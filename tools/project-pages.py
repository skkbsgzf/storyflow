"""每项目工作流页生成器（复用 v3 Canvas 语义：拖拽画布 / 检查器 / 节点快照查看·修改·重跑）
零中心化依赖：单文件 HTML，数据内嵌；保存走 File System Access API（Chromium），回退下载。
用法：python3 tools/project-pages.py <flowId> <projectId>
"""
import json, sys, re, html, glob, time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

def md2js(md: str) -> str:
    """md -> html (python side, mirrors delivery renderer)"""
    out, i, lines = [], 0, md.split("\n")
    def esc(s): return html.escape(s)
    def inline(s):
        s = esc(s)
        s = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", s)
        s = re.sub(r"`([^`]+)`", r"<code>\1</code>", s)
        return s
    while i < len(lines):
        ln = lines[i]
        if not ln.strip(): i += 1; continue
        h = re.match(r"^(#{1,4}) (.+)$", ln)
        if h:
            l = min(len(h.group(1)) + 1, 5); out.append(f"<h{l}>{inline(h.group(2))}</h{l}>"); i += 1; continue
        if re.match(r"^-{3,}$", ln.strip()): out.append("<hr>"); i += 1; continue
        if ln.startswith("|"):
            rows = []
            while i < len(lines) and lines[i].startswith("|"):
                cells = [c.strip() for c in lines[i].strip("|").split("|")]
                if not all(re.match(r":?-{2,}:?$", c) for c in cells): rows.append(cells)
                i += 1
            t = "<table><tr>" + "".join(f"<th>{inline(c)}</th>" for c in rows[0]) + "</tr>"
            for r in rows[1:]: t += "<tr>" + "".join(f"<td>{inline(c)}</td>" for c in r) + "</tr>"
            out.append(t + "</table>"); continue
        if re.match(r"^- ", ln):
            buf = []
            while i < len(lines) and re.match(r"^- ", lines[i]): buf.append(lines[i][2:]); i += 1
            out.append("<ul>" + "".join(f"<li>{inline(b)}</li>" for b in buf) + "</ul>"); continue
        if ln.startswith(">"):
            buf = []
            while i < len(lines) and lines[i].startswith(">"): buf.append(lines[i].lstrip("> ")); i += 1
            out.append("<blockquote>" + "<br>".join(inline(b) for b in buf if b) + "</blockquote>"); continue
        buf = []
        while i < len(lines) and lines[i].strip() and not re.match(r"^(#{1,4} |\||- |> |-{3,}$)", lines[i]):
            buf.append(lines[i]); i += 1
        out.append("<p>" + "<br>".join(inline(b) for b in buf) + "</p>"); continue
    return "\n".join(out)

def main(flow_id, project_id):
    proj = ROOT / "projects" / project_id
    if not proj.exists():
        sys.exit(f"[ABORT] 项目不存在：{proj}")
    # 流程身份约束（p-fq-001 串图事故）：flowId 以项目 state 绑定为准，传参不一致即中止。
    # 项目绑定哪个流程是事实，不是调用方可以假设的参数。
    bound = None
    for sp in (proj / "state.json", proj / "run-state.json"):
        if sp.exists():
            try:
                bound = json.load(open(sp, encoding="utf-8")).get("flowId")
            except Exception:
                bound = None
            if bound:
                break
    if bound and bound != flow_id:
        sys.exit(f"[ABORT] 流程身份不一致：项目 {project_id} 绑定 flow='{bound}'，调用传入 '{flow_id}'。\n"
                 f"正确调用：python tools/project-pages.py {bound} {project_id}")
    flow_id = bound or flow_id
    flow_path = ROOT / "flows" / flow_id / "flow.json"
    if not flow_path.exists():
        sys.exit(f"[ABORT] flow 不存在：{flow_path}")
    bootstrap = json.load(open(flow_path, encoding="utf-8"))
    flow = bootstrap
    # R5：生效编排（bootstrap ⊕ overlay ⊕ kit 边界派生）由**内核**算好落 registry/effective.json。
    # 页面主图必须用它——边界验收节点只存在于生效编排里，bootstrap flow.json 看不到。
    # 这里刻意不在 python 里复刻 applyOverlay/injectKitBoundaries：派生逻辑只允许有一处实现。
    effective = None
    eff_path = proj / "registry" / "effective.json"
    if eff_path.exists():
        try:
            effective = json.loads(eff_path.read_text(encoding="utf-8"))
            if effective.get("format") == "effective@1" and (effective.get("flow") or {}).get("graph"):
                flow = effective["flow"]
        except Exception:
            effective = None
    # 项目级 overlay（位置改写 + tool 配置改写），页面据此显示「本节点被改写」及理由
    overlay = None
    ov_path = proj / "registry" / "overlay.json"
    if ov_path.exists():
        try:
            overlay = json.loads(ov_path.read_text(encoding="utf-8"))
        except Exception:
            overlay = None
    # 优化提案（由 flow_optimize 产出），页面显示「建议改哪里、依据哪条指标、是否待批」
    optimize = None
    opt_path = proj / "registry" / "optimize.json"
    if opt_path.exists():
        try:
            optimize = json.loads(opt_path.read_text(encoding="utf-8"))
        except Exception:
            optimize = None
    # 指标汇总（tool 效率 / 上下文命中率），由内核落盘——同一份口径喂页面与优化 agent
    metrics = None
    ms_path = proj / "registry" / "metrics-summary.json"
    if ms_path.exists():
        try:
            metrics = json.loads(ms_path.read_text(encoding="utf-8"))
        except Exception:
            metrics = None
    # collect artifacts: flow outputs + known extras
    extra = (["项目约束.md", "选题素材.md", "梗卡.md", "故事框架案.md", "硬断言报告.json", "台词打磨对照表.md"]
             + sorted([x.name for x in proj.glob("多视角意见书-*.md")] + [x.name for x in proj.glob("红方意见书*.md")] + [x.name for x in proj.glob("内部/*.md")])
             + sorted("对外交付/" + x.name for x in proj.glob("对外交付/*.md"))
             + ["run-asserts.py", "run-delivery.py"])
    delivery_page = next((f.name for f in proj.glob("*.html") if f.name != "workflow.html"), None)
    files = {}
    _nodes = flow.get("graph", {}).get("nodes", {})
    _out_paths = [
        o.get("path") or o.get("file") or (_nodes.get(o.get("node")) or {}).get("output")
        for o in flow.get("outputs", [])
    ]
    for f in sorted(set([x for x in _out_paths if x] + extra)):
        p = proj / f
        if p.exists():
            try: files[f] = p.read_text(encoding="utf-8")
            except Exception: pass
    # 全项目 md 收纳（过程文件对用户可见）：排除快照/注册表/生成页
    for p in sorted(proj.rglob("*.md")):
        rel = p.relative_to(proj).as_posix()
        if rel.startswith(("registry/", "snapshots/")) or rel == "workflow.html":
            continue
        if rel not in files:
            try: files[rel] = p.read_text(encoding="utf-8")
            except Exception: pass
    rs_path = proj / "run-state.json"
    state_path = proj / "state.json"  # 内核布局（M1+）：state.json 为准，页面不回写
    legacy = not state_path.exists()
    if state_path.exists():
        runstate = json.load(open(state_path, encoding="utf-8"))
    elif rs_path.exists():
        runstate = json.load(open(rs_path, encoding="utf-8"))
    else:
        runstate = {"nodes": {}, "notes": [], "presets": {}, "comments": {}}
    for n in flow["graph"]["nodes"]:
        runstate["nodes"].setdefault(n, {"status": "none", "round": 0})
    runstate.setdefault("presets", {})
    runstate.setdefault("comments", {})
    runstate.setdefault("inputs", {})
    # 快照内嵌（含内容）：旧布局读 snapshots/index.json；新布局从 registry/artifacts.json 重建
    snapshots = {}
    snap_idx_path = proj / "snapshots" / "index.json"
    reg_path = proj / "registry" / "artifacts.json"
    if snap_idx_path.exists():
        snap_idx = json.load(open(snap_idx_path, encoding="utf-8"))
        for node, entries in snap_idx.get("snapshots", {}).items():
            lst = []
            for e in entries:
                content = {}
                for name, meta in e.get("files", {}).items():
                    sp = proj / "snapshots" / node / f"r{e['round']}" / name
                    if sp.exists(): content[name] = sp.read_text(encoding="utf-8")
                lst.append({"round": e["round"], "ts": e["ts"], "note": e.get("note",""), "content": content})
            snapshots[node] = lst
    elif reg_path.exists():
        reg = json.load(open(reg_path, encoding="utf-8")).get("artifacts", [])
        groups = {}
        for a in reg:
            ap = proj / a.get("path", "")
            if not ap.exists(): continue
            try: text = ap.read_text(encoding="utf-8")
            except Exception: continue
            g = groups.setdefault((a.get("node",""), a.get("round",1)), {"content": {}, "ts": "", "producers": set()})
            g["content"][a["path"]] = text
            g["ts"] = max(g["ts"], a.get("ts",""))
            g["producers"].add(a.get("producer",""))
        for (node, rnd), g in groups.items():
            snapshots.setdefault(node, []).append({
                "round": rnd, "ts": g["ts"][:19].replace("T"," "),
                "note": "registry · " + ",".join(sorted(g["producers"])), "content": g["content"]})
        for lst in snapshots.values(): lst.sort(key=lambda v: v["round"])
    # 交付件声明集（唯一事实源 = 顶层 flow.outputs）：路径 = outputs[].path，缺省回落节点 output。
    # 此处原有一段「NN 前缀 → 硬编码节点 id」把磁盘文件写回 node.file 的补丁，已删：它既是第二个
    # 字段名（规范 R4 §5.1 已废），又曾把 polish 的 03-剧本试稿.md 误记到 miniguided 名下。
    declared_paths = set()
    for o in (flow.get("outputs") or []):
        p = o.get("path") or ((flow.get("graph", {}).get("nodes", {}).get(o.get("node")) or {}).get("output"))
        if p:
            declared_paths.add(str(p).replace("\\", "/"))
    # 顶栏项目切换：扫描全部项目绑定（生成时快照）
    projects_list = []
    seen_pids = set()
    for sp in sorted(glob.glob(str(ROOT / "projects" / "*" / "state.json"))):
        try:
            st = json.load(open(sp, encoding="utf-8"))
            pid2 = Path(sp).parent.name
            projects_list.append({"id": pid2, "flow": st.get("flowId"), "status": st.get("status", "")})
            seen_pids.add(pid2)
        except Exception:
            pass
    # 未开跑项目（如官方 Demo 实例）：无 state.json 但有 配置/旧状态，同样进切换器（跳过 _ 开头目录）
    for extra in sorted(glob.glob(str(ROOT / "projects" / "*"))):
        pdir = Path(extra)
        if not pdir.is_dir() or pdir.name.startswith("_") or pdir.name in seen_pids:
            continue
        if (pdir / "项目配置.json").exists() or (pdir / "run-state.json").exists():
            st = {}
            try:
                st = json.load(open(pdir / "run-state.json", encoding="utf-8"))
            except Exception:
                pass
            projects_list.append({"id": pdir.name, "flow": st.get("flowId"), "status": st.get("status", "") or "未开跑"})
    # 交付件清单（含非 md 格式：docx/html；章节正文另由 iterate 槽位呈现）
    deliverables = sorted(
        f.relative_to(proj).as_posix()
        for pat in ("对外交付/*.*", "章节正文/*.md")
        for f in proj.glob(pat)
    )
    # R4 核对项：磁盘上有、flow.outputs 里查不到的对外交付件 → 页面显式告警（不静默、不猜归属）
    unclaimed = [d for d in deliverables if d.startswith("对外交付/") and d not in declared_paths]

    # 工作流管理数据源：流商店清单（Obsidian 式卡片需富元数据）/ 技能清单 / 项目初始化配置
    # 各项目运行情况（flowId -> [{project, version}]），state.json 为准，旧布局 run-state.json 兜底
    usage = {}
    seen_proj = set()
    for sp in sorted((ROOT / "projects").glob("*/state.json")):
        try:
            sd = json.loads(sp.read_text(encoding="utf-8"))
        except Exception:
            continue
        fid, fv = sd.get("flowId"), sd.get("flowVersion") or ""
        if fid:
            usage.setdefault(fid, []).append({"project": sp.parent.name, "version": fv})
            seen_proj.add(sp.parent.name)
    for sp in sorted((ROOT / "projects").glob("*/run-state.json")):
        if sp.parent.name in seen_proj:
            continue
        try:
            sd = json.loads(sp.read_text(encoding="utf-8"))
        except Exception:
            continue
        fid, fv = sd.get("flowId"), sd.get("flowVersion") or ""
        if fid:
            usage.setdefault(fid, []).append({"project": sp.parent.name, "version": fv})
    cat_map = (("novel", "网文"), ("episode", "剧本"), ("outline", "剧本"), ("script", "剧本"),
               ("topic", "短剧"), ("short", "短剧"), ("book", "拆书"), ("kb", "拆书"))
    flows_index, skills_index = [], []
    for fd in sorted((ROOT / "flows").iterdir()):
        fj = fd / "flow.json"
        if not fj.exists():
            continue
        try:
            d = json.loads(fj.read_text(encoding="utf-8"))
            title = (d.get("title") or d.get("id") or fd.name).split("（")[0].split(" v")[0]
            g = d.get("graph") or {}
            nodes = g.get("nodes") or {}
            kinds = [v.get("kind") for v in nodes.values()]
            skills = sorted({v["skill"].rsplit("/", 1)[-1] for v in nodes.values()
                             if isinstance(v.get("skill"), str) and v.get("skill")})
            stages = [{"id": s.get("id"), "name": s.get("name", "")}
                      for s in (d.get("stages") or []) if isinstance(s, dict)]
            if not stages:  # 无显式阶段表时按节点 stage 字段归并
                stages = [{"id": s, "name": ""}
                          for s in sorted({v.get("stage") for v in nodes.values() if v.get("stage")})]
            fid = d.get("id", fd.name)
            cat = d.get("category") or next((c for p, c in cat_map if p in fid), "其他")
            ver = d.get("version", "")
            flows_index.append({
                "id": fid, "title": title, "version": ver,
                "official": "-draft" not in ver,
                "desc": (d.get("desc") or "").strip(), "category": cat,
                "stages": stages, "nNodes": len(nodes),
                "nAgents": sum(1 for k in kinds if k == "agent"),
                "nGates": sum(1 for k in kinds if k == "gate"),
                "skills": skills, "engine": (d.get("engine") or {}).get("type", ""),
                "updated": time.strftime("%Y-%m-%d", time.localtime(fj.stat().st_mtime)),
                "usage": usage.get(fid, []),
                "hasDemo": (ROOT / "demos" / fid / "项目配置.json").exists(),
            })
        except Exception:
            pass
    for sf in sorted((ROOT / "skills").glob("*.md")):
        head = sf.read_text(encoding="utf-8")[:400]
        m = re.search(r"^name:\s*(.+)$", head, re.M)
        nm = m.group(1).strip() if m else sf.stem
        nm = nm.split("（")[0] if nm.startswith(sf.stem + "（") else nm
        skills_index.append({"id": sf.stem, "name": nm})
    pc_path = proj / "项目配置.json"
    project_config = None
    if pc_path.exists():
        try:
            project_config = json.loads(pc_path.read_text(encoding="utf-8"))
        except Exception:
            project_config = None
    # 用户批注/意见回放（serve.py POST 落盘的 内部/批注与意见.json）
    anno_file = proj / "内部" / "批注与意见.json"
    payload_annos = {}
    if anno_file.exists():
        try:
            ud = json.loads(anno_file.read_text(encoding="utf-8"))
            payload_annos = ud.get("annos") or {}
            for k, v in (ud.get("comments") or {}).items():
                runstate.setdefault("comments", {}).setdefault(k, [])
                for c in v:
                    if c not in runstate["comments"][k]:
                        runstate["comments"][k].append(c)
        except Exception:
            pass
    # kit 注册表（依据页数据源）：节点知识依据来自 kits/<kit>/kit.json#ops.<op>.knowledge，
    # 单一事实源；页面不再读已废弃的 node.kb（规范 R4 §5.1/§5.3）
    kits_index = {}
    for kp in sorted((ROOT / "kits").glob("*/kit.json")):
        try:
            kd = json.loads(kp.read_text(encoding="utf-8"))
        except Exception:
            continue
        ops = {}
        for op_id, op in (kd.get("ops") or {}).items():
            ops[op_id] = {
                "title": op.get("title") or "",
                "skill": op.get("skill") or "",
                "knowledge": op.get("knowledge") or [],
                "asserts": op.get("asserts") or [],
                "minitools": op.get("minitools") or [],
                # R5：tool 的内容配置项声明（旋钮表）。节点面板据此渲染「可调项」，
                # 未在这一层声明的键由内核在合成时显式回显（不静默丢弃）。
                "config": op.get("config") or {},
            }
        kits_index[kd.get("id") or kp.parent.name] = {"domain": kd.get("domain") or "", "title": kd.get("title") or "", "ops": ops}
    # 节点字段白名单（规范 R4 §5.3）：直接取自 contracts/flow.schema.json，未登记字段由页面显式标「未规范化」
    try:
        _sch = json.loads((ROOT / "contracts" / "flow.schema.json").read_text(encoding="utf-8"))
        _nd = _sch["$defs"]["node"]
        node_fields = set()
        for _part in [_nd.get("$ref") or {}, *_nd.get("allOf", [])]:
            if isinstance(_part, dict) and _part.get("$ref", "").endswith("nodeCommon"):
                node_fields |= set(_sch["$defs"]["nodeCommon"].get("properties", {}).keys())
            elif isinstance(_part, dict):
                node_fields |= set((_part.get("properties") or {}).keys())
        node_fields = sorted(node_fields)
    except Exception:
        node_fields = []
    # 知识条目索引（依据页显示中文名而非裸 id）
    kb_titles = {}
    try:
        for e in json.loads((ROOT / "knowledge" / "index.json").read_text(encoding="utf-8")).get("entries", []):
            kb_titles[e["id"]] = e.get("title") or e["id"]
    except Exception:
        pass
    payload = json.dumps({"flow": flow, "files": files, "runstate": runstate, "project": project_id,
                          "flowsIndex": flows_index, "skillsIndex": skills_index, "projectConfig": project_config,
                          "deliveryPage": delivery_page, "snapshots": snapshots,
                          "kits": kits_index, "kbTitles": kb_titles, "unclaimed": unclaimed,
                          "nodeFields": node_fields,
                          # R5：生成式编排的四个数据面（全部由内核落盘，页面只读不改写）
                          "effective": effective, "overlay": overlay,
                          "optimize": optimize, "metrics": metrics,
                          "bootstrapFlowId": (bootstrap.get("id") or flow_id),
                          "projects": projects_list, "deliverables": deliverables, "annos": payload_annos}, ensure_ascii=False)
    payload = payload.replace("</", "<\\/")  # 防 </script> 提前闭合（JSON 中 \/ 合法等价）
    if legacy:  # 旧布局：页面与 run-state.json 双向同步；新布局 state.json 由内核独占，不回写
        (proj / "run-state.json").write_text(json.dumps(runstate, ensure_ascii=False, indent=2), encoding="utf-8")
    tpl = (ROOT / "tools" / "workflow-page-template.html").read_text(encoding="utf-8")
    page = tpl.replace("__PAYLOAD__", payload).replace("__TITLE__", f"{flow.get('title', flow_id)} · {project_id}")
    out = proj / "workflow.html"
    out.write_text(page, encoding="utf-8")
    print(f"written: {out} ({out.stat().st_size//1024} KB, {len(files)} artifacts embedded)")

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
