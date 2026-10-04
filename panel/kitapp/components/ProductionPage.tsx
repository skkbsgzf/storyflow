"use client";

/** 生产线 · 工程 map（工单-20261004）：工作流图示化——模块泳道 = 科技树列，
 *  节点卡 = 关键节点（走过/进行中/待走三态），journal submit 时间戳 = 走过路径。
 *  数据经桥路由 /api/kit/production-plan?project=（state ⊕ effective 读模型 ⊕ journal）。 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { KitFlowPlan, KitPlanNode, KitProductionStatus } from "@/mock/kit/client";

interface HubProject { id: string; title?: string }
interface Hub {
  workspace?: string;
  groups?: { name?: string; projects?: HubProject[] }[];
}

const ACCENT = "var(--accent, #a5433a)";
const OK = "#5f9c7a";
const GOLD = "#e8b33d";
const BLUE = "#6ea8fe";
const RED = "#d98a83";
const DIM = "var(--text-dim, #6b7280)";

/** 节点状态 → 视觉语言（科技树三态 + 细分） */
function statusVisual(s: string): { color: string; bg: string; icon: string; label: string } {
  switch (s) {
    case "done": return { color: OK, bg: "rgba(95,156,122,0.10)", icon: "✓", label: "已走过" };
    case "awaiting": return { color: GOLD, bg: "rgba(232,179,61,0.10)", icon: "◐", label: "进行中（待交卷）" };
    case "running": return { color: BLUE, bg: "rgba(110,168,254,0.10)", icon: "◉", label: "执行中" };
    case "pending": return { color: BLUE, bg: "transparent", icon: "○", label: "已派发" };
    case "rejected": return { color: RED, bg: "rgba(217,138,131,0.10)", icon: "✕", label: "被打回" };
    case "stale": return { color: DIM, bg: "transparent", icon: "◌", label: "已失效（重跑）" };
    default: return { color: DIM, bg: "transparent", icon: "○", label: "未走到" };
  }
}

const NODE_W = 208;
const NODE_H = 62;
const ROW_GAP = 16;
const COL_GAP = 46;
const HEAD_H = 56;

export function ProductionPage({ project: projectProp }: { project?: string }) {
  const [status, setStatus] = useState<KitProductionStatus | null>(null);
  const [plan, setPlan] = useState<KitFlowPlan | null>(null);
  const [projects, setProjects] = useState<HubProject[]>([]);
  const [selected, setSelected] = useState<string>(projectProp ?? "");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [selNode, setSelNode] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [s, hub] = await Promise.all([
        fetch("/api/kit/status").then((r) => r.json()) as Promise<KitProductionStatus>,
        fetch("/api/kit/hub").then((r) => r.json()) as Promise<Hub>,
      ]);
      setStatus(s);
      const list = (hub.groups ?? []).flatMap((g) => g.projects ?? []);
      setProjects(list);
      // tab 自带项目（侧栏点入）优先；否则回落批循环当前项目 → 首个
      setSelected((cur) => cur || projectProp || s.project || list[0]?.id || "");
    } catch (e) {
      setNote(`状态不可达：${String((e as Error).message ?? e)}`);
    }
  }, [projectProp]);

  // 地图随选中项目拉取；运行中每 6s 自动重绘（走过路径会推进）
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { if (projectProp) { setSelected(projectProp); setSelNode(null); } }, [projectProp]);
  useEffect(() => {
    if (!selected) return;
    let alive = true;
    const pull = () => fetch(`/api/kit/production-plan?project=${encodeURIComponent(selected)}`)
      .then((r) => r.json()).then((p: KitFlowPlan) => { if (alive) setPlan(p); })
      .catch(() => { if (alive) setPlan(null); });
    void pull();
    const timer = status?.running ? setInterval(pull, 6000) : null;
    return () => { alive = false; if (timer) clearInterval(timer); };
  }, [selected, status?.running]);

  const start = useCallback(async () => {
    if (!selected) return;
    setBusy(true);
    setNote("");
    try {
      await fetch("/api/kit/production-start", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ project: selected }) });
      setNote(`已请求启动 ${selected}（后台批循环；事件见会话/日志）`);
      await refresh();
    } catch (e) {
      setNote(`启动失败：${String((e as Error).message ?? e)}`);
    } finally { setBusy(false); }
  }, [selected, refresh]);

  const stop = useCallback(async () => {
    setBusy(true);
    try {
      await fetch("/api/kit/production-stop", { method: "POST" });
      setNote("已在下一批边界请求停止");
      await refresh();
    } catch (e) {
      setNote(`停止失败：${String((e as Error).message ?? e)}`);
    } finally { setBusy(false); }
  }, [refresh]);

  const running = Boolean(status?.running);
  const sel = plan?.nodes.find((n) => n.id === selNode) ?? null;

  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 300, background: "var(--bg)", display: "flex", flexDirection: "column", overflow: "auto" }}>
      {/* ── 头部：产线身份 + 运行控制 ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderBottom: "1px solid var(--border)", flexShrink: 0, flexWrap: "wrap" }}>
        <b style={{ fontSize: 15, letterSpacing: 2 }}>🏭 生产线</b>
        {plan && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{plan.flow.title}{plan.flow.version ? ` · v${plan.flow.version}` : ""}</span>}
        <span style={{
          padding: "3px 12px", borderRadius: 999, fontSize: 12, fontWeight: 700,
          border: `1px solid ${running ? OK : "var(--border)"}`,
          color: running ? OK : "var(--text-muted)",
        }}>
          {running ? "● 批循环运行中" : "○ 已停止"}
        </span>
        {plan?.flowStatus && plan.flowStatus !== "none" && (
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>流程态 {plan.flowStatus}</span>
        )}
        <span style={{ flex: 1 }} />
        <select
          value={selected}
          onChange={(e) => { setSelected(e.target.value); setSelNode(null); }}
          disabled={running}
          style={{ maxWidth: 300, padding: "7px 10px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg-panel, #fff)", color: "var(--text)", fontSize: 13, fontFamily: "inherit" }}
        >
          <option value="">选择项目…</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.title || p.id}</option>
          ))}
        </select>
        {running ? (
          <button type="button" onClick={() => void stop()} disabled={busy} style={{ padding: "7px 14px", border: "1px solid var(--border)", borderRadius: 8, background: "transparent", color: "var(--text)", cursor: busy ? "wait" : "pointer", fontSize: 13 }}>
            停止（批边界）
          </button>
        ) : (
          <button type="button" onClick={() => void start()} disabled={busy || !selected} style={{ padding: "7px 14px", border: `1px solid ${ACCENT}`, borderRadius: 8, background: ACCENT, color: "#fff", cursor: busy || !selected ? "not-allowed" : "pointer", fontSize: 13, opacity: busy || !selected ? 0.6 : 1 }}>
            启动递归
          </button>
        )}
        <button type="button" onClick={() => void refresh()} style={{ padding: "7px 12px", border: "1px solid var(--border)", borderRadius: 8, background: "transparent", color: "var(--text-muted)", cursor: "pointer", fontSize: 12 }}>刷新</button>
      </div>

      {note && <div style={{ padding: "6px 16px", fontSize: 12, color: "var(--text-muted)" }}>{note}</div>}
      {plan?.lastError && (
        <div style={{ margin: "8px 16px 0", border: "1px solid #b3564d", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: RED }}>
          上次错误：{plan.lastError}
        </div>
      )}

      {/* ── 验收门横幅：门挂起 = 流程停在人这里（红线：门归人裁） ── */}
      {plan?.gate?.verdict === "awaiting" && (
        <div style={{ margin: "10px 16px 0", border: `1px solid ${GOLD}`, borderRadius: 8, padding: "8px 12px", fontSize: 13, color: GOLD, background: "rgba(232,179,61,0.06)" }}>
          ⛨ 验收门挂起 · 节点 <b>{plan.gate.node}</b> 等待人工裁决——流程停在门等人，agent 不代裁。
        </div>
      )}

      {/* ── 节点详情（点击卡片出；置于地图上方，长图不把详情挤出视口） ── */}
      {sel && (
        <div style={{ margin: "10px 16px", border: `1px solid ${ACCENT}`, borderRadius: 10, padding: "12px 14px", flexShrink: 0, background: "var(--bg-panel, transparent)", boxShadow: `0 0 0 2px ${ACCENT}22` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <b style={{ fontSize: 14 }}>{sel.title}</b>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: DIM }}>{sel.id}</span>
            <span style={{ fontSize: 11, padding: "1px 8px", borderRadius: 999, border: `1px solid ${statusVisual(sel.status).color}`, color: statusVisual(sel.status).color }}>
              {statusVisual(sel.status).label}
            </span>
            {sel.gateRole && <span style={{ fontSize: 11, padding: "1px 8px", borderRadius: 999, border: `1px solid ${GOLD}`, color: GOLD }}>门 · {sel.gateRole}</span>}
            <span style={{ flex: 1 }} />
            <button type="button" onClick={() => setSelNode(null)} style={{ border: "none", background: "transparent", color: DIM, cursor: "pointer", fontSize: 13 }}>×</button>
          </div>
          {sel.desc && <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.7, marginBottom: 6 }}>{sel.desc}</div>}
          <div style={{ display: "flex", gap: 18, flexWrap: "wrap", fontSize: 12, color: "var(--text-muted)" }}>
            <span>轮次 {sel.round}</span>
            {sel.failCount > 0 && <span style={{ color: RED }}>打回 {sel.failCount} 次</span>}
            {sel.submits > 0 && <span>交卷 {sel.submits} 次</span>}
            {sel.verdicts > 0 && <span>裁决 {sel.verdicts} 次</span>}
            {sel.at && <span>首次交卷 {sel.at.slice(0, 19).replace("T", " ")}</span>}
            {sel.output && <span style={{ fontFamily: "var(--font-mono)" }}>产物 {sel.output}</span>}
          </div>
        </div>
      )}

      {plan && <PlanMap plan={plan} selNode={selNode} onSelect={setSelNode} />}

      {/* ── 底注：原始盘面（折叠） + 机制说明 ── */}
      <div style={{ padding: "6px 16px 16px", display: "flex", flexDirection: "column", gap: 8, flexShrink: 0 }}>
        {plan?.degraded && <div style={{ fontSize: 12, color: DIM }}>⚠ 节点元数据降级（registry/effective.json 不可得且内核未响应）——图谱只含状态，不含门/产物标注。</div>}
        <details>
          <summary style={{ fontSize: 12, color: DIM, cursor: "pointer" }}>原始盘面快照（/status）</summary>
          <pre style={{ margin: "6px 0 0", whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "var(--font-mono)", fontSize: 11, lineHeight: 1.7, color: DIM }}>
            {status ? JSON.stringify(status, null, 1) : "（装载中…）"}
          </pre>
        </details>
        <div style={{ fontSize: 12, color: DIM, lineHeight: 1.7 }}>
          生产线 = kit 的批式编排执行（flow_run → 逐节点领包执行 → AND-join → 人工门挂起）。
          启停是人的动词：agent 交卷后停在门等人裁，此处只做运行控制，不做语义裁决。
        </div>
      </div>
    </div>
  );
}

/** 工程 map 主体：模块泳道列（左→右 = 剧情推进）+ SVG 走过路径。 */
function PlanMap({ plan, selNode, onSelect }: { plan: KitFlowPlan; selNode: string | null; onSelect: (id: string) => void }) {
  // 列 = 泳道（plan 序去重），行 = 泳道内 plan 序
  const layout = useMemo(() => {
    const colOf = new Map<string, number>();
    plan.modules.forEach((m, i) => colOf.set(m.id, i));
    const pos = new Map<string, { x: number; y: number; col: number; row: number }>();
    const rowCount: number[] = [];
    for (const n of plan.nodes) {
      const col = colOf.get(n.module) ?? 0;
      const row = rowCount[col] ?? 0;
      rowCount[col] = row + 1;
      pos.set(n.id, { x: col * (NODE_W + COL_GAP), y: HEAD_H + row * (NODE_H + ROW_GAP), col, row });
    }
    const width = Math.max(plan.modules.length, 1) * (NODE_W + COL_GAP) - COL_GAP + 32;
    const height = HEAD_H + Math.max(...rowCount, 1) * (NODE_H + ROW_GAP) - ROW_GAP + 28;
    return { pos, width, height };
  }, [plan]);

  const doneIds = new Set(plan.nodes.filter((n) => n.status === "done").map((n) => n.id));
  const activeId = plan.nodes.find((n) => n.status === "awaiting" || n.status === "running")?.id ?? null;
  const pct = plan.stats.total ? Math.round((plan.stats.done / plan.stats.total) * 100) : 0;

  return (
    <div style={{ padding: "12px 16px 0", flexShrink: 0 }}>
      {/* 进度条：done/total + 当前节点 */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
        <div style={{ flex: 1, maxWidth: 420, height: 6, borderRadius: 3, background: "var(--border)", overflow: "hidden" }}>
          <div style={{ width: `${pct}%`, height: "100%", background: OK, transition: "width .5s" }} />
        </div>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{plan.stats.done}/{plan.stats.total} 节点 · {pct}%</span>
        {activeId && (
          <span style={{ fontSize: 12, color: GOLD, fontFamily: "var(--font-mono)" }}>
            当前 {activeId}
          </span>
        )}
        {plan.mode === "skeleton" && (
          <span style={{ fontSize: 12, color: DIM }}>骨架视图（未开跑——开跑后展开为逐节点地图）</span>
        )}
      </div>

      {/* 泳道画布 */}
      <div style={{ overflow: "auto", maxHeight: "58vh", border: "1px solid var(--border)", borderRadius: 10, background: "var(--bg-panel, transparent)", padding: 12 }}>
        <div style={{ position: "relative", width: layout.width, height: layout.height, minWidth: "100%" }}>
          <svg width={layout.width} height={layout.height} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
            <defs>
              <marker id="arrow-done" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M0,0 L8,4 L0,8 z" fill={OK} />
              </marker>
              <marker id="arrow-dim" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M0,0 L8,4 L0,8 z" fill={DIM} />
              </marker>
            </defs>
            {plan.edges.map((e, i) => {
              const a = layout.pos.get(e.from);
              const b = layout.pos.get(e.to);
              if (!a || !b) return null;
              const walked = doneIds.has(e.from) && doneIds.has(e.to);
              const frontier = e.to === activeId;
              const d = b.col > a.col
                ? `M ${a.x + NODE_W} ${a.y + NODE_H / 2} C ${(a.x + NODE_W + b.x) / 2} ${a.y + NODE_H / 2}, ${(a.x + NODE_W + b.x) / 2} ${b.y + NODE_H / 2}, ${b.x} ${b.y + NODE_H / 2}`
                : `M ${a.x + NODE_W / 2} ${a.y + NODE_H} L ${b.x + NODE_W / 2} ${b.y}`;
              return (
                <path key={i} d={d} fill="none" stroke={walked ? OK : frontier ? GOLD : DIM} strokeWidth={walked || frontier ? 2 : 1.2} strokeDasharray={frontier ? "5 4" : undefined} opacity={walked ? 0.95 : frontier ? 0.9 : 0.35} markerEnd={walked ? "url(#arrow-done)" : "url(#arrow-dim)"} />
              );
            })}
          </svg>
          {/* 泳道头 */}
          {plan.modules.map((m, i) => (
            <div key={m.id} style={{
              position: "absolute", left: i * (NODE_W + COL_GAP), top: 0, width: NODE_W,
              display: "flex", alignItems: "center", gap: 8, paddingBottom: 8,
              borderBottom: "1px solid var(--border)",
            }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: GOLD, border: `1px solid ${GOLD}`, borderRadius: 6, padding: "1px 6px" }}>{m.id}</span>
              <b style={{ fontSize: 13 }}>{m.name}</b>
            </div>
          ))}
          {/* 节点卡 */}
          {plan.nodes.map((n) => {
            const p = layout.pos.get(n.id);
            if (!p) return null;
            const v = statusVisual(n.status);
            const on = n.id === selNode;
            const isGate = n.gateRole === "gate" || n.gateRole === "boundary";
            const isLink = n.op === "link";
            return (
              <div
                key={n.id}
                role="button"
                aria-label={`节点 ${n.title}`}
                onClick={() => onSelect(n.id === selNode ? "" : n.id)}
                style={{
                  position: "absolute", left: p.x, top: p.y, width: NODE_W, minHeight: NODE_H, boxSizing: "border-box",
                  borderWidth: 1,
                  borderStyle: isLink ? "none" : n.status === "none" && !isGate ? "dashed" : "solid",
                  borderColor: on ? ACCENT : isLink ? "transparent" : v.color + (n.status === "none" ? "55" : ""),
                  borderRadius: 8,
                  background: isLink ? "transparent" : v.bg || "var(--bg)",
                  boxShadow: on ? `0 0 0 2px ${ACCENT}44` : undefined,
                  padding: isLink ? "2px 8px" : "8px 10px",
                  cursor: "pointer",
                  display: "flex", flexDirection: "column", gap: 2,
                  animation: n.status === "awaiting" || n.status === "running" ? "kitpulse 2s ease-in-out infinite" : undefined,
                }}
              >
                {isLink ? (
                  <span style={{ fontSize: 11, color: DIM, textAlign: "center" }}>─── ⛨ 连接门 ───</span>
                ) : (
                  <>
                    <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600, color: n.status === "none" ? "var(--text-muted)" : "var(--text)" }}>
                      <span style={{ color: v.color, fontWeight: 700 }}>{v.icon}</span>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.title}</span>
                      {isGate && <span style={{ marginLeft: "auto", color: GOLD }}>⛨</span>}
                    </span>
                    <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10.5, color: DIM, fontFamily: "var(--font-mono)" }}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.op || n.id}</span>
                      <span style={{ marginLeft: "auto", flexShrink: 0 }}>{n.status === "done" && n.at ? n.at.slice(5, 16).replace("T", " ") : n.failCount > 0 ? `✕${n.failCount}` : ""}</span>
                    </span>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <style>{`@keyframes kitpulse { 0%,100% { box-shadow: 0 0 0 0 rgba(232,179,61,0.0); } 50% { box-shadow: 0 0 0 4px rgba(232,179,61,0.18); } }`}</style>
    </div>
  );
}
