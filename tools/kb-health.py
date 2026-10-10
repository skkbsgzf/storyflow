#!/usr/bin/env python3
"""kb-health · 知识库体检（批次3b Q1）——四张账：画像 / 查重候选 / 边审计 / 覆盖矩阵。

定位（与既有件互补不重复）：
  tools/kb-affinity.py  管「卡 ↔ 消费者」（四层消费面引用对账）；
  tools/kit-lint.py     管「卡 ↔ 契约/扫描器」静态门（W3/W10/E12/E13）；
  本工具        管「卡 ↔ 卡」与「卡 ↔ 标尺」——全卡画像、卡间查重候选、图产物边审计、
                rule-card@1 × qid 覆盖矩阵。只读体检出收据，非门禁：任何退出码只区分
                用法错误/材料缺失（2/3），账面发现一律记账不拦截。
  Q1 只读不动卡：knowledge/ 零改动；产物 kit/hypergraph.rag.json 只读不回写。

四账口径：
  inventory  全卡画像——id/域/类型/标题/正文字数/frontmatter 完整度（rule-card@1 九必填逐项 +
             clause 三必填）/frontmatter 出处（json|yaml|none|broken）/卡间引用（出/入）/
             消费面计数（结构化 op 面 + 文本面，口径与 kb-affinity 同式）/图出度入度（读产物）/
             最后 updated。缺 frontmatter、声明 id 与路径 id 不一致的卡单列。
  dups       查重候选——标题 2-gram 集合 Jaccard + 正文 3-gram 集合 IDF 加权 Jaccard
             （权重压模板样板：被全库共享的 gram 权重趋零，28 张 benchmark 的同构表格不再
             刷屏）。只出候选对 + 重叠证据（高 IDF 共现 gram / 标题重合），跨域同判、
             同题分组单列；只出候选不裁决。
  edges      边审计——读 kit/hypergraph.rag.json（storyflow-hypergraph@1）：悬空端点/自环/
             单向边/域内-跨域分布/度数分布（枢纽与孤岛）；另做「回退标题伪边」判别：
             kit-compile 对 JSON frontmatter 卡解析不出 title 时回落首行『---』，而 '---'
             是几乎所有卡的子串 → 这类边的「证据子串」是分隔线不是语义，逐类点数与净化视图
             （真实标题 mention 边）分开呈现。产物与盘上卡差集（id 口径漂移）也在本账对账。
  coverage   覆盖矩阵——域 × 卡数 × clauses 总数 × 已认领 qid 数 × 消费 op 数；
             两个双向缺口清单：①两份 laya spec 的全部 qid 中无任何规则卡 scanner_qids
             认领的（反向列出，注 style spec 退役名单）；②规则卡 clauses 中带确定性措辞
             （S 级判据启发式：计数/阈值/配额/每章每集等标记词）却无扫描器对应的候选，
             只标记不硬判。

用法：
  python tools/kb-health.py [inventory|dups|edges|coverage|all] [--root <dir>] [--out-dir <dir>]
                            [--top <N>] [--body-threshold <F>] [--title-threshold <F>]
  python tools/kb-health.py --by track|cluster    # 板块/簇汇总视图（批次3c R2，组内卡数·字数·消费数·孤儿数）
  缺省子命令 = all（四账各写一份收据）。退出码：0 正常；2 用法错误；3 材料缺失（产物/目录）。
  收据缺省 projects/_reports/kb-health-{inventory,dups,edges,coverage,rollup}.json
  （projects/ 不入 git，写坏不脏库）；内容不含生成时刻，同一状态重跑逐字节一致。
"""
import argparse
import json
import math
import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# ── 共用常量 ─────────────────────────────────────────────────────
FM_RE = re.compile(r"\A---\s*\n(.*?)\n---\s*\n?", re.S)
# 卡间引用 token：kb/<段>/<名> 或 glob kb/<段>/*（与 kb-affinity KB_TOKEN 同式：
# `<` 不在字符集，占位写法天然不匹配；尾斜杠截断形不匹配）
KB_TOKEN = re.compile(r"kb/[A-Za-z0-9_\-\u4e00-\u9fff]+(?:/\*|/[A-Za-z0-9_\-\u9fff]+)")
RULE_ID_RE = re.compile(r'"id"\s*:\s*"(kb/rules/[a-z0-9-]+)"')
RULE_CARD_REQUIRED = ["id", "type", "title", "dimension", "version", "status",
                      "activation_hint", "provenance", "updated"]
CLAUSE_REQUIRED = ["rule_id", "tier", "severity"]
# 正文归一：只留中英文与数字（查重与 gram 抽取用）
_BODY_NORM_RE = re.compile(r"[^0-9A-Za-z\u4e00-\u9fff]+")
# S 级判据启发式：条款 detect/judge 里出现这些措辞 = 疑似可确定性计数（候选，不硬判）
DET_MARKS = re.compile(
    r"计数|次数|统计|阈值|不超过|不得超过|少于|多于|≤|≥|每章|每集|每场|每千字|字数|"
    r"密度|百分比|配额|出现〔一二三〕|禁用|禁止|逐条|逐章|逐集")
DET_MARK_SHOWN = ["计数", "次数", "统计", "阈值", "不超过", "不得超过", "少于", "多于", "≤", "≥",
                  "每章", "每集", "每场", "每千字", "字数", "密度", "百分比", "配额", "禁用", "禁止", "逐条", "逐章", "逐集"]


# ── 卡面装载（供给）─────────────────────────────────────────────
def parse_front(text: str):
    """卡头解析：`---` 围栏内先试 JSON（本库卡的主流信封），失败退 YAML 裸键行
    （与 kit-compile front 同式）。返回 (fm_dict_or_None, source)，source ∈ json|yaml|none|broken。"""
    m = FM_RE.match(text)
    if not m:
        return None, "none"
    raw = m.group(1)
    try:
        fm = json.loads(raw)
        if isinstance(fm, dict):
            return fm, "json"
    except Exception:
        pass
    fm = {}
    for line in raw.splitlines():
        mm = re.match(r"^([A-Za-z_][\w-]*):\s*(\S.*)$", line)
        if mm:
            fm[mm.group(1)] = mm.group(2).strip()
    return (fm, "yaml") if fm else (None, "broken")


def load_cards(root: Path) -> dict:
    """盘上全卡：knowledge/**/*.md（README 除外）。id = frontmatter id 优先，
    否则 kb/<相对路径去 .md>（kit-compile 同款回落）。"""
    cards = {}
    kb_dir = root / "knowledge"
    if not kb_dir.is_dir():
        sys.exit("[ABORT] knowledge/ 目录不存在")
    for p in sorted(kb_dir.rglob("*.md")):
        if p.name.upper() == "README.MD":
            continue
        rel = p.relative_to(kb_dir).as_posix()
        raw = p.read_text(encoding="utf-8")
        fm, src = parse_front(raw)
        declared = (fm or {}).get("id")
        path_id = "kb/" + rel.removesuffix(".md")
        cid = declared or path_id
        body = raw[FM_RE.match(raw).end():] if FM_RE.match(raw) else raw
        # 产物回落标题形态（kit-compile 对带信封无 title 的卡回落首个正文行——R2 起与 kit-compile
        # 同式先剥信封再取行；旧式取 raw 首行会把带信封无 title 的卡打成『---』伪标题）
        first_line = next((l for l in body.splitlines() if l.strip()), '')
        title = (fm or {}).get("title") or (first_line.lstrip("# \n")[:60] if first_line.strip() else rel)
        kind = "rule-card" if rel.startswith("rules/") else "kb"
        clauses = (fm or {}).get("clauses") or []
        cards[cid] = {
            "id": cid,
            "domain": rel.split("/")[0],
            "kind": kind,
            "type": (fm or {}).get("type"),
            "title": title,
            "title_fallback": not bool((fm or {}).get("title")),
            "file": "knowledge/" + rel,
            "rel": rel,
            "fm": fm or {},
            "fm_source": src,
            "declared_id": declared,
            "path_id": path_id,
            "body": body,
            "raw": raw,
            "body_chars": len(body),
            "updated": (fm or {}).get("updated"),
            "clauses": clauses if isinstance(clauses, list) else [],
            "scanner_qids": (fm or {}).get("scanner_qids") or [],
        }
    return cards


# ── 消费面扫描（口径与 kb-affinity 同式；只取计数与清单，不做断链退出）──
def glob_expand(cards: dict, ref: str) -> list:
    if ref.endswith("/*"):
        return sorted(cid for cid in cards if cid.startswith(ref[:-1]))
    return [ref] if ref in cards else []


def scan_consumers(root: Path, cards: dict):
    """四层消费面 → (op_faces_by_card, text_files_by_card, op_domains, dangling_refs)。
    op_domains: 域 → 引用它域卡的 op face 集合（coverage 矩阵的「消费 op 数」列）。"""
    op_face_card: dict = defaultdict(set)   # card -> {op face}
    text_face_card: dict = defaultdict(set)  # card -> {file}
    op_domains: dict = defaultdict(set)      # domain -> {op face}
    dangling: list = []

    def reg(refs, face, structured: bool, domain_of=None):
        for ref in refs:
            hits = glob_expand(cards, ref)
            if not hits:
                dangling.append({"ref": ref, "face": face, "level": "structural" if structured else "textual"})
            for cid in hits:
                if cid not in cards:
                    continue
                if structured:
                    op_face_card[cid].add(face)
                    if domain_of:
                        op_domains[domain_of].add(face)
                else:
                    text_face_card[cid].add(face)

    # 1) modules ops：knowledge / exclude_knowledge / knowledge_pools（exclude 是负向记账，
    #    不算消费正数——与 kb-affinity 口径一致，这里只记结构化面不进 op_domains 正账）
    for mp in sorted((root / "modules").glob("*/module.json")):
        try:
            m = json.loads(mp.read_text(encoding="utf-8"))
        except Exception:
            continue
        mid = mp.parent.name
        for op_id, op in (m.get("ops") or {}).items():
            face = f"modules/{mid}#{op_id}"
            for kb in op.get("knowledge") or []:
                doms = {cards[c]["domain"] for c in glob_expand(cards, kb) if c in cards}
                reg([kb], face, True)
                for d in doms:
                    op_domains[d].add(face)
            for p in op.get("knowledge_pools") or []:
                pool = (p or {}).get("pool")
                if pool:
                    prefix = pool[:-1] if pool.endswith("*") else pool + "/"
                    hits = [cid for cid in cards if cid == pool or cid.startswith(prefix)]
                    for cid in hits:
                        op_face_card[cid].add(face)
                        op_domains[cards[cid]["domain"]].add(face)
            # exclude_knowledge：负向记账，只探存在性不计消费
            for ex in op.get("exclude_knowledge") or []:
                if not glob_expand(cards, ex):
                    dangling.append({"ref": ex, "face": face, "level": "structural"})

    # 2) flows：node.kb / node.loads（kb/ 前缀）结构化 + 全文文本提及
    for fp in sorted((root / "flows").glob("*/flow.json")):
        fid = fp.parent.name
        raw = fp.read_text(encoding="utf-8")
        try:
            fl = json.loads(raw)
        except Exception:
            fl = {}
        for nid, node in ((fl.get("graph") or {}).get("nodes") or {}).items():
            face = f"flows/{fid}/{nid}"
            kbs = node.get("kb")
            reg([kbs] if isinstance(kbs, str) else (kbs or []), face, True)
            loads = node.get("loads")
            reg([it for it in ((loads if isinstance(loads, str) else (loads or [])))
                 if isinstance(it, str) and it.startswith("kb/")], face, True)
        for tok in sorted(set(KB_TOKEN.findall(raw))):
            reg([tok], f"flows/{fid}", False)

    # 3)+4) 文本面：skills/*.md 与 core/src/**/*.ts（含注释，textual 记账不失败）
    for base, suffix in ((root / "skills", ".md"), (root / "core" / "src", ".ts")):
        if not base.is_dir():
            continue
        for p in sorted(base.rglob(f"*{suffix}")):
            rel = p.relative_to(root).as_posix()
            try:
                raw = p.read_text(encoding="utf-8")
            except Exception:
                continue
            for tok in sorted(set(KB_TOKEN.findall(raw))):
                reg([tok], rel, False)

    return op_face_card, text_face_card, op_domains, dangling


# ── 图产物装载 ──────────────────────────────────────────────────
def load_product(root: Path):
    out = root / "kit" / "hypergraph.rag.json"
    if not out.exists():
        return None
    try:
        return json.loads(out.read_text(encoding="utf-8"))
    except Exception as e:
        sys.exit(f"[ABORT] kit/hypergraph.rag.json 解析失败：{e}")


def write_receipt(root: Path, out_dir: Path, name: str, payload: dict) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / name
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path


def clip(s, n=60):
    s = str(s or "")
    return s if len(s) <= n else s[:n] + "…"


# ── 账一：inventory ─────────────────────────────────────────────
def account_inventory(root: Path, out_dir: Path, args) -> int:
    cards = load_cards(root)
    op_face, text_face, _opdom, _dang = scan_consumers(root, cards)
    prod = load_product(root)
    graph_deg: dict = defaultdict(lambda: {"out": 0, "in": 0})
    if prod:
        for r in prod.get("relations") or []:
            graph_deg[r["from"]]["out"] += 1
            graph_deg[r["to"]]["in"] += 1

    no_fm, id_mismatch, no_updated, rows = [], [], [], []
    # 卡间互引（先算：出向 = 本卡全文 kb/ token 指向其他真实存在的卡）
    cites: dict = defaultdict(set)
    for cid in sorted(cards):
        for tok in set(KB_TOKEN.findall(cards[cid]["raw"])):
            if tok != cid and tok in cards:
                cites[cid].add(tok)
    inbound = defaultdict(int)
    for cid, targets in cites.items():
        for t in targets:
            inbound[t] += 1
    for cid in sorted(cards):
        c = cards[cid]
        fm = c["fm"]
        missing = [f for f in RULE_CARD_REQUIRED if f not in fm] if c["kind"] == "rule-card" else None
        bad_clauses = []
        for cl in c["clauses"]:
            miss = [f for f in CLAUSE_REQUIRED if f not in cl]
            if miss:
                bad_clauses.append({"rule_id": cl.get("rule_id"), "missing": miss})
        if c["fm_source"] in ("none", "broken"):
            no_fm.append({"id": cid, "file": c["file"], "fm_source": c["fm_source"]})
        if c["declared_id"] and c["declared_id"] != c["path_id"]:
            id_mismatch.append({"id": cid, "declared_id": c["declared_id"], "path_id": c["path_id"],
                                "file": c["file"]})
        if not c["updated"]:
            no_updated.append(cid)
        rows.append({
            "id": cid,
            "domain": c["domain"],
            "kind": c["kind"],
            "type": c["type"],
            "title": clip(c["title"]),
            "file": c["file"],
            "fm_source": c["fm_source"],
            "missing_required": missing,           # 仅 rule-card；kb 卡无 schema 不评判
            "clauses": len(c["clauses"]),
            "clauses_missing_required": bad_clauses,
            "scanner_qids": sorted(c["scanner_qids"]),
            "updated": c["updated"],
            "body_chars": c["body_chars"],
            "outbound_card_refs": sorted(cites.get(cid, ())),
            "cited_by_cards": inbound.get(cid, 0),
            "op_consumers": sorted(op_face.get(cid, ())),
            "text_consumers": len(text_face.get(cid, ())),
            "graph_out": graph_deg[cid]["out"] if prod else None,
            "graph_in": graph_deg[cid]["in"] if prod else None,
        })

    by_domain = defaultdict(int)
    by_kind = defaultdict(int)
    for r in rows:
        by_domain[r["domain"]] += 1
        by_kind[r["kind"]] += 1
    rule_rows = [r for r in rows if r["kind"] == "rule-card"]
    rule_ok = sum(1 for r in rule_rows if not r["missing_required"] and not r["clauses_missing_required"])

    payload = {
        "format": "kb-health-inventory@1",
        "root": root.as_posix(),
        "summary": {
            "cards": len(rows),
            "by_domain": {k: by_domain[k] for k in sorted(by_domain)},
            "by_kind": {k: by_kind[k] for k in sorted(by_kind)},
            "cards_without_frontmatter": no_fm,
            "id_mismatch_declared_vs_path": id_mismatch,
            "cards_without_updated": sorted(no_updated),
            "rule_card_completeness": f"{rule_ok}/{len(rule_rows)}",
            "clauses_total": sum(r["clauses"] for r in rows),
            "citations_between_cards": sum(len(v) for v in cites.values()),
        },
        "cards": rows,
    }
    path = write_receipt(root, out_dir, "kb-health-inventory.json", payload)

    print(f"kb-health inventory ｜ 盘上卡 {len(rows)}（{', '.join(f'{k} {v}' for k, v in sorted(by_kind.items()))}）"
          f" ｜ 域 {len(by_domain)} 个 ｜ 卡间互引 {payload['summary']['citations_between_cards']} 笔")
    print(f"  ｜ 规则卡 rule-card@1 完整 {rule_ok}/{len(rule_rows)}，clauses 合计 {payload['summary']['clauses_total']}")
    if no_fm:
        print(f"  ｜ 缺 frontmatter：{len(no_fm)} 张 —— " + "、".join(x['id'] for x in no_fm))
    if id_mismatch:
        print(f"  ｜ 声明 id ≠ 路径 id：{len(id_mismatch)} 张 —— "
              + "；".join(f"{x['id']}（声明 {x['declared_id']} / 路径 {x['path_id']}）" for x in id_mismatch))
    if no_updated:
        print(f"  ｜ 缺 updated：{len(no_updated)} 张 —— " + "、".join(sorted(no_updated)))
    zero = [r["id"] for r in rows if not r["op_consumers"] and not r["text_consumers"] and r["kind"] != "rule-card"]
    if zero:
        print(f"  ｜ 零消费非规则卡 {len(zero)} 张（kb-affinity 孤儿账同源，此处仅画像）：{ '、'.join(zero[:8]) }"
              + ("…" if len(zero) > 8 else ""))
    print(f"收据 → {path}")
    return 0


# ── 账二：dups ──────────────────────────────────────────────────
def _grams(text: str, n: int) -> set:
    t = _BODY_NORM_RE.sub("", text)
    return {t[i:i + n] for i in range(len(t) - n + 1)}


def account_dups(root: Path, out_dir: Path, args) -> int:
    cards = load_cards(root)
    ids = sorted(cards)
    n = len(ids)
    body_sets = {cid: _grams(cards[cid]["body"], 3) for cid in ids}
    title_sets = {cid: _grams(cards[cid]["title"], 2) for cid in ids}
    df = defaultdict(int)
    for cid in ids:
        for g in body_sets[cid]:
            df[g] += 1
    idf = {g: math.log(n / d) for g, d in df.items()}
    # 独异 gram：全库出现次数超过上限的 gram 视为模板样板（表格骨架/套话），不参与相似度——
    # 28 张 benchmark 的同构表格、16 张规则卡的同款信封从此刷不进候选；真重复共享的是
    # 少数卡才有的内容 gram，不受影响。
    distinctive = {cid: {g for g in body_sets[cid] if df[g] <= args.df_cap} for cid in ids}
    wsum = {cid: sum(idf[g] for g in distinctive[cid]) for cid in ids}

    def evidence(a: str, b: str, k: int = 8) -> list:
        shared = distinctive[a] & distinctive[b]
        return sorted(shared, key=lambda g: (-idf[g], g))[:k]

    def title_common(a: str, b: str) -> str:
        import difflib
        m = difflib.SequenceMatcher(None, cards[a]["title"], cards[b]["title"]).find_longest_match(
            0, len(cards[a]["title"]), 0, len(cards[b]["title"]))
        return cards[a]["title"][m.a:m.a + m.size]

    pairs = []
    for i, a in enumerate(ids):
        for b in ids[i + 1:]:
            inter = distinctive[a] & distinctive[b]
            iw = sum(idf[g] for g in inter)
            uw = wsum[a] + wsum[b] - iw
            body_j = iw / uw if uw > 0 else 0.0
            ta, tb = title_sets[a], title_sets[b]
            title_j = len(ta & tb) / len(ta | tb) if ta | tb else 0.0
            if body_j >= args.body_threshold or title_j >= args.title_threshold:
                pairs.append({
                    "a": a, "b": b,
                    "domain_a": cards[a]["domain"], "domain_b": cards[b]["domain"],
                    "cross_domain": cards[a]["domain"] != cards[b]["domain"],
                    "sibling_template": cards[a]["kind"] == "rule-card" and cards[b]["kind"] == "rule-card",
                    "title_a": clip(cards[a]["title"]), "title_b": clip(cards[b]["title"]),
                    "title_common": clip(title_common(a, b), 40),
                    "body_jaccard_idf": round(body_j, 4),
                    "title_jaccard": round(title_j, 4),
                    "shared_grams_top": evidence(a, b),
                    "chars": [cards[a]["body_chars"], cards[b]["body_chars"]],
                })
    # 排序：非模板兄弟对优先（分数降序）；16 张规则卡的同款信封是预期形态，降权垫底
    pairs.sort(key=lambda p: (p["sibling_template"],
                              -max(p["body_jaccard_idf"], p["title_jaccard"]), p["a"], p["b"]))
    shown = [p for p in pairs if not p["sibling_template"]]
    siblings = [p for p in pairs if p["sibling_template"]]
    pairs = (shown + siblings)[:args.top]

    # 同题分组（完全同标题的卡，标题重复是比正文相似更强的合并信号）
    by_title = defaultdict(list)
    for cid in ids:
        by_title[cards[cid]["title"]].append(cid)
    same_title = [{"title": clip(t), "ids": sorted(v)}
                  for t, v in sorted(by_title.items()) if len(v) > 1]

    payload = {
        "format": "kb-health-dups@1",
        "root": root.as_posix(),
        "params": {"body_threshold": args.body_threshold, "title_threshold": args.title_threshold,
                   "top": args.top, "gram": 3, "weighting": "idf", "df_cap_distinctive": args.df_cap,
                   "note": "正文相似只在独异 gram（df<=df_cap）上算 IDF 加权 Jaccard；"
                           "sibling_template=两张规则卡共用 rules-init 模板信封（预期形态，垫底呈现）"},
        "summary": {
            "cards": n,
            "candidate_pairs": len(shown),
            "sibling_template_pairs": len(siblings),
            "cross_domain_pairs": sum(1 for p in shown if p["cross_domain"]),
            "same_title_groups": same_title,
        },
        "candidates": pairs,
    }
    path = write_receipt(root, out_dir, "kb-health-dups.json", payload)

    print(f"kb-health dups ｜ 卡 {n} ｜ 候选对 {len(shown)}（阈值 正文≥{args.body_threshold} / 标题≥{args.title_threshold}，"
          f"独异 gram（df≤{args.df_cap}）IDF 加权）｜ 跨域 {payload['summary']['cross_domain_pairs']} 对"
          f" ｜ 规则卡模板兄弟对 {len(siblings)} 对（预期形态，另计）")
    for p in shown[:10]:
        tag = "跨域" if p["cross_domain"] else "同域"
        print(f"  {p['body_jaccard_idf']:.3f}/{p['title_jaccard']:.2f} {tag}  {p['a']} × {p['b']}")
        print(f"      {clip(p['title_a'], 36)} × {clip(p['title_b'], 36)}")
        print(f"      共现证据：{'、'.join(p['shared_grams_top'][:6])}")
    if len(shown) > 10:
        print(f"  …（其余 {len(shown) - 10} 对见收据）")
    if same_title:
        print(f"  ｜ 同标题组 {len(same_title)} 组：" +
              "；".join(f"『{g['title']}』×{len(g['ids'])}" for g in same_title))
    print(f"收据 → {path}")
    return 0


# ── 账三：edges ─────────────────────────────────────────────────
def account_edges(root: Path, out_dir: Path, args) -> int:
    cards = load_cards(root)
    prod = load_product(root)
    if prod is None:
        print("[ABORT] 盘上无 kit/hypergraph.rag.json —— 先跑 tools/kit-compile.py 再体检边")
        return 3
    entries = prod.get("entries") or []
    rels = prod.get("relations") or []
    ids = {e["id"] for e in entries}
    title_of = {e["id"]: e.get("title") or "" for e in entries}
    dom_of = {e["id"]: e.get("domain") for e in entries}

    dangling = sorted({r["from"] for r in rels if r["from"] not in ids}
                      | {r["to"] for r in rels if r["to"] not in ids})
    self_loops = sorted(f"{r['from']}→{r['to']}" for r in rels if r["from"] == r["to"])
    undirected = defaultdict(set)
    for r in rels:
        if r["from"] != r["to"]:
            undirected[r["from"]].add(r["to"])
            undirected[r["to"]].add(r["from"])
    # 单向对计数（注：kit-compile 对 mention 边按无序对去重、方向=首见——mention 语义本对称，
    # 单向是存储形状不是语义缺失；此处只计数，不判错）
    def one_way_of(edge_list):
        pairset = {(r["from"], r["to"]) for r in edge_list}
        cnt = 0
        for (a, b) in pairset:
            if a != b and (b, a) not in pairset:
                cnt += 1
        return cnt

    one_way_total = one_way_of(rels)
    # 域分布
    intra = sum(1 for r in rels if dom_of.get(r["from"]) == dom_of.get(r["to"]))
    cross = len(rels) - intra
    cross_matrix = defaultdict(int)
    for r in rels:
        d1, d2 = dom_of.get(r["from"]), dom_of.get(r["to"])
        if d1 != d2:
            cross_matrix["→".join(sorted((d1, d2)))] += 1
    # 度数
    indeg, outdeg = defaultdict(int), defaultdict(int)
    for r in rels:
        outdeg[r["from"]] += 1
        indeg[r["to"]] += 1
    deg = {i: indeg[i] + outdeg[i] for i in ids}
    hubs = sorted(deg.items(), key=lambda kv: (-kv[1], kv[0]))[:15]
    isolates = sorted(i for i, d in deg.items() if d == 0)
    # 回退标题伪边判别：kit-compile 对 JSON frontmatter 卡解析不出 title → 回落首行 '---'；
    # '---' 是几乎所有卡的子串，凡「证据子串」为 '---' 的边是分隔线伪边不是语义 mention。
    fallback_targets = sorted(i for i in ids if title_of.get(i) == "---")
    artifact_edges = [r for r in rels if title_of.get(r["to"]) == "---"]
    genuine = [r for r in rels if title_of.get(r["to"]) != "---"]
    # 净化视图（真实标题 mention 边）完整统计
    g_intra = sum(1 for r in genuine if dom_of.get(r["from"]) == dom_of.get(r["to"]))
    g_deg = defaultdict(int)
    for r in genuine:
        g_deg[r["from"]] += 1
        g_deg[r["to"]] += 1
    g_hubs = sorted(g_deg.items(), key=lambda kv: (-kv[1], kv[0]))[:10]
    # 注意 g_deg 此时只含真边触达的卡——用成员测试取孤岛，不做 defaultdict 取值（会插 0 污染）
    g_isolates = sorted(i for i in ids if i not in g_deg)
    g_one_way = one_way_of(genuine)
    # 产物 vs 盘上卡对账
    disk_only = sorted(set(cards) - ids)
    prod_only = sorted(ids - set(cards))
    mism = [{"id": i, "declared_id": cards[i]["declared_id"], "path_id": cards[i]["path_id"]}
            for i in sorted(set(cards) & ids) if cards[i]["declared_id"] and cards[i]["declared_id"] != i]

    payload = {
        "format": "kb-health-edges@1",
        "root": root.as_posix(),
        "product": {"file": "kit/hypergraph.rag.json", "format": prod.get("format"),
                    "entries": len(entries), "relations": len(rels),
                    "kinds": sorted({r.get("kind") for r in rels}),
                    "weights": sorted({r.get("weight") for r in rels})},
        "summary": {
            "dangling_endpoints": dangling,
            "self_loops": self_loops,
            "one_way_pairs_total": one_way_total,
            "one_way_note": "mention 边按无序对去重存储、方向=首见（kit-compile build_graph seen 表）；"
                            "mention 语义本对称，单向是存储形状不是语义缺失",
            "domain_distribution": {"intra": intra, "cross": cross,
                                    "cross_pairs_top": sorted(cross_matrix.items(), key=lambda kv: (-kv[1], kv[0]))[:12]},
            "degree": {"top_hubs": [{"id": i, "degree": d} for i, d in hubs],
                       "isolates": isolates,
                       "isolates_total": len(isolates)},
            "fallback_title_entries": len(fallback_targets),
            "fallback_title_ids": fallback_targets,
            "artifact_edges": len(artifact_edges),
            "genuine_edges": len(genuine),
            "genuine": [{"from": r["from"], "to": r["to"], "title": clip(title_of.get(r["to"]), 40)}
                        for r in sorted(genuine, key=lambda r: (r["from"], r["to"]))],
            "genuine_view": {"intra": g_intra, "cross": len(genuine) - g_intra,
                             "one_way": g_one_way,
                             "top_degree": [{"id": i, "degree": d} for i, d in g_hubs],
                             "isolates_total": len(g_isolates),
                             "isolates_sample": g_isolates[:12]},
            "product_vs_disk": {"product_only": prod_only, "disk_only": disk_only,
                                "id_mismatch": mism},
        },
    }
    path = write_receipt(root, out_dir, "kb-health-edges.json", payload)
    s = payload["summary"]
    kind_names = ",".join(sorted({str(r.get("kind")) for r in rels}))
    print(f"kb-health edges ｜ 产物 {len(entries)} 词条 / {len(rels)} 边（kind={kind_names}，weight 全 1）")
    print(f"  ｜ 悬空端点 {len(dangling)} ｜ 自环 {len(self_loops)} ｜ 单向对 {one_way_total}（存储形状，见收据注）")
    print(f"  ｜ 域分布 全量：域内 {intra} / 跨域 {cross}")
    print(f"  ｜ 回退标题『---』词条 {len(fallback_targets)} 个 → 关联伪边 {len(artifact_edges)} 条"
          f"（占 {round(100 * len(artifact_edges) / len(rels), 1) if rels else 0}%）——kit-compile front() 不识 JSON frontmatter 的连带效应")
    print(f"  ｜ 净化视图（真实标题 mention）{len(genuine)} 条：域内 {s['genuine_view']['intra']} / 跨域 "
          f"{s['genuine_view']['cross']}，单向 {g_one_way}，涉卡 {len(g_deg)} 张；其余 {len(g_isolates)} 卡在真语义图上零边")
    if g_isolates:
        print(f"      净化孤岛样例：{'、'.join(g_isolates[:6])}" + ("…" if len(g_isolates) > 6 else ""))
    print(f"  ｜ 全量度数：最高 {'、'.join(f'{i}({d})' for i, d in hubs[:3])}；孤岛 {len(isolates)} 个"
          + (f"：{'、'.join(isolates[:5])}" if isolates else ""))
    if prod_only or disk_only:
        print(f"  ｜ 产物↔盘上差集：产物多出 {prod_only}；盘上多出 {disk_only}")
    if mism:
        print(f"  ｜ 声明 id 与产物 id 不一致 {len(mism)} 张："
              + "；".join(f"{m['id']}（声明 {m['declared_id']}）" for m in mism))
    print(f"收据 → {path}")
    return 0


# ── 账四：coverage ──────────────────────────────────────────────
AE_ID_RE = re.compile(r"AE-[A-Z0-9-]+")


def _scanner_side_ids(root: Path):
    """扫描器侧 id 全集（与 tools/lintlib.py 同源同式，不抄名单）：
    T 轨台账 = tools/rules-init.py 的 TRACK_T 常量；实现面 = core/src/aesthetic.ts 的
    `"AE-…"` 字符串（`AE-X#子项` 归并主 id）。返回 (track_t, engine_ids)。"""
    import importlib.util
    track_t: set = set()
    p = root / "tools" / "rules-init.py"
    if p.exists():
        spec = importlib.util.spec_from_file_location("rules_init_for_kbhealth", p)
        mod = importlib.util.module_from_spec(spec)
        try:
            spec.loader.exec_module(mod)
            track_t = set(getattr(mod, "TRACK_T", []) or [])
        except Exception:
            track_t = set()
    eng: set = set()
    ae = root / "core" / "src" / "aesthetic.ts"
    if ae.exists():
        eng = {m.split("#")[0] for m in re.findall(r'"(AE-[A-Za-z0-9#\-]+)"', ae.read_text(encoding="utf-8"))}
    return track_t, eng


def account_coverage(root: Path, out_dir: Path, args) -> int:
    cards = load_cards(root)
    _op_face, text_face, op_domains, _dang = scan_consumers(root, cards)
    spec_paths = [root / "tools" / "laya-ft" / "questions.spec.json",
                  root / "tools" / "laya-ft" / "style.questions.spec.json"]
    qinfo = {}
    retired = set()
    for sp in spec_paths:
        if not sp.exists():
            continue
        spec = json.loads(sp.read_text(encoding="utf-8"))
        # style spec 的退役名单：retirement 文本首个括号里是斜杠分隔的题 slug 短名
        # （rhythm/punct/dialogue/time-word/density/slop.banned，qid 保留不复用）。
        # 只对声明 retirement 的这份 spec 自己的 qid 生效；退役题不算活缺口，如实注记。
        ret_txt = str(spec.get("retirement") or "")
        slugs = []
        # retirement 文本形如「0.2.1（日期）：…退役（slug/slug/…，说明）…」——取含斜杠的
        # 那个括号组（第一组通常是日期），斜杠分隔项即退役题 slug 短名。
        for grp in re.findall(r"（([^）]*)）", ret_txt):
            if "/" in grp:
                slugs = [s.strip() for s in grp.split("，")[0].split("/") if s.strip()]
                break
        spec_qids = list((spec.get("questions") or {}).keys())
        for slug in slugs:
            for qid in spec_qids:
                if qid == slug or qid.startswith(slug + ".") or f".{slug}." in qid:
                    retired.add(qid)
        for qid, q in (spec.get("questions") or {}).items():
            qinfo[qid] = {"spec": sp.name, "type": (q or {}).get("type"),
                          "rubric_ref": clip((q or {}).get("rubric_ref"), 100)}

    claimed: dict = defaultdict(list)   # qid -> [card id]
    for cid in sorted(cards):
        for q in cards[cid]["scanner_qids"] or []:
            claimed[q].append(cid)
    unclaimed = []
    for qid in sorted(qinfo):
        if qid not in claimed:
            unclaimed.append({"qid": qid, "retired": qid in retired, **qinfo[qid]})
    # 缺口②：确定性措辞候选（tier S 直接入选；A/B 带确定性标记词的列为「定级/落扫描器候选」）。
    # 证据增强：条款 judge/detect 里点名的 AE-id 若落在 T 轨台账或 aesthetic.ts 实现面 =
    # 「已声明 T 轨孪生」（双轨制下同族不同 id 的机械对不存在，卡面声明即对账）——
    # 这类不算真空档；无孪生声明的才值得排扫描器/复检优先级。
    track_t, engine_ids = _scanner_side_ids(root)
    det_candidates = []
    for cid in sorted(cards):
        c = cards[cid]
        if c["kind"] != "rule-card" or not c["clauses"]:
            continue
        for cl in c["clauses"]:
            blob = f"{cl.get('detect') or ''} {cl.get('judge') or ''}"
            marks = [m for m in DET_MARK_SHOWN if m in blob]
            if cl.get("tier") == "S" or marks:
                twins = sorted(set(AE_ID_RE.findall(blob)) & (track_t | engine_ids))
                det_candidates.append({
                    "card": cid, "rule_id": cl.get("rule_id"), "tier": cl.get("tier"),
                    "severity": cl.get("severity"), "marks": marks,
                    "declared_twin_ids": twins,
                    "twin_implemented": sorted(set(twins) & engine_ids),
                    "card_level_qids": sorted(c["scanner_qids"]),
                    "has_repair": bool(cl.get("repair")),
                })

    # 域矩阵
    matrix = []
    domains = sorted({c["domain"] for c in cards.values()})
    for d in domains:
        dcards = [cid for cid in sorted(cards) if cards[cid]["domain"] == d]
        text_files = sorted({f for cid in dcards for f in text_face.get(cid, ())})
        matrix.append({
            "domain": d,
            "cards": len(dcards),
            "rule_cards": sum(1 for cid in dcards if cards[cid]["kind"] == "rule-card"),
            "clauses": sum(len(cards[cid]["clauses"]) for cid in dcards),
            "qids_claimed": sorted({q for cid in dcards for q in cards[cid]["scanner_qids"] or []}),
            "op_consumers": len(op_domains.get(d, ())),
            "op_faces": sorted(op_domains.get(d, ()))[:12],
            "text_consumers": len(text_files),
            "text_files_sample": text_files[:8],
        })

    tiers = defaultdict(int)
    for cid in sorted(cards):
        for cl in cards[cid]["clauses"]:
            tiers[cl.get("tier")] += 1
    no_twin = [x for x in det_candidates if not x["declared_twin_ids"]]
    payload = {
        "format": "kb-health-coverage@1",
        "root": root.as_posix(),
        "summary": {
            "domains": len(matrix),
            "clauses_total": sum(tiers.values()),
            "clauses_by_tier": {k: tiers[k] for k in sorted(tiers, key=lambda x: str(x))},
            "qids_total": len(qinfo),
            "qids_claimed": len([q for q in qinfo if q in claimed]),
            "qids_unclaimed": len(unclaimed),
            "qids_unclaimed_active": sum(1 for u in unclaimed if not u["retired"]),
            "deterministic_candidates": len(det_candidates),
            "candidates_with_declared_twin": len(det_candidates) - len(no_twin),
            "candidates_without_twin": len(no_twin),
            "scanner_side": {"track_t_total": len(track_t),
                             "aesthetic_ts_impl_total": len(engine_ids)},
        },
        "matrix": matrix,
        "gap1_qids_without_card": unclaimed,
        "gap2_deterministic_clause_candidates": det_candidates,
    }
    path = write_receipt(root, out_dir, "kb-health-coverage.json", payload)
    s = payload["summary"]
    print(f"kb-health coverage ｜ 域 {s['domains']} ｜ clauses {s['clauses_total']}"
          f"（{'、'.join(f'{k}:{v}' for k, v in s['clauses_by_tier'].items())}）"
          f" ｜ qid {s['qids_claimed']}/{s['qids_total']} 已认领"
          f" ｜ 扫描器侧：T 轨 {len(track_t)} / aesthetic.ts 实装 {len(engine_ids)}")
    print(f"  ｜ 缺口① 无卡认领 qid {s['qids_unclaimed']} 条（其中 style spec 退役 {s['qids_unclaimed'] - s['qids_unclaimed_active']} 条，"
          f"活缺口 {s['qids_unclaimed_active']} 条）")
    for u in unclaimed:
        flag = "退役" if u["retired"] else "活"
        print(f"      [{flag}] {u['qid']}（{u['spec']}）")
    print(f"  ｜ 缺口② 确定性措辞条款候选 {s['deterministic_candidates']} 条（启发式标记，不硬判）："
          f"已声明 T 轨孪生 {s['candidates_with_declared_twin']} 条 ｜ 无孪生声明 {s['candidates_without_twin']} 条")
    for x in no_twin:
        print(f"      [无孪生] {x['card']}#{x['rule_id']} tier={x['tier']} marks={'、'.join(x['marks'][:3])}")
    for d in matrix:
        print(f"      {d['domain']:<20} 卡 {d['cards']:>3} ｜ clauses {d['clauses']:>3} ｜ "
              f"qid {len(d['qids_claimed'])} ｜ 消费 op {d['op_consumers']:>2} ｜ 文本消费面 {d['text_consumers']:>2}")
    print(f"收据 → {path}")
    return 0


# ── 视图：板块/簇汇总（批次3c R2 ·--by track|cluster）──────────────────────
def account_rollup(root: Path, out_dir: Path, args) -> int:
    """--by track|cluster 视图：板块（人工维度，卡面 frontmatter track）或簇（算法维度，
    产物 entries[].cluster）分组——组内卡数·正文字数·消费 op 数·文本消费面数·孤儿数。
    只读汇总，与四账互补：track 是人打的职能标签，cluster 是编译期聚类；孤儿 = op+文本双零。"""
    cards = load_cards(root)
    op_face, text_face, _opdom, _dang = scan_consumers(root, cards)
    by_key: dict = defaultdict(list)
    if args.by == "track":
        for cid, c in cards.items():
            by_key[str((c["fm"] or {}).get("track") or "").strip() or "(缺 track)"].append(cid)
    else:
        prod = load_product(root)
        cluster_of = {e["id"]: (e.get("cluster") or "") for e in (prod or {}).get("entries") or []}
        for cid, c in cards.items():
            cl = cluster_of.get(cid, "")
            by_key[cl or ("(产物无此卡)" if cid not in cluster_of else "(无簇)")].append(cid)
    groups = []
    for key in sorted(by_key):
        ids = sorted(by_key[key])
        consumers = sorted({f for cid in ids for f in op_face.get(cid, ())})
        text_files = sorted({f for cid in ids for f in text_face.get(cid, ())})
        orphans = [cid for cid in ids if not op_face.get(cid) and not text_face.get(cid)]
        groups.append({
            "group": key,
            "cards": len(ids),
            "body_chars": sum(cards[cid]["body_chars"] for cid in ids),
            "op_consumers": len(consumers),
            "text_consumers": len(text_files),
            "orphans": len(orphans),
            "orphan_ids": orphans[:12],
            "ids": ids if args.by == "track" else ids[:24],
        })
    payload = {
        "format": f"kb-health-rollup-{args.by}@1",
        "root": root.as_posix(),
        "口径": ("track=人工职能板块（卡面 frontmatter，缺标 '(缺 track)'）；" if args.by == "track"
                 else "cluster=编译期聚类（kit-compile 产物 entries[].cluster；盘上卡不在产物/无簇单列）；"),
        "summary": {"groups": len(groups), "cards": sum(g["cards"] for g in groups),
                    "orphans": sum(g["orphans"] for g in groups)},
        "groups": groups,
    }
    path = write_receipt(root, out_dir, "kb-health-rollup.json", payload)
    print(f"kb-health rollup（--by {args.by}）｜ {len(groups)} 组 / {payload['summary']['cards']} 卡"
          f" ｜ 孤儿（op+文本双零）{payload['summary']['orphans']} 张")
    for g in groups:
        print(f"  {g['group']:<28} 卡 {g['cards']:>3} ｜ 字数 {g['body_chars']:>6} ｜ "
              f"消费 op {g['op_consumers']:>2} ｜ 文本面 {g['text_consumers']:>2} ｜ 孤儿 {g['orphans']}")
    print(f"收据 → {path}")
    return 0


# ── 入口 ────────────────────────────────────────────────────────
def main() -> int:
    ap = argparse.ArgumentParser(description="知识库体检四账（画像/查重/边审计/覆盖矩阵；只读收据，非门禁）")
    ap.add_argument("account", nargs="?", default="all",
                    choices=["inventory", "dups", "edges", "coverage", "all"])
    ap.add_argument("--by", choices=["track", "cluster"], default=None,
                    help="汇总视图（批次3c R2）：track=板块（人工维度）/ cluster=聚类簇（算法维度）；"
                         "给出时只跑该视图（组内卡数·字数·消费数·孤儿数），四账不跑")
    ap.add_argument("--root", default=str(ROOT), help="仓库根（缺省本脚本上一级）")
    ap.add_argument("--out-dir", default=None, help="收据目录（缺省 projects/_reports）")
    ap.add_argument("--top", type=int, default=25, help="dups 输出候选对上限（缺省 25）")
    ap.add_argument("--body-threshold", type=float, default=0.12, help="正文独异 gram IDF 加权 Jaccard 阈值（缺省 0.12）")
    ap.add_argument("--title-threshold", type=float, default=0.5, help="标题 2-gram Jaccard 阈值（缺省 0.5）")
    ap.add_argument("--df-cap", type=int, default=8, help="独异 gram 的全库出现次数上限（超过视为模板样板剔除，缺省 8）")
    args = ap.parse_args()

    root = Path(args.root).resolve()
    out_dir = Path(args.out_dir) if args.out_dir else root / "projects" / "_reports"
    if args.by:
        return account_rollup(root, out_dir, args)
    runners = {"inventory": account_inventory, "dups": account_dups,
               "edges": account_edges, "coverage": account_coverage}
    if args.account == "all":
        rc = 0
        for name in ("inventory", "dups", "edges", "coverage"):
            rc = runners[name](root, out_dir, args) or rc
        return rc
    return runners[args.account](root, out_dir, args)


if __name__ == "__main__":
    sys.exit(main())
