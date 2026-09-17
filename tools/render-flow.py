"""flow.json -> 图示渲染器（零依赖，确定性）
输出：flows/<id>/graph.svg + flows/<id>/graph.mmd（Obsidian/GitHub 可渲染）+ flows/graphs.html（总览）
布局：最长路径分层 + 层内重心排序，节点按 kind 着色，产物节点描边加粗。
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

def load(flow_path):
    d = json.load(open(flow_path, encoding="utf-8"))
    nodes, edges = d["graph"]["nodes"], d["graph"]["edges"]
    return d, nodes, edges

def layers(nodes, edges):
    # 环边（loop: true）不参与分层（v3 语义：环上边不计）
    edges = [e for e in edges if not e.get("loop")]
    ids = list(nodes)
    preds = {i: [] for i in ids}
    for e in edges:
        preds[e["to"]].append(e["from"])
    # longest-path layering (iterative, graph is a DAG)
    layer = {}
    def depth(n, seen=()):
        if n in layer: return layer[n]
        if n in seen: return 0
        p = [depth(x, seen + (n,)) for x in preds[n]]
        layer[n] = (max(p) + 1) if p else 0
        return layer[n]
    for i in ids: depth(i)
    L = max(layer.values())
    out = [[] for _ in range(L + 1)]
    for i in ids: out[layer[i]].append(i)
    # barycenter ordering sweeps
    def pos_map():
        return {n: k for l in out for k, n in enumerate(l)}
    for _ in range(3):
        pm = pos_map()
        for li in range(1, L + 1):
            out[li].sort(key=lambda n: (sum(pm.get(p, 0) for p in preds[n]) / max(len(preds[n]), 1), n))
        pm = pos_map()
        for li in range(L - 1, -1, -1):
            succs = {n: [e["to"] for e in edges if e["from"] == n] for n in out[li]}
            out[li].sort(key=lambda n: (sum(pm.get(s, 0) for s in succs[n]) / max(len(succs[n]), 1), n))
    return out

def render_svg(d, nodes, edges):
    L = layers(nodes, edges)
    layer_of = {n: li for li, col in enumerate(L) for n in col}
    W, H, GAPX, GAPY, NW, NH = 190, 64, 74, 96, 176, 52
    width = GAPX * 2 + len(L) * (NW + GAPX)
    height = GAPY * 2 + max(len(l) for l in L) * (NH + GAPY) + 70  # 底部留回环弧空间
    cx = {}
    for li, col in enumerate(L):
        colh = len(col) * (NH + GAPY) - GAPY
        y0 = (height - 70 - colh) / 2
        for k, n in enumerate(col):
            cx[n] = (GAPX + li * (NW + GAPX), y0 + k * (NH + GAPY))
    def esc(s): return html.escape(str(s), quote=True)
    svg = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" font-family="-apple-system,\'PingFang SC\',\'Microsoft YaHei\',sans-serif">']
    svg.append(f'''<defs><marker id="arw" markerWidth="9" markerHeight="8" refX="8" refY="4" orient="auto">
<path d="M0,0 L9,4 L0,8 z" fill="#5a6478"/></marker></defs>''')
    svg.append(f'<rect width="{width}" height="{height}" fill="#0f1115" rx="10"/>')
    # 阶段分区带（节点带 stage 字段时启用）
    STAGE_STYLE = {
        "S1": ("#14231c", "#3d7a4f", "S1 调研"), "S2": ("#161d31", "#3d5a80", "S2 结构"),
        "S3": ("#241b12", "#e8b33d", "S3 方案"), "S4": ("#28141f", "#a5433a", "S4 成稿"),
        "S5": ("#1d1d24", "#7a8496", "交付"),
    }
    stage_of = {n: nodes[n].get("stage") for n in nodes if nodes[n].get("stage")}
    if stage_of:
        bands = []
        for li, col in enumerate(L):
            sts = [stage_of[n] for n in col if n in stage_of]
            dom = max(set(sts), key=sts.count) if sts else None
            bands.append(dom)
        runs = []
        s0 = 0
        for li in range(1, len(bands) + 1):
            if li == len(bands) or bands[li] != bands[s0]:
                if bands[s0]: runs.append((s0, li - 1, bands[s0]))
                s0 = li
        for (c0, c1, st) in runs:
            xs = GAPX + c0 * (NW + GAPX) - 14
            xe = GAPX + c1 * (NW + GAPX) + NW + 14
            fill, stroke, label = STAGE_STYLE.get(st, ("#161a22", "#2a2f3a", st))
            svg.append(f'<rect x="{xs}" y="16" width="{xe-xs}" height="{height-42}" rx="12" fill="{fill}" stroke="{stroke}" stroke-width="0.8" stroke-dasharray="3,5" opacity="0.55"/>')
            svg.append(f'<text x="{xs+12}" y="34" fill="{stroke}" font-size="11" font-weight="700">{esc(label)}</text>')
    # edges first (under nodes); 回环弧由 engine 派生（gate → 本阶段入口 / 全局入口）
    outputs = set(d["graph"].get("outputs", []))
    layer_of = {n: li for li, col in enumerate(L) for n in col}
    stage_of = {n: nodes[n].get("stage") for n in nodes if nodes[n].get("stage")}
    stage_entry = {}
    for st_def in d.get("stages", []):
        stage_entry[st_def["id"]] = st_def.get("entry")
    global_entry = d["stages"][0]["entry"] if d.get("stages") else None
    derived = []
    arc_i = 0
    for e in edges:
        x1, y1 = cx[e["from"]]; x2, y2 = cx[e["to"]]
        if e.get("loop"):
            color, tag = "#a5433a", "打回重做"
            depth = 34 + (arc_i % 3) * 26
            arc_i += 1
            sx, sy = x1 + NW / 2, y1 + NH
            tx, ty = x2 + NW / 2, y2 + NH
            by = max(sy, ty) + depth
            path = f"M{sx},{sy} C{sx},{by} {tx},{by} {tx},{ty}"
            lx, ly = (sx + tx) / 2, by + 2
            svg.append(f'<path d="{path}" fill="none" stroke="{color}" stroke-width="1.6" stroke-dasharray="6,4" marker-end="url(#arw)"><title>{esc(e["id"])}: {esc(e["from"])} → {esc(e["to"])}</title></path>')
            svg.append(f'<text x="{lx}" y="{ly}" fill="{color}" font-size="9.5" text-anchor="middle">{esc(tag)}·{esc(e.get("when",""))}</text>')
            continue
        sx, sy = x1 + NW, y1 + NH / 2
        tx, ty = x2, y2 + NH / 2
        dashed = ' stroke-dasharray="5,4"' if e.get("optional") or e.get("when") else ""
        mx = (sx + tx) / 2
        path = f"M{sx},{sy} C{mx},{sy} {mx},{ty} {tx},{ty}"
        label = e.get("transform", "")
        svg.append(f'<path d="{path}" fill="none" stroke="#5a6478" stroke-width="1.4"{dashed} marker-end="url(#arw)"><title>{esc(e["id"])}: {esc(e["from"])} → {esc(e["to"])} ｜ {esc(label)}{" ｜ "+esc(e["when"]) if e.get("when") else ""}{" ｜ optional" if e.get("optional") else ""}</title></path>')
        if label:
            ly = (sy + ty) / 2 - 4
            svg.append(f'<text x="{mx}" y="{ly}" fill="#7a8496" font-size="9" text-anchor="middle">{esc(label[:20])}</text>')
    # 派生回环弧：gate 菱形 → 本阶段入口（修改流）/ 全局入口（从零构筑）
    for st_def in d.get("stages", []):
        g = st_def.get("gate")
        entry = st_def.get("entry")
        if not g or g not in cx: continue
        gx, gy = cx[g]
        if entry in cx:
            ex, ey = cx[entry]
            depth = 46
            sx, sy = gx + NW/2, gy + NH
            tx, ty = ex + NW/2, ey + NH
            by = max(sy, ty) + depth + 8
            svg.append(f'<path d="M{sx},{sy} C{sx},{by} {tx},{by} {tx},{ty}" fill="none" stroke="#a5433a" stroke-width="1.5" stroke-dasharray="7,4" marker-end="url(#arw)" opacity="0.85"><title>{esc(st_def["id"])} 打回 · 修改流：回 {esc(entry)} 重做（级联失效下游）</title></path>')
            svg.append(f'<text x="{(sx+tx)/2}" y="{by-4}" fill="#a5433a" font-size="9" text-anchor="middle">{esc(st_def["id"])} 打回·修改流</text>')
        if st_def["id"] != d["stages"][0]["id"]:
            ex, ey = cx[global_entry]
            depth2 = 46 + 22
            sx2, sy2 = gx + NW/2, gy + NH
            tx2, ty2 = ex + NW/2, ey + NH
            by2 = max(sy2, ty2) + depth2
            svg.append(f'<path d="M{sx2},{sy2} C{sx2},{by2} {tx2},{by2} {tx2},{ty2}" fill="none" stroke="#7a4a4a" stroke-width="1.3" stroke-dasharray="3,5" marker-end="url(#arw)" opacity="0.7"><title>{esc(st_def["id"])} 打回 · 从零构筑流：回 {esc(global_entry)}（根因在更早阶段时）</title></path>')
    # nodes
    for li, col in enumerate(L):
        for n in col:
            x, y = cx[n]
            meta = nodes[n]
            st = KIND_STYLE.get(meta.get("kind", "agent"), KIND_STYLE["agent"])
            is_out = n in outputs
            sw = 2.6 if is_out else 1.4
            tip = esc(f'{n} ｜ {meta.get("kind")} ｜ {meta.get("title", "")} ｜ skill={meta.get("skill","-")} minitool={meta.get("minitool","-")}')
            svg.append(f'<g><title>{tip}</title>')
            if meta.get("kind") == "gate":
                # 菱形判断节点（红方验收）
                cxm, cym = x + NW/2, y + NH/2
                pts = f"{cxm},{y} {x+NW},{cym} {cxm},{y+NH} {x},{cym}"
                svg.append(f'<polygon points="{pts}" fill="{st["fill"]}" stroke="{st["stroke"]}" stroke-width="{sw}"/>')
                if is_out:
                    svg.append(f'<circle cx="{x+NW-9}" cy="{y+9}" r="5" fill="none" stroke="{st["stroke"]}" stroke-width="1.2"/><circle cx="{x+NW-9}" cy="{y+9}" r="1.8" fill="{st["stroke"]}"/>')
                svg.append(f'<text x="{cxm}" y="{cym-2}" fill="{st["text"]}" font-size="12.5" font-weight="700" text-anchor="middle">{esc(n)}</text>')
                svg.append(f'<text x="{cxm}" y="{cym+14}" fill="#b8bdc7" font-size="9.5" text-anchor="middle">{esc("红方验收 ◇")}</text>')
            else:
                svg.append(f'<rect x="{x}" y="{y}" width="{NW}" height="{NH}" rx="9" fill="{st["fill"]}" stroke="{st["stroke"]}" stroke-width="{sw}"/>')
                if is_out:
                    svg.append(f'<circle cx="{x+NW-9}" cy="{y+9}" r="5" fill="none" stroke="{st["stroke"]}" stroke-width="1.2"/><circle cx="{x+NW-9}" cy="{y+9}" r="1.8" fill="{st["stroke"]}"/>')
                svg.append(f'<text x="{x+NW/2}" y="{y+21}" fill="{st["text"]}" font-size="12.5" font-weight="700" text-anchor="middle">{esc(n)}</text>')
                title = meta.get("title", "")
                if len(title) > 14: title = title[:13] + "…"
                svg.append(f'<text x="{x+NW/2}" y="{y+37}" fill="#b8bdc7" font-size="10.5" text-anchor="middle">{esc(title)}</text>')
                tag = meta.get("skill") or meta.get("minitool") or KIND_LABEL.get(meta.get("kind"), "")
                if tag:
                    if len(tag) > 18: tag = tag[:17] + "…"
                    svg.append(f'<text x="{x+NW/2}" y="{y+49}" fill="#667089" font-size="8.5" text-anchor="middle">{esc(tag)}</text>')
            svg.append('</g>')
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

svgs = {}
for fp in FLOWS:
    d, nodes, edges = load(fp)
    fid = d["id"]
    outdir = Path(fp).parent
    svg = render_svg(d, nodes, edges)
    (outdir / "graph.svg").write_text(svg, encoding="utf-8")
    (outdir / "graph.mmd").write_text(render_mmd(d, nodes, edges) + "\n", encoding="utf-8")
    svgs[fid] = (d.get("title", fid), d.get("version", ""), svg)
    print(f"{fid}: graph.svg + graph.mmd ({len(nodes)} nodes / {len(edges)} edges)")

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
<h1>miniflow · flow 图示</h1><div class="legend">节点色 = 步型：{legend}　空心圆点 = flow 产物节点　虚线边 = 条件/可选</div>
<div class="tabs">{''.join(tabs)}</div>{''.join(pages)}
<script>function show(n){{document.querySelectorAll('.tab').forEach((t,i)=>t.classList.toggle('on',i===n));document.querySelectorAll('.page').forEach((p,i)=>p.classList.toggle('on',i===n));}}</script>
</body></html>"""
(ROOT / "flows" / "graphs.html").write_text(viewer, encoding="utf-8")
print("written: flows/graphs.html")
