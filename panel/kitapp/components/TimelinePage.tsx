"use client";

/** 大事记专有页（工单-20261002 批4；20261005 补跨项目扫描）：
 *  数据 = /api/kit/journal——project=_scan_ 时服务端扫全工作区找有台账的项目，
 *  页面自动落在最近有动静的那本上（原实现只会盯第一个项目，而台账只由 flow_run 产生，
 *  立项未跑的项目永远空态——看起来像没实现）。 */
import { useCallback, useEffect, useState } from "react";

interface JournalEntry {
  ts?: string;
  runId?: string;
  event?: string;
  actor?: string;
  detail?: string;
}
interface ScanRow {
  id: string;
  total: number;
  last: string | null;
  flowId?: string;
  flowStatus?: string;
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
  const [scan, setScan] = useState<ScanRow[] | null>(null);
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

  const scanAll = useCallback(async () => {
    setNote("");
    try {
      const r = await fetch("/api/kit/journal?project=_scan_");
      const body = (await r.json()) as { projects?: ScanRow[] };
      const rows = (body.projects ?? []).sort((a, b) => (b.last ?? "").localeCompare(a.last ?? ""));
      setScan(rows);
      if (rows.length > 0) {
        setProject((cur) => (cur && rows.some((x) => x.id === cur) ? cur : rows[0].id));
      } else {
        setEntries([]);
        setTotal(0);
      }
    } catch (e) {
      setNote(String((e as Error).message ?? e));
      setScan([]);
    }
  }, []);

  useEffect(() => { void scanAll(); }, [scanAll]);
  useEffect(() => { if (project) void load(project); }, [project, load]);

  const visible = (entries ?? []).filter((e) => {
    const word = filter.trim();
    if (!word) return true;
    return (e.event ?? "").includes(word) || (e.detail ?? "").includes(word) || (e.actor ?? "").includes(word);
  });
  const row = scan?.find((x) => x.id === project);

  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 300, background: "var(--bg)", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", borderBottom: "1px solid var(--border)", flexShrink: 0, flexWrap: "wrap" }}>
        <b style={{ fontSize: 15, letterSpacing: 2, whiteSpace: "nowrap" }}>🕐 大事记</b>
        <select
          value={project}
          onChange={(e) => setProject(e.target.value)}
          style={{ maxWidth: 280, padding: "6px 8px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg-panel, #fff)", color: "var(--text)", fontSize: 12, fontFamily: "inherit" }}
        >
          {(scan ?? []).map((x) => (
            <option key={x.id} value={x.id}>{x.id}{x.total ? ` · ${x.total} 条` : ""}</option>
          ))}
        </select>
        {row?.flowId && <span style={{ fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap" }}>{row.flowId}{row.flowStatus ? ` · ${row.flowStatus}` : ""}</span>}
        <span style={{ fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap" }}>台账 {total} 条</span>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="过滤：事件 / detail / actor（如 node、verdict）"
          style={{ flex: 1, minWidth: 0, maxWidth: 380, padding: "6px 10px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg-panel, #fff)", color: "var(--text)", fontSize: 12, fontFamily: "inherit" }}
        />
        <span style={{ flex: 1 }} />
        <button type="button" onClick={() => { void scanAll(); void load(project); }} style={{ padding: "5px 12px", border: "1px solid var(--border)", borderRadius: 6, background: "transparent", color: "var(--text-muted)", cursor: "pointer", fontSize: 12 }}>刷新</button>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "18px 22px" }}>
        {note && <div style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 12 }}>{note}</div>}
        {scan !== null && scan.length === 0 && (
          <div style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.9, maxWidth: 640 }}>
            整个工作区还没有任何项目写过台账。journal 由 <b>flow_run</b>（生产线开跑）产生——
            到「生产线」选一个项目启动批循环，或经内核动词 flow_run 立项跑一次，这里就会出现流水。
          </div>
        )}
        {row && (row.total ?? 0) === 0 && (
          <div style={{ color: "var(--text-muted)", fontSize: 13 }}>（该项目还没有台账——启动生产线后生成）</div>
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
