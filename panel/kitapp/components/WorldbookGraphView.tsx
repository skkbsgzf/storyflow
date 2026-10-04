"use client";

/** 世界书关系图谱视图（批A 从 WorldbookPage 抽出）：力导向布局 + hover 邻域高亮 + 点击开词条。 */
import { useCallback, useEffect, useRef } from "react";
import { catColorOf, fetchWbGraph, type WbEntry } from "@/lib/worldbook-data";

interface GraphNode { e: WbEntry; x: number; y: number; vx: number; vy: number }
type GraphEdge = readonly [GraphNode, GraphNode];

export function WorldbookGraphView({
  onOpenEntry,
}: {
  onOpenEntry?: (path: string, title: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const layoutRef = useRef<{ nodes: GraphNode[]; edges: GraphEdge[] } | null>(null);
  const hoverRef = useRef<string | null>(null);
  const layoutReadyRef = useRef(false);

  const draw = useCallback((hoverId: string | null) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const layout = layoutRef.current;
    if (!canvas || !ctx || !layout) return;
    const { nodes, edges } = layout;
    const neighbors = new Set<string>();
    if (hoverId) {
      neighbors.add(hoverId);
      for (const [a, b] of edges) {
        if (a.e.id === hoverId) neighbors.add(b.e.id);
        if (b.e.id === hoverId) neighbors.add(a.e.id);
      }
    }
    const dim = hoverId ? 0.14 : 1;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = 1.4;
    for (const [a, b] of edges) {
      const on = !hoverId || a.e.id === hoverId || b.e.id === hoverId;
      ctx.strokeStyle = on ? "rgba(138,131,117,0.5)" : `rgba(138,131,117,${0.35 * dim})`;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    for (const n of nodes) {
      const on = !hoverId || neighbors.has(n.e.id);
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
        const nodes = graph.entries.map((e, i) => ({
          e,
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
        layoutReadyRef.current = true;
        draw(null);
      })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [draw]);

  const pickNode = useCallback((ev: React.MouseEvent<HTMLCanvasElement>): string | null => {
    const canvas = canvasRef.current;
    const layout = layoutRef.current;
    if (!canvas || !layout) return null;
    const rect = canvas.getBoundingClientRect();
    const x = (ev.clientX - rect.left) * 2;
    const y = (ev.clientY - rect.top) * 2;
    for (const n of layout.nodes) {
      const r = n.e.cat === "总览" ? 28 : 16;
      if ((n.x - x) ** 2 + (n.y - y) ** 2 <= r * r) return n.e.id;
    }
    return null;
  }, []);

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", height: "100%", display: "flex", flexDirection: "column" }}>
      <canvas
        ref={canvasRef}
        style={{ width: "100%", flex: 1, display: "block" }}
        onMouseMove={(ev) => {
          const hit = pickNode(ev);
          if (hit !== hoverRef.current) {
            hoverRef.current = hit;
            draw(hit);
            canvasRef.current!.style.cursor = hit ? "pointer" : "default";
          }
        }}
        onMouseLeave={() => {
          hoverRef.current = null;
          draw(null);
        }}
        onClick={() => {
          const hover = hoverRef.current;
          const layout = layoutRef.current;
          if (!hover || !layout || !onOpenEntry) return;
          const node = layout.nodes.find((n) => n.e.id === hover);
          if (node) onOpenEntry(node.e.path, node.e.title);
        }}
      />
      <div style={{ padding: "8px 12px", fontSize: 12, color: "var(--text-muted)", borderTop: "1px solid var(--border)" }}>
        hover 高亮邻域 · 点击节点打开词条
      </div>
    </div>
  );
}
