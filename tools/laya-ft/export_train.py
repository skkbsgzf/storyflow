#!/usr/bin/env python3
"""export_train · 标注结果 → Laya typed-decisions 训练格式（train/held/test 70/15/15）。

每行（与官方微调 notebook 数据形状对齐，训练脚本零改动只换数据路径）：
  {"state": "<state JSON 字符串>", "questions": "<该案例的问题 JSON 字符串>", "gold": "<gold JSON 字符串>"}
gold 形状：{"qid": {"probabilities": {选项/档位: 概率}}}；noul 转成 {true,false} 两选项。
"""
import argparse, json, random
from pathlib import Path

HERE = Path(__file__).parent

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--labeled", default="labeled.jsonl")
    ap.add_argument("--spec", default=str(HERE / "questions.spec.json"))
    ap.add_argument("--seed", type=int, default=20260923)
    ap.add_argument("--outdir", default="dataset")
    a = ap.parse_args()
    spec = json.loads(Path(a.spec).read_text(encoding="utf-8"))["questions"]
    rows = [json.loads(l) for l in Path(a.labeled).read_text(encoding="utf-8").splitlines() if l.strip()]

    by_case = {}
    for r in rows:
        by_case.setdefault(r["case_id"], {"state": r["state"], "items": []})
        by_case[r["case_id"]]["items"].append(r)

    rng = random.Random(a.seed)
    case_ids = sorted(by_case)
    rng.shuffle(case_ids)
    n = len(case_ids)
    n_train = int(n * 0.70)
    n_held = int(n * 0.15)
    splits = {"train": case_ids[:n_train], "held": case_ids[n_train:n_train + n_held], "test": case_ids[n_train + n_held:]}

    outdir = Path(a.outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    counts = {}
    for split, ids in splits.items():
        lines = []
        for cid in ids:
            entry = by_case[cid]
            qids = sorted({r["qid"] for r in entry["items"]})
            questions = {q: spec[q] for q in qids if q in spec}
            gold = {r["qid"]: {"probabilities": r["gold_soft"]} for r in entry["items"]}
            lines.append(json.dumps({
                "state": json.dumps(entry["state"], ensure_ascii=False),
                "questions": json.dumps(questions, ensure_ascii=False),
                "gold": json.dumps(gold, ensure_ascii=False),
            }, ensure_ascii=False))
        (outdir / f"{split}.jsonl").write_text("\n".join(lines), encoding="utf-8")
        counts[split] = len(lines)
    print(json.dumps({"outdir": str(outdir), "cases": len(case_ids), **counts,
                      "note": "held=校准（GATE-2 拟温度）/ test=验收（GATE-3），均不参与训练"}, ensure_ascii=False))

if __name__ == "__main__":
    main()
