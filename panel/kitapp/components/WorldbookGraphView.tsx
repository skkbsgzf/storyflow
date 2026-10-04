"use client";

/** 世界书关系图谱视图（批A 抽出；2026-10-05 对齐 pedia 交互）：
 *  力导向布局 + hover 邻域高亮 + 节点拖拽 + 画布平移 + 滚轮缩放 + 节点名称
 *  + 度数定半径 + 分类图例（点击高亮该类、其余淡化）+ 双击复位 + 点击开词条。 */
import { useCallback, useEffect, useRef, useState } from "react";
import { CAT_PALETTE, catColorOf, fetchWbGraph, type WbEntry } from "@/lib/worldbook-data";

interface GraphNode { e: WbEntry; x: number; y: number; vx: number; vy: number; deg: number }
type GraphEdge = readonly [GraphNode, GraphNode];
interface ViewTx { k: number; tx: number; ty: number }

const MIN_K = 0.35;
const MAX_K = 3;
const catColor = (cat: string): string => CAT_PALETTE[cat] ?? "#8a8375";

export function WorldbookGraphView({
  onOpenEntry,
}: {
  onOpenEntry?: (path: string, title: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const layoutRef = useRef<{ nodes: GraphNode[]; edges: GraphEdge[] } | null>(null);
  const hoverRef = useRef<string | null>(null);
  const viewRef = useRef<ViewTx>({ k: 1, tx: 0, ty: 0 });
  const dragRef = useRef<
    | { type: "node"; n: GraphNode; ox: number; oy: number; moved: boolean }
    | { type: "pan"; sx: number; sy: number; tx0: number; ty0: number; moved: boolean }
    | null
  >(null);
  const [highlightCat, setHighlightCat] = useState<string | null>(null);
  const [cats, setCats] = useState<{ cat: string; count: number }[]>([]);
  const [ready, setReady] = useState(false);
  // 事件回调里要读到最新高亮态
  const highlightRef = useRef<string | null>(null);
  highlightRef.current = highlightCat;

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
    // 淡化优先级：hover 邻域 > 分类高亮 > 无
    const dimOthers = (id: string): number => {
      if (hoverId) return neighbors.has(id) ? 1 : 0.14;
      if (hl) return nodes.find((n) => n.e.id === id)?.e.cat === hl ? 1 : 0.16;
      return 1;
    };
    ctx.lineWidth = 1.4;
    for (const [a, b] of edges) {
      const on = !hoverId && !hl ? 1 : Math.min(dimOthers(a.e.id), dimOthers(b.e.id));
      ctx.strokeStyle = on === 1 ? "rgba(138,131,117,0.5)" : `rgba(138,131,117,${0.35 * on})`;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    // 名称显隐：枢纽与总览常显，放大后全显
    const labelAll = k >= 1.2;
    for (const n of nodes) {
      const alpha = dimOthers(n.e.id);
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
      const showLabel = n.e.cat === "总览" || labelAll || n.deg >= 5;
      if (showLabel) {
        ctx.font = `${n.e.cat === "总览" ? 15 / k : 22 / k}px 'Noto Serif SC', serif`;
        ctx.textAlign = "center";
        ctx.fillStyle = "rgba(200,195,185,0.92)";
        ctx.fillText(n.e.title, n.x, n.y - r - 6 / k);
      }
      ctx.globalAlpha = 1;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }, []);

  useEffect(() => {
    let alive = true;
    fetchWbGraph()
      .then((graph) => {
        if (!alive || !canvasRef.current) return;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const W = canvas.width = canvas.clientWidth * 2;
        const H = canvas.height = canvas.clientHeight * 2;
        const deg: Record<string, number> = {};
        for (const r of graph.relations) { deg[r.a] = (deg[r.a] ?? 0) + 1; deg[r.b] = (deg[r.b] ?? 0) + 1; }
        const nodes = graph.entries.map((e, i) => ({
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
        const counts = new Map<string, number>();
        for (const n of nodes) counts.set(n.e.cat, (counts.get(n.e.cat) ?? 0) + 1);
        setCats([...counts.entries()].map(([cat, count]) => ({ cat, count })).sort((a, b) => b.count - a.count));
        setReady(true);
        draw(null);
      })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [draw]);

  // 高亮切换重绘
  useEffect(() => { if (ready) draw(hoverRef.current); }, [highlightCat, ready, draw]);

  const toWorld = useCallback((clientX: number, clientY: number): { x: number; y: number } | null => {
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
    <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", height: "100%", display: "flex", flexDirection: "column" }}>
      {/* 分类图例：点击高亮该类（其余淡化），再点取消 */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", padding: "8px 12px", borderBottom: "1px solid var(--border)", alignItems: "center" }}>
        {cats.map(({ cat, count }) => {
          const on = highlightCat === cat;
          return (
            <button
              key={cat}
              type="button"
              onClick={() => setHighlightCat(on ? null : cat)}
              style={{
                display: "flex", alignItems: "center", gap: 6, padding: "2px 10px", borderRadius: 999, fontSize: 11,
                border: `1px solid ${on ? catColor(cat) : "var(--border)"}`,
                background: on ? `${catColor(cat)}22` : "transparent",
                color: on ? catColor(cat) : "var(--text-muted)",
                cursor: "pointer",
              }}
            >
              <span style={{ width: 8, height: 8, borderRadius: 999, background: catColor(cat), display: "inline-block" }} />
              {cat} · {count}
            </button>
          );
        })}
        {highlightCat && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>已高亮「{highlightCat}」— 再点图例取消</span>}
      </div>
      <canvas
        ref={canvasRef}
        style={{ width: "100%", flex: 1, display: "block", touchAction: "none", cursor: "grab" }}
        onPointerDown={(ev) => {
          const hit = pickNode(ev.clientX, ev.clientY);
          const canvas = canvasRef.current;
          if (hit) {
            const p = toWorld(ev.clientX, ev.clientY);
            if (p) dragRef.current = { type: "node", n: hit, ox: p.x - hit.x, oy: p.y - hit.y, moved: false };
          } else {
            const { tx, ty } = viewRef.current;
            dragRef.current = { type: "pan", sx: ev.clientX, sy: ev.clientY, tx0: tx, ty0: ty, moved: false };
          }
          try { canvas?.setPointerCapture(ev.pointerId); } catch { /* 捕获失败照走 */ }
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
        onPointerUp={(ev) => {
          const drag = dragRef.current;
          dragRef.current = null;
          if (canvasRef.current) canvasRef.current.style.cursor = "grab";
          // 节点原地点击（未拖动）→ 开词条
          if (drag?.type === "node" && !drag.moved && onOpenEntry) {
            onOpenEntry(drag.n.e.path, drag.n.e.title);
          }
          void ev;
        }}
        onPointerLeave={() => {
          if (!dragRef.current) { hoverRef.current = null; draw(null); }
        }}
        onDoubleClick={() => { viewRef.current = { k: 1, tx: 0, ty: 0 }; draw(null); }}
        onWheel={(ev) => {
          ev.preventDefault();
          const canvas = canvasRef.current;
          if (!canvas) return;
          const rect = canvas.getBoundingClientRect();
          const px = (ev.clientX - rect.left) * 2, py = (ev.clientY - rect.top) * 2;
          const { k, tx, ty } = viewRef.current;
          const nk = Math.max(MIN_K, Math.min(MAX_K, k * (ev.deltaY < 0 ? 1.12 : 0.89)));
          viewRef.current.tx = px - ((px - tx) * nk) / k;
          viewRef.current.ty = py - ((py - ty) * nk) / k;
          viewRef.current.k = nk;
          draw(null);
        }}
      />
      <div style={{ padding: "8px 12px", fontSize: 12, color: "var(--text-muted)", borderTop: "1px solid var(--border)" }}>
        hover 高亮邻域 · 拖节点/拖画布/滚轮缩放 · 双击复位 · 点节点打开词条 · 图例点击按分类高亮
      </div>
    </div>
  );
}
