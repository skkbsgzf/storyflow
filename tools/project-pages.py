"""每项目工作台页生成器（R6 · payload@2 五键契约）

注入形状由 contracts/page-payload.schema.json 冻结：顶层 DATA / EFF / OVERLAY / OPTIMIZE / METRICS。
  DATA     project / flow / modules / toolbox / files / runstate / deliverables (+inputs/annos/projects)
  EFF      registry/effective.json（effective@2，内核 expandFlow 单点派生；页面只消费不重算）
  OVERLAY  registry/overlay.json（flow-overlay@1）
  OPTIMIZE registry/optimize.json
  METRICS  registry/metrics-summary.json

派生纪律（R6 §三）：页面/脚本**不重算**节点与边。DATA.modules/toolbox 只读两处——
① registry/effective.json 的 composition（内核算好的展开结果，优先）；
② flow@3 + modules/*/module.json 的**声明**（无 effective@2 时的静态兜底：
   仅当实例 caps ⊆ 骨架覆盖能力且无 insert/vary 才给 spine，否则置空并显式提示）。
存量 flow@2 项目：DATA.modules/toolbox 置空 + 控制台提示（存量未转换，页面等待 flow_effect 刷新）。

文件扫描按新布局：输入/ · 世界书/ · NN-模块名/ · 交付/（registry/receipts 读收据由 serve/导出侧负责）。
旧区文件（根级散件/内部/对外交付/章节正文）不再内嵌——搬迁见 docs/项目目录搬迁清单-*.md（人批后另批执行）。

用法：
  python tools/project-pages.py --root projects/<id>            # 新形态：flowId 从项目绑定解析（铁律 8）
  python tools/project-pages.py <flowId> <projectId>            # 旧形态（serve.py/package.py 在用）
"""
import json, sys, re, glob, time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCAN_ROOT_DIRS = ("输入", "交付")
SCAN_RE_DIRS = re.compile(r"^(世界书|\d{2}-.+)$")


def load_json(p: Path, default):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return default


def bound_flow_id(proj: Path):
    """流程身份以项目盘上绑定为准（铁律 8）：state.json → 项目配置.json。"""
    for name in ("state.json", "项目配置.json"):
        p = proj / name
        if p.exists():
            fid = load_json(p, {}).get("flowId")
            if fid:
                return fid
    return None


def module_registry():
    reg = {}
    for p in sorted(ROOT.glob("modules/*/module.json")):
        d = load_json(p, None)
        if d and d.get("id"):
            reg[d["id"]] = d
    return reg


def skeleton_caps(mod):
    """骨架已覆盖能力 = spine 成员 capability 的并集。"""
    out = []
    ops = mod.get("ops") or {}
    for t in (mod.get("skeleton") or {}).get("spine", []):
        out += (ops.get(t) or {}).get("capability") or []
    return out


def module_view(inst, mod, order, link_default, spine, plugins):
    caps_all = list(mod.get("caps") or [])
    caps_req = list(inst.get("caps") or [])
    caps_enabled = sorted(set(caps_req) | set(skeleton_caps(mod)))
    link = inst.get("link") or link_default or "auto"
    return {
        "id": inst.get("id"), "module": mod["id"], "name": mod.get("name") or mod["id"],
        "link": link, "order": order,
        "dir": f"{order:02d}-{mod.get('name') or mod['id']}",
        "caps": caps_all, "capsEnabled": caps_enabled,
        "spine": spine, "plugins": plugins,
        "io": mod.get("io"),
    }


def toolbox_module(inst, mod, view):
    ops = mod.get("ops") or {}
    spine = set((mod.get("skeleton") or {}).get("spine") or [])
    cap_req = set(inst.get("caps") or [])
    ins_tools = {t for tools in (inst.get("insert") or {}).values() for t in tools}
    groups = []
    for cap in mod.get("caps") or []:
        tools = []
        for tid, op in ops.items():
            if cap not in (op.get("capability") or []):
                continue
            enabled = tid in spine or cap in cap_req or tid in ins_tools \
                or bool(set(op.get("capability") or []) & cap_req)
            tools.append({
                "tool": tid, "title": op.get("title") or tid,
                "slot": op.get("slot") or "end",
                "alsoFits": op.get("also_fits") or [],
                "requires": op.get("requires") or [],
                "enabled": enabled, "defaultEnabled": tid in spine,
            })
        if tools:
            groups.append({"cap": cap, "tools": tools})
    return {
        "module": mod["id"], "name": view["name"], "desc": mod.get("desc") or "",
        "caps": view["caps"], "capsEnabled": view["capsEnabled"],
        "spine": view["spine"], "plugins": view["plugins"], "groups": groups,
    }


def static_module_views(flow3, reg):
    """无 effective@2 时的声明级兜底：只有「caps ⊆ 骨架覆盖 且 无 insert/vary」才给 spine。"""
    views, notes = [], []
    link_default = (flow3.get("defaults") or {}).get("link") \
        or (flow3.get("policy") or {}).get("link_default") or "auto"
    for i, inst in enumerate(flow3.get("modules") or []):
        mod = reg.get(inst.get("module"))
        if not mod:
            notes.append(f"模块「{inst.get('module')}」在 modules/ 无声明，实例 {inst.get('id')} 跳过（显式回显）")
            continue
        skel = (mod.get("skeleton") or {}).get("spine") or []
        caps_req = set(inst.get("caps") or [])
        pure = caps_req <= set(skeleton_caps(mod)) and not inst.get("insert") and not inst.get("vary")
        views.append(module_view(inst, mod, i + 1, link_default,
                                 skel if pure else [], []))
        if not pure:
            notes.append(f"实例 {inst.get('id')}：caps/insert/vary 超出骨架静态可判范围，spine 置空——"
                         f"跑内核 flow_effect 生成 effective@2 后页面即完整")
    return views, notes


def effective_module_views(eff, reg):
    """effective@2 的 composition 是内核算好的展开结果，直接采用（遍历 composition 数组本身）。
    composition 可能是 dict（key=实例id）或 array（每项有 id 键）。"""
    views, notes = [], []
    raw_comp = eff.get("composition") or {}
    policy = eff.get("policy") or {}
    link_default = policy.get("link_default") or "auto"
    if isinstance(raw_comp, dict):
        comp_items = list(raw_comp.values())
    elif isinstance(raw_comp, list):
        comp_items = raw_comp
    else:
        comp_items = []
    for i, c in enumerate(comp_items):
        mid = c.get("id", "")
        dir_name = c.get("dir") or f"{i + 1:02d}-{mid}"
        mod = reg.get(c.get("module", mid)) or {}
        caps = c.get("caps") or []
        caps_enabled = c.get("capsEnabled") or []
        # composition 的 spine/plugins 已经是完整节点 id（<实例id>.<tool>），不再加前缀
        spine = list(c.get("spine") or [])
        plugins = list(c.get("plugins") or [])
        views.append({
            "id": mid, "module": c.get("module", mid), "name": c.get("name") or mod.get("name") or mid,
            "link": c.get("link", link_default), "order": i + 1, "dir": dir_name,
            "caps": caps, "capsEnabled": caps_enabled,
            "spine": spine, "plugins": plugins, "nodes": c.get("nodes") or [],
            "io": mod.get("io"),
        })
    return views, notes


def kits_summary_build():
    """DATA.kits 摘要（模板 kitOpOf 消费）：modules（flow@3 源）与 kits（flow@2 源）合并，
    op 级带 title/knowledge/asserts/minitools——节点页「知识依据/校验/可用工具」行的事实源。"""
    out = {}

    def put(kid, k):
        ops = {}
        for op_id, o in (k.get("ops") or {}).items():
            ops[op_id] = {
                "title": o.get("title") or op_id,
                "knowledge": o.get("knowledge") or [],
                "asserts": o.get("asserts") or [],
                "minitools": o.get("minitools") or [],
            }
        out[kid] = {"domain": k.get("domain") or kid, "title": k.get("name") or k.get("desc") or kid, "ops": ops}

    for p in sorted(ROOT.glob("modules/*/module.json")):
        d = load_json(p, None)
        if d and d.get("id"):
            put(d["id"], d)
    for p in sorted(ROOT.glob("kits/*/kit.json")):
        d = load_json(p, None)
        if d and d.get("id") and d["id"] not in out:
            put(d["id"], d)
    return out


def kb_titles_build():
    """DATA.kbTitles：kb id → 中文标题（knowledge/index.json）。"""
    idx = load_json(ROOT / "knowledge" / "index.json", {}) or {}
    return {e.get("id"): (e.get("title") or e.get("id")) for e in (idx.get("entries") or []) if e.get("id")}


def scan_files(proj: Path):
    files = {}
    for p in sorted(proj.rglob("*")):
        if not p.is_file():
            continue
        rel = p.relative_to(proj).as_posix()
        top = rel.split("/", 1)[0]
        if top in SCAN_ROOT_DIRS or SCAN_RE_DIRS.match(top):
            try:
                files[rel] = p.read_text(encoding="utf-8")
            except Exception:
                pass
    return files


def projects_switcher():
    """项目清单（W-项目管理）：id + 可读名(title=state.title>项目配置>id) + 状态 +
    最近变更(mtime，state.json 落盘时刻) + renderable（effective@2 可渲染，否则旧版页）。
    按最近变更倒序——最新的项目排最上。"""
    from datetime import datetime

    def mtime_pair(p: Path):
        try:
            return int(p.stat().st_mtime), datetime.fromtimestamp(p.stat().st_mtime).strftime("%m-%d %H:%M")
        except OSError:
            return 0, ""

    def eff_renderable(proj: Path):
        eff = load_json(proj / "registry" / "effective.json", None)
        return bool(eff and eff.get("format") == "effective@2")

    out, seen = [], set()
    for sp in sorted(glob.glob(str(ROOT / "projects" / "*" / "state.json"))):
        proj = Path(sp).parent
        pid = proj.name
        st = load_json(sp, {})
        seen.add(pid)
        cfg = load_json(proj / "项目配置.json", {}) or {}
        msort, mtxt = mtime_pair(Path(sp))
        out.append({
            "id": pid, "title": st.get("title") or cfg.get("name") or cfg.get("title") or "",
            "flow": st.get("flowId"), "status": st.get("status", ""),
            "mtime": mtxt, "mtimeSort": msort, "renderable": eff_renderable(proj),
        })
    for extra in sorted(glob.glob(str(ROOT / "projects" / "*"))):
        pdir = Path(extra)
        if not pdir.is_dir() or pdir.name.startswith("_") or pdir.name in seen:
            continue
        cfg = pdir / "项目配置.json"
        if cfg.exists():
            c = load_json(cfg, {})
            out.append({
                "id": pdir.name, "title": c.get("name") or c.get("title") or "",
                "flow": c.get("flowId"), "status": c.get("status", "") or "未开跑",
                "mtime": "", "mtimeSort": 0, "renderable": False,
            })
    out.sort(key=lambda x: x.get("mtimeSort") or 0, reverse=True)
    for item in out:
        item.pop("mtimeSort", None)
    return out


def main():
    argv = sys.argv[1:]
    legacy_pos = [a for a in argv if not a.startswith("--")]
    flow_id_arg = legacy_pos[0] if len(legacy_pos) == 2 else None
    if "--root" in argv:
        root = Path(argv[argv.index("--root") + 1])
        proj = root if root.is_absolute() else ROOT / root
        if not proj.exists():
            sys.exit(f"[ABORT] 项目不存在：{proj}")
        project_id = proj.name
        flow_id = bound_flow_id(proj) or flow_id_arg
        if not flow_id:
            sys.exit(f"[ABORT] 项目 {project_id} 无流程绑定（state.json/项目配置.json 均无 flowId），"
                     f"且未传 <flowId>。流程身份以项目绑定为准（铁律 8）。")
    elif len(legacy_pos) == 2:
        flow_id, project_id = legacy_pos
        proj = ROOT / "projects" / project_id
        if not proj.exists():
            sys.exit(f"[ABORT] 项目不存在：{proj}")
        bound = bound_flow_id(proj)
        if bound and bound != flow_id:
            sys.exit(f"[ABORT] 流程身份不一致：项目 {project_id} 绑定 flow='{bound}'，调用传入 '{flow_id}'。\n"
                     f"正确调用：python tools/project-pages.py --root projects/{project_id}")
        flow_id = bound or flow_id
    else:
        print(__doc__)
        sys.exit(1)

    flow_path = ROOT / "flows" / flow_id / "flow.json"
    if not flow_path.exists():
        sys.exit(f"[ABORT] flow 不存在：{flow_path}")
    flow = load_json(flow_path, {})
    reg = module_registry()
    notes = []

    # EFF：只认内核落盘的 effective@2；legacy effective@1 不渲染（盘上仍在，等 flow_effect 刷新）
    eff_raw = load_json(proj / "registry" / "effective.json", None)
    if eff_raw and eff_raw.get("format") == "effective@2":
        eff = eff_raw
        module_views, n = effective_module_views(eff, reg)
        notes += n
    else:
        eff = {"format": "effective@2", "policy": {}, "links": [], "composition": {},
               "nodes": {}, "edges": [], "artifacts": []}
        if eff_raw:
            notes.append("registry/effective.json 为旧 effective@1：页面按空编排渲染，"
                         "待 flow@3 转换 + 内核 flow_effect 刷新（盘上旧文件未动）")
    if flow.get("format") == "flow@3":
        if not module_views:
            module_views, n = static_module_views(flow, reg)
            notes += n
        toolbox = {"format": "toolbox@1", "modules": {}}
        for v in module_views:
            toolbox["modules"][v["id"]] = toolbox_module(
                next(m for m in flow["modules"] if m["id"] == v["id"]), reg[v["module"]], v)
    else:
        module_views = []
        toolbox = {"format": "toolbox@1", "modules": {}}
        notes.append(f"flow『{flow_id}』为 {flow.get('format') or 'legacy'}：DATA.modules/toolbox 置空（存量未转换，WO-08 转换后消失）")

    runstate = load_json(proj / "state.json", None) or load_json(proj / "run-state.json", None) \
        or {"nodes": {}, "notes": [], "presets": {}, "comments": {}}
    annos = load_json(proj / "registry" / "批注与意见.json", None) \
        or load_json(proj / "内部" / "批注与意见.json", None) or {}
    files = scan_files(proj)
    # 交付件：旧版目录（交付/ 对外交付/ 章节正文/）+ R6 模块交付目录（flow 最后一个模块的
    # <NN>-名/ 与名字带「交付」的模块目录）。二进制（docx/pdf）不在 files，由前端走链接打开。
    r6_dirs = set()
    for v in module_views:
        d = v.get("dir")
        if not d:
            continue
        if "交付" in (v.get("name") or ""):
            r6_dirs.add(d)
    if module_views:
        last = module_views[-1]
        if last.get("dir"):
            r6_dirs.add(last["dir"])
    cand = []
    for sub in ("交付", "对外交付", "章节正文"):
        p = proj / sub
        if p.is_dir():
            cand.extend(q for q in p.rglob("*") if q.is_file())
    for d in sorted(r6_dirs):
        p = proj / d
        if p.is_dir():
            cand.extend(q for q in p.rglob("*") if q.is_file())
    deliverables = sorted({q.relative_to(proj).as_posix().replace("\\", "/") for q in cand})

    # W-02 产物可见性分级：模块收敛交付件 = io.output.file（每模块一份成熟交付）；
    # 模块目录内其余产物 = 过程件（前端默认收进「模块内幕」折叠区）。
    module_files = []
    for v in module_views:
        d = v.get("dir")
        if not d:
            continue
        pdir = proj / d
        allf = sorted(q.relative_to(proj).as_posix().replace("\\", "/")
                      for q in pdir.rglob("*") if q.is_file()) if pdir.is_dir() else []
        io_out = ((v.get("io") or {}).get("output") or {}).get("file")
        dlv = f"{d}/{io_out}" if io_out else None
        module_files.append({
            "id": v["id"], "name": v.get("name") or v["id"], "dir": d,
            "deliverable": dlv if (dlv and dlv in allf) else None,
            "audience": ((v.get("io") or {}).get("output") or {}).get("audience") or "",
            "process": [f for f in allf if f != dlv],
        })

    # W-04 模块结果报告读模型（内核 persistModuleReports 落盘，页面只读）
    module_reports = {}
    for q in sorted((proj / "registry").glob("module-report-*.json")):
        try:
            mr = load_json(q, None)
        except Exception:
            mr = None
        if isinstance(mr, dict) and mr.get("moduleId"):
            module_reports[mr["moduleId"]] = mr

    payload = {
        "DATA": {
            "project": project_id,
            "flow": {"id": flow.get("id") or flow_id, "title": flow.get("title") or flow_id,
                     "version": flow.get("version") or "", "status": flow.get("status") or "draft"},
            "modules": module_views,
            "toolbox": toolbox,
            "files": files,
            "runstate": runstate,
            "deliverables": deliverables,
            "moduleFiles": module_files,
            "moduleReports": module_reports,
            "kits": kits_summary_build(),
            "kbTitles": kb_titles_build(),
            "inputs": runstate.get("inputs") or {},
            "annos": annos.get("annos") or {},
            "projects": projects_switcher(),
        },
        "EFF": eff,
        "OVERLAY": load_json(proj / "registry" / "overlay.json", None)
        or {"format": "flow-overlay@1", "patches": []},
        "OPTIMIZE": load_json(proj / "registry" / "optimize.json", None) or {"proposals": [], "pending": []},
        "METRICS": load_json(proj / "registry" / "metrics-summary.json", None)
        or {"byNode": {}, "byTool": {}, "knowledge": [], "links": {}, "window": {}},
    }
    text = json.dumps(payload, ensure_ascii=False).replace("</", "<\\/")  # 防 </script> 提前闭合
    tpl = (ROOT / "tools" / "workflow-page-template.html").read_text(encoding="utf-8")
    page = tpl.replace("__PAYLOAD__", text).replace("__TITLE__", f"{payload['DATA']['flow']['title']} · {project_id}")
    out = proj / "workflow.html"
    out.write_text(page, encoding="utf-8")
    print(f"written: {out} ({out.stat().st_size // 1024} KB, {len(files)} artifacts embedded, "
          f"{len(module_views)} modules)")
    for n in notes:
        print(f"NOTE: {n}")


if __name__ == "__main__":
    main()
