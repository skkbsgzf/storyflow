"""whereami · 开工自检（AGENTS.md 铁律 #1）

回答「我在哪」：项目 / flow / 当前焦点节点 / 必读输入 / 应产输出 / 门状态。
多项目歧义时返回类型化 AMBIGUOUS（决策日志 #4），禁止静默猜测。

用法：
  python tools/whereami.py                  # 自动判定（0/1/N 个待办项目）
  python tools/whereami.py --project p-key-soul
  python tools/whereami.py --json           # 机器可读
  python tools/whereami.py --selfcheck      # 约束档位三档自测（合成 fixture，纯 stdlib，不碰真实项目）
"""
import argparse, json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# ── 约束档位（模式感知约束 P1，2026-10-13）────────────────────────────────────
# kit 只出「检索档位」信号（strict/assist/idle + 档位标注），不出裁决语义——
# 「必须遵循」的纪律语言归 Agent.md 方法论与注入文案（storyharness/src/brief.ts）。
# 与 storyharness/src/brief.ts::determineConstraintMode **双实现同启发式**，确定性小逻辑，
# 两侧测试钉住（本文件 --selfcheck / storyharness/test/brief-session.test.ts）：
#   ① 无 state.json → 项目配置.json.sessionBrief 非空 ? "assist" : "idle"（改稿/协作会话）
#   ② 有 state：pending 节点（status≠done）中存在 kind=="produce"（写作产出相）→ "strict"；
#      有 pending 无 produce → "assist"；无 pending → "idle"。
# kind 事实源 = 生效编排节点表（analyze() 已解析的 flow 图：flows/ 直图或 registry/effective.json）；
# brief.ts 侧只读项目目录 effective.json（不读 flows/）——legacy 项目两侧可能差一档，见 Agent.md。
CONSTRAINT_HINT = {
    "strict": "项目创作中，检索结果按强相关档位遵循",
    "assist": "项目运行中，检索结果强烈推荐参考",
    "idle": "无活跃创作，检索结果仅供参考",
}


def _session_brief_nonempty(cfg):
    sb = (cfg or {}).get("sessionBrief")
    return isinstance(sb, list) and any(isinstance(x, str) and x.strip() for x in sb)


def determine_constraint_mode(state, cfg, flow=None):
    """三档约束档位判定（启发式见模块注释，与 brief.ts 逐行同口径）。"""
    if not state:
        # ① 无 state：未立项/改稿项目——sessionBrief 非空 = 改稿/协作会话进行中
        return "assist" if _session_brief_nonempty(cfg) else "idle"
    # ② 有 state：pending（status≠done）里找写作产出相（kind=produce）
    nodes = state.get("nodes", {})
    order = (state.get("plan") or {}).get("order") or list(nodes)
    pending = [n for n in order if (nodes.get(n) or {}).get("status") != "done"]
    if not pending:
        return "idle"
    gnodes = ((flow or {}).get("graph") or {}).get("nodes", {})
    for n in pending:
        if (gnodes.get(n) or {}).get("kind") == "produce":
            return "strict"
    return "assist"


def load_config(proj):
    """项目配置.json → dict（缺失/坏 JSON 回 {}，档位判定不因配置损坏而崩）。"""
    p = proj / "项目配置.json"
    if not p.exists():
        return {}
    try:
        return json.load(open(p, encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


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
    cfg = load_config(proj)
    # M1 起优先读内核 state.json；旧项目回退 run-state.json
    sp = proj / "state.json"
    legacy = False
    if not sp.exists():
        sp = proj / "run-state.json"
        legacy = True
    if not sp.exists():
        # 无 state（未立项/改稿项目）：不再回 None——改稿会话（sessionBrief 非空）也要拿到
        # 约束档位（模式感知约束 P1）；目录不存在才维持「项目不存在」错误路径。
        if not proj.is_dir():
            return None
        return {"project": project, "flow": None, "state": None, "legacy": False, "flowObj": None,
                "constraint_mode": determine_constraint_mode(None, cfg)}
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
           "flowObj": flow,
           "constraint_mode": determine_constraint_mode(state, cfg, flow)}
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
    # 约束档位行（模式感知约束 P1）：三档都渲染——agent 据此定 KB/世界书检索的遵循强度
    mode = a.get("constraint_mode") or "idle"
    L.append(f"CONSTRAINT: {mode} → {CONSTRAINT_HINT[mode]}")
    if not a.get("state"):
        # 无 state（未立项/改稿项目）：无流程盘面可报，档位行之外只指路
        L.append("STATE: 无 state.json（未立项或改稿会话）——flow_* 流程动词不可用，按 sessionBrief/改稿工作法走")
        return L
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


def idle_hint():
    """IDLE 分支的引导（OS-04）：首次运行必须**指路**，不能只说一句「没有待办」——
    这个工具是 agent 的开工地标，返回 0 却无指引等于把人丢在空目录里。"""
    flows = sorted(p.parent.name for p in (ROOT / "flows").glob("*/flow.json"))
    proj_root = ROOT / "projects"
    has_proj = proj_root.is_dir() and any(
        d.is_dir() and not d.name.startswith("_") for d in proj_root.iterdir())
    lines = []
    if not has_proj:
        lines += [
            "IDLE: 还没有项目（首次运行）",
            "  ① 起常驻服务（内核 API + 页面同进程；端口占用会自动顺延）：",
            "       miniflow up",
            "     然后打开 http://127.0.0.1:8421/ —— 顶部项目下拉里的「＋ 新建项目…」",
            "  ② 或在命令行建项目 + 填初始化配置：",
            "       miniflow flow_init --project <新项目id>      # 生成 项目配置.json（也可在页面「流配置」表单里填）",
            "       miniflow flow_run --flow <flowId> --project <新项目id>",
            "  ③ 想先跑通一遍：进页面「流商店」，挑带「装 Demo」标的流一键装官方示例",
            f"     可用 flow：{', '.join(flows) if flows else '(none)'}",
        ]
    else:
        lines += [
            "IDLE: 已有项目但都没有待办（全部完成或无 run）",
            "  看交付：projects/<id>/workflow.html（或 miniflow up 后从页面项目下拉进）",
            "  开新项目：miniflow up →「＋ 新建项目…」，或 miniflow flow_init --project <新id>",
        ]
    return lines


def selfcheck():
    """--selfcheck：约束档位三档自测（合成 fixture，纯 stdlib tempfile，不碰真实 projects/）。
    覆盖 determine_constraint_mode 判定矩阵 + analyze() 端到端（registry/effective.json
    kind 解析、无 state 最小块）+ render_block 文本形状。全过 exit 0，任一失配 exit 1。"""
    import tempfile
    global ROOT
    fails = []

    def check(name, got, want):
        if got != want:
            fails.append(f"{name}: got {got!r} want {want!r}")

    # 纯函数判定矩阵（不依赖 ROOT）
    check("无state+sessionBrief非空", determine_constraint_mode(None, {"sessionBrief": ["文风卡：x.md"]}), "assist")
    check("无state+sessionBrief空数组", determine_constraint_mode(None, {"sessionBrief": []}), "idle")
    check("无state+无cfg", determine_constraint_mode(None, None), "idle")
    st_pending = {"plan": {"order": ["1.1", "1.2"]},
                  "nodes": {"1.1": {"status": "done"}, "1.2": {"status": "pending"}}}
    kinds_produce = {"graph": {"nodes": {"1.1": {"kind": "review"}, "1.2": {"kind": "produce"}}}}
    kinds_review = {"graph": {"nodes": {"1.1": {"kind": "review"}, "1.2": {"kind": "review"}}}}
    check("pending有produce", determine_constraint_mode(st_pending, {}, kinds_produce), "strict")
    check("pending无produce", determine_constraint_mode(st_pending, {}, kinds_review), "assist")
    check("无pending", determine_constraint_mode(
        {"plan": {"order": ["1.1"]}, "nodes": {"1.1": {"status": "done"}}}, {}, kinds_produce), "idle")
    check("kinds不可见回落assist", determine_constraint_mode(st_pending, {}, None), "assist")

    with tempfile.TemporaryDirectory(prefix="whereami-selfcheck-") as td:
        real_root, ROOT = ROOT, Path(td)
        try:
            (ROOT / "flows").mkdir()  # match_flow 需要目录存在（空 = 无直图兜底，走 effective.json）
            # strict：有 state，pending 有 produce（kind 走 registry/effective.json）
            p = ROOT / "projects" / "p-sc-strict"
            (p / "registry").mkdir(parents=True)
            (p / "state.json").write_text(json.dumps(
                {"flowId": "novel", "gate": {"verdict": "none"}, "plan": {"order": ["1.1", "1.2"]},
                 "nodes": {"1.1": {"status": "done"}, "1.2": {"status": "pending"}}}), encoding="utf-8")
            (p / "项目配置.json").write_text(json.dumps({"项目": "p-sc-strict", "灵感": "x"}), encoding="utf-8")
            (p / "registry" / "effective.json").write_text(json.dumps(
                {"flowId": "novel", "nodes": {"1.1": {"kind": "review"}, "1.2": {"kind": "produce"}}, "edges": []}),
                encoding="utf-8")
            a = analyze("p-sc-strict")
            check("analyze strict", (a or {}).get("constraint_mode"), "strict")
            check("render strict 行", f"CONSTRAINT: strict → {CONSTRAINT_HINT['strict']}" in "\n".join(render_block(a or {})), True)

            # assist：有 state，pending 无 produce
            (p / "registry" / "effective.json").write_text(json.dumps(
                {"flowId": "novel", "nodes": {"1.1": {"kind": "review"}, "1.2": {"kind": "review"}}, "edges": []}),
                encoding="utf-8")
            check("analyze 有state assist", (analyze("p-sc-strict") or {}).get("constraint_mode"), "assist")

            # idle：有 state 全 done
            (p / "state.json").write_text(json.dumps(
                {"flowId": "novel", "gate": {"verdict": "none"}, "plan": {"order": ["1.1", "1.2"]},
                 "nodes": {"1.1": {"status": "done"}, "1.2": {"status": "done"}}}), encoding="utf-8")
            check("analyze 有state idle", (analyze("p-sc-strict") or {}).get("constraint_mode"), "idle")

            # assist：无 state，sessionBrief 非空（改稿场景，p-menghe-01 同形）
            p2 = ROOT / "projects" / "p-sc-assist"
            p2.mkdir(parents=True)
            (p2 / "项目配置.json").write_text(json.dumps(
                {"项目": "p-sc-assist", "sessionBrief": ["文风卡：规则/文风-draft.md"]}), encoding="utf-8")
            a2 = analyze("p-sc-assist")
            check("analyze 无state assist", (a2 or {}).get("constraint_mode"), "assist")
            check("无state 最小块", "STATE: 无 state.json" in "\n".join(render_block(a2 or {})), True)

            # idle：无 state 无 sessionBrief
            p3 = ROOT / "projects" / "p-sc-idle"
            p3.mkdir(parents=True)
            check("analyze 无state idle", (analyze("p-sc-idle") or {}).get("constraint_mode"), "idle")

            # 不存在的项目仍回 None（main 层维持 AMBIGUOUS-NA 错误路径）
            check("不存在项目回None", analyze("p-nope"), None)
        finally:
            ROOT = real_root
    if fails:
        for line in fails:
            print(f"SELFCHECK FAIL: {line}")
        return 1
    print("SELFCHECK OK: constraint_mode 三档判定矩阵 + analyze/render 端到端全过")
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--project")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--selfcheck", action="store_true")
    args = ap.parse_args()

    if args.selfcheck:
        sys.exit(selfcheck())

    if args.project:
        a = analyze(args.project)
        if not a:
            print(f"AMBIGUOUS-NA: 项目不存在: {args.project}（目录存在但未立项/改稿中会回档位块，不进此错误路径）")
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
        out = {"kind": kind, "results": results}
        if kind == "IDLE":
            out["hint"] = idle_hint()
        print(json.dumps(out, ensure_ascii=False, indent=2))
        return
    if kind == "AMBIGUOUS":
        print(f"AMBIGUOUS: {len(results)} 个项目有待办节点，无法判定焦点——用 --project 指定：")
        for a in results:
            print(f"  - {a['project']}（剩余 {a['pendingCount']} 节点：{', '.join(a['pendingIds'][:4])}…）")
        sys.exit(3)
    if kind == "IDLE":
        for line in idle_hint():
            print(line)
        return
    print("\n".join(render_block(results[0])))


if __name__ == "__main__":
    main()
