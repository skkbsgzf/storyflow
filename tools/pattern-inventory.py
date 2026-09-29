#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""A 盘点 · 无主语/施事缺失句式的确定性候选清单（同尺扫稿件与语料，只列候选不裁决）。

口径（全部命中=「候选」，合法与否归人/4B，本脚本零豁免判断）：
  Z1 副词/助动词/连词开局（典型零主语承前省）
  Z2 谓语开局（动词+不/得/到…补语结构直接起句）
  Z3 宾语/主题前置顶主语（「X的，……」「X他记了一路」型）
  Z4 裸代词开局（他/她/它/自己起句——R6 多角色画面禁条的候选面）
对白（“…”内）与 markdown 结构行不扫。JSON 结果 + Markdown 表stdout。
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

ADJ = r"就|也|还|又|才|却|但|可|倒|总|连|于是|然后|接着|已经|曾经|反而|索性|干脆|只好|只能|必须|需要|应该|得|要|想|会|能|反正|果然|居然|竟然|偏偏|可惜|幸好|当然|眼看"
RE_Z1 = re.compile(rf"^(?:{ADJ})[\u4e00-\u9fff]")
RE_Z2 = re.compile(r"^[\u4e00-\u9fff]{1,3}(?:不|没|得|到|坏|完|光|死)[\u4e00-\u9fff]")
RE_Z3 = re.compile(r"^[\u4e00-\u9fff]{1,6}的[，,]")
RE_Z4 = re.compile(r"^(他|她|它|自己|他们|她们)(?![们])")
DIALOG = re.compile(r"“[^”]*”")
SENT_SPLIT = re.compile(r"[。！？；…]+|\n")


def narrative_sentences(md_text: str):
    text = re.sub(r"^---[\s\S]*?---", "", md_text, count=1)  # frontmatter
    out = []
    for raw in text.splitlines():
        s = raw.strip()
        if not s or s.startswith(("#", ">", "|", "- ", "* ", "```")):
            continue
        s = DIALOG.sub("", s)
        for seg in SENT_SPLIT.split(s):
            seg = re.sub(r"\s+", "", seg).strip("，,、：:“”\"'（）()《》")
            if 2 <= len(seg) <= 60:
                out.append(seg)
    return out


def scan_sents(sents):
    c = {"Z1": 0, "Z2": 0, "Z3": 0, "Z4": 0}
    ex = {k: [] for k in c}
    for s in sents:
        for k, r in (("Z1", RE_Z1), ("Z2", RE_Z2), ("Z3", RE_Z3), ("Z4", RE_Z4)):
            if r.match(s):
                c[k] += 1
                if len(ex[k]) < 6:
                    ex[k].append(s)
                break  # 一句只记首个命中，防重复计数
    return c, ex


def load_jsonl_plans(path: Path, n=200):
    docs = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            if len(docs) >= n:
                break
            try:
                d = json.loads(line)
            except json.JSONDecodeError:
                continue
            txt = (d.get("topPlanning") or "") + "\n" + (d.get("logline") or "")
            cjk = sum(1 for ch in txt if "\u4e00" <= ch <= "\u9fff")
            if cjk >= 100:
                docs.append(txt)
    return docs


def main():
    targets = []  # (label, group, [sent lists per doc])
    proj = ROOT / "projects/p-kunxiu-001"
    groups = [
        ("kunxiu 稿", [proj / "04-写作/正文.md", proj / "04-写作/终稿.md",
                       *sorted((proj / "04-写作/novel-chapter").glob("*.md")),
                       *sorted(proj.glob("snapshots/m4.ghostwrite/r*/04-写作/*.md"))]),
        ("对标语料 kb/benchmark", sorted((ROOT / "knowledge/benchmark").glob("*-cn.md"))),
    ]
    for glabel, files in groups:
        for fp in files:
            if fp.exists():
                targets.append((glabel, fp.name, narrative_sentences(fp.read_text(encoding="utf-8"))))
    jl = ROOT / "src/kakaxing-Json/data/scriptrawstone.jsonl"
    if jl.exists():
        for i, plan in enumerate(load_jsonl_plans(jl)):
            targets.append(("策划案语料 rawstone", f"plan{i:03d}", narrative_sentences(plan)))

    agg = {}
    for glabel, name, sents in targets:
        if not sents:
            continue
        c, _ = scan_sents(sents)
        g = agg.setdefault(glabel, {"docs": 0, "sents": 0, **{k: 0 for k in c}, "ex": {k: [] for k in c}})
        g["docs"] += 1
        g["sents"] += len(sents)
        for k, v in c.items():
            g[k] += v
            g["ex"][k].extend(scan_sents(sents)[1][k][:2])
    lines = ["| 组 | 文档数 | 叙述句数 | Z1 副词开局% | Z2 谓语开局% | Z3 的字主题前置% | Z4 裸代词开局% |",
             "| --- | --- | --- | --- | --- | --- | --- |"]
    out = {}
    for g, d in agg.items():
        row = {k: round(d[k] / d["sents"] * 100, 2) for k in ("Z1", "Z2", "Z3", "Z4")}
        out[g] = {"docs": d["docs"], "sents": d["sents"], "pct": row}
        lines.append(f"| {g} | {d['docs']} | {d['sents']} | {row['Z1']} | {row['Z2']} | {row['Z3']} | {row['Z4']} |")
    print("\n".join(lines))
    Path(ROOT / "docs/盘点-无主语模式分布-data.json").write_text(
        json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
