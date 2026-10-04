"use client";

/** 统一 tab 工作台（批A · Obsidian 模型骨架）：主内容区唯一容器。
 *  工具侧栏点任何条目 → openWorkTab 开一页；可叠多页、可关；正文 tab 常驻。 */
import ReactMarkdown from "react-markdown";
import React, { Component, useEffect, useState, type ReactNode } from "react";
import { FileViewer } from "./FileViewer";
import { PROJECT_ROOT } from "../mock/paths";
import { EntryWikiView } from "./EntryWikiView";
import { WorldbookGraphView } from "./WorldbookGraphView";
import { TimelinePage } from "./TimelinePage";
import { ProductionPage } from "./ProductionPage";
import { KbShopView, KB_TYPE_NAMES } from "./KbShopView";
import { kitKbRead } from "../mock/kit/client";
import type { SelectionCard } from "@/lib/selection-card";

/** tab 内容错误边界：单个 tab 渲染崩掉只废这一页（可关掉重开），不许拖死整个工作台。 */
class TabErrorBoundary extends Component<{ name: string; children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: unknown) { return { error: String((e as Error)?.message ?? e) }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 20 }}>
          <div style={{ border: "1px solid #b3564d", borderRadius: 10, padding: "12px 14px", fontSize: 13, color: "#d98a83", marginBottom: 12 }}>
            页「{this.props.name}」渲染出错：{this.state.error}
          </div>
          <button type="button" onClick={() => this.setState({ error: null })} style={{ padding: "7px 16px", border: "1px solid var(--border)", borderRadius: 8, background: "transparent", color: "var(--text)", cursor: "pointer", fontSize: 13 }}>
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export type WorkTab =
  | { kind: "file"; id: string; title: string; path: string }
  | { kind: "entry"; id: string; title: string; path: string }
  | { kind: "kbcard"; id: string; title: string; ref: string }
  | { kind: "kbshop"; id: string; title: string; domain?: string }
  | { kind: "graph"; id: string; title: string }
  | { kind: "timeline"; id: string; title: string; project: string }
  | { kind: "production"; id: string; title: string; project: string };

/** 知识卡深读页：frontmatter 结构化卡头 + 正文 markdown。
 *  失败态带「重试」——8431 曾因服务重启短暂不可达，失败卡死在页上（点击同一命中不重拉）即由此修。 */
function KbCardFetcher({ refId }: { refId: string }) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let alive = true;
    setContent(null);
    setError("");
    kitKbRead(refId)
      .then((raw) => {
        if (!alive) return;
        const body = raw as { content?: string };
        if (typeof body?.content === "string" && body.content.length > 0) setContent(body.content);
        else setError("读卡返回为空");
      })
      .catch((e) => { if (alive) setError(String((e as Error).message ?? e)); });
    return () => { alive = false; };
  }, [refId, nonce]);

  if (error) {
    return (
      <div style={{ padding: 20 }}>
        <div style={{ border: "1px solid #b3564d", borderRadius: 10, padding: "12px 14px", fontSize: 13, color: "#d98a83", marginBottom: 12, maxWidth: 720 }}>
          读卡失败（{refId}）：{error}
        </div>
        <button type="button" onClick={() => setNonce((n) => n + 1)} style={{ padding: "7px 16px", border: "1px solid var(--border)", borderRadius: 8, background: "transparent", color: "var(--text)", cursor: "pointer", fontSize: 13 }}>
          重试
        </button>
      </div>
    );
  }
  if (content === null) return <div style={{ padding: 14, fontSize: 12, color: "var(--text-muted)" }}>装载卡片…</div>;
  // frontmatter 结构化头（JSON in --- 围栏）与正文分离渲染
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  let meta: Record<string, unknown> | null = null;
  let body = content;
  if (m) {
    try { meta = JSON.parse(m[1]) as Record<string, unknown>; body = content.slice(m[0].length); } catch { meta = null; }
  }
  return (
    <div style={{ padding: "18px 22px", fontSize: 14, lineHeight: 1.9, maxWidth: 980 }}>
      {meta && (
        <div style={{ marginBottom: 14, paddingBottom: 12, borderBottom: "1px solid var(--border)" }}>
          <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>{String(meta.title ?? refId)}</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", fontSize: 11 }}>
            {[KB_TYPE_NAMES[String(meta.type ?? "")] ?? String(meta.type ?? ""), `v${String(meta.version ?? "?")}`, String(meta.status ?? "") === "active" ? "生效中" : String(meta.status ?? ""), String(meta.updated ?? "")]
              .filter(Boolean)
              .map((chip, i) => (
                <span key={i} style={{ padding: "2px 9px", borderRadius: 999, border: "1px solid var(--border)", color: "var(--text-muted)" }}>{chip}</span>
              ))}
          </div>
        </div>
      )}
      <div className="markdown-body">
        <ReactMarkdown>{body}</ReactMarkdown>
      </div>
    </div>
  );
}

export function WorkTabs({
  tabs,
  activeId,
  onActivate,
  onClose,
  onSelectionToChat,
  onOpenEntry,
  onNavigateEntry,
  onOpenWorkTab,
  sidebarOpen,
  onToggleSidebar,
}: {
  tabs: WorkTab[];
  activeId: string | null;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onSelectionToChat?: (card: SelectionCard) => void;
  onOpenEntry?: (path: string, title: string) => void;
  onNavigateEntry?: (path: string, title: string) => void;
  onOpenWorkTab?: (tab: WorkTab) => void;
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
}) {
  const active = tabs.find((t) => t.id === activeId) ?? tabs[0] ?? null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* tab 条 */}
      <div style={{ display: "flex", gap: 2, padding: "6px 10px 0", flexShrink: 0, overflowX: "auto", borderBottom: "1px solid var(--border)", background: "var(--bg-panel)" }}>
        {/* 左侧栏开关：管哪侧就锚在哪侧（原来长在右会话面板顶栏上，视觉错位） */}
        {onToggleSidebar && (
          <button
            type="button"
            onClick={onToggleSidebar}
            title={sidebarOpen ? "收起左侧栏" : "展开左侧栏"}
            aria-label={sidebarOpen ? "收起左侧栏" : "展开左侧栏"}
            aria-expanded={sidebarOpen}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
              width: 28, height: 28, marginRight: 6, padding: 0,
              background: "none", border: "none", borderRight: "1px solid var(--border)",
              color: sidebarOpen ? "var(--text)" : "var(--text-muted)", cursor: "pointer",
            }}
          >
            {sidebarOpen ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="9" y1="3" x2="9" y2="21" />
              </svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="9" y1="3" x2="9" y2="21" strokeDasharray="2 2" />
              </svg>
            )}
          </button>
        )}
        {tabs.map((t) => {
          const on = t.id === active?.id;
          return (
            <div
              key={t.id}
              onClick={() => onActivate(t.id)}
              style={{
                display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", cursor: "pointer",
                fontSize: 12, borderRadius: "8px 8px 0 0", whiteSpace: "nowrap",
                border: `1px solid ${on ? "var(--accent)" : "var(--border)"}`,
                borderBottom: on ? "none" : "1px solid var(--border)",
                background: on ? "var(--bg)" : "transparent",
                color: on ? "var(--text)" : "var(--text-muted)",
              }}
            >
              <span>{t.title}</span>
              <span
                role="button"
                aria-label={`关闭 ${t.title}`}
                onClick={(e) => { e.stopPropagation(); onClose(t.id); }}
                style={{ color: "var(--text-dim)", cursor: "pointer", padding: "0 2px" }}
              >×</span>
            </div>
          );
        })}
        {tabs.length === 0 && (
          <div style={{ padding: "6px 10px", fontSize: 12, color: "var(--text-muted)" }}>从工具侧栏打开条目</div>
        )}
      </div>

      {/* tab 内容 */}
      <div style={{ flex: 1, minHeight: 0, position: "relative", overflow: "auto" }}>
        {!active ? (
          <div style={{ padding: 20, fontSize: 13, color: "var(--text-muted)" }}>（无打开页）</div>
        ) : (
          <TabErrorBoundary name={active.title}>
            {active.kind === "file" ? (
              <div style={{ height: "100%" }}>
                <FileViewer filePath={`${PROJECT_ROOT}/${active.path}`} cwd={PROJECT_ROOT} onSelectionToChat={onSelectionToChat} />
              </div>
            ) : active.kind === "entry" ? (
              <EntryWikiView path={active.path} title={active.title} onOpenEntry={onOpenEntry} onNavigateEntry={onNavigateEntry} />
            ) : active.kind === "kbcard" ? (
              <KbCardFetcher refId={active.ref} />
            ) : active.kind === "kbshop" ? (
              <KbShopView
                key={active.domain ?? "all"}
                domain={active.domain}
                onOpenCard={(ref, title) => onOpenWorkTab?.({ kind: "kbcard", id: `kb:${ref}`, title, ref })}
              />
            ) : active.kind === "graph" ? (
              <div style={{ padding: 14, height: "100%", boxSizing: "border-box" }}>
                <WorldbookGraphView onOpenEntry={onOpenEntry} />
              </div>
            ) : active.kind === "timeline" ? (
              <div style={{ position: "relative", height: "100%" }}>
                <TimelinePage />
              </div>
            ) : active.kind === "production" ? (
              <div style={{ position: "relative", height: "100%" }}>
                <ProductionPage project={active.project} />
              </div>
            ) : null}
          </TabErrorBoundary>
        )}
      </div>
    </div>
  );
}
