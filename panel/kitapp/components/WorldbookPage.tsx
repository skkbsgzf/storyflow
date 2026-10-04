"use client";

/** 世界书专有页（工单-20261002 批2）：主内容区整页视图。
 *  左=分类树，中=词条卡墙/图谱/详情，顶=全局 RAG 检索。
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

export function WorldbookPage({ onBack }: { onBack?: () => void }) {
  const [graph, setGraph] = useState<WbGraph | null>(null);
  const [loadError, setLoadError] = useState("");
  const [cat, setCat] = useState<string>("全部");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [entry, setEntry] = useState<{ path: string; title: string; content: string } | null>(null);
  const byTitle = useMemo(() => new Map((graph?.entries ?? []).map((e) => [e.title, e])), [graph]);
  const [mode, setMode] = useState<"cards" | "graph">("cards");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const graphLayoutRef = useRef<{
    nodes: { e: WbEntry; x: number; y: number; vx: number; vy: number }[];
    edges: readonly (readonly [{ e: WbEntry; x: number; y: number; vx: number; vy: number }, { e: WbEntry; x: number; y: number; vx: number; vy: number }])[];
    byId: Map<string, WbEntry>;
  } | null>(null);

  /** 绘制：hover 时高亮该节点邻域（邻边 + 邻点全亮，其余淡化）。 */
  interface GraphNode { e: WbEntry; x: number; y: number; vx?: number; vy?: number }
  const drawGraph = (
    canvas: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D,
    nodes: GraphNode[],
    edges: readonly (readonly [GraphNode, GraphNode])[],
    hoverId: string | null,
  ) => {
    const W = canvas.width, H = canvas.height;
    const neighborIds = new Set<string>();
    if (hoverId) {
      neighborIds.add(hoverId);
      for (const pair of edges) {
        const a = pair[0]!, b = pair[1]!;
        if (a.e.id === hoverId) neighborIds.add(b.e.id);
        if (b.e.id === hoverId) neighborIds.add(a.e.id);
      }
    }
    const dim = hoverId ? 0.14 : 1;
    ctx.clearRect(0, 0, W, H);
    ctx.lineWidth = 1.4;
    for (const pair of edges) {
      const a = pair[0]!, b = pair[1]!;
      const on = !hoverId || (a.e.id === hoverId || b.e.id === hoverId);
      ctx.strokeStyle = on ? "rgba(138,131,117,0.5)" : `rgba(138,131,117,${0.35 * dim})`;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    for (const n of nodes) {
      const on = !hoverId || neighborIds.has(n.e.id);
      const r = n.e.cat === "总览" ? 14 : 7;
      ctx.globalAlpha = on ? 1 : dim;
      ctx.beginPath();
      ctx.arc(n.x, n.y, r * 2, 0, Math.PI * 2);
      ctx.fillStyle = catColorOf(n.e);
      ctx.fill();
      if (hoverId && n.e.id === hoverId) {
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 3;
        ctx.stroke();
      }
      if (n.e.cat !== "总览") { ctx.globalAlpha = 1; continue; }
      ctx.fillStyle = "#2c2824";
      ctx.font = "bold 26px 'Noto Serif SC', serif";
      ctx.textAlign = "center";
      ctx.fillText(n.e.title, n.x, n.y - 24);
      ctx.globalAlpha = 1;
    }
  };

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

  const fetchEntry = useCallback((path: string, title: string) => {
    fetch(`/api/kit/entry?path=${encodeURIComponent(path)}`)
      .then((r) => r.json())
      .then((body: { path: string; content: string }) => setEntry({ ...body, title }))
      .catch(() => setEntry({ path, title, content: "（读取失败）" }));
  }, []);
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

  // ── 关系图谱（canvas 力导向简化版：分类着色 + 邻域高亮） ──
  useEffect(() => {
    if (mode !== "graph" || !graph || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const W = canvas.width = canvas.clientWidth * 2;
    const H = canvas.height = canvas.clientHeight * 2;
    const byId = new Map(graph.entries.map((e) => [e.id, e]));
    const palette: Record<string, string> = {
      "人物": "#c96f4a", "地点": "#5b7fa6", "势力": "#8a6fb0", "规则": "#5f9c7a",
      "总览": "#b09a5f", "物品": "#a06a8a", "事件": "#6a9aa0",
    };
    const colorOf = (e: WbEntry) => palette[e.cat] ?? "#8a8375";
    // 初始环形布局 + 简易斥力迭代
    const nodes = graph.entries.map((e, i) => ({
      e,
      x: W / 2 + Math.cos((i / graph.entries.length) * Math.PI * 2) * W * 0.36,
      y: H / 2 + Math.sin((i / graph.entries.length) * Math.PI * 2) * H * 0.36,
      vx: 0, vy: 0,
    }));
    const idx = new Map(nodes.map((n) => [n.e.id, n]));
    const edges = graph.relations
      .map((r) => [idx.get(r.a), idx.get(r.b)] as const)
      .filter((pair): pair is readonly [NonNullable<ReturnType<typeof idx.get>>, NonNullable<ReturnType<typeof idx.get>>] => pair[0] !== undefined && pair[1] !== undefined);
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
    // 布局结果与邻接缓存到 ref，供 hover/点击交互复用
    graphLayoutRef.current = { nodes, edges, byId };
    drawGraph(canvas, ctx, nodes, edges, null);
  }, [mode, graph]);

  // 交互：hover 高亮邻域 / 点击节点开词条（坐标换算 ×2 = canvas 内部分辨率）
  const graphHoverRef = useRef<string | null>(null);
  const redrawWithHighlight = useCallback((hoverId: string | null) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const layout = graphLayoutRef.current;
    if (!canvas || !ctx || !layout) return;
    drawGraph(canvas, ctx, layout.nodes, layout.edges, hoverId);
  }, []);

  const onCanvasMove = useCallback((ev: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const layout = graphLayoutRef.current;
    if (!canvas || !layout) return;
    const rect = canvas.getBoundingClientRect();
    const x = (ev.clientX - rect.left) * 2;
    const y = (ev.clientY - rect.top) * 2;
    let hit: string | null = null;
    for (const n of layout.nodes) {
      const r = n.e.cat === "总览" ? 28 : 16;
      if ((n.x - x) ** 2 + (n.y - y) ** 2 <= r * r) { hit = n.e.id; break; }
    }
    if (hit !== graphHoverRef.current) {
      graphHoverRef.current = hit;
      redrawWithHighlight(hit);
      canvas.style.cursor = hit ? "pointer" : "default";
    }
  }, [redrawWithHighlight]);

  const onCanvasClick = useCallback(() => {
    const hover = graphHoverRef.current;
    const layout = graphLayoutRef.current;
    if (!hover || !layout) return;
    const node = layout.nodes.find((n) => n.e.id === hover);
    if (node) openEntry(node.e);
  }, [openEntry]);

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

          {/* 词条详情 · wiki 形态（frontmatter 结构化 + markdown 正文 + 关联词条） */}
          {entry && (() => {
            const fm = parseFrontmatter(entry.content);
            const meta = (fm.data ?? {}) as { title?: string; cat?: string; tags?: string[]; links?: string[]; summary?: string };
            const body = fm.rest.replace(/^#[^\n]*\n/, ""); // 正文渲染自标题行之后（标题已在页头）
            const graphEntry = byTitle.get(meta.title ?? entry.title);
            const tags = Array.isArray(meta.tags) ? meta.tags : [];
            const linkTitles = (Array.isArray(meta.links) ? meta.links : []).filter((t) => byTitle.has(t));
            return (
              <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: "18px 22px", marginBottom: 16, background: "var(--bg-panel, transparent)", maxWidth: 980 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
                  <b style={{ fontSize: 24, letterSpacing: 2 }}>{meta.title ?? entry.title}</b>
                  {meta.cat && <span style={{ padding: "2px 10px", borderRadius: 999, fontSize: 11, border: `1px solid ${ACCENT}`, color: ACCENT }}>{meta.cat}</span>}
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
                  <div style={{ marginTop: 10, fontSize: 13, color: "var(--text)", lineHeight: 1.7, borderLeft: `3px solid ${ACCENT}`, paddingLeft: 10 }}>
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
                {linkTitles.length > 0 && (
                  <div style={{ marginTop: 16, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
                    <div style={{ ...labelStyle, marginBottom: 6 }}>关联词条 · {linkTitles.length}</div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {linkTitles.map((t) => (
                        <button key={t} type="button" onClick={() => { const target = byTitle.get(t); if (target) openEntry(target); }} style={{ ...chipStyle(false), borderRadius: 6 }}>
                          {t} ↗
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
                    <span style={{ fontSize: 11, color: ACCENT }}>{e.cat}</span>
                  </div>
                  <div style={{ ...labelStyle, marginTop: 4, lineHeight: 1.6, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                    {e.tags.join(" · ")}
                  </div>
                  <div style={{ ...labelStyle, marginTop: 6, fontSize: 11 }}>关联 {e.links.length} 条</div>
                </button>
              ))}
            </div>
          )}

          {/* 关系图谱 */}
          {mode === "graph" && graph && (
            <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
              <canvas
                ref={canvasRef}
                style={{ width: "100%", height: "62vh", display: "block" }}
                onMouseMove={onCanvasMove}
                onMouseLeave={() => { graphHoverRef.current = null; redrawWithHighlight(null); }}
                onClick={onCanvasClick}
              />
              <div style={{ padding: "8px 12px", ...labelStyle, borderTop: "1px solid var(--border)" }}>
                {graph.entries.length} 词条 · {graph.relations.length} 关系边 · 分类着色（人物/地点/势力/规则…）
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
