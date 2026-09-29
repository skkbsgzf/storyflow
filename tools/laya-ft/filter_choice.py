#!/usr/bin/env python3
"""filter_choice · 数据集行内题面过滤：只保留 choice 题（来源判别+真伪配对）。

依据 encoder_probe 实证：choice 信号在冻结表示里线性可分 89.9%（探针），而 v02 学生
只考出 55.3%——瓶颈在决策头；noul 统计题连探针都平多数类且可被扫描器确定性计算，
退出学生赛道。本过滤器产出 choice-only 数据集供头部重训（v03）。

用法：python tools/laya-ft/filter_choice.py --src dataset-style/v02 --dst dataset-style/v02-choice
"""
import argparse, json
from pathlib import Path

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--dst", required=True)
    a = ap.parse_args()
    out = Path(a.dst)
    out.mkdir(parents=True, exist_ok=True)
    for split in ("train", "held", "test"):
        src = Path(a.src) / f"{split}.jsonl"
        if not src.exists():
            continue
        kept, dropped = [], 0
        for l in src.read_text(encoding="utf-8").splitlines():
            if not l.strip():
                continue
            r = json.loads(l)
            qs = json.loads(r["questions"])
            choice = {qid: q for qid, q in qs.items() if qid.endswith(".choice")}
            if not choice:
                dropped += 1
                continue
            gold = json.loads(r["gold"])
            r["questions"] = json.dumps(choice, ensure_ascii=False)
            r["gold"] = json.dumps({q: gold[q] for q in choice if q in gold}, ensure_ascii=False)
            kept.append(json.dumps(r, ensure_ascii=False))
        (out / f"{split}.jsonl").write_text("\n".join(kept) + "\n", encoding="utf-8")
        print(f"{split}: 保留 {len(kept)} 丢弃 {dropped}")
    print(f"→ {out}")

if __name__ == "__main__":
    main()
