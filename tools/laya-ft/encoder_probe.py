#!/usr/bin/env python3
"""encoder_probe · 冻结 encoder 表示力诊断（文风线 v2 架构决策的廉价先导实验）。

问题：v02 学生 noul 题判别力停在抛硬币水平（置信钉 0.51），假设是「冻结 mmBERT encoder
没把细粒度文体统计编进表示」。本脚本直接在冻结嵌入上训**线性探针**（softmax 回归，
5 折 CV，零微调）：
  - 探针 ≈ 多数类基线 → 表示层缺失信号，解冻 encoder（或换底座）才有意义；
  - 探针 ≫ 多数类   → 信号在表示里，瓶颈在决策头（加深加宽头部即可，不必动 encoder）。

用法：
  laya-venv python tools/laya-ft/encoder_probe.py --data dataset-style/v02 \
      --base <multilingual snapshot> --out dataset-style/v02/encoder-probe.json
"""
import argparse, json, sys
from pathlib import Path

import numpy as np
import torch

ROOT = Path(__file__).resolve().parents[2]

def softmax_reg(X, y, n_class, epochs=300, lr=0.5, l2=1e-4, seed=0):
    """简单 softmax 回归（全批 GD + L2），确定性。"""
    torch.manual_seed(seed)
    n, d = X.shape
    W = torch.zeros(d, n_class, requires_grad=True)
    b = torch.zeros(n_class, requires_grad=True)
    Xt = torch.tensor(X, dtype=torch.float32)
    yt = torch.tensor(y, dtype=torch.long)
    opt = torch.optim.LBFGS([W, b], max_iter=epochs, line_search_fn="strong_wolfe")

    def closure():
        opt.zero_grad()
        logits = Xt @ W + b
        loss = torch.nn.functional.cross_entropy(logits, yt) + l2 * (W ** 2).sum()
        loss.backward()
        return loss
    opt.step(closure)
    with torch.no_grad():
        pred = (Xt @ W + b).argmax(-1).numpy()
    return pred

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="dataset-style/v02")
    ap.add_argument("--base", required=True)
    ap.add_argument("--out", default="encoder-probe.json")
    ap.add_argument("--max-len", type=int, default=512)
    ap.add_argument("--folds", type=int, default=5)
    a = ap.parse_args()

    import laya
    agent = laya.load(a.base, device="cpu")
    tok = agent.tok
    enc = agent.model.encoder
    enc.eval()

    # 1) 收集唯一文本块与其标签（pair 行跳过）
    blocks = {}
    for split in ("train", "held", "test"):
        p = Path(a.data) / f"{split}.jsonl"
        if not p.exists():
            continue
        for l in p.read_text(encoding="utf-8").splitlines():
            if not l.strip():
                continue
            r = json.loads(l)
            state = json.loads(r["state"])
            if "场景文本" not in state:
                continue
            text = state["场景文本"]
            if text in blocks:
                continue
            gold = json.loads(r["gold"])
            labels = {}
            for qid, g in gold.items():
                if "true" in g:
                    labels[qid] = int(g["true"] > 0.5)
                elif qid.endswith(".choice") and "pengpai" in g.get("probabilities", {}):
                    labels[qid] = max(g["probabilities"], key=g["probabilities"].get)
                elif qid.endswith(".score"):
                    labels[qid] = max(g["probabilities"], key=g["probabilities"].get)
            blocks[text] = labels
    texts = list(blocks)
    print(f"[probe] 唯一文本块 {len(texts)}", file=sys.stderr)

    # 2) 冻结嵌入（均值池化），分批；落盘缓存——重跑免重算（CPU 全量约 20 分钟）
    cache_npy, cache_txt = Path(a.out).with_suffix(".emb.npy"), Path(a.out).with_suffix(".texts.json")
    if cache_npy.exists() and cache_txt.exists():
        old = json.loads(cache_txt.read_text(encoding="utf-8"))
        if old == texts:
            X = np.load(cache_npy)
            print(f"[probe] 命中嵌入缓存 {X.shape}", file=sys.stderr)
        else:
            X = None
    else:
        X = None
    if X is None:
        embs = []
        B = 16
        with torch.no_grad():
            for i in range(0, len(texts), B):
                batch = texts[i:i + B]
                enc_in = tok(batch, padding=True, truncation=True, max_length=a.max_len, return_tensors="pt")
                h = enc(input_ids=enc_in["input_ids"], attention_mask=enc_in["attention_mask"]).last_hidden_state
                m = enc_in["attention_mask"].unsqueeze(-1).float()
                emb = (h * m).sum(1) / m.sum(1).clamp(min=1)
                embs.append(torch.nn.functional.normalize(emb, dim=-1).numpy())
                if (i // B) % 10 == 0:
                    print(f"[probe] embed {i + len(batch)}/{len(texts)}", file=sys.stderr, flush=True)
        X = np.concatenate(embs)
        np.save(cache_npy, X)
        cache_txt.write_text(json.dumps(texts, ensure_ascii=False), encoding="utf-8")
    print(f"[probe] 嵌入 {X.shape}", file=sys.stderr)

    # 3) 各标签 5 折 CV 线性探针
    from collections import Counter
    report = {"gate": "encoder-probe", "base": a.base, "n_blocks": len(texts), "dim": int(X.shape[1]),
              "probe": "softmax-reg L2, 5-fold CV (train folds fit, held fold eval)", "labels": {}}
    qids = sorted({q for labels in blocks.values() for q in labels})
    rng = np.random.RandomState(20260927)
    idx = rng.permutation(len(texts))
    for qid in qids:
        ys_all = np.array([blocks[t].get(qid, None) for t in texts], dtype=object)
        mask = np.array([y is not None for y in ys_all])
        raw = [v for v in ys_all[mask]]
        classes = sorted(set(raw), key=lambda x: (isinstance(x, str), str(x)))
        cls_map = {c: i for i, c in enumerate(classes)}
        ys = np.array([cls_map[v] for v in raw])
        Xm = X[mask]
        n_class = len(classes)
        if n_class < 2:
            continue
        majority = max(Counter(ys.tolist()).values()) / len(ys)
        fold_acc = []
        for f in range(a.folds):
            test_idx = idx[mask][f::a.folds]
            tm = np.ones(len(Xm), dtype=bool)
            tm[test_idx] = False
            tr_idx = np.where(tm)[0]
            torch.manual_seed(0)
            d = Xm.shape[1]
            W = torch.zeros(d, n_class, requires_grad=True)
            b = torch.zeros(n_class, requires_grad=True)
            Xt = torch.tensor(Xm[tr_idx], dtype=torch.float32)
            yt = torch.tensor(ys[tr_idx], dtype=torch.long)
            Xe = torch.tensor(Xm[test_idx], dtype=torch.float32)
            opt = torch.optim.LBFGS([W, b], max_iter=300, line_search_fn="strong_wolfe")
            def closure():
                opt.zero_grad()
                loss = torch.nn.functional.cross_entropy(Xt @ W + b, yt) + 1e-4 * (W ** 2).sum()
                loss.backward()
                return loss
            opt.step(closure)
            with torch.no_grad():
                pred = (Xe @ W + b).argmax(-1).numpy()
            fold_acc.append(float((pred == ys[test_idx]).mean()))
        report["labels"][qid] = {
            "n": int(len(ys)), "n_class": n_class,
            "majority_baseline": round(majority, 4),
            "probe_cv_acc": round(float(np.mean(fold_acc)), 4),
            "probe_cv_std": round(float(np.std(fold_acc)), 4),
            "delta_vs_majority": round(float(np.mean(fold_acc)) - majority, 4),
        }
        print(f"  {qid:34s} probe={np.mean(fold_acc):.3f}±{np.std(fold_acc):.3f}  majority={majority:.3f}", file=sys.stderr)

    Path(a.out).write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps({"out": a.out, "labels": report["labels"]}, ensure_ascii=False, indent=1))

if __name__ == "__main__":
    main()
