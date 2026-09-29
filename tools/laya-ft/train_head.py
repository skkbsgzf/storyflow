#!/usr/bin/env python3
"""train_head · Laya v1 学生训练执行体（冻结 encoder，只训决策头）。

= 官方 laya_finetune_typed_decisions notebook 的本地化（README 口径的三处改动）：
  ① 数据源换本地 train/held.jsonl（export_train.py 产物，70/15/15）；
  ② 底座暖启动 convaiinnovations/laya multilingual（本地路径直读，不走网络）；
  ③ proper reward 损失（log score + spherical0.5；score 桶加 −RPS）。
纪律：encoder 全程冻结（不 optimizer、detach 梯度）；训练只碰 train.jsonl；
held 只用于每轮评估与选 best（拟温度在 fit_temperature.py，用 held，不碰 test）。

运行（CPU）：
  tools/_vendor/laya-venv/Scripts/python.exe tools/laya-ft/train_head.py \
    --base <multilingual snapshot 路径> \
    --train dataset/train.jsonl --held dataset/held.jsonl --out student-v1 \
    [--epochs 6 --lr 3e-4 --batch 8 --grad-accum 2]
产物：out/rl_agent_config.json + model.safetensors + tokenizer/ + encoder/ + train-log.json
"""
import argparse, json, os, shutil, sys, time
from pathlib import Path

import numpy as np
import torch

import laya
from laya.common import QTYPES, QTYPE_NAMES, build_sequence, collate_items, proper_reward, render_options


def q_to_internal(qdef):
    t = qdef["type"]
    crit = qdef.get("criteria")
    if t == "choice" and isinstance(crit, list):
        crit = {c: None for c in crit}
    return {"t": t, "ins": str(qdef["instructions"]), "crit": crit}


def target_vec(qdef, gold_probs):
    """gold_soft 频率分布 → 与 marker 顺序对齐的目标分布。noul 序 = [false, true]。"""
    q = q_to_internal(qdef)
    n = len(render_options(q))
    if q["t"] == "noul":
        v = [float(gold_probs.get("false", 0.0)), float(gold_probs.get("true", 0.0))]
    elif q["t"] == "choice":
        v = [float(gold_probs.get(k, 0.0)) for k in q["crit"].keys()]
    else:
        v = [float(gold_probs.get(str(i), 0.0)) for i in range(n)]
    s = sum(v)
    return [x / s for x in v] if s > 0 else [1.0 / n] * n


def make_items(agent, rows, max_len, head_max_len, log):
    items, skipped = [], []
    for row in rows:
        state = json.loads(row["state"])
        questions = json.loads(row["questions"])
        gold = json.loads(row["gold"])
        for qid, qdef in questions.items():
            q = q_to_internal(qdef)
            try:
                ids, markers = build_sequence(agent.tok, state, q, max_len, head_max_len)
            except Exception as e:
                skipped.append({"qid": qid, "why": str(e)[:80]})
                continue
            if len(markers) != len(render_options(q)):
                skipped.append({"qid": qid, "why": "options 超 head_max_len，截断丢 marker"})
                continue
            gp = gold.get(qid, {}).get("probabilities", {})
            items.append({"ids": ids, "markers": markers, "qtype": QTYPES[q["t"]],
                          "target": target_vec(qdef, gp), "qid": qid})
    if skipped:
        log(f"[train] 跳过 {len(skipped)} 个 (case,qid) 例：{skipped[:3]}")
    return items


def forward(agent, batch_items, device="cpu"):
    b = collate_items([batch_items], agent.tok.pad_token_id)
    for k in list(b.keys()):
        if torch.is_tensor(b[k]):
            b[k] = b[k].to(device)
    logits, _act = agent.model(
        b["input_ids"], b["attention_mask"], b["marker_pos"], b["marker_mask"],
        b["qtype"], detach_encoder=True)
    mm = b["marker_mask"]
    p = torch.softmax(logits.masked_fill(~mm, -1e4), -1)
    return p, b, logits


def evaluate(agent, items, batch=8, device="cpu"):
    """与教师 argmax 的一致率（分题型）。无梯度，纯推理。"""
    agree = {"noul": [0, 0], "choice": [0, 0], "score": [0, 0]}
    abs_err = []
    with torch.no_grad():
        for i in range(0, len(items), batch):
            grp = items[i:i + batch]
            p, b, _ = forward(agent, grp, device)
            pn, tn = p.cpu().numpy(), b["target"].cpu().numpy()
            for j, it in enumerate(grp):
                k = len(it["markers"])
                pj, tj = pn[j, :k], tn[j, :k]
                qname = QTYPE_NAMES[int(it["qtype"])]
                agree[qname][1] += 1
                agree[qname][0] += int(pj.argmax() == tj.argmax())
                if qname == "score":
                    abs_err.append(abs(float((np.arange(k) * pj).sum() - (np.arange(k) * tj).sum())))
    tot_a = sum(v[0] for v in agree.values())
    tot_n = sum(v[1] for v in agree.values()) or 1
    return {"agreement_overall": round(tot_a / tot_n, 4),
            "agreement_by_type": {k: (round(v[0] / v[1], 4) if v[1] else None) for k, v in agree.items()},
            "score_mean_abs_err": round(float(np.mean(abs_err)), 4) if abs_err else None}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True, help="multilingual snapshot 本地路径")
    ap.add_argument("--train", required=True)
    ap.add_argument("--held", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--epochs", type=int, default=6)
    ap.add_argument("--lr", type=float, default=3e-4)
    ap.add_argument("--batch", type=int, default=8)
    ap.add_argument("--grad-accum", type=int, default=2)
    ap.add_argument("--threads", type=int, default=0, help="torch 线程数（0=全给）")
    ap.add_argument("--device", default="auto", help="auto（cuda 可用则用）/ cuda / cpu")
    ap.add_argument("--seed", type=int, default=20260923)
    a = ap.parse_args()

    def log(*x):
        print(*x, file=sys.stderr, flush=True)

    if a.threads:
        torch.set_num_threads(a.threads)
    torch.manual_seed(a.seed)
    np.random.seed(a.seed)

    t0 = time.time()
    device = a.device if a.device != "auto" else ("cuda" if torch.cuda.is_available() else "cpu")
    agent = laya.load(a.base, device=device)
    log(f"[train] device={device}")
    cfg = agent.cfg
    max_len, head_max_len = cfg.get("max_len", 1024), cfg.get("head_max_len", 256)

    # 冻结 encoder（+ act_head：本管线无 action 标签，不训练保持出厂值）
    trainable, frozen = [], []
    for name, prm in agent.model.named_parameters():
        if name.startswith(("head.", "type_emb.", "scorer.")):
            prm.requires_grad_(True)
            trainable.append(prm)
        else:
            prm.requires_grad_(False)
            frozen.append(name)
    log(f"[train] 可训参数 {sum(p.numel() for p in trainable)/1e6:.1f}M ｜ 冻结 {len(frozen)} 组（encoder+act_head）")

    load_rows = lambda p: [json.loads(l) for l in Path(p).read_text(encoding="utf-8").splitlines() if l.strip()]
    tr_items = make_items(agent, load_rows(a.train), max_len, head_max_len, log)
    hd_items = make_items(agent, load_rows(a.held), max_len, head_max_len, log)
    log(f"[train] train {len(tr_items)} 题项 ｜ held {len(hd_items)}")

    opt = torch.optim.AdamW(trainable, lr=a.lr)
    base_eval = evaluate(agent, hd_items, device=device)
    log("[train] 暖启动基线（未训）：", json.dumps(base_eval, ensure_ascii=False))

    hist = [{"epoch": 0, "loss": None, **base_eval, "sec": round(time.time() - t0)}]
    best = (base_eval["agreement_overall"], 0)
    best_sd = {k: v.detach().clone() for k, v in agent.model.state_dict().items()}
    step = 0
    for ep in range(1, a.epochs + 1):
        rng = np.random.RandomState(a.seed + ep)
        order = rng.permutation(len(tr_items))
        losses = []
        opt.zero_grad()
        for i, idx in enumerate(order):
            grp = [tr_items[j] for j in order[i:i + a.batch]]
            p, b, _ = forward(agent, grp, device=device)
            r = proper_reward(p, b["target"], b["qtype"], b["marker_mask"].float())
            loss = -r.mean() / (a.batch * a.grad_accum)
            loss.backward()
            losses.append(float(-r.mean().detach()))
            if (i + 1) % a.grad_accum == 0 or i + 1 == len(order):
                torch.nn.utils.clip_grad_norm_(trainable, 1.0)
                opt.step()
                opt.zero_grad()
                step += 1
        ev = evaluate(agent, hd_items, device=device)
        log(f"[train] epoch {ep}/{a.epochs} loss={np.mean(losses):.4f} ｜ held {json.dumps(ev, ensure_ascii=False)}")
        hist.append({"epoch": ep, "loss": round(float(np.mean(losses)), 5), **ev,
                     "sec": round(time.time() - t0)})
        if ev["agreement_overall"] > best[0]:  # 严格优于才换：平局取更早轮，留拟合余量
            best = (ev["agreement_overall"], ep)
            best_sd = {k: v.detach().clone() for k, v in agent.model.state_dict().items()}
    agent.model.load_state_dict(best_sd)  # 落盘 = best（按 held 一致率选轮），不是末轮

    # 保存 best（按 held 一致率；epoch 0 = 重存暖启动也算数）
    outdir = Path(a.out)
    if outdir.exists():
        shutil.rmtree(outdir)
    outdir.mkdir(parents=True)
    from safetensors.torch import save_file
    sd = {k: v.detach().clone().contiguous().cpu() for k, v in agent.model.state_dict().items()}
    save_file(sd, str(outdir / "model.safetensors"), metadata={"format": "pt"})
    shutil.copytree(str(Path(a.base) / "tokenizer"), str(outdir / "tokenizer"))
    shutil.copytree(str(Path(a.base) / "encoder"), str(outdir / "encoder"))
    new_cfg = dict(cfg)
    new_cfg["training"] = {"fine_tuned_from_checkpoint": True, "frozen_encoder": True,
                           "trainable": "head+type_emb+scorer", "epochs_completed": a.epochs,
                           "best_epoch": best[1], "best_held_agreement": best[0],
                           "teacher": "semif Qwen3.5-4B daemon（GSS K=5 软标签）",
                           "spec": "laya-question-spec@1 v0.2.0",
                           "hours": round((time.time() - t0) / 3600, 2)}
    (outdir / "rl_agent_config.json").write_text(json.dumps(new_cfg, ensure_ascii=False, indent=1), encoding="utf-8")
    (outdir / "train-log.json").write_text(json.dumps(
        {"history": hist, "config": vars(a)}, ensure_ascii=False, indent=1), encoding="utf-8")
    log(f"[train] 学生 → {outdir} ｜ best held={best[0]:.3f} (epoch {best[1]}) ｜ 总耗时 {(time.time()-t0)/60:.1f}min")


if __name__ == "__main__":
    main()
