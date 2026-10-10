#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""kb-eval.py —— 检索质量探针集生成器（批次3c R1 · before 基线的探针面）。

配套件：scripts/kb-eval-exec.ts（评测执行器，函数级直调 core/src/kb.ts::kbSearch 出
MRR / recall@5 / recall@10）。本件只产**确定性探针集**，不做评测——python 调不动 TS，
harness 拆两件：本件生成探针 json（收据，可复跑），执行器读探针调 kbSearch 出指标。

用法（仓库根；本机 python 指商店 stub 时用完整路径）：
  <python> tools/kb-eval.py                          # 探针集 → projects/_reports/kb-eval-probes-20261011.json
  <python> tools/kb-eval.py --out <path>             # 自定义落点
  <python> tools/kb-eval.py --selfcheck              # 合成 fixture 自测生成规则，零真实写盘

▌口径诚实（本工具的头等纪律）────────────────────────────────────────────
探针只有两档，**不是绝对语义评测**：
  ① 词面探针（lexical）——本卡标题的子集/变序 + 一个关键词，考标题/词面通道；
  ② 交叉探针（cross）——同域**其他卡**的正文关键句作查询、期望命中**本卡**，
    查询与本卡零词面重叠，考语义/关联检索（基线词面打分器此项天然偏低，属预期）。
分数只用于 **before/after 同探针集相对比较**（批次3c R2 聚类索引的硬门槛
after ≥ before），不自称 SOTA 绝对分，不与任何外部榜单对表。

▌探针生成规则（确定性，无时间戳无随机；重跑逐字节一致）──────────────────────
1. 卡 universe：knowledge/ 下全部 .md（README.md 除外），按 id 升序；
   且必须出现在编译产物 kit/hypergraph.rag.json 里（检索面=编译图，kbSearch 走图
   打分；不在图里的卡永无命中可能，生成探针=给基线投系统计零分的毒票）。
   frontmatter 解析与 kit-compile front() 同口径：JSON 优先、YAML 裸键兜底。
2. 词面探针 ×1/卡：标题按中英标点切段 → 丢弃「对标」等前缀段 → 段序倒置 + 追加
   首个关键词（tags[0] → dimension → genres 首段 → 域名，逐级回退）。
3. 交叉探针 ×1/卡：同域按 id 升序取**下一张**（循环回绕）为供体；取供体正文首个
   长度 ≥8 的非空行，剥 markdown 记号后截前 24 字为查询，期望命中**本卡**。
   域内卡 <2 张不出交叉探针。
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
KNOWLEDGE = REPO / "knowledge"
GRAPH = REPO / "kit" / "hypergraph.rag.json"
DEFAULT_OUT = REPO / "projects" / "_reports" / "kb-eval-probes-20261011.json"

# 标题切段：中英标点与空白都算分隔（保留字母数字与 CJK 本体）
SEG_SPLIT = re.compile(r"[·：:，,。；;（）()《》<>「」『』【】\[\]—\-–_／/！!？?、.\s]+")
# 词面探针丢弃的噪声段（benchmark 卡统一前缀等）
SEG_DROP = {"对标", "标", "卡"}
# 交叉探针：正文行剥 markdown 记号（行首行尾的 #/>/-/*/`/空白都剥）
MD_STRIP = re.compile(r"^[#>\-\*\+\s`*]+|[`\*\s]+$")
KEY_SENT_MIN = 8   # 交叉探针供体关键句的最短长度（字）
KEY_SENT_CLIP = 24  # 交叉探针查询截断长度（字）


def parse_frontmatter(text: str) -> tuple[dict, str]:
    """卡 frontmatter 解析（与 kit-compile front() 同口径：JSON 优先、YAML 裸键兜底）。

    返回 (meta, body)。JSON 解析失败时只认 id/title/dimension/genres/tags 五个键的
    裸键行——探针生成不需要完整 YAML。"""
    m = re.match(r"^---\r?\n([\s\S]*?)\r?\n---", text)
    if not m:
        return {}, text
    head, body = m.group(1) or "", text[m.end():]
    try:
        meta = json.loads(head)
        if isinstance(meta, dict):
            return meta, body
    except (ValueError, TypeError):
        pass
    meta: dict = {}
    for key in ("id", "title", "dimension", "genres"):
        y = re.search(rf"^{key}:\s*(.+)$", head, re.M)
        if y:
            meta[key] = y.group(1).strip().strip("'\"")
    t = re.search(r"^tags:\s*\[([^\]]*)\]", head, re.M)
    if t:
        meta["tags"] = [x.strip().strip("'\"") for x in t.group(1).split(",") if x.strip()]
    return meta, body


def first_keyword(meta: dict, domain: str) -> str:
    """词面探针的追加关键词：tags[0] → dimension → genres 首段 → 域名，逐级回退。"""
    tags = meta.get("tags") or []
    if isinstance(tags, list) and tags:
        return str(tags[0]).strip()
    if meta.get("dimension"):
        return str(meta["dimension"]).strip()
    genres = str(meta.get("genres") or "").strip()
    if genres:
        return genres.split(",")[0].split("，")[0].split("/")[0].strip() or domain
    return domain


def lexical_query(title: str, meta: dict, domain: str) -> str:
    """词面探针：标题切段去噪 → 倒序 → 追加首个关键词（子集+变序，防自原样词面）。"""
    segs = [s for s in SEG_SPLIT.split(title or "") if s and s not in SEG_DROP]
    kw = first_keyword(meta, domain)
    if len(segs) >= 2:
        parts = list(reversed(segs))
    elif segs:
        parts = [segs[0]]
    else:
        parts = [title or domain]
    if kw and kw not in parts:
        parts.append(kw)
    return " ".join(parts)


def key_sentence(body: str) -> str | None:
    """供体正文关键句：首个长度 ≥8 的非空行，剥 markdown 记号，截前 24 字。"""
    for line in body.splitlines():
        s = MD_STRIP.sub("", line.strip()).strip()
        if len(s) >= KEY_SENT_MIN:
            return s[:KEY_SENT_CLIP].rstrip("。，；：、,. ;:！？!")
    return None


def collect_cards() -> tuple[list[dict], dict]:
    """扫盘收集探针 universe（id 升序；须在编译图内）。返回 (cards, 统计)。"""
    graph_ids: set[str] = set()
    if GRAPH.exists():
        g = json.loads(GRAPH.read_text(encoding="utf-8"))
        graph_ids = {e.get("id") for e in g.get("entries", []) if e.get("id")}
    cards: list[dict] = []
    stats = {"mdTotal": 0, "skippedNoId": 0, "skippedNotInGraph": 0}
    for root, dirs, files in os.walk(KNOWLEDGE):
        dirs.sort()
        for f in sorted(files):
            if not f.endswith(".md") or f == "README.md":
                continue
            stats["mdTotal"] += 1
            p = Path(root) / f
            meta, body = parse_frontmatter(p.read_text(encoding="utf-8"))
            cid = str(meta.get("id") or "").strip()
            if not cid:
                stats["skippedNoId"] += 1
                continue
            if cid not in graph_ids:
                stats["skippedNotInGraph"] += 1
                continue
            domain = p.relative_to(KNOWLEDGE).parts[0]
            cards.append({
                "id": cid,
                "domain": domain,
                "title": str(meta.get("title") or "").strip(),
                "body": body,
                "meta": meta,
            })
    cards.sort(key=lambda c: c["id"])
    return cards, stats


def build_probes(cards: list[dict]) -> list[dict]:
    """生成探针（确定性）：逐卡先词面后交叉；探针 id 按生成序 p0001… 连续编。"""
    by_domain: dict[str, list[dict]] = {}
    for c in cards:
        by_domain.setdefault(c["domain"], []).append(c)
    probes: list[dict] = []
    for c in cards:
        probes.append({
            "type": "lexical",
            "domain": c["domain"],
            "target": c["id"],
            "query": lexical_query(c["title"], c["meta"], c["domain"]),
        })
        peers = by_domain[c["domain"]]
        if len(peers) < 2:
            continue
        donor = peers[(peers.index(c) + 1) % len(peers)]  # 同域下一张（循环回绕）
        sent = key_sentence(donor["body"]) or donor["title"]  # 无正文回退供体标题
        probes.append({
            "type": "cross",
            "domain": c["domain"],
            "target": c["id"],
            "donor": donor["id"],
            "query": sent,
        })
    for i, p in enumerate(probes, 1):
        p["id"] = f"p{i:04d}"
    probes = [{k: p[k] for k in ("id", "type", "domain", "target", "query", "donor") if k in p}
              for p in probes]
    return probes


def selfcheck() -> int:
    """合成 fixture 自测生成规则（零真实写盘、零真实语料依赖）。"""
    ok = True

    def expect(name: str, cond: bool):
        nonlocal ok
        print(f"  {'OK ' if cond else 'FAIL'} {name}")
        ok = ok and cond

    fm_json, body = parse_frontmatter('---\n{"id": "kb/x/a", "title": "对标 · 测试甲：开局即高潮", "tags": ["爽感"]}\n---\n\n# 标题\n\n正文第一行足够长了可以当关键句。\n')
    expect("JSON frontmatter 解析", fm_json.get("id") == "kb/x/a")
    expect("正文切出", "正文第一行" in body)
    expect("词面探针（去对标+倒序+关键词）", lexical_query("对标 · 测试甲：开局即高潮", fm_json, "x") == "开局即高潮 测试甲 爽感")
    fm_yaml, _ = parse_frontmatter("---\nid: kb/x/b\ntitle: 裸键标题\ndimension: hook\n---\n正文")
    expect("YAML 裸键兜底", fm_yaml.get("id") == "kb/x/b" and fm_yaml.get("dimension") == "hook")
    expect("关键句截断（24 字）", key_sentence("一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十。") == "一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十"[:KEY_SENT_CLIP])
    expect("关键句剥 markdown", key_sentence("### **加粗标题行也算够长了吧**") == "加粗标题行也算够长了吧")
    expect("短行跳过", key_sentence("短\n\n这一行足够长可以入选") == "这一行足够长可以入选")
    a = {"id": "kb/x/a", "domain": "x", "title": "甲", "body": "甲的正文关键句足够长了", "meta": {}}
    b = {"id": "kb/x/b", "domain": "x", "title": "乙", "body": "乙的正文关键句也足够长", "meta": {}}
    ps = build_probes([a, b])
    expect("交叉探针供体=同域下一张", ps[1]["donor"] == "kb/x/b" and ps[3]["donor"] == "kb/x/a")
    expect("探针 id 连续编号", [p["id"] for p in ps] == ["p0001", "p0002", "p0003", "p0004"])
    print("selfcheck " + ("PASS" if ok else "FAIL"))
    return 0 if ok else 1


def main() -> int:
    ap = argparse.ArgumentParser(description="kb 检索质量探针集生成器（确定性；口径见文件头注）")
    ap.add_argument("--out", default=str(DEFAULT_OUT), help="探针集落点（默认 projects/_reports/kb-eval-probes-20261011.json）")
    ap.add_argument("--selfcheck", action="store_true", help="合成 fixture 自测，零真实写盘")
    args = ap.parse_args()
    if args.selfcheck:
        return selfcheck()
    cards, stats = collect_cards()
    probes = build_probes(cards)
    by_type: dict[str, int] = {}
    by_domain: dict[str, int] = {}
    for p in probes:
        by_type[p["type"]] = by_type.get(p["type"], 0) + 1
        by_domain[p["domain"]] = by_domain.get(p["domain"], 0) + 1
    doc = {
        "format": "kb-eval-probes@1",
        "口径": "探针两档：词面（标题子集/变序+关键词，考词面通道）与同域交叉（他卡关键句作查询、本卡为期望命中，考语义关联；基线词面打分器此项偏低属预期）。非绝对语义评测——只用于 before/after 同探针集相对比较（R2 硬门槛 after≥before），不自称 SOTA 绝对分。生成规则见 tools/kb-eval.py 头注；无时间戳无随机，重跑逐字节一致。",
        "counts": {"cards": len(cards), "probes": len(probes), "byType": dict(sorted(by_type.items())), "byDomain": dict(sorted(by_domain.items()))},
        "universe": stats,
        "probes": probes,
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(doc, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
    out.write_text(text, encoding="utf-8", newline="\n")
    print(f"探针集：{len(probes)} 条（卡 {len(cards)} 张；byType={by_type}）→ {out}")
    print("下一步：core/node_modules/.bin/tsx scripts/kb-eval-exec.ts --run --probes <本件> --out <指标收据>")
    return 0


if __name__ == "__main__":
    sys.exit(main())
