"use client";

/** 生产线专有页（工单-20261002 批3）：/status 盘面 + start/stop——kit 独有能力。
 *  数据经桥路由 /api/kit/status | production-start | production-stop。 */
import { useCallback, useEffect, useState } from "react";
import type { KitProductionStatus } from "@/mock/kit/client";

interface HubProject { id: string; title?: string }
interface Hub {
  workspace?: string;
  groups?: { name?: string; projects?: HubProject[] }[];
}

const ACCENT = "var(--accent, #a5433a)";
const OK = "var(--status-ok, #5f9c7a)";

export function ProductionPage() {
  const [status, setStatus] = useState<KitProductionStatus | null>(null);
  const [projects, setProjects] = useState<HubProject[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [s, hub] = await Promise.all([
        fetch("/api/kit/status").then((r) => r.json()) as Promise<KitProductionStatus>,
        fetch("/api/kit/hub").then((r) => r.json()) as Promise<Hub>,
      ]);
      setStatus(s);
      const list = (hub.groups ?? []).flatMap((g) => g.projects ?? []);
      setProjects(list);
      setSelected((cur) => cur || list[0]?.id || "");
    } catch (e) {
      setNote(`状态不可达：${String((e as Error).message ?? e)}`);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

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

  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 300, background: "var(--bg)", display: "flex", flexDirection: "column", overflow: "auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <b style={{ fontSize: 15, letterSpacing: 2 }}>🏭 生产线</b>
        <span style={{
          padding: "3px 12px", borderRadius: 999, fontSize: 12, fontWeight: 700,
          border: `1px solid ${running ? OK : "var(--border)"}`,
          color: running ? OK : "var(--text-muted)",
        }}>
          {running ? "● 运行中" : "○ 已停止"}
        </span>
        {status?.startedAt && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>自 {String(status.startedAt).slice(0, 19).replace("T", " ")}</span>}
        <span style={{ flex: 1 }} />
        <button type="button" onClick={() => void refresh()} style={{ padding: "5px 12px", border: "1px solid var(--border)", borderRadius: 6, background: "transparent", color: "var(--text-muted)", cursor: "pointer", fontSize: 12 }}>刷新</button>
      </div>

      <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14, maxWidth: 900 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <label style={{ fontSize: 13, color: "var(--text-muted)", whiteSpace: "nowrap" }}>项目</label>
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            disabled={running}
            style={{ flex: 1, padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg-panel, #fff)", color: "var(--text)", fontSize: 13, fontFamily: "inherit" }}
          >
            <option value="">选择项目…</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.title || p.id}</option>
            ))}
          </select>
          {running ? (
            <button type="button" onClick={() => void stop()} disabled={busy} style={{ padding: "8px 18px", border: "1px solid var(--border)", borderRadius: 8, background: "transparent", color: "var(--text)", cursor: busy ? "wait" : "pointer", fontSize: 13 }}>
              停止（下一批边界）
            </button>
          ) : (
            <button type="button" onClick={() => void start()} disabled={busy || !selected} style={{ padding: "8px 18px", border: `1px solid ${ACCENT}`, borderRadius: 8, background: ACCENT, color: "#fff", cursor: busy || !selected ? "not-allowed" : "pointer", fontSize: 13, opacity: busy || !selected ? 0.6 : 1 }}>
              启动批循环
            </button>
          )}
        </div>

        {note && <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{note}</div>}

        {status?.lastError && (
          <div style={{ border: "1px solid #b3564d", borderRadius: 8, padding: "10px 12px", fontSize: 12, color: "#d98a83" }}>
            上次错误：{status.lastError}
          </div>
        )}

        <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>盘面快照</div>
          <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "var(--font-mono)", fontSize: 12, lineHeight: 1.7, color: "var(--text-muted)" }}>
            {status ? JSON.stringify(status, null, 1) : "（装载中…）"}
          </pre>
        </div>

        <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.7 }}>
          生产线 = kit 的批式编排执行（flow_run → 逐节点领包执行 → AND-join → 人工门挂起）。
          启停是人的动词：agent 交卷后停在门等人裁，此处只做运行控制，不做语义裁决。
        </div>
      </div>
    </div>
  );
}
