# -*- coding: utf-8 -*-
"""authors_data · 四作者/来源具名数据集构建（异兽迷城 / 十日终焉 / 诸神愚戏 / AI）。

复用 style_data 的清洗与切块；每类独立采样，杜绝跨 split 重复文本。
产出: dataset-style/v03-authors/{train,held,test}.jsonl + authors.spec.json
运行（仓库根）: laya-venv python tools/laya-ft/authors_data.py
"""
import json
import random
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from style_data import PENGPAI_RAW, OTHER_TXT, AI_FILES, clean, blocks_of  # noqa: E402

ROOT = HERE.resolve().parents[1]
OUT = ROOT / "dataset-style" / "v03-authors"
QID = "style.author.v1.choice"
SEED = 20260928
CLASSES = ["yishou", "srzy", "sryx", "ai"]
# 每类 split 配额；ai 受语料上限约束取全部可用
QUOTA = {"yishou": (220, 45, 45), "srzy": (220, 45, 45), "sryx": (220, 45, 45), "ai": (80, 24, 23)}
CRITERIA = {
    "yishou": "《异兽迷城》正文。",
    "srzy": "《十日终焉》正文。",
    "sryx": "《诸神愚戏》正文。",
    "ai": "AI 生成的网文正文。",
}

rng = random.Random(SEED)


def blocks_from_files(paths):
    text = "\n".join(clean(p.read_text(encoding="utf-8", errors="ignore")) for p in paths)
    return blocks_of(text)


def main():
    pools = {
        "yishou": blocks_from_files(sorted(PENGPAI_RAW.glob("*.txt")) or sorted(PENGPAI_RAW.glob("*"))),
        "srzy": blocks_from_files([OTHER_TXT[0]]),
        "sryx": blocks_from_files([OTHER_TXT[1]]),
        "ai": blocks_from_files([ROOT / f for f in AI_FILES]),
    }
    for k, v in pools.items():
        print(f"[pool] {k}: {len(v)} blocks")

    rows = {"train": [], "held": [], "test": []}
    qobj = {"type": "choice", "instructions": "判断这段正文出自哪个来源。",
            "criteria": CRITERIA, "state_requires": ["场景文本"]}
    for cls in CLASSES:
        pool = list(dict.fromkeys(pools[cls]))  # 原文级去重
        rng.shuffle(pool)
        n_tr, n_he, n_te = QUOTA[cls]
        if len(pool) < n_tr + n_he + n_te:
            print(f"[warn] {cls} 池不足: {len(pool)} < {n_tr + n_he + n_te}，按比例缩减")
        taken = {"train": pool[:n_tr], "held": pool[n_tr:n_tr + n_he], "test": pool[n_tr + n_he:n_tr + n_he + n_te]}
        for split, texts in taken.items():
            for i, text in enumerate(texts):
                gold = {c: (1.0 if c == cls else 0.0) for c in CLASSES}
                rows[split].append({
                    "case_id": f"{cls}-{i:05d}",
                    "state": json.dumps({"场景文本": text}, ensure_ascii=False),
                    "questions": json.dumps({QID: qobj}, ensure_ascii=False),
                    "gold": json.dumps({QID: {"probabilities": gold}}, ensure_ascii=False),
                })

    OUT.mkdir(parents=True, exist_ok=True)
    for split, rs in rows.items():
        p = OUT / f"{split}.jsonl"
        p.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rs), encoding="utf-8")
        print(f"[out] {p} {len(rs)} 行")
    spec = {"version": "authors-v1", "questions": {QID: qobj}}
    (OUT / "authors.spec.json").write_text(json.dumps(spec, ensure_ascii=False, indent=2), encoding="utf-8")
    print("[out] authors.spec.json")


if __name__ == "__main__":
    main()
