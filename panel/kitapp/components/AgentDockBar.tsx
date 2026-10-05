"use client";

/** 右侧 agent dock 条（工单-20261006 分流；20261007 抽屉改浮层）：
 *  一条缩略工具条收纳 agent 侧一切入口——💬 会话浮层（SessionSidebar 整体，可选会话/项目/git 分支，
 *  盖在聊天上方、不推挤内容）、🌿 分支快切（git checkout，分支名白名单校验）、＋ 新建会话。
 *  左侧资源管理器从此只管文件与功能面板。SessionSidebar 常驻挂载（display 切换）——它承担
 *  会话水合/恢复管线，卸载即断流。 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

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
  /** 会话浮层内容（SessionSidebar 整体——项目选择/会话列表/操作全都在）。 */
  drawer: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [git, setGit] = useState<{ current: string; branches: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const wrapRef = useRef<HTMLDivElement | null>(null);

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

  // 浮层点外收起（mousedown 在浮层/工具条之外）
  useEffect(() => {
    if (!open) return;
    const onDown = (ev: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(ev.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

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
    <div ref={wrapRef} style={{ position: "relative", borderBottom: `1px solid ${BORDER}`, background: "var(--bg-panel)", flexShrink: 0 }}>
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
      {/* 会话浮层：盖在聊天上方（absolute），不占布局流——SessionSidebar 常驻挂载只切可见性 */}
      <div style={{
        position: "absolute", top: "100%", left: 8, right: 8, zIndex: 90,
        display: open ? "flex" : "none", flexDirection: "column",
        maxHeight: "68vh", overflow: "auto",
        border: `1px solid ${BORDER}`, borderRadius: 10, background: "var(--bg)",
        boxShadow: "0 14px 36px rgba(0,0,0,0.5)",
      }}>
        {drawer}
      </div>
    </div>
  );
}
