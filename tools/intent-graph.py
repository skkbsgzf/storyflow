#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""立意图 CLI · intent-graph@1 图 CRUD 单一实现（方案盘-立意图三层架构-20260924）。

宇宙级存储：universes/<uid>/intent-graph.json（+ universes/index.json 台账）。
项目经 项目配置.json 的 universeId 绑定宇宙；committed 候选经内核 ig_sync 动词
单向落 projects/<id>/decisions/（setDecision 单源，本工具不写决策文件——防双实现漂移）。

内核动词 ig_load/ig_propose/ig_commit/ig_exclude 全部桥接到本工具（verbs.ts 单表），
chat agent 白名单只放 ig_load/ig_propose（提案制：AI 提案、人拍板、系统记账）。

红线（同步自 contracts/intent-graph.schema.json）：
  - p 是剪枝排序分，禁当放行闸；scorer=untested 禁带 p；
  - excluded 必须带理由；commit 必须带 --reason（拍板留痕）；
  - 本工具绝不写 projects/<id>/decisions/（那是 ig_sync + setDecision 的家）。
"""
from __future__ import annotations
import argparse, json, os, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UNIVERSES = ROOT / "universes"
KINDS = ["立意", "人物", "世界观", "主旨", "题材", "钩子", "设定"]
SCORERS = ["human", "semif-4b", "laya-student", "jev-api", "untested"]
ID_OK = __import__("re").compile(r"^[a-z][a-z0-9-]*$")


def die(msg: str) -> None:
    print(f"[ABORT] {msg}", file=sys.stderr)
    sys.exit(1)


def now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S") + time.strftime("%z")


def udir(uid: str) -> Path:
    if not ID_OK.match(uid):
        die(f"宇宙 id 不合法：{uid}（^u-[a-z0-9-]+$ 实际按 ^[a-z][a-z0-9-]*$ 校验前缀 u-）")
    if not uid.startswith("u-"):
        die(f"宇宙 id 必须以 u- 开头：{uid}")
    return UNIVERSES / uid


def load_graph(uid: str) -> dict:
    p = udir(uid) / "intent-graph.json"
    if not p.exists():
        die(f"立意图不存在：{p}（先 intent-graph.py init）")
    g = json.loads(p.read_text(encoding="utf-8"))
    if g.get("format") != "intent-graph@1":
        die(f"format≠intent-graph@1：{p}")
    return g


def save_graph(uid: str, g: dict) -> None:
    g["updated_at"] = now()
    nodes = g.get("nodes", [])
    g["stats"] = {
        "nodes": len(nodes),
        "committed": sum(1 for n in nodes if n.get("status") == "committed"),
        "candidates": sum(len(n.get("candidates", [])) for n in nodes),
    }
    p = udir(uid) / "intent-graph.json"
    tmp = p.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(g, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, p)


def check_p_scorer(cand: dict) -> str | None:
    """红线复核，返回问题串（None=过）。p 是剪枝排序分：必须有有效 scorer，untested 禁带 p。"""
    if cand.get("p") is not None:
        if cand.get("scorer") in (None, "untested"):
            return f"候选 {cand.get('id')}：带 p 必须带有效 scorer（untested 禁带 p——不编造概率）"
        if not (0 <= float(cand["p"]) <= 1):
            return f"候选 {cand['id']}：p 越界（0..1）"
    return None


def node_of(g: dict, nid: str) -> dict:
    for n in g.get("nodes", []):
        if n["id"] == nid:
            return n
    die(f"节点不存在：{nid}")


# ── 子命令 ──────────────────────────────────────────────────────────

def cmd_init(a: argparse.Namespace) -> None:
    p = udir(a.universe) / "intent-graph.json"
    if p.exists() and not a.force:
        die(f"已存在（--force 覆盖）：{p}")
    udir(a.universe).mkdir(parents=True, exist_ok=True)
    g = {"format": "intent-graph@1", "universe": a.universe, "title": a.title,
         "updated_at": now(), "nodes": [], "edges": [], "stats": {"nodes": 0, "committed": 0, "candidates": 0}}
    save_graph(a.universe, g)
    idx_p = UNIVERSES / "index.json"
    idx = json.loads(idx_p.read_text(encoding="utf-8")) if idx_p.exists() else {"format": "universe-index@1", "universes": []}
    if not any(u.get("id") == a.universe for u in idx["universes"]):
        idx["universes"].append({"id": a.universe, "title": a.title, "created_at": now(), "projects": []})
    tmp = idx_p.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(idx, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, idx_p)
    print(f"[init] {p}")


def cmd_add_node(a: argparse.Namespace) -> None:
    if a.kind not in KINDS:
        die(f"kind 限 {KINDS}")
    if not ID_OK.match(a.id):
        die(f"节点 id 不合法：{a.id}")
    g = load_graph(a.universe)
    if any(n["id"] == a.id for n in g["nodes"]):
        die(f"节点 id 已存在：{a.id}")
    if a.parent and not any(n["id"] == a.parent for n in g["nodes"]):
        die(f"父节点不存在：{a.parent}")
    if a.decision_key and not ID_OK.match(a.decision_key):
        die(f"decision_key 不合法：{a.decision_key}（decision@1 键位 ^[a-z][a-z0-9-]*$）")
    g["nodes"].append({"id": a.id, "kind": a.kind, "title": a.title, "content": a.content or "",
                       "parent": a.parent, "status": "open", "decision_key": a.decision_key or "",
                       "candidates": []})
    save_graph(a.universe, g)
    print(f"[add-node] {a.id}（{a.kind}·{a.title}）")


def cmd_add_candidate(a: argparse.Namespace) -> None:
    if not ID_OK.match(a.id):
        die(f"候选 id 不合法：{a.id}")
    if a.scorer not in SCORERS:
        die(f"scorer 限 {SCORERS}")
    g = load_graph(a.universe)
    n = node_of(g, a.node)
    if any(c["id"] == a.id for c in n["candidates"]):
        die(f"候选 id 已存在：{a.id}（qid 式不复用）")
    cand = {"id": a.id, "title": a.title or "", "content": a.content or "",
            "scorer": a.scorer, "evidence": a.evidence or "", "status": "proposed"}
    if a.p is not None:
        cand["p"] = a.p
    err = check_p_scorer(cand)
    if err:
        die(err)
    n["candidates"].append(cand)
    save_graph(a.universe, g)
    p_txt = f" p={a.p}" if a.p is not None else ""
    print(f"[add-candidate] {a.node}/{a.id}（scorer={a.scorer}{p_txt}）")


def cmd_commit(a: argparse.Namespace) -> None:
    if not a.reason:
        die("commit 必须带 --reason（拍板留痕，R8 证据纪律）")
    g = load_graph(a.universe)
    n = node_of(g, a.node)
    cand = next((c for c in n["candidates"] if c["id"] == a.candidate), None)
    if cand is None:
        die(f"候选不存在：{a.node}/{a.candidate}")
    if cand["status"] == "excluded":
        die(f"候选已排除，不可 commit：{a.candidate}（先复核排除理由）")
    # 拍板理由并进 evidence（契约 additionalProperties:false，不新增键），状态一次落盘
    cand["evidence"] = ((cand.get("evidence") or "") + f"｜拍板：{a.reason}").strip("｜")
    cand["status"] = "committed"
    n["status"] = "committed"
    save_graph(a.universe, g)
    print(f"[commit] {a.node}/{a.candidate}（{n.get('decision_key') or '无 decision_key，不参与 ig_sync'}）")


def cmd_exclude(a: argparse.Namespace) -> None:
    if not a.reason:
        die("exclude 必须带 --reason（为什么没选 X 不许哑，R8）")
    g = load_graph(a.universe)
    n = node_of(g, a.node)
    cand = next((c for c in n["candidates"] if c["id"] == a.candidate), None)
    if cand is None:
        die(f"候选不存在：{a.node}/{a.candidate}")
    if cand["status"] == "committed":
        die(f"候选已 committed，不可 exclude（先出修订流程）")
    cand["status"] = "excluded"
    cand["excluded_reason"] = a.reason
    save_graph(a.universe, g)
    print(f"[exclude] {a.node}/{a.candidate}（{a.reason[:40]}）")


def cmd_show(a: argparse.Namespace) -> None:
    g = load_graph(a.universe)
    if a.json:
        print(json.dumps(g, ensure_ascii=False, indent=2))
        return
    print(f"立意图 {g['universe']} · {g['title']}（stats={g.get('stats')}）")
    by_parent: dict[str, list] = {}
    for n in g["nodes"]:
        by_parent.setdefault(n.get("parent") or "", []).append(n)

    def render(pid: str, depth: int) -> None:
        for n in by_parent.get(pid, []):
            badge = {"committed": "✅", "excluded": "❌", "open": "◻"}.get(n["status"], "◻")
            print("  " * depth + f"{badge} [{n['kind']}] {n['title']}（{n['id']}）")
            for c in n["candidates"]:
                p = f" p={c['p']}" if c.get("p") is not None else ""
                st = {"proposed": "·", "committed": "✅", "excluded": "❌"}.get(c["status"], "·")
                print("  " * (depth + 1) + f"{st} {c['id']} scorer={c.get('scorer','?')}{p} {c.get('title','')}")
            render(n["id"], depth + 1)

    render("", 0)


def cmd_bind(a: argparse.Namespace) -> None:
    cfg_p = ROOT / "projects" / a.project / "项目配置.json"
    if not cfg_p.exists():
        die(f"项目配置不存在：{cfg_p}")
    load_graph(a.universe)  # 宇宙必须真实存在
    cfg = json.loads(cfg_p.read_text(encoding="utf-8"))
    cfg["universeId"] = a.universe
    tmp = cfg_p.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, cfg_p)
    idx_p = UNIVERSES / "index.json"
    idx = json.loads(idx_p.read_text(encoding="utf-8"))
    for u in idx["universes"]:
        if u["id"] == a.universe and a.project not in u.setdefault("projects", []):
            u["projects"].append(a.project)
    tmp = idx_p.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(idx, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, idx_p)
    print(f"[bind] {a.project} → {a.universe}")


def cmd_check(a: argparse.Namespace) -> None:
    """契约体检：schema 红线手工复核（p 无 scorer / excluded 无理由 / decision_key 形状 / parent 环）。"""
    problems: list[str] = []
    g = load_graph(a.universe)
    ids = set()
    for n in g["nodes"]:
        if n["id"] in ids:
            problems.append(f"节点 id 重复：{n['id']}")
        ids.add(n["id"])
        if n.get("decision_key") and not ID_OK.match(n["decision_key"]):
            problems.append(f"{n['id']}: decision_key 不合法（{n['decision_key']}）")
        if n["status"] == "committed" and not any(c["status"] == "committed" for c in n["candidates"]):
            problems.append(f"{n['id']}: 节点 committed 但无 committed 候选")
        for c in n["candidates"]:
            err = check_p_scorer(c)
            if err:
                problems.append(f"{n['id']}: {err}")
            if c["status"] == "excluded" and not c.get("excluded_reason"):
                problems.append(f"{n['id']}/{c['id']}: excluded 无理由")
            if c["status"] == "committed" and n.get("status") != "committed":
                problems.append(f"{n['id']}/{c['id']}: 候选 committed 但节点非 committed")
    for n in g["nodes"]:
        par = n.get("parent")
        if par and par not in ids:
            problems.append(f"{n['id']}: parent 不存在（{par}）")
    for e in g.get("edges", []):
        if e["from"] not in ids or e["to"] not in ids:
            problems.append(f"edge 端点不存在：{e['from']}→{e['to']}")
    if problems:
        print(json.dumps({"ok": False, "problems": problems}, ensure_ascii=False, indent=2))
        sys.exit(1)
    print(json.dumps({"ok": True, "universe": a.universe, "stats": g.get("stats")}, ensure_ascii=False))


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("init"); s.add_argument("--universe", required=True); s.add_argument("--title", required=True); s.add_argument("--force", action="store_true"); s.set_defaults(f=cmd_init)
    s = sub.add_parser("add-node"); s.add_argument("--universe", required=True); s.add_argument("--id", required=True); s.add_argument("--kind", required=True); s.add_argument("--title", required=True); s.add_argument("--content"); s.add_argument("--parent"); s.add_argument("--decision-key", dest="decision_key"); s.set_defaults(f=cmd_add_node)
    s = sub.add_parser("add-candidate"); s.add_argument("--universe", required=True); s.add_argument("--node", required=True); s.add_argument("--id", required=True); s.add_argument("--title"); s.add_argument("--content"); s.add_argument("--p", type=float); s.add_argument("--scorer", required=True); s.add_argument("--evidence"); s.set_defaults(f=cmd_add_candidate)
    s = sub.add_parser("commit"); s.add_argument("--universe", required=True); s.add_argument("--node", required=True); s.add_argument("--candidate", required=True); s.add_argument("--reason", required=True); s.set_defaults(f=cmd_commit)
    s = sub.add_parser("exclude"); s.add_argument("--universe", required=True); s.add_argument("--node", required=True); s.add_argument("--candidate", required=True); s.add_argument("--reason", required=True); s.set_defaults(f=cmd_exclude)
    s = sub.add_parser("show"); s.add_argument("--universe", required=True); s.add_argument("--json", action="store_true"); s.set_defaults(f=cmd_show)
    s = sub.add_parser("bind"); s.add_argument("--project", required=True); s.add_argument("--universe", required=True); s.set_defaults(f=cmd_bind)
    s = sub.add_parser("check"); s.add_argument("--universe", required=True); s.set_defaults(f=cmd_check)

    a = ap.parse_args()
    a.f(a)


if __name__ == "__main__":
    main()
