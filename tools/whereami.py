"""whereami · 开工自检（AGENTS.md 铁律 #1）

回答「我在哪」：项目 / flow / 当前焦点节点 / 必读输入 / 应产输出 / 门状态。
多项目歧义时返回类型化 AMBIGUOUS（决策日志 #4），禁止静默猜测。

用法：
  python tools/whereami.py                  # 自动判定（0/1/N 个待办项目）
  python tools/whereami.py --project p-key-soul
  python tools/whereami.py --json           # 机器可读
"""
import argparse, json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def load_flow(flow_id):
    p = ROOT / "flows" / flow_id / "flow.json"
    return json.load(open(p, encoding="utf-8")) if p.exists() else None


def effective_flow(proj, flow_id):
    """flow@3 的图不手画——消费内核落盘的 registry/effective.json（单点派生事实源，
    本工具不重实现 expandFlow3）。"""
    p = proj / "registry" / "effective.json"
    if not p.exists():
        return None
    try:
        eff = json.load(open(p, encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if flow_id and eff.get("flowId") and eff["flowId"] != flow_id:
        return None
    nodes, edges = eff.get("nodes") or {}, eff.get("edges") or []
    if not nodes:
        return None
    return {"id": flow_id, "graph": {"nodes": nodes, "edges": edges}, "outputs": []}


def match_flow(state):
    """run-state 未记录 flowId：按节点 id 重叠度匹配 flows/*。"""
    best, best_ov = None, 0
    for d in sorted((ROOT / "flows").iterdir()):
        f = load_flow(d.name)
        if not f:
            continue
        ov = len(set(f.get("graph", {}).get("nodes", {})) & set(state.get("nodes", {})))
        if ov > best_ov:
            best, best_ov = f, ov
    return best if best_ov else None


def topo_order(flow):
    """边做拓扑排序，退化到声明顺序。"""
    nodes = flow["graph"]["nodes"]
    edges = flow["graph"].get("edges", [])
    indeg = {n: 0 for n in nodes}
    outs = {n: [] for n in nodes}
    for e in edges:
        if e.get("to") in indeg and e.get("from") in indeg:
            outs[e["from"]].append(e["to"])
            indeg[e["to"]] += 1
    order, queue = [], [n for n in nodes if indeg[n] == 0]
    while queue:
        n = queue.pop(0)
        order.append(n)
        for m in outs[n]:
            indeg[m] -= 1
            if indeg[m] == 0:
                queue.append(m)
    order += [n for n in nodes if n not in order]
    return order


def upstream_of(flow, node_id):
    return [e["from"] for e in flow["graph"].get("edges", []) if e.get("to") == node_id]


def outputs_of(flow, node_id):
    return [o for o in flow.get("outputs", []) if o.get("node") == node_id]


def analyze(project):
    proj = ROOT / "projects" / project
    # M1 起优先读内核 state.json；旧项目回退 run-state.json
    sp = proj / "state.json"
    legacy = False
    if not sp.exists():
        sp = proj / "run-state.json"
        legacy = True
    if not sp.exists():
        return None
    state = json.load(open(sp, encoding="utf-8"))
    flow = None
    if state.get("flowId"):
        flow = load_flow(state["flowId"])
        if flow is not None and "graph" not in flow:
            # flow@3（模块序列）：图取内核 effective 派生事实源
            flow = effective_flow(proj, state["flowId"]) or flow
    if flow is None:
        flow = match_flow(state) or effective_flow(proj, state.get("flowId"))
    out = {"project": project, "flow": flow.get("id") if flow else None, "state": state, "legacy": legacy,
           "flowObj": flow}
    if not flow:
        out["error"] = "无法匹配 flow（flows/ 下无节点重叠项）"
        return out
    nodes, order = state.get("nodes", {}), (state.get("plan", {}).get("order") or list(state.get("nodes", {})))
    pending = [n for n in order if (nodes.get(n) or {}).get("status") != "done"]
    out["pendingCount"] = len(pending)
    out["pendingIds"] = pending

    gate = state.get("gate", {})
    if gate.get("verdict") == "awaiting":
        out["focus"] = {"type": "GATE", "node": gate.get("node") or (pending[0] if pending else None),
                        "note": gate.get("note", "")}
    else:
        cur = next((n for n in pending if nodes.get(n, {}).get("status") == "pending"), None)
        cur = cur or (pending[0] if pending else None)
        if cur is None:
            out["focus"] = {"type": "DONE", "note": "全部节点 done"}
        else:
            fn = flow["graph"]["nodes"].get(cur, {})
            out["focus"] = {"type": "NODE", "node": cur, "title": fn.get("title", ""),
                            "kind": fn.get("kind", ""), "skill": fn.get("skill", ""),
                            "file": fn.get("output") or fn.get("file", "")}
            # 必读输入：上游 done 节点 → 其产物（存在才列）
            reads = []
            gnodes = flow["graph"]["nodes"]
            for up in upstream_of(flow, cur):
                if nodes.get(up, {}).get("status") != "done":
                    continue
                up_out = (gnodes.get(up) or {}).get("output") or (gnodes.get(up) or {}).get("file")
                for o in outputs_of(flow, up):
                    op = o.get("path") or o.get("file") or up_out
                    if op and (proj / op).exists():
                        reads.append(op)
            if fn.get("output") or fn.get("file"):
                reads.append(fn.get("output") or fn["file"])
            out["mustRead"] = sorted(set(reads))
    return out


def render_block(a):
    L = [f"PROJECT: {a['project']} ｜ FLOW: {a.get('flow') or '?'}" + ("（legacy run-state）" if a.get("legacy") else "")]
    if a.get("error"):
        return L + [f"ERROR: {a['error']}"]
    f = a.get("flowObj") or (load_flow(a["flow"]) if isinstance(a.get("flow"), str) else a.get("flow"))
    g = a["state"].get("gate", {})
    L.append(f"GATE: {g.get('verdict')}" + (f"（{g.get('note','')}）" if g.get("note") else ""))
    fo = a.get("focus", {})
    if fo["type"] == "GATE":
        L.append(f"FOCUS: 等人裁决 @ {fo.get('node')} —— 调用 flow_gate（M1 前：更新 state 的 gate 字段）")
    elif fo["type"] == "DONE":
        L.append("FOCUS: 无（全部完成）")
    else:
        fn = f["graph"]["nodes"][fo["node"]]
        L.append(f"FOCUS: {fo['node']}（{fo['title']} ｜ kind={fo['kind']}"
                 + (f" ｜ skill={fo['skill']}" if fo.get("skill") else "") + "）")
        if fo.get("skill"):
            L.append(f"  节点契约: skills/{fo['skill']}.md + flow.json#{fo['node']}")
        outs = outputs_of(f, fo["node"])
        if outs:
            _n = f["graph"]["nodes"]
            L.append("  应产输出: " + "；".join(
                f"{o.get('path') or o.get('file') or (_n.get(o.get('node')) or {}).get('output')}（{o.get('title','')}）"
                for o in outs))
    for r in a.get("mustRead", []):
        L.append(f"MUST-READ: projects/{a['project']}/{r}")
    L.append(f"PENDING: {a['pendingCount']}/{len(a['state'].get('nodes', {}))} 节点未完成"
             + (f"（之后: {', '.join(a['pendingIds'][1:5])}…）" if a["pendingCount"] > 1 else ""))
    return L


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--project")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    if args.project:
        a = analyze(args.project)
        if not a:
            print(f"AMBIGUOUS-NA: 项目不存在或无 run-state.json: {args.project}")
            sys.exit(2)
        results = [a]
        kind = "FOCUSED"
    else:
        results = []
        for d in sorted((ROOT / "projects").iterdir()):
            if d.is_dir() and ((d / "state.json").exists() or (d / "run-state.json").exists()):
                a = analyze(d.name)
                if a and not a.get("error") and a.get("pendingCount", 0) > 0:
                    results.append(a)
        if len(results) == 0:
            kind = "IDLE"
        elif len(results) == 1:
            kind = "FOCUSED"
        else:
            kind = "AMBIGUOUS"

    if args.json:
        print(json.dumps({"kind": kind, "results": results}, ensure_ascii=False, indent=2))
        return
    if kind == "AMBIGUOUS":
        print(f"AMBIGUOUS: {len(results)} 个项目有待办节点，无法判定焦点——用 --project 指定：")
        for a in results:
            print(f"  - {a['project']}（剩余 {a['pendingCount']} 节点：{', '.join(a['pendingIds'][:4])}…）")
        sys.exit(3)
    if kind == "IDLE":
        print("IDLE: 没有待办项目（全部 done 或无 run-state）")
        return
    print("\n".join(render_block(results[0])))


if __name__ == "__main__":
    main()
