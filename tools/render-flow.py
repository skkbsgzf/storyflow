"""flow -> 图示渲染器（零依赖，确定性）
输出：flows/<id>/graph.svg + flows/<id>/graph.mmd（Obsidian/GitHub 可渲染）+ flows/graphs.html（总览）

R6（模块化 flow）：
  flow@3 → 模块序列图：模块卡横向拼接，卡内竖向列骨架工具（modules/<id>/module.json 声明的
           skeleton.spine，只读声明，**不做节点派生**——展开是内核 modules.ts::expandFlow 的单点职责）；
           模块缝画连接件（auto 灰虚 / manual 金实+「待人工」）。
  flow@2（存量）→ 阶段横向带 + 带内节点竖向（与新画布同构的过渡形态；WO-08 转换后此分支消亡）。
"""
import json, glob, os, re, html
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FLOWS = sorted(glob.glob(str(ROOT / "flows" / "*" / "flow.json")))

KIND_STYLE = {
    "novel-txt": {"fill": "#1d3323", "stroke": "#3d7a4f", "text": "#8fd4a3"},
    "core":      {"fill": "#16233a", "stroke": "#3d5a80", "text": "#a8c4e8"},
    "agent":     {"fill": "#2a2313", "stroke": "#e8b33d", "text": "#e8b33d"},
    "srd":       {"fill": "#2a1616", "stroke": "#a5433a", "text": "#e8a49c"},
}
KIND_LABEL = {"novel-txt": "素材", "core": "core·minitool", "agent": "agent·认知步", "srd": "验收门"}
MODULE_PALETTE = ["#3d7a4f", "#3d5a80", "#e8b33d", "#7d5f8a", "#a5433a", "#3d7a7a", "#8a623d", "#5f3d7a"]


def load(flow_path):
    d = json.load(open(flow_path, encoding="utf-8"))
    if d.get("format") == "flow@3":
        return d, {}, {}
    return d, d["graph"]["nodes"], d["graph"]["edges"]


def module_registry():
    reg = {}
    for p in sorted(ROOT.glob("modules/*/module.json")):
        try:
            m = json.loads(p.read_text(encoding="utf-8"))
            reg[m.get("id") or p.parent.name] = m
        except Exception:
            continue
    return reg


def esc(s):
    return html.escape(str(s), quote=True)


def render_flow3(d, reg):
    """flow@3 模块序列图：模块卡横向拼接 + 卡内竖向骨架 + 连接件走缝。"""
    CARD_W, GAP = 236, 96
    top, row_h = 64, 34
    mods = d.get("modules") or []
    link_default = (d.get("defaults") or {}).get("link") or (d.get("policy") or {}).get("link_default") or "auto"
    # 卡高 = 骨架工具数（声明级；caps 触发的插件在卡底以「+能力」行提示）
    def card_rows(inst):
        m = reg.get(inst.get("module")) or {}
        spine = (m.get("skeleton") or {}).get("spine") or []
        extra = [c for c in (inst.get("caps") or [])]
        return spine, extra
    cards = []
    max_h = 0
    for inst in mods:
        m = reg.get(inst.get("module")) or {}
        spine, extra = card_rows(inst)
        h = top + len(spine) * row_h + (row_h + 10 if extra else 0) + 18
        max_h = max(max_h, h)
        cards.append((inst, m, spine, extra, h))
    width = 40 + len(cards) * (CARD_W + GAP)
    height = max(240, max_h + 40)
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" font-family="-apple-system,\'PingFang SC\',\'Microsoft YaHei\',sans-serif">']
    out.append(f'<rect width="{width}" height="{height}" fill="#0f1115" rx="10"/>')
    x = 40
    band_of = {}
    for i, (inst, m, spine, extra, h) in enumerate(cards):
        color = MODULE_PALETTE[i % len(MODULE_PALETTE)]
        link = inst.get("link") or link_default
        out.append(f'<rect x="{x}" y="24" width="{CARD_W}" height="{h}" rx="12" fill="{color}" fill-opacity="0.08" stroke="{color}" stroke-width="1"/>')
        caps_n = len(inst.get("caps") or [])
        caps_all = len(m.get("caps") or [])
        title = f'{i+1:02d} {m.get("name") or inst.get("module","?")}'
        sub = f'{inst.get("id","")} · link={link}' + (f' · caps {caps_n}/{caps_all}' if caps_n else '')
        out.append(f'<text x="{x+12}" y="48" fill="{color}" font-size="13" font-weight="700">{esc(title)}</text>')
        out.append(f'<text x="{x+12}" y="64" fill="#8b95a8" font-size="9.5">{esc(sub)}{" · iterate" if inst.get("iterate") else ""}</text>')
        for k, t in enumerate(spine):
            ty = 92 + k * row_h
            out.append(f'<rect x="{x+14}" y="{ty-17}" width="{CARD_W-28}" height="26" rx="7" fill="#161a22" stroke="#2a2f3a"/>')
            dot = f'<circle cx="{x+26}" cy="{ty-4}" r="3.2" fill="{color}"/>'
            out.append(f'{dot}<text x="{x+36}" y="{ty}" fill="#c9ceda" font-size="10.5">{esc(t)}</text>')
        if extra:
            ty = 92 + len(spine) * row_h
            out.append(f'<text x="{x+14}" y="{ty}" fill="{color}" font-size="10">＋ {esc(" / ".join(extra))}</text>')
        band_of[inst.get("id")] = (x, x + CARD_W, 24 + h / 2)
        x += CARD_W + GAP
    # 连接件：模块缝上，auto 灰虚 / manual 金实 + 徽章
    pairs = list(zip(mods, mods[1:]))
    for a, b in pairs:
        if a["id"] not in band_of or b["id"] not in band_of:
            continue
        x1 = band_of[a["id"]][1] + 4
        x2 = band_of[b["id"]][0] - 4
        y = band_of[b["id"]][2]
        link = (b.get("link") or link_default)
        manual = link == "manual"
        col = "#b8a464" if manual else "#5a6478"
        dash = '' if manual else ' stroke-dasharray="6,5"'
        out.append(f'<path d="M{x1},{y} L{x2},{y}" fill="none" stroke="{col}" stroke-width="{2 if manual else 1.3}"{dash}/>')
        label = "待人工" if manual else "自动"
        mx = (x1 + x2) / 2
        out.append(f'<rect x="{mx-26}" y="{y-11}" width="52" height="22" rx="11" fill="#0f1115" stroke="{col}"/>')
        out.append(f'<text x="{mx}" y="{y+4}" fill="{col}" font-size="9.5" text-anchor="middle">{esc(label)}</text>')
    out.append('</svg>')
    return "\n".join(out)


def mmd_flow3(d, reg):
    lines = ["flowchart LR"]
    for inst in d.get("modules") or []:
        m = reg.get(inst.get("module")) or {}
        spine = " → ".join((m.get("skeleton") or {}).get("spine") or ["(空骨架)"])
        lines.append(f'    {inst["id"]}["{inst.get("id")} {m.get("name") or inst.get("module")} · {spine}"]:::mod')
    for a, b in zip(d.get("modules") or [], (d.get("modules") or [])[1:]):
        link = b.get("link") or (d.get("defaults") or {}).get("link") or "auto"
        op = "-.->" if link == "auto" else "==>"
        lines.append(f'    {a["id"]} {op}|{link}| {b["id"]}')
    lines += ["    classDef mod fill:#1d2430,stroke:#e8b33d,color:#e8b33d"]
    return "\n".join(lines)


def render_svg(d, nodes, edges):
    """flow@2 存量：阶段横向带 + 带内竖向（与新画布同构的过渡形态）。"""
    NW, NH, ROW_H, MG = 176, 52, 78, 40
    stages = d.get("stages") or []
    placed = {}
    max_rows = 1
    bands = []
    for sg in stages:
        ns = [n for n in sg.get("nodes", []) if n in nodes]
        max_rows = max(max_rows, len(ns))
        bands.append((sg, ns))
    orphan = [n for n in nodes if n not in placed and not any(n in ns for _, ns in bands)]
    if orphan:
        bands.append(({"id": "ORPHAN", "name": "未归段"}, orphan))
        max_rows = max(max_rows, len(orphan))
    CARD_W = 200
    width = 40 + len(bands) * (CARD_W + 88)
    height = max(240, 72 + max_rows * ROW_H + 24)
    svg = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" font-family="-apple-system,\'PingFang SC\',\'Microsoft YaHei\',sans-serif">']
    svg.append(f'''<defs><marker id="arw" markerWidth="9" markerHeight="8" refX="8" refY="4" orient="auto">
<path d="M0,0 L9,4 L0,8 z" fill="#5a6478"/></marker></defs>''')
    svg.append(f'<rect width="{width}" height="{height}" fill="#0f1115" rx="10"/>')
    STAGE_COLOR = {"S1": "#3d7a4f", "S2": "#3d5a80", "S3": "#e8b33d", "S4": "#a5433a", "S5": "#7a8496"}
    x = 40
    for sg, ns in bands:
        color = STAGE_COLOR.get(sg.get("id"), "#5a6478")
        bh = max(72, 64 + len(ns) * ROW_H)
        svg.append(f'<rect x="{x}" y="24" width="{CARD_W}" height="{bh}" rx="12" fill="{color}" fill-opacity="0.08" stroke="{color}" stroke-width="1"/>')
        svg.append(f'<text x="{x+12}" y="48" fill="{color}" font-size="13" font-weight="700">{esc(sg.get("id","")+" "+sg.get("name",""))}</text>')
        for k, n in enumerate(ns):
            meta = nodes[n]
            st = KIND_STYLE.get(meta.get("kind", "agent"), KIND_STYLE["agent"])
            ty = 78 + k * ROW_H
            svg.append(f'<rect x="{x+14}" y="{ty-17}" width="{CARD_W-28}" height="{NH-8}" rx="8" fill="{st["fill"]}" stroke="{st["stroke"]}" stroke-width="1.2"/>')
            title = meta.get("title", n)
            if len(title) > 13:
                title = title[:12] + "…"
            svg.append(f'<text x="{x+CARD_W/2}" y="{ty}" fill="{st["text"]}" font-size="11" font-weight="700" text-anchor="middle">{esc(title)}</text>')
            tag = meta.get("skill") or meta.get("minitool") or ""
            if len(tag) > 16:
                tag = tag[:15] + "…"
            if tag:
                svg.append(f'<text x="{x+CARD_W/2}" y="{ty+15}" fill="#667089" font-size="8.5" text-anchor="middle">{esc(tag)}</text>')
            placed[n] = (x + CARD_W / 2, ty + (NH - 8) / 2, x, x + CARD_W, ty - 17, ty + NH - 17)
        x += CARD_W + 88
    # 边：同带竖向、跨带横向
    for e in edges:
        if e["from"] not in placed or e["to"] not in placed:
            continue
        _, _, ax0, ax1, ay0, ay1 = placed[e["from"]]
        bx0, bx1, by0, by1, _, by2 = placed[e["to"]]
        dashed = ' stroke-dasharray="5,4"' if e.get("optional") or e.get("when") else ""
        if abs(ax0 - bx0) < 8:  # 同带：竖向
            sx, sy = (ax0 + ax1) / 2, ay1
            tx, ty = (bx0 + bx1) / 2, by0 - 8
            my = (sy + ty) / 2
            path = f"M{sx},{sy} C{sx},{my} {tx},{my} {tx},{ty}"
        else:  # 跨带：横向
            sx, sy = ax1, (ay0 + ay1) / 2
            tx, ty = bx0, (by0 + by2) / 2
            mx = (sx + tx) / 2
            path = f"M{sx},{sy} C{mx},{sy} {mx},{ty} {tx},{ty}"
        svg.append(f'<path d="{path}" fill="none" stroke="#5a6478" stroke-width="1.3"{dashed} marker-end="url(#arw)"><title>{esc(e["id"])}: {esc(e["from"])} → {esc(e["to"])}</title></path>')
    svg.append('</svg>')
    return "\n".join(svg)


def render_mmd(d, nodes, edges):
    lines = ["flowchart LR"]
    for n, m in nodes.items():
        cls = {"novel-txt": "src", "core": "core", "agent": "agent", "srd": "gate"}.get(m.get("kind"), "agent")
        label = f'{n} · {m.get("title", "")}'
        lines.append(f'    {n}["{label}"]:::{cls}')
    for e in edges:
        op = "-.->" if (e.get("optional") or e.get("when")) else "-->"
        lbl = e.get("transform", "")
        lines.append(f'    {e["from"]} {op}|{lbl}| {e["to"]}')
    lines += ["    classDef src fill:#1d3323,stroke:#3d7a4f,color:#8fd4a3",
              "    classDef core fill:#16233a,stroke:#3d5a80,color:#a8c4e8",
              "    classDef agent fill:#2a2313,stroke:#e8b33d,color:#e8b33d",
              "    classDef gate fill:#2a1616,stroke:#a5433a,color:#e8a49c"]
    return "\n".join(lines)


REG = module_registry()
svgs = {}
for fp in FLOWS:
    d, nodes, edges = load(fp)
    fid = d["id"]
    outdir = Path(fp).parent
    if d.get("format") == "flow@3":
        svg = render_flow3(d, REG)
        mmd = mmd_flow3(d, REG)
    else:
        svg = render_svg(d, nodes, edges)
        mmd = render_mmd(d, nodes, edges)
    (outdir / "graph.svg").write_text(svg, encoding="utf-8")
    (outdir / "graph.mmd").write_text(mmd + "\n", encoding="utf-8")
    svgs[fid] = (d.get("title", fid), d.get("version", ""), svg)
    print(f"{fid}: graph.svg + graph.mmd ({d.get('format') or 'flow@2'})")

# ---- 世界书体系页（全项目通用：小说/剧本双变体 + 各项目实况） ----
WB_VARIANT_TREE = {
    "小说变体（结算单位=章）": ["设定/", "人物/（一人一卡：主角/主要配角/次要配角/路人）", "势力/", "地理/", "编年/（大事记 + 章账=handoff）", "伏笔/台账.md", "底牌/暗线底牌.md（draft，永不入正文）"],
    "剧本变体（结算单位=集）": ["设定/", "人物/", "势力/", "场景/（有名场景≤3 硬约束）", "道具/（连续性信物建档）", "分集账/（集账=handoff）", "伏笔/台账.md", "底牌/暗线底牌.md"],
}

def worldbook_rows():
    rows = []
    for pj in sorted((ROOT / "projects").iterdir()):
        idx = pj / "世界书" / "index.json"
        if not pj.is_dir() or not idx.exists():
            continue
        try:
            d = json.loads(idx.read_text(encoding="utf-8"))
        except Exception:
            continue
        entries = [e for s in d.get("sections", []) for e in s.get("entries", [])]
        st = {}
        for e in entries:
            k = e.get("status", "?")
            st[k] = st.get(k, 0) + 1
        st_s = " / ".join(f"{k}:{v}" for k, v in st.items()) or "-"
        rows.append((pj.name, d.get("变体", "novel"), d.get("version", "-"),
                     len(d.get("sections", [])), len(entries), st_s,
                     d.get("updated", "-")))
    return rows

wb_rows = worldbook_rows()
wb_rows_html = "".join(
    f'<tr><td>{html.escape(r[0])}</td><td>{html.escape(str(r[1]))}</td><td>{r[2]}</td>'
    f'<td>{r[3]} 区 / {r[4]} 词条</td><td>{html.escape(r[5])}</td><td>{html.escape(str(r[6]))}</td></tr>'
    for r in wb_rows
) or '<tr><td colspan="6">（尚无项目建档——python tools/worldbook.py init &lt;project&gt; [--variant novel|drama]）</td></tr>'
wb_tree_html = "".join(
    f'<div class="wbc"><h3>{html.escape(k)}</h3><ul>' + "".join(f"<li>{html.escape(i)}</li>" for i in v) + "</ul></div>"
    for k, v in WB_VARIANT_TREE.items()
)

# combined viewer
tabs, pages = [], []
for n, (fid, (title, ver, svg)) in enumerate(svgs.items()):
    tabs.append(f'<button class="tab{" on" if n==0 else ""}" onclick="show({n})">{html.escape(fid)}</button>')
    pages.append(f'<div class="page{" on" if n==0 else ""}"><h2>{html.escape(title)} <small>{html.escape(ver)}</small></h2>'
                 f'<div class="scroll">{svg}</div></div>')
wb_n = len(tabs)
tabs.append(f'<button class="tab" onclick="show({wb_n})">世界书体系</button>')
pages.append(f'''<div class="page"><h2>世界书体系 <small>全项目通用 · 小说/剧本双变体 · 文件即真相</small></h2>
<div class="wb">
<p>所有叙事项目共用一套世界书骨架：类型化建档（list/text 双格式）+ 逐章（集）结算五件 + 状态机 draft→active→retired（不删档）。标准：<code>knowledge/continuity/worldbook.md</code>；脚手架：<code>python tools/worldbook.py init &lt;project&gt; [--variant novel|drama]</code>。</p>
<h3>一、结算五件（每章/集交稿后、下一章/集派发前）</h3>
<ol><li>章卡/集卡（一句话+梗点+钩型+新名目）→ 编年/章账 或 分集账/集账</li><li>人物状态推进（伤/钱/知情/关系/位置）→ 人物卡「当前状态」+「变动史」</li><li>交接 handoff（下一章/集写手必知 3-5 条）→ 账本末节</li><li>伏笔变动（新埋/回收/顺期）→ 伏笔/台账</li><li>世界揭示（新设定事实，version+1）→ 设定词条</li></ol>
<h3>二、目录模板（双变体）</h3><div class="wbs">{wb_tree_html}</div>
<h3>三、各项目实况（生成时快照）</h3>
<table class="wbt"><tr><th>项目</th><th>变体</th><th>版本</th><th>规模</th><th>状态分布</th><th>更新日</th></tr>{wb_rows_html}</table>
</div></div>''')
legend = "".join(f'<span class="lg"><i style="background:{v["stroke"]}"></i>{KIND_LABEL.get(k, k)}</span>' for k, v in KIND_STYLE.items())
viewer = f"""<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>miniflow · flow 图示</title><style>
body{{font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;margin:0;background:#0f1115;color:#e8e8ea}}
h1{{font-size:18px;padding:14px 16px 0;margin:0}} .legend{{padding:4px 16px 10px;font-size:12px;color:#9aa}}
.lg i{{display:inline-block;width:10px;height:10px;border-radius:2px;margin:0 4px 0 12px}}
.tabs{{display:flex;overflow-x:auto;gap:6px;padding:8px 12px;position:sticky;top:0;background:#0f1115ee}}
.tab{{border:1px solid #2a2f3a;background:#161a22;color:#cfd4dd;border-radius:14px;padding:5px 12px;font-size:13px}}
.tab.on{{background:#e8b33d;color:#141414;font-weight:700;border-color:#e8b33d}}
.page{{display:none}} .page.on{{display:block}} h2{{font-size:15px;padding:0 16px}}
.scroll{{overflow-x:auto;padding:0 12px 40px}} .scroll svg{{min-width:900px;width:100%;height:auto}}
.wb{{padding:0 16px 40px;max-width:980px}} .wb p{{color:#c9ceda;font-size:13.5px}} .wb h3{{font-size:14px;margin:18px 0 8px;color:#e8b33d}}
.wb ol{{color:#c9ceda;font-size:13.5px;line-height:1.8}} .wb code{{background:#161a22;border:1px solid #2a2f3a;border-radius:4px;padding:1px 6px;font-size:12px}}
.wbs{{display:flex;gap:14px;flex-wrap:wrap}} .wbc{{flex:1;min-width:300px;background:#12151c;border:1px solid #2a2f3a;border-radius:8px;padding:10px 14px}} .wbc h3{{margin:4px 0 8px}}
.wbc ul{{margin:0;padding-left:18px;color:#b9c0cc;font-size:13px;line-height:1.9}}
.wbt{{border-collapse:collapse;width:100%;font-size:13px}} .wbt th,.wbt td{{border:1px solid #2a2f3a;padding:6px 10px;text-align:left;color:#c9ceda}} .wbt th{{background:#161a22;color:#e8b33d}}
small{{color:#7a8496;font-weight:400}}
</style></head><body>
<h1>miniflow · flow 图示</h1><div class="legend">模块卡/节点带横向拼接 · 带内竖向为执行序　虚线边 = 条件/自动连接件　金色 = 待人工连接件</div>
<div class="tabs">{''.join(tabs)}</div>{''.join(pages)}
<script>function show(n){{document.querySelectorAll('.tab').forEach((t,i)=>t.classList.toggle('on',i===n));document.querySelectorAll('.page').forEach((p,i)=>p.classList.toggle('on',i===n));}}</script>
</body></html>"""
(ROOT / "flows" / "graphs.html").write_text(viewer, encoding="utf-8")
print("written: flows/graphs.html")

