"use client";

/** 大事记专有页（工单-20261002 批4）：journal 台账时间轴。
 *  数据 = /api/kit/journal（kit /api/panel/journal，台账尾部 200 条）。 */
import { useCallback, useEffect, useState } from "react";

interface JournalEntry {
  ts?: string;
  runId?: string;
  event?: string;
  actor?: string;
  detail?: string;
}

const ACCENT = "var(--accent, #a5433a)";
const KIND_COLORS: Record<string, string> = {
  "run-start": "#5f9c7a", "run-end": "#b3564d",
  "batch-start": "#5b7fa6", "batch-end": "#5b7fa6",
  "node-start": "#c96f4a", "node-complete": "#5f9c7a", "node-error": "#b3564d",
  "verdict": "#8a6fb0", "gate-pending": "#b09a5f",
  "note": "#8a8375",
};

export function TimelinePage() {
  const [entries, setEntries] = useState<JournalEntry[] | null>(null);
  const [total, setTotal] = useState(0);
  const [note, setNote] = useState("");
  const [project, setProject] = useState("");
  const [filter, setFilter] = useState("");

  const load = useCallback(async (p: string) => {
    if (!p) return;
    try {
      const r = await fetch(`/api/kit/journal?project=${encodeURIComponent(p)}&limit=200`);
      const body = (await r.json()) as { total: number; entries: JournalEntry[]; note?: string };
      setEntries(body.entries ?? []);
      setTotal(body.total ?? 0);
      setNote(body.note ?? "");
    } catch (e) {
      setNote(String((e as Error).message ?? e));
    }
  }, []);

  useEffect(() => {
    fetch("/api/kit/hub")
      .then((r) => r.json())
      .then((hub: { groups?: { projects?: { id: string }[] }[] }) => {
        const first = (hub.groups ?? []).flatMap((g) => g.projects ?? []).map((p) => p.id)[0] ?? "";
        setProject(first);
        void load(first);
      })
      .catch(() => setNote("hub 不可达"));
  }, [load]);

  const visible = (entries ?? []).filter((e) => {
    const word = filter.trim();
    if (!word) return true;
    return (e.event ?? "").includes(word) || (e.detail ?? "").includes(word) || (e.actor ?? "").includes(word);
  });

  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 300, background: "var(--bg)", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <b style={{ fontSize: 15, letterSpacing: 2, whiteSpace: "nowrap" }}>🕐 大事记</b>
        <span style={{ fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap" }}>{project || "（未选项目）"} · 台账 {total} 条</span>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="过滤：事件 / detail / actor（如 node、verdict）"
          style={{ flex: 1, minWidth: 0, maxWidth: 420, padding: "6px 10px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg-panel, #fff)", color: "var(--text)", fontSize: 12, fontFamily: "inherit" }}
        />
        <span style={{ flex: 1 }} />
        <button type="button" onClick={() => void load(project)} style={{ padding: "5px 12px", border: "1px solid var(--border)", borderRadius: 6, background: "transparent", color: "var(--text-muted)", cursor: "pointer", fontSize: 12 }}>刷新</button>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "18px 22px" }}>
        {note && <div style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 12 }}>{note}</div>}
        {entries && entries.length === 0 && !note && (
          <div style={{ color: "var(--text-muted)", fontSize: 13 }}>（台账为空——到「生产线」启动一次批循环即可生成）</div>
        )}
        <div style={{ position: "relative", paddingLeft: 18, maxWidth: 980 }}>
          <div style={{ position: "absolute", left: 5, top: 4, bottom: 4, width: 2, background: "var(--border)" }} />
          {visible.map((e, i) => {
            const color = KIND_COLORS[e.event ?? ""] ?? "#8a8375";
            return (
              <div key={i} style={{ position: "relative", padding: "0 0 14px 14px" }}>
                <span style={{
                  position: "absolute", left: -18 + 0, top: 4, width: 10, height: 10, borderRadius: 999,
                  background: color, border: "2px solid var(--bg)", boxShadow: "0 0 0 1px var(--border)",
                }} />
                <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                  <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>{(e.ts ?? "").replace("T", " ").slice(0, 19)}</span>
                  <b style={{ fontSize: 12, color }}>{e.event}</b>
                  {e.actor && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{e.actor}</span>}
                </div>
                {e.detail && <div style={{ fontSize: 12.5, color: "var(--text)", marginTop: 2, lineHeight: 1.6 }}>{e.detail}</div>}
              </div>
            );
          })}
          {entries && visible.length === 0 && entries.length > 0 && (
            <div style={{ color: "var(--text-muted)", fontSize: 12 }}>（过滤后无条目）</div>
          )}
        </div>
      </div>
    </div>
  );
}
