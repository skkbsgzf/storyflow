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
  python tools/project-pages.py --index-only                    # 只重生成入口页 index.html（serve.py 调用）
"""
import json, sys, re, glob, time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCAN_ROOT_DIRS = ("输入", "交付")
SCAN_RE_DIRS = re.compile(r"^(世界书|\d{2}-.+)$")


def load_json(p: Path, default):
    # Path(p) 强转：调用方可能传 glob 出来的 str——此前 str.read_text 静默 AttributeError
    # 吞成 default，项目切换器的 title/flow/status 一直全空（潜伏 bug，2026-09-22 顺带修）
    try:
        return json.loads(Path(p).read_text(encoding="utf-8"))
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
    """DATA.kits 摘要（模板 kitOpOf 消费）：事实源 = modules/（批D 起 kit@1 已清场），
    op 级带 title/knowledge/minitools——节点页「知识依据/可用工具」行的事实源。
    v5.0：op.asserts 出账（声明式断言协议退役）；「校验」面改由 io.acceptance（scans/rules）
    与扫描器收据（内部/质量扫描-*.json）承担。"""
    out = {}

    def put(kid, k):
        ops = {}
        for op_id, o in (k.get("ops") or {}).items():
            ops[op_id] = {
                "title": o.get("title") or op_id,
                # 中文用途（产物管理·文件柜卡片用途行的第一事实源）：op 契约里的 desc 是现成中文
                "desc": o.get("desc") or "",
                "knowledge": o.get("knowledge") or [],
                "minitools": o.get("minitools") or [],
            }
        out[kid] = {"domain": k.get("domain") or kid, "title": k.get("name") or k.get("desc") or kid, "ops": ops}

    for p in sorted(ROOT.glob("modules/*/module.json")):
        d = load_json(p, None)
        if d and d.get("id"):
            put(d["id"], d)
    return out


def kb_titles_build():
    """DATA.kbTitles：kb id → 中文标题（knowledge/index.json）。"""
    idx = load_json(ROOT / "knowledge" / "index.json", {}) or {}
    return {e.get("id"): (e.get("title") or e.get("id")) for e in (idx.get("entries") or []) if e.get("id")}


def machine_scans_build(proj: Path):
    """DATA.machineScans：机械审核证据切片（SemIf/扫描器落 内部/*扫描-*.json 的收据件）。
    生成器单点读盘搬运，页面只渲染（R4 §5.3：字段唯一，前端零派生）；每证据文件截前 40 条。"""
    out = []
    ev_dir = proj / "内部"
    for p in sorted(ev_dir.glob("semif扫描-*.json")) + sorted(ev_dir.glob("质量扫描-*.json")):
        d = load_json(p, None)
        if not isinstance(d, dict):
            continue
        d.pop("findings_full", None)
        if isinstance(d.get("findings"), list):
            for f in d["findings"]:
                # 历史证据件唯一归一点（R4/v5.0 口径）：semif-scan@1 只有 p_leak，
                # @2 起字段更名 p_flag（多条款通用）——面板只读 p_flag，不许双名兜底。
                if "p_flag" not in f and "p_leak" in f:
                    f["p_flag"] = f["p_leak"]
            d["findings"] = d["findings"][:40]
        d["evidencePath"] = f"内部/{p.name}"
        out.append(d)
    out.sort(key=lambda x: str(x.get("at") or ""))
    return out[-8:]  # 只带最近 8 份，页面体积闸


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


MTIME_EXTRA_ROOT_DIRS = ("对外交付", "章节正文")


def scan_mtimes(proj: Path):
    """文件修改时间面（产物管理·文件柜卡片「备注修改时间」）：
    与 scan_files 同根，另加交付二进制根（docx/pdf 也要有时间，故不能复用文本过滤）。
    只 stat 不读正文；格式与 projects_switcher 的「最近变更」一致（MM-DD HH:MM）。"""
    from datetime import datetime

    out = {}
    for p in sorted(proj.rglob("*")):
        if not p.is_file():
            continue
        rel = p.relative_to(proj).as_posix()
        top = rel.split("/", 1)[0]
        if top in SCAN_ROOT_DIRS or top in MTIME_EXTRA_ROOT_DIRS or SCAN_RE_DIRS.match(top):
            try:
                out[rel] = datetime.fromtimestamp(p.stat().st_mtime).strftime("%m-%d %H:%M")
            except OSError:
                pass
    return out


def load_snapshots_view(proj: Path, per_file_cap: int = 256_000, total_cap: int = 1_500_000) -> dict:
    """快照多轮视图（与内核 readSnapshots 同构）：{node: [{round, ts, note, files, content}]}。
    静态页此前不嵌快照 → 版本/轮次/diff 无从可见（09-22 诊断断点②）。
    只读 index.json + 不可变副本：文本限载（单文件 256KB / 总量 1.5MB，超限留元数据不载内容），
    二进制副本（docx 等）不嵌——页面按 md 渲染，二进制走交付页链接。"""
    idx = load_json(proj / "snapshots" / "index.json", None)
    if not isinstance(idx, dict):
        return {}
    out: dict = {}
    budget = total_cap
    for nid, snaps in (idx.get("snapshots") or {}).items():
        rows = []
        for s in snaps or []:
            if not isinstance(s, dict):
                continue
            meta_files = s.get("files") or {}
            content = {}
            for name, fm in meta_files.items():
                if not isinstance(fm, dict) or not fm.get("path") or fm.get("binary"):
                    continue
                fp = proj / str(fm["path"])
                try:
                    if not fp.exists() or fp.stat().st_size > per_file_cap or budget <= 0:
                        continue
                    text = fp.read_text(encoding="utf-8")
                except Exception:
                    continue
                content[name] = text
                budget -= len(text)
            rows.append({"round": s.get("round"), "ts": s.get("ts", ""), "note": s.get("note", ""),
                         "files": meta_files, "content": content})
        if rows:
            out[nid] = rows
    return out


def config_template(project_id: str) -> dict:
    """出厂模板（与内核 viewConfig 的 template 同口径，缺一不可——面板「载入官方默认」靠它）。"""
    return {"项目": project_id, "题材": "", "需求": "", "灵感": "", "严肃性": "标准",
            "风格": "爽", "AB测试": False, "市场预估": "", "presets": {}}


def load_config_view(proj: Path, project_id: str):
    """项目配置的页面视图。与内核 viewConfig 同口径：无文件→None；非法→原文 + __invalid（前端标红）。

    为什么必须注入：模板原先读 DATA.projectConfig，而生成器**从未注入该键**
    ⇒ 「项目配置」编辑器恒显占位（OS-04 审计实测项）。手写 JSON 因此成了唯一入口。
    """
    tpl = config_template(project_id)
    f = proj / "项目配置.json"
    if not f.exists():
        return None, tpl, False
    try:
        raw = json.loads(f.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            raise ValueError("顶层不是对象")
    except Exception as e:  # 非法配置不静默：原样带回让面板标红
        return {"__invalid": True, "message": str(e)}, tpl, True
    return raw, tpl, True


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


INDEX_TEMPLATE = """<!DOCTYPE html>
<html lang="zh">
<head><meta charset="utf-8"><title>storyflow · 项目工作台</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Noto Serif SC',SimSun,serif;background:#f5f1e8;color:#2c2824;padding:40px 32px}
h1{font-size:22px;letter-spacing:3px;margin-bottom:6px;color:#8a3b2e}
.sub{font-size:12px;color:#8a8375;margin-bottom:28px;letter-spacing:1px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px}
.card{display:block;background:#fbf7ee;border:1px solid #d8d0c0;border-radius:4px;padding:16px 18px;text-decoration:none;color:inherit;transition:border-color .15s}
a.card:hover{border-color:#a5433a}
.card-off{opacity:.72}
.card-top{display:flex;align-items:center;gap:8px;margin-bottom:6px}
.badge{font-size:14px}
.pid{font-weight:700;font-size:14px;color:#5a3a28;flex:1}
.date{font-size:11px;color:#8a8375;white-space:nowrap;font-family:monospace}
.flow{font-size:12px;color:#6b6255;margin-bottom:4px}
.meta{font-size:11px;color:#8a8375}
</style></head>
<body>
<h1>storyflow · 项目工作台</h1>
<p class="sub">__SUB__ · <a href="projects.html" style="color:#8a3b2e">项目中心（切换 / 新建 / 归档）</a></p>
<div class="grid">__CARDS__</div>
</body></html>
"""


def regen_index():
    """入口页 index.html 重生成——数据与项目切换器同源（projects_switcher，单一实现）。
    此前入口页无任何生成器（一次性快照），归档/立项后卡片必陈旧（2026-09-22 诊断根因②）。
    产物数 = registry/artifacts.json 条目数（缺席按 0，不另行扫盘）。"""
    from datetime import datetime

    def art_count(pid: str) -> int:
        arts = load_json(ROOT / "projects" / pid / "registry" / "artifacts.json", None)
        if isinstance(arts, list):
            return len(arts)
        if isinstance(arts, dict):
            items = arts.get("artifacts")
            return len(items) if isinstance(items, list) else len(arts)
        return 0

    cards = []
    for it in projects_switcher():
        st = it.get("status") or ""
        badge = ("✅" if st == "completed"
                 else "⏸" if st in ("suspended", "awaiting_input", "gate")
                 else "▶" if st == "running" else "◻")
        top = (f'<span class="badge">{badge}</span><span class="pid">{it["id"]}</span>'
               f'<span class="date">{it.get("mtime") or ""}</span>')
        body = (f'<div class="flow">{it.get("flow") or "无绑定"}</div>'
                f'<div class="meta">{st or "未开跑"} · 产物 {art_count(it["id"])} 件</div>')
        if it.get("renderable"):
            cards.append(f'<a class="card" href="projects/{it["id"]}/workflow.html">'
                         f'<div class="card-top">{top}</div>{body}</a>')
        else:
            cards.append(f'<div class="card card-off"><div class="card-top">{top}</div>{body}'
                         f'<div class="meta">未渲染（无 effective@2；跑 flow_run 后出页）</div></div>')
    ts = datetime.now().strftime("%m-%d %H:%M")
    html = (INDEX_TEMPLATE
            .replace("__SUB__", f"{len(cards)} 个项目 · 点卡片进入工作台 · 生成于 {ts}")
            .replace("__CARDS__", "".join(cards)))
    (ROOT / "index.html").write_text(html, encoding="utf-8")
    return len(cards)


sys.path.insert(0, str(Path(__file__).resolve().parent))
from worldbook_index import build_index as wb_build_index  # noqa: E402
from worldbook_history import build_history as wb_build_history  # noqa: E402


def build_wbdata(proj: Path, book_title: str) -> dict:
    """世界书数据（归纳层 + 查看层共用）：worldbook_index 归纳 → graph.json 落盘 → 词条正文内嵌。
    全屏页面不挤工作台右栏（用户口径：pedia 原版体验）；无世界书也出页——显式空态写明
    强制口径与补索引入口，绝不静默空白。与工作台页同次刷新。"""
    graph = wb_build_index(proj)
    # 归纳层落盘：agent 直调 worldbook_search 读的就是这份 graph.json（不依赖页面渲染时机）
    try:
        (proj / "世界书").mkdir(parents=True, exist_ok=True)
        (proj / "世界书" / "graph.json").write_text(
            json.dumps(graph, ensure_ascii=False, indent=1), encoding="utf-8")
    except Exception:
        pass
    for e in graph.get("entries") or []:
        try:
            body = (proj / e["path"]).read_text(encoding="utf-8")
        except Exception:
            e["body"] = ""
            continue
        m = re.match(r"^---\r?\n.*?\r?\n---\r?\n?", body, re.S)
        e["body"] = (body[m.end():] if m else body)[:20000]
    try:
        history = wb_build_history(proj)
        (proj / "世界书").mkdir(parents=True, exist_ok=True)
        (proj / "世界书" / "history.json").write_text(
            json.dumps(history, ensure_ascii=False, indent=1), encoding="utf-8")
    except Exception:
        history = None
    return {"project": proj.name, "book": book_title, "graph": graph, "history": history}


def build_igdata(proj: Path) -> dict:
    """立意图数据（intent-graph@1，方案盘 20260924）：读 项目配置.json.universeId →
    universes/<uid>/intent-graph.json 宇宙级共享图，只读内嵌——写路径 = tools/intent-graph.py
    + 内核 ig_* 动词（提案制：AI 提案、人拍板、ig_sync 落决策），页面不发明第二套写路径。
    未绑定/图缺失都显式空态回显，绝不静默空白。"""
    cfg = load_json(proj / "项目配置.json", {}) or {}
    uid = cfg.get("universeId")
    if not uid:
        return {"bound": False, "reason": "项目配置.json 无 universeId 绑定"}
    p = ROOT / "universes" / uid / "intent-graph.json"
    if not p.exists():
        return {"bound": False, "reason": f"宇宙图不存在：universes/{uid}/intent-graph.json"}
    g = load_json(p, None)
    if not isinstance(g, dict) or g.get("format") != "intent-graph@1":
        return {"bound": False, "reason": f"intent-graph@1 格式不符：universes/{uid}"}
    return {"bound": True, "universe": uid, "title": g.get("title", uid),
            "updated_at": g.get("updated_at"), "stats": g.get("stats", {}),
            "nodes": g.get("nodes", []), "edges": g.get("edges", [])}


def emit_worldbook_page(proj: Path, book_title: str, data: dict | None = None) -> Path:
    """独立世界书 pedia 页（pedia 原版白皮，供外发/存档直读）；数据与工作台嵌入式视图同源。"""
    data = data or build_wbdata(proj, book_title)
    tpl = (ROOT / "tools" / "worldbook-template.html").read_text(encoding="utf-8")
    html = (tpl
            .replace("__WBDATA__", json.dumps(data, ensure_ascii=False).replace("</", "<\\/"))
            .replace("__TITLE__", f"{book_title} · {proj.name}"))
    out = proj / "worldbook.html"
    out.write_text(html, encoding="utf-8")
    return out


def main():
    argv = sys.argv[1:]
    if "--index-only" in argv:
        n = regen_index()
        print(f"[index] 已重生成入口页（{n} 个项目）：{ROOT / 'index.html'}")
        return
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
        module_views = []   # 冷项目（无 effective.json）走 static_module_views 兜底——此前漏初始化必 UnboundLocalError
        if eff_raw:
            notes.append("registry/effective.json 为旧 effective@1：页面按空编排渲染，"
                         "待 flow@3 转换 + 内核 flow_effect 刷新（盘上旧文件未动）")
    if flow.get("format") == "flow@3":
        if not module_views:
            module_views, n = static_module_views(flow, reg)
            notes += n
        toolbox = {"format": "toolbox@1", "modules": {}}
        for v in module_views:
            inst = next((m for m in flow["modules"] if m["id"] == v["id"]), None)
            if inst is None:
                # registry/effective.json 可能领先/落后于 flow.json 当前版（composition 实例已不在
                # flow.modules）——页面按「无 caps 请求」渲染该实例工具箱并显式回显，禁止整页崩
                notes.append(f"stale effective：实例 {v['id']}（{v['module']}）不在 flow『{flow_id}』当前 modules——"
                             f"registry/effective.json 待 flow_effect 刷新（盘上旧文件未动）")
                inst = {}
            toolbox["modules"][v["id"]] = toolbox_module(inst, reg[v["module"]], v)
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
    # v5.0 历史口径归一（单点在生成器，前端禁双名兜底——R4 §5.3）：
    #   旧报告的验收行 `assert` → `check`；三态 `unverified` → `warn`（绝不升格成 pass）。
    #   registry 盘上原件不动，只归一显示面，并给整份报告打 legacy 标记供前端标注「v5.0 前历史口径」。
    module_reports = {}
    for q in sorted((proj / "registry").glob("module-report-*.json")):
        try:
            mr = load_json(q, None)
        except Exception:
            mr = None
        if isinstance(mr, dict) and mr.get("moduleId"):
            acc = mr.get("acceptance") or []
            if any(
                "assert" in a
                or a.get("status") == "unverified"
                or str(a.get("check", "")).startswith("AE-")  # 断言协议残留：v5.0 验收行=完整性检查名
                for a in acc
            ):
                mr["legacy"] = True
                mr["acceptance"] = [
                    {**{k: v for k, v in a.items() if k != "assert"},
                     "check": a.get("check") or a.get("assert"),
                     "status": "warn" if a.get("status") == "unverified" else a.get("status")}
                    for a in acc
                ]
            module_reports[mr["moduleId"]] = mr

    cfg_view, cfg_tpl, cfg_exists = load_config_view(proj, project_id)
    # OS-04 余量 · 模板库首屏：**读内核落盘的读模型**（registry/config-templates.json），
    # python **不重扫**模板目录——扫描面（自存 root / 官方 repoRoot）只允许内核定义一次。
    # 文件不存在（未跑过 flow_effect）⇒ None，前端显式降级为「暂无模板读模型」，不编造空清单。
    cfg_templates = load_json(proj / "registry" / "config-templates.json", None)

    snapshots_view = load_snapshots_view(proj)

    # StoryHarness agent 脑基址：.storyharness.json 的 agent.base（storyharness web 写入）。
    # 空 = 同源内核脑（miniflow up 形态）；生成器单点注入，页面只消费（R4 §5.3 单名不兜底）。
    _manifest = load_json(ROOT / ".storyharness.json", {}) or {}
    agent_api = str((_manifest.get("agent") or {}).get("base") or "").rstrip("/")

    payload = {
        "DATA": {
            "project": project_id,
            "flow": {"id": flow.get("id") or flow_id, "title": flow.get("title") or flow_id,
                     "version": flow.get("version") or "", "status": flow.get("status") or "draft"},
            "modules": module_views,
            "toolbox": toolbox,
            "files": files,
            "mtimes": scan_mtimes(proj),
            "snapshots": snapshots_view,
            "runstate": runstate,
            "deliverables": deliverables,
            "moduleFiles": module_files,
            "moduleReports": module_reports,
            "machineScans": machine_scans_build(proj),
            "kits": kits_summary_build(),
            "kbTitles": kb_titles_build(),
            "inputs": runstate.get("inputs") or {},
            # OS-04 初始化面板：flow 声明的权威输入面 + 当前配置 + 出厂模板（三者都由内核/生成器算，页面只渲染）
            "flowInputs": flow.get("inputs") or {},
            "projectConfig": cfg_view,
            "configTemplate": cfg_tpl,
            "configExists": cfg_exists,
            # OS-04 余量 模板库：内核读模型原样搬运（自存/官方/从零新建三来源的清单）。
            # 页面只渲染；live 时由 /live 的 configTemplates 切片覆盖（内核现扫，防过期）。
            "configTemplates": cfg_templates,
            "agentApi": agent_api,
            # OS-02 阶段 C 阈值预算区：**内核派生**的阈值面（defs/values/sources/issues），
            # 页面纯消费——绝不在 python 侧再实现一遍合并与区间校验（那是「两处各改一半」的开端）。
            "budgetView": (eff or {}).get("budget"),
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
    # 世界书数据（嵌入式视图 wbstage + 独立 pedia 页共用）：归纳层 graph.json 顺带落盘
    cfg = load_json(proj / "项目配置.json", {}) or {}
    book_title = (runstate or {}).get("title") or cfg.get("name") or cfg.get("title") or f"{payload['DATA']['flow']['title']}"
    try:
        wb_data = build_wbdata(proj, book_title)
    except Exception as e:
        print(f"NOTE: 世界书归纳失败（工作台世界书视图按空态渲染）: {e}")
        wb_data = {"project": project_id, "book": book_title,
                   "graph": {"entries": [], "relations": [], "stats": {"entries": 0, "edges": 0, "byCat": {}}}}
    wb_json = json.dumps(wb_data, ensure_ascii=False).replace("</", "<\\/")
    ig_data = build_igdata(proj)  # 立意图（宇宙级只读内嵌；未绑定显式空态）
    ig_json = json.dumps(ig_data, ensure_ascii=False).replace("</", "<\\/")
    text = json.dumps(payload, ensure_ascii=False).replace("</", "<\\/")  # 防 </script> 提前闭合
    tpl = (ROOT / "tools" / "workflow-page-template.html").read_text(encoding="utf-8")
    page = (tpl
            .replace("__PAYLOAD__", text)
            .replace("__TITLE__", f"{payload['DATA']['flow']['title']} · {project_id}")
            .replace("__WBDATA__", wb_json)
            .replace("__IGDATA__", ig_json))
    out = proj / "workflow.html"
    out.write_text(page, encoding="utf-8")
    print(f"written: {out} ({out.stat().st_size // 1024} KB, {len(files)} artifacts embedded, "
          f"{len(module_views)} modules)")
    # 世界书 pedia 页（查看层，与工作台页同次刷新——归纳层 graph.json 顺带重建）
    try:
        cfg = load_json(proj / "项目配置.json", {}) or {}
        book_title = (runstate or {}).get("title") or cfg.get("name") or cfg.get("title") \
            or f"{payload['DATA']['flow']['title']}"
        wb_out = emit_worldbook_page(proj, book_title, wb_data)
        print(f"written: {wb_out} ({wb_out.stat().st_size // 1024} KB, worldbook pedia)")
    except Exception as e:  # 世界书渲染失败不拖垮工作台页，但必须显式回显
        print(f"NOTE: worldbook.html 渲染失败（工作台页不受影响）: {e}")
    for n in notes:
        print(f"NOTE: {n}")


if __name__ == "__main__":
    main()
