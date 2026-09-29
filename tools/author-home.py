"""author-home · 作者之家生成器（author-home@1，零依赖，静态聚合只读）

三柱合一页：
  聚合层  项目 Wiki 目录 + 全项目合并时间轴（journal 里程碑）
  叙事层  ThoughtDAG 思脉图（想法→选项→定案→版本→复盘→编排，全部 join 自既有外键）
          + 作者之眼（规则归纳的创作习惯观察，机器归纳、供作者反驳）
  学习中心（预览）经验收件箱：findings 按维度给转化路由（编排提案/规则卡/kb 卡），
          起草为构建期确定性模板——提案落盘仍走既有渠道（flow_overlay / 手动立卡），本页不代拍板

数据源（零新增记录负担）：journal.jsonl、snapshots/index.json、decisions/*.json、
registry/miner-findings.json、universes/*/intent-graph.json、世界书/graph.json、
flow.json、state.json。产物：仓库根 author-home.html（静态自包含）。

用法：
  python tools/author-home.py [--quiet]
"""
import json
import re
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
from worldbook_history import (  # noqa: E402
    build_decisions,
    build_findings,
    build_milestones,
    build_versions,
    load_json,
)

SKIP_PREFIX = "_"
MILESTONE_CAP = 120
FINDING_CAP = 12
HOTSPOT_CAP = 10
DIM_ROUTE = {
    "structure": ("编排提案", "flow_overlay"),
    "cost": ("编排提案", "flow_overlay"),
    "coverage": ("kb 卡", "kb/"),
    "ctx": ("kb 卡", "kb/"),
    "aesthetic": ("规则卡", "knowledge/rules/"),
    "style": ("规则卡", "knowledge/rules/"),
    "continuity": ("kb 卡", "kb/"),
}
DAG_KIND_COLOR = {
    "idea": "#7d5ba6", "option": "#c2831f", "decision": "#9d3b26",
    "version": "#3f5e8c", "finding": "#b04a3a", "overlay": "#a8722a",
}


def last_journal_ts(proj: Path) -> str:
    jp = proj / "journal.jsonl"
    if not jp.exists():
        return ""
    last = ""
    for ln in jp.read_text(encoding="utf-8").splitlines():
        ln = ln.strip()
        if not ln:
            continue
        try:
            d = json.loads(ln)
        except Exception:
            continue
        if d.get("ts"):
            last = d["ts"]
    return last[5:16].replace("T", " ")


def scan_project(proj: Path) -> dict | None:
    if not proj.is_dir() or proj.name.startswith(SKIP_PREFIX):
        return None
    cfg = load_json(proj / "项目配置.json", {}) or {}
    state = load_json(proj / "state.json", {}) or {}
    flow = load_json(ROOT / "flows" / (state.get("flowId") or "_") / "flow.json") or {}
    graph = load_json(proj / "世界书" / "graph.json") or {}
    nodes = state.get("nodes") or {}
    done = sum(1 for v in nodes.values() if (v or {}).get("status") == "done")
    decisions = build_decisions(proj)
    findings = build_findings(proj, cap=99)
    versions = [v for v in build_versions(proj, cap=99) if len(v["rounds"]) > 1]
    card = {
        "id": proj.name,
        "title": cfg.get("title") or proj.name,
        "theme": cfg.get("题材", ""),
        "universe": cfg.get("universeId", ""),
        "flow": state.get("flowId") or cfg.get("flowId") or "",
        "flowTitle": (flow.get("title") or "") if isinstance(flow, dict) else "",
        "status": state.get("status", ""),
        "nodesDone": done,
        "nodesTotal": len(nodes),
        "entries": (graph.get("stats") or {}).get("entries", 0),
        "relations": (graph.get("stats") or {}).get("edges", 0),
        "decisions": len(decisions),
        "findings": len(findings),
        "rework": len(versions),
        "lastActive": last_journal_ts(proj),
    }
    ms = [{**m, "project": proj.name, "ptitle": card["title"]} for m in build_milestones(proj)]
    return {"card": card, "milestones": ms,
            "decisions": decisions, "versions": versions,
            "findings": [{**f, "project": proj.name, "ptitle": card["title"]} for f in findings],
            "hotspots": [{**v, "project": proj.name} for v in versions]}


def src_link(text: str, project: str) -> str:
    """从证据文本里解析第一个真实存在的仓库文件路径 → 相对链接；找不到返回空。"""
    if not text:
        return ""
    m = re.search(r"[A-Za-z0-9_\-\u4e00-\u9fff]+(?:/[A-Za-z0-9_\-\u4e00-\u9fff.#§]+)+\.(?:md|json)", str(text))
    if not m:
        return ""
    rel = m.group(0)
    for cand in (ROOT / rel, ROOT / "projects" / project / rel):
        if cand.is_file():
            return str(cand.relative_to(ROOT)).replace("\\", "/")
    return ""


def build_dag(projects, per) -> dict:
    """ThoughtDAG：想法→选项→定案→版本→复盘→编排，join 既有外键。"""
    nodes, edges = [], []
    seen = set()

    def node(nid, kind, title, project, detail=None, ts="", status="", src=""):
        if nid in seen:
            return
        seen.add(nid)
        nodes.append({"id": nid, "kind": kind, "title": title, "project": project,
                      "detail": detail or "", "ts": ts, "status": status, "src": src})

    def edge(a, b, rel):
        edges.append({"a": a, "b": b, "rel": rel})

    # ① 宇宙级立意图：想法 → 选项（committed/excluded/proposed）
    uni = load_json(ROOT / "universes" / "index.json", {}) or {}
    for u in uni.get("universes", []):
        uid = u.get("id", "")
        bound = u.get("projects", [])
        g = load_json(ROOT / "universes" / uid / "intent-graph.json") or {}
        for n in g.get("nodes", []):
            anchor = bound[0] if bound else ""
            nid = f"{uid}:{n['id']}"
            node(nid, "idea", f"{n.get('kind', '想法')}·{n.get('title', '')}", anchor,
                 detail=n.get("content", ""), ts=(g.get("updated_at") or "")[5:16].replace("T", " "),
                 status=n.get("status", ""))
            for c in n.get("candidates", []):
                cid = f"{nid}:{c['id']}"
                node(cid, "option", c.get("title", ""), anchor,
                     detail=c.get("content", ""), status=c.get("status", ""))
                edge(nid, cid, "分叉出")
                if c.get("status") == "excluded":
                    pass  # 否决路径以状态呈现，不加额外边
    # ② 决策（decision@1）：选项/想法 → 定案（key == decision_key）
    for p in projects:
        pid = p["id"]
        uni_id = p.get("universe", "")
        for d in per[pid]["decisions"]:
            did = f"dec:{pid}:{d['key']}"
            node(did, "decision", d["key"], pid,
                 detail="选定：" + "、".join(d.get("picked", [])),
                 ts=d.get("at", ""), src=src_link(d.get("evidence", ""), pid))
            # 与宇宙立意图的接线：decision_key 匹配
            g = load_json(ROOT / "universes" / uni_id / "intent-graph.json") or {}
            for n in g.get("nodes", []):
                if n.get("decision_key") == d["key"]:
                    edge(f"{uni_id}:{n['id']}", did, "定案为")
                    for c in n.get("candidates", []):
                        if c.get("status") == "committed":
                            edge(f"{uni_id}:{n['id']}:{c['id']}", did, "支持")
    # ③ 版本（多轮产物）与 ④ 编排调整 → 版本
    for p in projects:
        pid = p["id"]
        for v in per[pid]["versions"]:
            vid = f"ver:{pid}:{v['node']}"
            node(vid, "version", v["node"], pid,
                 detail=f"{len(v['rounds'])} 轮 · {v.get('artifact', '')}",
                 ts=v["rounds"][-1]["ts"], src=src_link(v.get("artifact", ""), pid))
        for m in per[pid].get("_milestones_raw", []):
            if m.get("kind") == "overlay":
                oid = f"ovl:{pid}:{m['ts']}"
                node(oid, "overlay", "编排调整", pid, detail=m.get("detail", ""), ts=m.get("ts", ""))
                for ref in m.get("refs", []) or []:
                    vid = f"ver:{pid}:{ref}"
                    if vid in seen:
                        edge(oid, vid, "波及")
    # ⑤ 复盘 findings
    for p in projects:
        pid = p["id"]
        for f in per[pid]["findings"]:
            fid = f"fnd:{pid}:{f.get('id', f.get('title', ''))}"
            node(fid, "finding", f.get("title", ""), pid,
                 detail=f.get("reason", ""), status=f.get("severity", ""),
                 src=src_link(" ".join(str(e.get("quote", "")) for e in (f.get("evidence") or []) if isinstance(e, dict)), pid))
    return {"nodes": nodes, "edges": edges,
            "stats": {"nodes": len(nodes), "edges": len(edges)}}


def build_habits(projects, per, milestones, hotspots) -> list:
    """作者之眼：规则归纳的创作习惯观察（机器归纳，供作者反驳）。"""
    obs = []
    prefix = {}
    for p in projects:
        for v in per[p["id"]]["versions"]:
            prefix.setdefault(v["node"].split(".")[0], []).append((p["id"], v["node"], len(v["rounds"])))
    if prefix:
        top = sorted(prefix.items(), key=lambda kv: -sum(x[2] for x in kv[1]))[0]
        rounds = sum(x[2] for x in top[1])
        obs.append({"t": "返工集中在哪", "b": f"多轮重写共 {rounds} 轮，其中 {len(top[1])} 个节点在 {top[0]} 层——"
                    "大改最容易发生的位置就是它，下次排期可以在该层前置留缓冲。"})
    if hotspots:
        h = hotspots[0]
        pt = (next((c["title"] for c in projects if c["id"] == h["project"]), h["project"]))
        obs.append({"t": "最热单点", "b": f"「{h['node']}」（{pt}）被重写 {len(h['rounds'])} 轮——"
                    "单点高频返工通常意味着该节点的验收口径该前移（评审步或标尺卡）。"})
    gates = sum(1 for m in milestones if m.get("kind") == "gate")
    reruns = sum(1 for m in milestones if m.get("kind") == "rerun")
    if milestones:
        obs.append({"t": "门与重做的比例", "b": f"全库 {gates} 次门裁决、{reruns} 次重做级联——"
                    + ("重做多于门，说明返工主要来自口径变化而非质量打回。" if reruns >= gates else "门多于重做，流程把关在起作用。")})
    days = {}
    for m in milestones:
        days.setdefault(m["project"], set()).add(m["ts"][:5])
    multi = {k: v for k, v in days.items() if len(v) >= 2}
    if multi:
        best = sorted(multi.items(), key=lambda kv: -len(kv[1]))[0]
        obs.append({"t": "结算节奏", "b": f"「{best[0]}」跨 {len(best[1])} 个活跃日持续产出；"
                    "全库有 " + str(len(multi)) + " 个项目呈现多日连续创作节奏。"})
    return obs


def build_author_home() -> dict:
    projects, per = [], {}
    milestones, findings, hotspots = [], [], []
    for p in sorted((ROOT / "projects").iterdir()):
        r = scan_project(p)
        if not r:
            continue
        projects.append(r["card"])
        per[p.name] = r
        r["_milestones_raw"] = r["milestones"]
        milestones.extend(r["milestones"])
        findings.extend(r["findings"])
        hotspots.extend(r["hotspots"])
    milestones.sort(key=lambda m: m["ts"], reverse=True)
    milestones = milestones[:MILESTONE_CAP]
    hotspots.sort(key=lambda v: -len(v["rounds"]))
    sev = {"high": 0, "medium": 1, "low": 2}
    findings.sort(key=lambda f: sev.get(f.get("severity"), 9))
    uni = load_json(ROOT / "universes" / "index.json", {}) or {}
    universes = {u.get("id"): u.get("title") for u in uni.get("universes", []) if u.get("id")}
    for f in findings[:FINDING_CAP]:
        route = DIM_ROUTE.get(f.get("dimension", ""), ("kb 卡", "kb/"))
        f["route"] = route[0]
        f["routeTo"] = route[1]
    dag = build_dag(projects, per)
    habits = build_habits(projects, per, milestones, hotspots)
    return {
        "format": "author-home@1",
        "built_at": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "projects": projects,
        "milestones": milestones,
        "findings": findings[:FINDING_CAP],
        "hotspots": [{"node": v["node"], "project": v["project"], "rounds": len(v["rounds"]),
                      "artifact": v.get("artifact", "")} for v in hotspots[:HOTSPOT_CAP]],
        "universes": universes,
        "dag": dag,
        "habits": habits,
        "stats": {
            "projects": len(projects),
            "active": sum(1 for c in projects if c["status"] not in ("completed",)),
            "entries": sum(c["entries"] for c in projects),
            "relations": sum(c["relations"] for c in projects),
            "decisions": sum(c["decisions"] for c in projects),
            "findings": sum(c["findings"] for c in projects),
        },
    }


def main():
    quiet = "--quiet" in sys.argv[1:]
    data = build_author_home()
    tpl = (ROOT / "tools" / "author-home-template.html").read_text(encoding="utf-8")
    html = (tpl
            .replace("__AHDATA__", json.dumps(data, ensure_ascii=False).replace("</", "<\\/"))
            .replace("__TITLE__", "作者之家"))
    out = ROOT / "author-home.html"
    out.write_text(html, encoding="utf-8")
    if not quiet:
        st = data["stats"]
        ds = data["dag"]["stats"]
        print(f"author-home@1 → {out} ｜ 项目 {st['projects']}（活跃 {st['active']}）｜ 词条 {st['entries']} ｜ "
              f"定案 {st['decisions']} ｜ 复盘 {st['findings']} ｜ 里程碑 {len(data['milestones'])} ｜ "
              f"思脉图 {ds['nodes']} 节点 {ds['edges']} 边 ｜ 习惯观察 {len(data['habits'])} 条")


if __name__ == "__main__":
    main()
