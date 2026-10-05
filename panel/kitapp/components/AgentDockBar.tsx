"use client";

/** 右侧 agent dock 条（工单-20261006 分流：右侧主攻 agent）：
 *  一条缩略工具条收纳 agent 侧一切入口——💬 会话抽屉（SessionSidebar 整体，可选会话/项目/git 分支）、
 *  🌿 分支快切（git checkout，分支名白名单校验）、＋ 新建会话。左侧资源管理器从此只管文件与功能面板。 */
import { useCallback, useEffect, useState, type ReactNode } from "react";

const BORDER = "var(--border)";
const chip = (on: boolean): React.CSSProperties => ({
  display: "flex", alignItems: "center", gap: 5, padding: "3px 10px", borderRadius: 999,
  fontSize: 12, border: `1px solid ${on ? "var(--accent, #a5433a)" : BORDER}`,
  background: on ? "var(--bg-selected)" : "transparent",
  color: on ? "var(--accent, #a5433a)" : "var(--text-muted)",
  cursor: "pointer", whiteSpace: "nowrap",
});
const selStyle: React.CSSProperties = {
  maxWidth: 160, padding: "3px 8px", borderRadius: 999, border: `1px solid ${BORDER}`,
  background: "transparent", color: "var(--text)", fontSize: 12, fontFamily: "inherit", cursor: "pointer",
};

export function AgentDockBar({
  sessions,
  selectedSessionId,
  onSelectSession,
  onNewSession,
  drawer,
}: {
  sessions: { id: string; name?: string; title?: string }[];
  selectedSessionId: string | null;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  /** 会话抽屉内容（SessionSidebar 整体——项目选择/会话列表/操作全都在）。 */
  drawer: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [git, setGit] = useState<{ current: string; branches: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const pullGit = useCallback(() => {
    fetch("/api/kit/git-info").then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((g: { current: string; branches: string[] }) => setGit(g))
      .catch(() => setGit(null));
  }, []);
  // kit 未就绪时桥路由 503——挂载后重试拉取直至成功（上限 20 次），保底分支选择器不缺席
  useEffect(() => {
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      fetch("/api/kit/git-info").then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((g: { current: string; branches: string[] }) => { setGit(g); clearInterval(timer); })
        .catch(() => { if (tries >= 20) clearInterval(timer); });
    }, 2500);
    return () => clearInterval(timer);
  }, []);

  const checkout = useCallback(async (branch: string) => {
    if (!git || branch === git.current || busy) return;
    setBusy(true);
    setNote("");
    try {
      const r = await fetch("/api/kit/git-checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ branch }) });
      const body = (await r.json()) as { ok?: boolean; current?: string; error?: string };
      if (body.ok && body.current) { setGit({ ...git, current: body.current }); setNote(`已切到 ${body.current}`); }
      else setNote(`切换失败：${body.error ?? `HTTP ${r.status}`}`);
    } catch (e) {
      setNote(`切换失败：${String((e as Error).message ?? e)}`);
    } finally { setBusy(false); }
  }, [git, busy]);

  const current = sessions.find((s) => s.id === selectedSessionId);
  const sessionLabel = current ? (current.name || current.title || current.id) : "会话…";

  return (
    <div style={{ borderBottom: `1px solid ${BORDER}`, background: "var(--bg-panel)", flexShrink: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 8px", flexWrap: "wrap" }}>
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} style={chip(open)} title="会话列表 / 项目 / 工作区">
          💬 <span style={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis" }}>{sessionLabel}</span> {open ? "▾" : "▸"}
        </button>
        {git && (
          <select
            value={git.current}
            disabled={busy}
            onChange={(e) => void checkout(e.target.value)}
            style={selStyle}
            title="git 分支（选择即 checkout）"
            aria-label="git 分支"
          >
            {git.branches.map((b) => <option key={b} value={b}>{b === git.current ? `🌿 ${b}` : b}</option>)}
          </select>
        )}
        <span style={{ flex: 1 }} />
        <button type="button" onClick={onNewSession} style={chip(false)} title="新建会话">＋ 新建</button>
      </div>
      {note && <div style={{ padding: "0 10px 5px", fontSize: 11, color: "var(--text-muted)" }}>{note}</div>}
      {/* 抽屉常驻挂载（display 切换）：SessionSidebar 承担会话恢复/项目选择管线，卸载即断流 */}
      <div style={{ display: open ? "flex" : "none", maxHeight: "46vh", overflow: "auto", borderTop: open ? `1px solid ${BORDER}` : "none", flexDirection: "column" }}>
        {drawer}
      </div>
    </div>
  );
}
