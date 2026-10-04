"use client";

/** 世界书专有页（工单-20261002 批2；2026-10-05 恢复全屏形态 + pedia 交互对齐）：
 *  左=分类树，中=词条卡墙/图谱/详情，顶=全局 RAG 检索。
 *  图谱 = pedia 交互全家桶：节点拖拽 / 画布平移 / 滚轮缩放 / 节点名称 / 度数定半径 / 分类图例高亮。
 *  读卡带引用解析兜底（全路径 → 尾段 → 标题 → id），关联词条原地跳转（单页形态不开新页）。
 *  数据经桥路由 /api/kit/worldbook-graph（graph.json）与 /api/kit/worldbook（检索）、/api/kit/entry（读卡）。 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { parseFrontmatter } from "@/lib/frontmatter";
import { markdownPreviewRehypePlugins, markdownPreviewRemarkPlugins, markdownUrlTransform } from "@/lib/markdown";

interface WbEntry {
  id: string;
  cat: string;
  title: string;
  tags: string[];
  links: string[];
  summary: string;
  path: string;
}
interface WbRelation { a: string; b: string; src: string; weight: number }
interface WbGraph { entries: WbEntry[]; relations: WbRelation[]; stats?: Record<string, unknown> }

interface Hit { title?: string; summary?: string; path?: string | null }

const ACCENT = "var(--accent, #a5433a)";
const CAT_PALETTE: Record<string, string> = {
  "人物": "#c96f4a", "地点": "#5b7fa6", "势力": "#8a6fb0", "规则": "#5f9c7a",
  "总览": "#b09a5f", "物品": "#a06a8a", "事件": "#6a9aa0",
};
const catColorOf = (e: WbEntry) => CAT_PALETTE[e.cat] ?? "#8a8375";
const catColor = (c: string) => CAT_PALETTE[c] ?? "#8a8375";

/** 图谱节点（布局后含度数）。 */
interface GraphNode { e: WbEntry; x: number; y: number; vx: number; vy: number; deg: number }
type GraphEdge = readonly [GraphNode, GraphNode];
interface ViewTx { k: number; tx: number; ty: number }
const MIN_K = 0.35;
const MAX_K = 3;

/** 关系图谱（pedia 对齐）：布局一次，交互（hover/拖拽/平移/缩放/图例）全在客户端。 */
function WorldbookGraph({ graph, onOpen }: { graph: WbGraph; onOpen: (e: WbEntry) => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const layoutRef = useRef<{ nodes: GraphNode[]; edges: GraphEdge[] } | null>(null);
  const viewRef = useRef<ViewTx>({ k: 1, tx: 0, ty: 0 });
  const hoverRef = useRef<string | null>(null);
  const dragRef = useRef<
    | { type: "node"; n: GraphNode; ox: number; oy: number; moved: boolean }
    | { type: "pan"; sx: number; sy: number; tx0: number; ty0: number; moved: boolean }
    | null
  >(null);
  const [highlightCat, setHighlightCat] = useState<string | null>(null);
  const highlightRef = useRef<string | null>(null);
  highlightRef.current = highlightCat;

  const cats = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of graph.entries) m.set(e.cat, (m.get(e.cat) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [graph]);

  const draw = useCallback((hoverId: string | null) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const layout = layoutRef.current;
    if (!canvas || !ctx || !layout) return;
    const { nodes, edges } = layout;
    const { k, tx, ty } = viewRef.current;
    const hl = highlightRef.current;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(k, 0, 0, k, tx, ty);
    const neighbors = new Set<string>();
    if (hoverId) {
      neighbors.add(hoverId);
      for (const [a, b] of edges) {
        if (a.e.id === hoverId) neighbors.add(b.e.id);
        if (b.e.id === hoverId) neighbors.add(a.e.id);
      }
    }
    const dimOf = (id: string): number => {
      if (hoverId) return neighbors.has(id) ? 1 : 0.14;
      if (hl) return nodes.find((n) => n.e.id === id)?.e.cat === hl ? 1 : 0.16;
      return 1;
    };
    ctx.lineWidth = 1.4;
    for (const [a, b] of edges) {
      const on = !hoverId && !hl ? 1 : Math.min(dimOf(a.e.id), dimOf(b.e.id));
      ctx.strokeStyle = on === 1 ? "rgba(138,131,117,0.5)" : `rgba(138,131,117,${0.35 * on})`;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    // 名称显隐：枢纽与总览常显，放大后全显（字号随缩放恒定屏显 ~11px）
    const labelAll = k >= 1.2;
    for (const n of nodes) {
      const alpha = dimOf(n.e.id);
      if (alpha === 0) continue;
      const r = n.e.cat === "总览" ? 18 : 8 + Math.min(n.deg, 20) * 0.5;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fillStyle = catColorOf(n.e);
      ctx.fill();
      if (hoverId && n.e.id === hoverId) {
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 3 / k;
        ctx.stroke();
      }
      if (n.e.cat === "总览" || labelAll || n.deg >= 5) {
        ctx.font = `${(n.e.cat === "总览" ? 15 : 22) / k}px 'Noto Serif SC', serif`;
        ctx.textAlign = "center";
        ctx.fillStyle = "rgba(200,195,185,0.92)";
        ctx.fillText(n.e.title, n.x, n.y - r - 6 / k);
      }
      ctx.globalAlpha = 1;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }, []);

  // 布局：环形起点 + 斥力/弹簧迭代（一次；此后拖拽即真拖拽）
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const W = canvas.width = canvas.clientWidth * 2;
    const H = canvas.height = canvas.clientHeight * 2;
    const deg: Record<string, number> = {};
    for (const r of graph.relations) { deg[r.a] = (deg[r.a] ?? 0) + 1; deg[r.b] = (deg[r.b] ?? 0) + 1; }
    const nodes: GraphNode[] = graph.entries.map((e, i) => ({
      e,
      deg: deg[e.id] ?? 0,
      x: W / 2 + Math.cos((i / graph.entries.length) * Math.PI * 2) * W * 0.36,
      y: H / 2 + Math.sin((i / graph.entries.length) * Math.PI * 2) * H * 0.36,
      vx: 0, vy: 0,
    }));
    const idx = new Map(nodes.map((n) => [n.e.id, n]));
    const edges: GraphEdge[] = [];
    for (const r of graph.relations) {
      const a = idx.get(r.a);
      const b = idx.get(r.b);
      if (a && b) edges.push([a, b] as const);
    }
    for (let iter = 0; iter < 220; iter += 1) {
      for (let i = 0; i < nodes.length; i += 1) {
        for (let j = i + 1; j < nodes.length; j += 1) {
          const a = nodes[i], b = nodes[j];
          const dx = b.x - a.x, dy = b.y - a.y;
          const d2 = Math.max(dx * dx + dy * dy, 400);
          const f = 24000 / d2;
          const d = Math.sqrt(d2);
          a.vx -= (dx / d) * f; a.vy -= (dy / d) * f;
          b.vx += (dx / d) * f; b.vy += (dy / d) * f;
        }
      }
      for (const [a, b] of edges) {
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const f = (d - 190) * 0.02;
        a.vx += (dx / d) * f; a.vy += (dy / d) * f;
        b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
      }
      for (const n of nodes) {
        n.vx += (W / 2 - n.x) * 0.0012; n.vy += (H / 2 - n.y) * 0.0012;
        n.x += Math.max(-14, Math.min(14, n.vx)); n.y += Math.max(-14, Math.min(14, n.vy));
        n.vx *= 0.82; n.vy *= 0.82;
      }
    }
    layoutRef.current = { nodes, edges };
    viewRef.current = { k: 1, tx: 0, ty: 0 };
    draw(null);
  }, [graph, draw]);

  // 滚轮缩放（native 非被动监听——React 根上的 wheel 是被动的，preventDefault 无效）
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const px = (ev.clientX - rect.left) * 2, py = (ev.clientY - rect.top) * 2;
      const { k, tx, ty } = viewRef.current;
      const nk = Math.max(MIN_K, Math.min(MAX_K, k * (ev.deltaY < 0 ? 1.12 : 0.89)));
      viewRef.current.tx = px - ((px - tx) * nk) / k;
      viewRef.current.ty = py - ((py - ty) * nk) / k;
      viewRef.current.k = nk;
      draw(hoverRef.current);
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [draw]);

  // 高亮切换重绘
  useEffect(() => { draw(hoverRef.current); }, [highlightCat, draw]);

  const toWorld = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const { k, tx, ty } = viewRef.current;
    return { x: ((clientX - rect.left) * 2 - tx) / k, y: ((clientY - rect.top) * 2 - ty) / k };
  }, []);

  const pickNode = useCallback((clientX: number, clientY: number): GraphNode | null => {
    const p = toWorld(clientX, clientY);
    const layout = layoutRef.current;
    const { k } = viewRef.current;
    if (!p || !layout) return null;
    let best: GraphNode | null = null;
    let bestD = Infinity;
    for (const n of layout.nodes) {
      const r = Math.max(n.e.cat === "总览" ? 18 : 8 + Math.min(n.deg, 20) * 0.5, 12 / k);
      const d = (n.x - p.x) ** 2 + (n.y - p.y) ** 2;
      if (d <= r * r && d < bestD) { best = n; bestD = d; }
    }
    return best;
  }, [toWorld]);

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
      {/* 分类图例：点击高亮该类（其余淡化），再点取消 */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", padding: "8px 12px", borderBottom: "1px solid var(--border)", alignItems: "center" }}>
        {cats.map(([c, count]) => {
          const on = highlightCat === c;
          return (
            <button
              key={c}
              type="button"
              onClick={() => setHighlightCat(on ? null : c)}
              style={{
                display: "flex", alignItems: "center", gap: 6, padding: "2px 10px", borderRadius: 999, fontSize: 11,
                border: `1px solid ${on ? catColor(c) : "var(--border)"}`,
                background: on ? `${catColor(c)}22` : "transparent",
                color: on ? catColor(c) : "var(--text-muted)",
                cursor: "pointer",
              }}
            >
              <span style={{ width: 8, height: 8, borderRadius: 999, background: catColor(c), display: "inline-block" }} />
              {c} · {count}
            </button>
          );
        })}
        {highlightCat && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>已高亮「{highlightCat}」— 再点图例取消</span>}
      </div>
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: "62vh", display: "block", touchAction: "none", cursor: "grab" }}
        onPointerDown={(ev) => {
          const hit = pickNode(ev.clientX, ev.clientY);
          if (hit) {
            const p = toWorld(ev.clientX, ev.clientY);
            if (p) dragRef.current = { type: "node", n: hit, ox: p.x - hit.x, oy: p.y - hit.y, moved: false };
          } else {
            const { tx, ty } = viewRef.current;
            dragRef.current = { type: "pan", sx: ev.clientX, sy: ev.clientY, tx0: tx, ty0: ty, moved: false };
          }
          try { canvasRef.current?.setPointerCapture(ev.pointerId); } catch { /* 捕获失败照走 */ }
        }}
        onPointerMove={(ev) => {
          const drag = dragRef.current;
          if (!drag) {
            const hit = pickNode(ev.clientX, ev.clientY);
            const id = hit?.e.id ?? null;
            if (id !== hoverRef.current) {
              hoverRef.current = id;
              draw(id);
              if (canvasRef.current) canvasRef.current.style.cursor = id ? "pointer" : "grab";
            }
            return;
          }
          if (drag.type === "pan") {
            const dx = ev.clientX - drag.sx, dy = ev.clientY - drag.sy;
            if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
            viewRef.current.tx = drag.tx0 + dx * 2;
            viewRef.current.ty = drag.ty0 + dy * 2;
            if (drag.moved) {
              if (canvasRef.current) canvasRef.current.style.cursor = "grabbing";
              draw(null);
            }
            return;
          }
          const p = toWorld(ev.clientX, ev.clientY);
          if (!p) return;
          drag.moved = true;
          drag.n.x = p.x - drag.ox;
          drag.n.y = p.y - drag.oy;
          if (canvasRef.current) canvasRef.current.style.cursor = "grabbing";
          draw(null);
        }}
        onPointerUp={() => {
          const drag = dragRef.current;
          dragRef.current = null;
          if (canvasRef.current) canvasRef.current.style.cursor = "grab";
          // 节点原地点击（未拖动）→ 开词条
          if (drag?.type === "node" && !drag.moved) onOpen(drag.n.e);
        }}
        onPointerLeave={() => {
          if (!dragRef.current) { hoverRef.current = null; draw(null); }
        }}
        onDoubleClick={() => { viewRef.current = { k: 1, tx: 0, ty: 0 }; draw(null); }}
      />
      <div style={{ padding: "8px 12px", fontSize: 12, color: "var(--text-muted)", borderTop: "1px solid var(--border)" }}>
        {graph.entries.length} 词条 · {graph.relations.length} 关系边 · hover 高亮邻域 · 拖节点/拖画布/滚轮缩放 · 双击复位 · 点节点打开词条 · 图例点击按分类高亮
      </div>
    </div>
  );
}

export function WorldbookPage({ onBack }: { onBack?: () => void }) {
  const [graph, setGraph] = useState<WbGraph | null>(null);
  const [loadError, setLoadError] = useState("");
  const [cat, setCat] = useState<string>("全部");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [entry, setEntry] = useState<{ path: string; title: string; content: string } | null>(null);
  const [mode, setMode] = useState<"cards" | "graph">("cards");
  const byTitle = useMemo(() => new Map((graph?.entries ?? []).map((e) => [e.title, e])), [graph]);

  useEffect(() => {
    fetch("/api/kit/worldbook-graph")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((g: WbGraph) => setGraph(g))
      .catch((e) => setLoadError(`图谱数据不可达：${e}`));
  }, []);

  const cats = useMemo(() => {
    if (!graph) return [];
    const m = new Map<string, number>();
    for (const e of graph.entries) m.set(e.cat, (m.get(e.cat) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [graph]);

  const visible = useMemo(() => {
    if (!graph) return [];
    const word = query.trim();
    const list = cat === "全部" ? graph.entries : graph.entries.filter((e) => e.cat === cat);
    if (!word) return list;
    return list.filter((e) =>
      e.title.includes(word) || e.tags.some((t) => t.includes(word)) || (e.summary ?? "").includes(word),
    );
  }, [graph, cat, query]);

  /** 引用解析兜底（pedia 对齐）：全路径 → .md 尾段 → 标题 → id；关联/RAG 带来的裸引用都能开卡。 */
  const resolveEntry = useCallback((ref: string): WbEntry | null => {
    if (!graph) return null;
    const bare = ref.replace(/\.md$/i, "");
    return (
      graph.entries.find((e) => e.path === ref || e.path === `${ref}.md` || e.id === ref) ??
      graph.entries.find((e) => e.title === bare || e.id === bare) ??
      graph.entries.find((e) => e.path.endsWith(`/${bare}.md`) || e.path.endsWith(`/${bare}`)) ??
      null
    );
  }, [graph]);

  const fetchEntry = useCallback((ref: string, title: string) => {
    const ent = resolveEntry(ref);
    const path = ent?.path ?? ref;
    fetch(`/api/kit/entry?path=${encodeURIComponent(path)}`)
      .then((r) => r.json())
      .then((body: { path: string; content?: string }) => {
        const content = typeof body.content === "string" && body.content.length > 0
          ? body.content
          : `（找不到词条内容：${ent ? path : `${title || ref}——引用解析不中`}）`;
        setEntry({ path, title: ent?.title ?? title, content });
      })
      .catch(() => setEntry({ path, title: ent?.title ?? title, content: "（读取失败）" }));
  }, [resolveEntry]);
  const openEntry = useCallback((e: WbEntry) => fetchEntry(e.path, e.title), [fetchEntry]);

  const runSearch = useCallback(() => {
    const word = query.trim();
    if (!word) return;
    setSearching(true);
    setEntry(null);
    fetch(`/api/kit/worldbook?q=${encodeURIComponent(word)}`)
      .then((r) => r.json())
      .then((body: { hits?: Hit[] }) => setHits(body.hits ?? []))
      .catch(() => setHits([]))
      .finally(() => setSearching(false));
  }, []);

  const labelStyle: React.CSSProperties = { fontSize: 12, color: "var(--text-muted)" };
  const chipStyle = (on: boolean): React.CSSProperties => ({
    padding: "3px 10px", borderRadius: 999, fontSize: 12, cursor: "pointer",
    border: `1px solid ${on ? ACCENT : "var(--border)"}`,
    background: on ? "var(--bg-selected)" : "transparent",
    color: on ? ACCENT : "var(--text-muted)",
    whiteSpace: "nowrap",
  });

  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 150, background: "var(--bg)", display: "flex", flexDirection: "column" }}>
      {/* 顶栏：标题 + RAG 检索 + 视图切换 */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        {onBack && (
          <button type="button" onClick={onBack} title="返回工作台" style={{ padding: "6px 10px", border: "1px solid var(--border)", borderRadius: 8, background: "transparent", color: "var(--text-muted)", cursor: "pointer", fontSize: 12, whiteSpace: "nowrap" }}>
            ← 返回工作台
          </button>
        )}
        <b style={{ fontSize: 15, letterSpacing: 2, whiteSpace: "nowrap" }}>📖 世界书</b>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") runSearch(); }}
          placeholder="RAG 检索：人物 / 绰号 / 地标 / 规则…（词面打分 + 一跳图扩展）"
          style={{ flex: 1, minWidth: 0, padding: "7px 12px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg-panel, #fff)", color: "var(--text)", fontSize: 13, fontFamily: "inherit" }}
        />
        <button type="button" onClick={runSearch} disabled={searching} style={{ padding: "7px 16px", border: `1px solid ${ACCENT}`, borderRadius: 8, background: ACCENT, color: "#fff", cursor: searching ? "wait" : "pointer", fontSize: 13, whiteSpace: "nowrap" }}>
          {searching ? "检索中…" : "检索"}
        </button>
        <div style={{ display: "flex", gap: 4 }}>
          <button type="button" onClick={() => { setMode("cards"); setHits(null); }} style={chipStyle(mode === "cards")}>词条</button>
          <button type="button" onClick={() => { setMode("graph"); setHits(null); }} style={chipStyle(mode === "graph")}>图谱</button>
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {/* 左栏：分类树 */}
        <div style={{ width: 170, flexShrink: 0, borderRight: "1px solid var(--border)", overflow: "auto", padding: "10px 8px", display: "flex", flexDirection: "column", gap: 2 }}>
          <div style={{ ...labelStyle, padding: "4px 8px" }}>分类</div>
          <button type="button" onClick={() => setCat("全部")} style={{ ...chipStyle(cat === "全部"), textAlign: "left", borderRadius: 6 }}>
            全部{graph ? ` · ${graph.entries.length}` : ""}
          </button>
          {cats.map(([c, n]) => (
            <button key={c} type="button" onClick={() => setCat(c)} style={{ ...chipStyle(cat === c), textAlign: "left", borderRadius: 6 }}>
              {c} · {n}
            </button>
          ))}
        </div>

        {/* 主区 */}
        <div style={{ flex: 1, minWidth: 0, overflow: "auto", padding: 14 }}>
          {loadError && <div style={{ color: "var(--text-muted)", padding: 20 }}>{loadError}</div>}
          {!graph && !loadError && <div style={labelStyle}>装载图谱数据…</div>}

          {/* RAG 检索结果（词条打开时让位给阅读视图） */}
          {hits && !entry && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>检索结果 · {hits.length} 命中</div>
              {hits.length === 0 && <div style={labelStyle}>（无命中——试试更短的词）</div>}
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {hits.slice(0, 12).map((hit, i) => (
                  <div key={i} style={{ border: "1px solid var(--border)", borderLeft: `3px solid ${ACCENT}`, borderRadius: 8, padding: "8px 12px" }}>
                    <b style={{ fontSize: 13 }}>{hit.title ?? "（无题）"}</b>
                    {hit.summary && <div style={{ ...labelStyle, marginTop: 4, lineHeight: 1.6 }}>{hit.summary}</div>}
                    {hit.path && (
                      <button
                        type="button"
                        onClick={() => fetchEntry(hit.path!, hit.title ?? "词条")}
                        style={{ marginTop: 6, padding: "3px 10px", border: `1px solid ${ACCENT}`, borderRadius: 6, background: "transparent", color: ACCENT, cursor: "pointer", fontSize: 11 }}
                      >
                        读卡片全文
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 词条详情 · wiki 形态（frontmatter 结构化 + markdown 正文 + 关联词条原地跳转） */}
          {entry && (() => {
            const fm = parseFrontmatter(entry.content);
            const meta = (fm.data ?? {}) as { title?: string; cat?: string; tags?: string[]; links?: string[]; summary?: string };
            const body = fm.rest.replace(/^#[^\n]*\n/, ""); // 正文渲染自标题行之后（标题已在页头）
            const tags = Array.isArray(meta.tags) ? meta.tags : [];
            const linkEntries = (Array.isArray(meta.links) ? meta.links : [])
              .map((t) => byTitle.get(t))
              .filter((e): e is WbEntry => Boolean(e));
            const catColorOfMeta = meta.cat ? catColor(meta.cat) : ACCENT;
            return (
              <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: "18px 22px", marginBottom: 16, background: "var(--bg-panel, transparent)", maxWidth: 980 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
                  <b style={{ fontSize: 24, letterSpacing: 2 }}>{meta.title ?? entry.title}</b>
                  {meta.cat && <span style={{ padding: "2px 10px", borderRadius: 999, fontSize: 11, border: `1px solid ${catColorOfMeta}`, color: catColorOfMeta }}>{meta.cat}</span>}
                  <span style={{ flex: 1 }} />
                  <button type="button" onClick={() => setEntry(null)} style={{ ...chipStyle(false), borderRadius: 6 }}>← 返回</button>
                </div>
                {tags.length > 0 && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
                    {tags.map((t) => (
                      <span key={t} style={{ padding: "2px 8px", borderRadius: 6, fontSize: 11, background: "var(--bg-selected)", color: "var(--text-muted)" }}>{t}</span>
                    ))}
                  </div>
                )}
                {meta.summary && (
                  <div style={{ marginTop: 10, fontSize: 13, color: "var(--text)", lineHeight: 1.7, borderLeft: `3px solid ${catColorOfMeta}`, paddingLeft: 10 }}>
                    {meta.summary}
                  </div>
                )}
                <div className="markdown-body" style={{ marginTop: 14, fontSize: 14, lineHeight: 1.9 }}>
                  <ReactMarkdown
                    remarkPlugins={markdownPreviewRemarkPlugins}
                    rehypePlugins={markdownPreviewRehypePlugins}
                    urlTransform={markdownUrlTransform}
                  >
                    {body}
                  </ReactMarkdown>
                </div>
                {linkEntries.length > 0 && (
                  <div style={{ marginTop: 16, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
                    <div style={{ ...labelStyle, marginBottom: 6 }}>关联词条 · {linkEntries.length}（点击在本页打开）</div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {linkEntries.map((e) => (
                        <button
                          key={e.id}
                          type="button"
                          onClick={() => openEntry(e)}
                          title={`${e.cat} · ${e.summary?.slice(0, 60) ?? ""}`}
                          style={{ display: "flex", alignItems: "center", gap: 5, padding: "3px 10px", borderRadius: 6, fontSize: 11, border: `1px solid ${catColorOf(e)}66`, background: "transparent", color: "var(--text)", cursor: "pointer" }}
                        >
                          <span style={{ width: 7, height: 7, borderRadius: 999, background: catColorOf(e), display: "inline-block" }} />
                          {e.title}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div style={{ ...labelStyle, marginTop: 12, fontSize: 11 }}>{entry.path}</div>
              </div>
            );
          })()}

          {/* 词条卡墙（词条打开时让位） */}
          {mode === "cards" && graph && !entry && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 10 }}>
              {visible.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => openEntry(e)}
                  style={{ textAlign: "left", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px", background: "var(--bg-panel, transparent)", cursor: "pointer", color: "var(--text)" }}
                >
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                    <b style={{ fontSize: 14 }}>{e.title}</b>
                    <span style={{ fontSize: 11, color: catColorOf(e) }}>{e.cat}</span>
                  </div>
                  <div style={{ ...labelStyle, marginTop: 4, lineHeight: 1.6, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                    {e.tags.join(" · ")}
                  </div>
                  <div style={{ ...labelStyle, marginTop: 6, fontSize: 11 }}>关联 {e.links.length} 条</div>
                </button>
              ))}
            </div>
          )}

          {/* 关系图谱（pedia 交互：拖拽/平移/缩放/名称/图例高亮） */}
          {mode === "graph" && graph && <WorldbookGraph graph={graph} onOpen={openEntry} />}
        </div>
      </div>
    </div>
  );
}
