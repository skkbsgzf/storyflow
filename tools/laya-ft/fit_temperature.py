#!/usr/bin/env python3
"""fit_temperature · 用 held split 给学生拟合分桶温度，写回 rl_agent_config.json。

对齐部署口径：置信度按 Agent.system_one 的真实通路算——softmax(logits/t) →
confidence_from_probs（归一化熵），按 temp_bucket(qtype, 选项数) 分桶网格搜温度，
最小化 ece_score。只碰 held，不碰 test（test 留给 accept.py）。
multilingual 出厂 temperature 全 1（官方报告出厂 ECE 0.387），训后必须重拟。

运行：
  tools/_vendor/laya-venv/Scripts/python.exe tools/laya-ft/fit_temperature.py \
    --student student-v1 --held dataset/held.jsonl [--grid 0.5:5.0:0.05]
"""
import argparse, json
from pathlib import Path

import numpy as np
import torch

import laya
from laya.common import (QTYPES, build_sequence, collate_items, confidence_from_probs,
                         ece_score, render_options, temp_bucket)
from train_head import q_to_internal  # 同目录复用，marker 口径与训练一致


def ok_index(qdef, gp):
    """教师 argmax 在该题 marker 序里的下标；无 gold → None。noul marker 序 = [false, true]。"""
    truth = max(gp, key=gp.get)
    q = q_to_internal(qdef)
    if q["t"] == "noul":
        return 1 if truth == "true" else 0
    if q["t"] == "choice":
        keys = list(q["crit"].keys())
        return keys.index(truth) if truth in keys else None
    return int(truth) if str(truth).isdigit() else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--student", required=True)
    ap.add_argument("--held", required=True)
    ap.add_argument("--grid", default="0.5:5.0:0.05")
    ap.add_argument("--min-n", type=int, default=8, help="桶内样本低于此数不拟合（防过拟合），温度保持 1.0")
    ap.add_argument("--threads", type=int, default=0)
    a = ap.parse_args()
    if a.threads:
        torch.set_num_threads(a.threads)

    agent = laya.load(a.student, device="cpu")
    cfg = agent.cfg
    max_len, head_max_len = cfg.get("max_len", 1024), cfg.get("head_max_len", 256)

    obs = []  # (bucket, z(未缩 logits), k, ok_idx)
    rows = [json.loads(l) for l in Path(a.held).read_text(encoding="utf-8").splitlines() if l.strip()]
    with torch.no_grad():
        for row in rows:
            state = json.loads(row["state"])
            questions = json.loads(row["questions"])
            gold = json.loads(row["gold"])
            items = []
            for qid, qdef in questions.items():
                q = q_to_internal(qdef)
                ids, markers = build_sequence(agent.tok, state, q, max_len, head_max_len)
                if len(markers) != len(render_options(q)):
                    continue
                oi = ok_index(qdef, gold.get(qid, {}).get("probabilities", {}))
                if oi is None or oi >= len(markers):
                    continue
                items.append({"ids": ids, "markers": markers, "qtype": QTYPES[q["t"]],
                              "ok": oi, "k": len(markers)})
            if not items:
                continue
            b = collate_items([items], agent.tok.pad_token_id)
            logits, _ = agent.model(b["input_ids"], b["attention_mask"],
                                    b["marker_pos"], b["marker_mask"], b["qtype"],
                                    detach_encoder=True)
            lg = logits.float().cpu().numpy()
            for j, it in enumerate(items):
                obs.append((temp_bucket(it["qtype"], it["k"]), lg[j, :it["k"]], it["k"], it["ok"]))

    def ece_at(t_of):
        confs, oks = [], []
        for _, z, k, oi in sel:
            zz = z * t_of
            p = np.exp(zz - zz.max()); p /= p.sum()
            confs.append(confidence_from_probs(p, k))
            oks.append(1.0 if int(np.argmax(zz)) == oi else 0.0)
        return ece_score(np.array(confs), np.array(oks))

    lo, hi, st = [float(x) for x in a.grid.split(":")]
    temps, report = {}, {}
    for bucket in sorted({o[0] for o in obs}):
        sel = [o for o in obs if o[0] == bucket]
        raw = ece_at(1.0)
        if len(sel) < a.min_n:
            report[bucket] = {"n": len(sel), "ece_raw": round(raw, 4), "temperature": 1.0,
                              "note": f"样本 <{a.min_n} 不拟合"}
            continue
        best_e, best_t = None, 1.0
        t = lo
        while t <= hi + 1e-9:
            e = ece_at(1.0 / t)
            if best_e is None or e < best_e - 1e-12:
                best_e, best_t = e, t
            t += st
        temps[bucket] = round(best_t, 3)
        report[bucket] = {"n": len(sel), "ece_raw": round(raw, 4),
                          "ece_fitted": round(best_e, 4), "temperature": round(best_t, 3)}

    cfg["temperature_by_options"] = temps
    Path(a.student, "rl_agent_config.json").write_text(
        json.dumps(cfg, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps({"gate": "temperature-fit(held)", "buckets": report,
                      "written_to": str(Path(a.student, "rl_agent_config.json"))},
                     ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
