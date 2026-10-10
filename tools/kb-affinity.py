#!/usr/bin/env python3
"""kb-affinity · 知识卡 ↔ 消费者亲和对账（批次2.5 P2，对账收据不是门禁）

对账什么：knowledge/ 全域卡——index.json 台账 + 盘上扫描兜底（含 rules/ 规则语料卡按盘上
核账，与 kit-lint 同口径；盘上有而台账没有的卡照收，标 indexed=false）——
（--project 时并入 projects/<id>/ 世界书、规则、文风三目录的项目卡，id 推断与 kit-compile
同款：frontmatter id 优先，否则 pj/<项目相对路径去 .md>）。
对每张卡产出：引用者清单（谁、以什么方式引用）+ 正向消费者计数；零正向引用 = 孤儿卡；
引用指向不存在的卡 = 悬空引用（断链）。

消费面（四层，结构化部分对齐并扩展 kit-lint 的 W3 扫描口径；kit-lint 行为原样不动）：
  1. modules/<id>/module.json 结构化引用（权威）：op.knowledge（精确 / glob）、
     op.knowledge_pools[].pool（前缀展开）、op.exclude_knowledge（负向记账）
  2. flows/*/flow.json：节点结构字段 node.kb（残留面）与 node.loads（core/src/minitools.ts
     resolveLoads 消费，kb/ 前缀的精确 / glob 项）→ 结构化引用；desc 等散文里的
     kb/<域>/<名> 字样 → 文本引用
  3. skills/*.md 正文 → 文本引用
  4. core/src/**/*.ts 硬编码（含注释）→ 文本引用

判定口径（宁简勿繁，内置默认写死在此处，可配化随批次3）：
    孤儿 = 零正向引用。exclude_knowledge 是负向记账（声明「此 op 不用这张卡」），
         不解除孤儿；文本提及算正向引用者（文档里点名了卡就是亲和证据，glob 亦展开）。
  悬空分两级：
    structural —— 结构化面（modules ops / flow 节点字段）引用的目标不在卡面 = 断链，
                   退出码 1（与 kit-lint E3/E9 的语义对齐，但本工具独立判定、不影响门禁）。
    textual    —— 文本面提及的 id/glob 不在卡面 = 记账不失败（多为注释示例如
                   kb/trope/xxx 或散文笔误，人裁），退出码不受影响。
  规则卡（knowledge/rules/*）零 op 引用是已知正常形态（激活归决策，kit-lint W3 同因
  豁免）——孤儿账按 kind 细分呈现，不特判豁免、不隐藏。
  项目卡多为孤儿是正常形态（世界书/文风卡由项目 RAG 档与决策面消费，不走 op 引用）——
  如实记账，不因孤儿而失败（孤儿是语料自由，悬空才是断链）。
  N3 豁免口径（批次3c R3，与 kit-lint 同一张表 = tools/lintlib.py，逐类回显非静默吞）：
  孤儿账先过三类豁免再定「真孤儿」——①目录可达（被有消费的卡正文 id 级互引覆盖的闭包 +
  域级检索域变体）②占位标注（id 以 -draft 结尾的草稿待审区）③人工链路证据件
  （CARD_MANUAL_EXEMPT 前缀表）；豁免明细进收据 orphans_exempt 字段（逐卡带理由）。

用法：
  python tools/kb-affinity.py [--project <id>] [--out <json>] [--root <dir>]
  退出码：0 无结构化悬空；1 有结构化悬空；2 用法错误（argparse）。
  收据缺省 projects/_reports/kb-affinity[-<project>].json（projects/ 不入 git，写坏不脏库）；
  内容不含生成时刻，同一状态重跑逐字节一致。
"""
import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
from lintlib import (  # noqa: E402  N3 豁免口径与 kit-lint 同源（一张表，两处消费）
    CARD_MANUAL_EXEMPT,
    KB_SEARCH_DOMAINS,
    draft_card,
    kb_card_edges,
    reach_closure,
)

# 文本面 kb 引用 token：kb/<段>/<名> 或 glob kb/<段>/*。`<` 不在字符集里，
# 「kb/<域>/<名>」这类占位写法天然不匹配；尾斜杠截断形（kb/benchmark/）不匹配。
KB_TOKEN = re.compile(r"kb/[A-Za-z0-9_\-\u4e00-\u9fff]+(?:/\*|/[A-Za-z0-9_\-\u4e00-\u9fff]+)")
# 规则卡 frontmatter id（与 tools/lintlib.py _CARD_ID_RE 同式；正则太小，不为此 import 绑死）
_CARD_ID_RE = re.compile(r'"id":\s*"(kb/rules/[a-z0-9-]+)"')

FRONT_LINE = re.compile(r"^([A-Za-z_][\w-]*):\s*(.*)$")


def front(text: str) -> dict:
    """卡头键值粗解析（与 kit-compile.py front 同款：YAML 裸键行，够取 id 即可）。"""
    m = re.match(r"\A---\s*\n(.*?)\n---\s*\n?", text, re.S)
    out = {}
    if m:
        for line in m.group(1).splitlines():
            mm = FRONT_LINE.match(line)
            if mm:
                out[mm.group(1)] = mm.group(2).strip()
    return out


# ── 卡面（供给）─────────────────────────────────────────────────

def new_card(kind: str, source: str, domain: str, file: str, indexed: bool | None = None) -> dict:
    card = {"kind": kind, "source": source, "domain": domain, "file": file, "consumers": {}}
    if indexed is not None:
        card["indexed"] = indexed
    return card


def load_global_cards(root: Path) -> dict:
    """全局卡：index.json 台账 ∪ 盘上扫描兜底（indexed=false）∪ 规则语料卡按盘上核账。"""
    cards: dict = {}
    idx_path = root / "knowledge" / "index.json"
    if idx_path.exists():
        try:
            idx = json.loads(idx_path.read_text(encoding="utf-8"))
        except Exception as e:  # noqa: BLE001 - 台账坏了显式报，不静默出空账
            sys.exit(f"[ABORT] knowledge/index.json 解析失败：{e}")
        for e in idx.get("entries", []):
            cid = e.get("id")
            if not cid:
                continue
            domain = e.get("dimension") or (e.get("file", "").split("/")[0] or str(cid).split("/")[1])
            cards[cid] = new_card("kb", "global", domain, "knowledge/" + (e.get("file") or ""), indexed=True)
    kb_dir = root / "knowledge"
    if kb_dir.is_dir():
        for p in sorted(kb_dir.rglob("*.md")):
            if p.name.upper() == "README.MD":
                continue
            rel = p.relative_to(kb_dir).as_posix()
            fm = front(p.read_text(encoding="utf-8"))
            cid = fm.get("id") or ("kb/" + rel.removesuffix(".md"))
            if cid in cards:
                continue
            kind = "rule-card" if rel.startswith("rules/") else "kb"
            cards[cid] = new_card(kind, "global", rel.split("/")[0], "knowledge/" + rel, indexed=False)
    # 规则语料卡按盘上核账（kit-lint 同口径）：frontmatter id 优先，否则 kb/rules/<stem>。
    # 盘扫已覆盖大多数；这里补 id 与派生不同的边角，并给台账里漏标的卡正名 kind=rule-card。
    rules_dir = root / "knowledge" / "rules"
    if rules_dir.is_dir():
        for p in sorted(rules_dir.glob("*.md")):
            if p.name.upper() == "README.MD":
                continue
            txt = p.read_text(encoding="utf-8")
            m = _CARD_ID_RE.search(txt)
            cid = m.group(1) if m else f"kb/rules/{p.stem}"
            if cid in cards:
                cards[cid]["kind"] = "rule-card"
            else:
                cards[cid] = new_card("rule-card", "global", "rules", f"knowledge/rules/{p.name}", indexed=False)
    return cards


def load_project_cards(root: Path, project: str) -> tuple[dict, list]:
    """项目卡：projects/<id>/ 世界书/规则/文风 三目录（kit-compile --project 同扫描面）。
    返回 (cards, 项目内撞 id 的说明清单——不覆盖，只如实记一笔)。"""
    proj = root / "projects" / project
    if not proj.is_dir():
        sys.exit(f"[ABORT] 项目目录不存在：{proj}")
    cards, dup = {}, []
    for sub in ("世界书", "规则", "文风"):
        d = proj / sub
        if not d.is_dir():
            continue
        for p in sorted(d.rglob("*.md")):
            if p.name.upper() == "README.MD":
                continue
            rel = p.relative_to(proj).as_posix()
            fm = front(p.read_text(encoding="utf-8"))
            cid = fm.get("id") or ("pj/" + rel.removesuffix(".md"))
            if cid in cards:
                dup.append(f"{cid}（{rel} 与早前条目撞 id）")
                continue
            cards[cid] = new_card("project-card", "project", rel.split("/")[0], rel)
    return cards, dup


# ── 消费面（引用扫描）────────────────────────────────────────────

def add_consumer(cards: dict, cid: str, face: str, ref: str, kind: str) -> None:
    """记账：同一卡同一消费位置只记一行（refs/kinds 归并），保确定性。"""
    c = cards[cid].setdefault("consumers", {}).setdefault(face, {"refs": [], "kinds": []})
    if ref not in c["refs"]:
        c["refs"].append(ref)
    if kind not in c["kinds"]:
        c["kinds"].append(kind)


def scan_structural_ref(cards: dict, ref: str, face: str, kind: str, dangling: list) -> None:
    """一条结构化引用（精确 / glob 两态，glob 展开语义与 kit-lint 逐字对齐：去尾星成前缀）。"""
    if ref.endswith("/*"):
        hits = sorted(cid for cid in cards if cid.startswith(ref[:-1]))
        if not hits:
            dangling.append({"ref": ref, "face": face, "why": "glob 无匹配"})
        for cid in hits:
            add_consumer(cards, cid, face, ref, kind)
    elif ref in cards:
        add_consumer(cards, ref, face, ref, kind)
    else:
        dangling.append({"ref": ref, "face": face, "why": "条目不存在"})


def scan_pool_ref(cards: dict, pool: str, face: str, dangling: list) -> None:
    """候选池展开（kit-lint 同款：pool 带尾 * 去星成前缀，否则补斜杠；等值也算命中）。"""
    prefix = pool[:-1] if pool.endswith("*") else pool + "/"
    hits = sorted(cid for cid in cards if cid == pool or cid.startswith(prefix))
    if not hits:
        dangling.append({"ref": pool, "face": face, "why": "候选池无命中"})
    for cid in hits:
        add_consumer(cards, cid, face, pool, "pool")


def scan_text_ref(cards: dict, tok: str, face: str, textual: list) -> None:
    """文本面引用（正文/注释里的 token）：精确 id 直接记；glob 同样展开（散文写
    kb/trope/* 就是在点名整个域）；落空的记 textual 悬空（记账不失败）。"""
    if tok.endswith("/*"):
        hits = sorted(cid for cid in cards if cid.startswith(tok[:-1]))
        if not hits:
            textual.append({"ref": tok, "face": face})
        for cid in hits:
            add_consumer(cards, cid, face, tok, "text")
    elif tok in cards:
        add_consumer(cards, tok, face, tok, "text")
    else:
        textual.append({"ref": tok, "face": face})


def scan_modules(root: Path, cards: dict, dangling: list) -> int:
    """modules/<id>/module.json 的 op.knowledge / exclude_knowledge / knowledge_pools。"""
    n_ops = 0
    for mp in sorted((root / "modules").glob("*/module.json")):
        try:
            m = json.loads(mp.read_text(encoding="utf-8"))
        except Exception as e:  # noqa: BLE001
            dangling.append({"ref": f"modules/{mp.parent.name}/module.json", "face": "modules", "why": f"解析失败 {e}"})
            continue
        mid = mp.parent.name
        for op_id, op in (m.get("ops") or {}).items():
            n_ops += 1
            face = f"modules/{mid}#{op_id}"
            for kb in op.get("knowledge") or []:
                scan_structural_ref(cards, kb, face, "glob" if kb.endswith("/*") else "knowledge", dangling)
            for ex in op.get("exclude_knowledge") or []:
                scan_structural_ref(cards, ex, face, "exclude", dangling)
            for p in op.get("knowledge_pools") or []:
                pool = (p or {}).get("pool")
                if pool:
                    scan_pool_ref(cards, pool, face, dangling)
    return n_ops


def scan_flows(root: Path, cards: dict, dangling: list, textual: list) -> int:
    """flows/*/flow.json：节点 node.kb / node.loads 结构化 + 全文文本（desc 散文提及）。"""
    n = 0
    for fp in sorted((root / "flows").glob("*/flow.json")):
        n += 1
        fid = fp.parent.name
        raw = fp.read_text(encoding="utf-8")
        try:
            fl = json.loads(raw)
        except Exception as e:  # noqa: BLE001
            dangling.append({"ref": f"flows/{fid}/flow.json", "face": "flows", "why": f"解析失败 {e}"})
            continue
        for nid, node in ((fl.get("graph") or {}).get("nodes") or {}).items():
            face = f"flows/{fid}/{nid}"
            kbs = node.get("kb")
            for kb in ([kbs] if isinstance(kbs, str) else (kbs or [])):
                scan_structural_ref(cards, kb, face, "kb", dangling)
            loads = node.get("loads")
            for it in ([loads] if isinstance(loads, str) else (loads or [])):
                # resolveLoads 只把 kb/ 前缀项当知识引用（其余是 repo 根相对路径，不进本账）
                if isinstance(it, str) and it.startswith("kb/"):
                    scan_structural_ref(cards, it, face, "loads", dangling)
        # 散文提及（desc 等）：文本级引用（glob 同展开），落空记 textual（不失败）
        for tok in sorted(set(KB_TOKEN.findall(raw))):
            scan_text_ref(cards, tok, f"flows/{fid}", textual)
    return n


def scan_text_faces(root: Path, cards: dict, textual: list) -> dict:
    """文本消费面：skills/*.md 与 core/src/**/*.ts 的 kb token 扫描（含注释——注释示例
    造成的 textual 悬空如实记账，人裁，不失败）。返回各面文件数。"""
    counts = {"skills": 0, "core_src": 0}

    def scan_dir(base: Path, key: str, suffix: str):
        if not base.is_dir():
            return
        for p in sorted(base.rglob(f"*{suffix}")):
            counts[key] += 1
            rel = p.relative_to(root).as_posix()  # 消费位置 = 仓库根相对路径，如 skills/x.md
            try:
                raw = p.read_text(encoding="utf-8")
            except Exception:  # noqa: BLE001 - 读不了的文件跳过（权限/编码），不致命
                continue
            for tok in sorted(set(KB_TOKEN.findall(raw))):
                scan_text_ref(cards, tok, rel, textual)

    scan_dir(root / "skills", "skills", ".md")
    scan_dir(root / "core" / "src", "core_src", ".ts")
    return counts


# ── 出账 ────────────────────────────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser(description="知识卡 ↔ 消费者亲和对账（收据，非门禁）")
    ap.add_argument("--project", help="并入 projects/<id>/ 项目卡（世界书/规则/文风）")
    ap.add_argument("--out", help="收据 json 路径（缺省 projects/_reports/kb-affinity[-<project>].json）")
    ap.add_argument("--root", default=str(ROOT), help="仓库根（缺省本脚本上一级）")
    args = ap.parse_args()

    root = Path(args.root).resolve()
    cards = load_global_cards(root)
    n_global = len(cards)
    dup: list = []
    if args.project:
        pcards, pdup = load_project_cards(root, args.project)
        dup.extend(pdup)
        for cid, card in pcards.items():
            if cid in cards:
                dup.append(f"{cid}（项目卡与全局卡同 id，账归全局）")
                continue
            cards[cid] = card

    dangling_structural: list = []
    textual: list = []
    n_ops = scan_modules(root, cards, dangling_structural)
    n_flows = scan_flows(root, cards, dangling_structural, textual)
    face_counts = scan_text_faces(root, cards, textual)

    # 汇账：孤儿 = 零正向引用（exclude 不解除孤儿）；消费行按 face 排序保确定性
    orphans, rows = [], []
    for cid in sorted(cards):
        card = cards[cid]
        cons = card.pop("consumers")
        faces = [
            {"face": face, "refs": sorted(cons[face]["refs"]), "kinds": sorted(cons[face]["kinds"])}
            for face in sorted(cons)
        ]
        positive = sum(1 for f in faces if any(k != "exclude" for k in f["kinds"]))
        rows.append({"id": cid, **card, "positive_consumers": positive, "consumers": faces})
        if positive == 0:
            orphans.append(cid)

    # ── N3 豁免账（批次3c R3）：孤儿账先过三类豁免再定「真孤儿」——与 kit-lint 同表同口径（tools/lintlib.py）
    reach = reach_closure({r["id"] for r in rows if r["positive_consumers"] > 0}, kb_card_edges(root))
    orphans_exempt: list = []
    real_orphans: list = []
    for cid in orphans:
        reason = None
        if cid in reach:  # ① 目录可达：被有消费的卡正文 id 级互引覆盖（catalog 导航 + R8 激活）
            reason = "目录可达（被有消费的卡正文 id 级互引覆盖；检索/装载经导航与 R8 激活可达）——N3①"
        elif draft_card(cid):  # ② 草稿待审：-draft 占位，转正前零执行面消费属设计（Q3 §2.2）
            reason = "草稿待审（id 以 -draft 结尾＝待审区占位，转正后接消费）——N3②"
        else:
            for pfx, why in CARD_MANUAL_EXEMPT.items():  # ③ 人工链路证据件
                if cid.startswith(pfx):
                    reason = f"人工链路证据件（{why}）——N3③"
                    break
        if reason:
            orphans_exempt.append({"id": cid, "rule": reason})
        else:
            real_orphans.append(cid)

    orphans_by_kind: dict = {}
    for cid in real_orphans:
        k = cards[cid]["kind"]
        orphans_by_kind[k] = orphans_by_kind.get(k, 0) + 1

    by_kind: dict = {}
    for r in rows:
        by_kind[r["kind"]] = by_kind.get(r["kind"], 0) + 1

    out_path = Path(args.out) if args.out else root / "projects" / "_reports" / (
        "kb-affinity.json" if not args.project else f"kb-affinity-{args.project}.json")
    out_path = out_path if out_path.is_absolute() else root / out_path
    report = {
        "format": "kb-affinity@1",
        "root": root.as_posix(),
        "project": args.project,
        "summary": {
            "cards": len(rows),
            "by_kind": {k: by_kind[k] for k in sorted(by_kind)},
            "referenced_cards": len(rows) - len(orphans),
            # 孤儿账 = N3 豁免后的「真孤儿」（批次3c R3）；豁免前全量在 orphans_exempt 逐卡可审计
            "orphans": len(real_orphans),
            "orphans_by_kind": {k: orphans_by_kind[k] for k in sorted(orphans_by_kind)},
            "orphan_exemptions": {
                "total": len(orphans_exempt),
                "by_rule": {
                    "N3①目录可达": sum(1 for e in orphans_exempt if e["rule"].startswith("目录可达")),
                    "N3②草稿待审": sum(1 for e in orphans_exempt if e["rule"].startswith("草稿待审")),
                    "N3③人工链路": sum(1 for e in orphans_exempt if e["rule"].startswith("人工链路")),
                },
            },
            "dangling_structural": len(dangling_structural),
            "dangling_textual": len(textual),
            "faces": {"modules_ops": n_ops, "flows": n_flows,
                      "skills_files": face_counts["skills"], "core_src_files": face_counts["core_src"]},
            "duplicate_ids": dup,
        },
        "cards": rows,
        "orphans": real_orphans,
        "orphans_exempt": sorted(orphans_exempt, key=lambda e: e["id"]),
        "dangling": {
            "structural": sorted(dangling_structural, key=lambda d: (d["ref"], d["face"])),
            "textual": sorted(textual, key=lambda d: (d["ref"], d["face"])),
        },
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    # stdout 摘要（报数必附收据路径）
    n_kb, n_rule, n_proj = (by_kind.get(k, 0) for k in ("kb", "rule-card", "project-card"))
    print(f"kb-affinity ｜ 全局卡 {n_global}（kb {n_kb} + 规则卡 {n_rule}）"
          + (f" ｜ 项目卡 {n_proj}" if args.project else "")
          + f" ｜ 消费面：modules ops {n_ops} · flows {n_flows} · skills {face_counts['skills']} 文件 · core/src {face_counts['core_src']} 文件")
    print(f"  ｜ 有正向引用的卡 {report['summary']['referenced_cards']} ｜ 零正向引用 {len(orphans)}"
          f"（只记账不失败——语料自由）")
    if orphans:
        n_exempt = len(orphans_exempt)
        by_rule = report["summary"]["orphan_exemptions"]["by_rule"]
        print(f"    N3 豁免 {n_exempt} 条（显式豁免非静默吞，明细进收据 orphans_exempt）："
              f"目录可达 {by_rule['N3①目录可达']}、草稿待审 {by_rule['N3②草稿待审']}、人工链路 {by_rule['N3③人工链路']}")
        print(f"    真孤儿 {len(real_orphans)} 条"
              + (f"（按类：{'、'.join(f'{k} {n}' for k, n in sorted(orphans_by_kind.items()))}）" if real_orphans else "（零）")
              + ("（规则卡零 op 引用属已知正常形态：激活归决策，kit-lint W3 同因豁免）" if orphans_by_kind.get("rule-card") else ""))
        if real_orphans:
            print("    真孤儿样例（前 10）：" + "、".join(real_orphans[:10]) + ("…" if len(real_orphans) > 10 else ""))
    print(f"  ｜ 悬空引用：结构化（断链，exit 1）{len(dangling_structural)} 条 ｜ 文本（注释示例/笔误，人裁）{len(textual)} 条")
    for d in dangling_structural:
        print(f"    STRUCTURAL {d['ref']} @ {d['face']}（{d['why']}）")
    for d in textual[:15]:
        print(f"    textual    {d['ref']} @ {d['face']}")
    if len(textual) > 15:
        print(f"    …（其余 {len(textual) - 15} 条见收据）")
    if dup:
        print(f"  ｜ 同 id 撞账 {len(dup)} 笔：{'; '.join(dup[:5])}")
    print(f"收据 → {out_path}")
    return 1 if dangling_structural else 0


if __name__ == "__main__":
    sys.exit(main())
