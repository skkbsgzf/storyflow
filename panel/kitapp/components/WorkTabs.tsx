"use client";

/** 统一 tab 工作台（批A · Obsidian 模型骨架）：主内容区唯一容器。
 *  工具侧栏点任何条目 → openWorkTab 开一页；可叠多页、可关；正文 tab 常驻。 */
import ReactMarkdown from "react-markdown";
import { useEffect, useState } from "react";
import { FileViewer } from "./FileViewer";
import { PROJECT_ROOT } from "../mock/paths";
import { EntryWikiView } from "./EntryWikiView";
import { WorldbookGraphView } from "./WorldbookGraphView";
import { TimelinePage } from "./TimelinePage";
import { ProductionPage } from "./ProductionPage";
import type { SelectionCard } from "@/lib/selection-card";

export type WorkTab =
  | { kind: "file"; id: string; title: string; path: string }
  | { kind: "entry"; id: string; title: string; path: string }
  | { kind: "kbcard"; id: string; title: string; ref: string }
  | { kind: "graph"; id: string; title: string }
  | { kind: "timeline"; id: string; title: string; project: string }
  | { kind: "production"; id: string; title: string };

function KbCardFetcher({ refId }: { refId: string }) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    setContent(null);
    setError("");
    fetch(`/api/kit/kb-read?ref=${encodeURIComponent(refId)}`)
      .then((r) => r.json())
      .then((body: { content?: string }) => { if (alive) setContent(body.content ?? "（读卡失败）"); })
      .catch((e) => { if (alive) setError(String(e)); });
    return () => { alive = false; };
  }, [refId]);
  if (content === null) return <div style={{ padding: 14, fontSize: 12, color: "var(--text-muted)" }}>装载卡片…</div>;
  if (error) return <div style={{ padding: 14, fontSize: 12, color: "var(--text-muted)" }}>{error}</div>;
  return (
    <div className="markdown-body" style={{ padding: "16px 20px", fontSize: 14, lineHeight: 1.9, maxWidth: 980 }}>
      <ReactMarkdown>{content}</ReactMarkdown>
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
}: {
  tabs: WorkTab[];
  activeId: string | null;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onSelectionToChat?: (card: SelectionCard) => void;
  onOpenEntry?: (path: string, title: string) => void;
}) {
  const active = tabs.find((t) => t.id === activeId) ?? tabs[0] ?? null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* tab 条 */}
      <div style={{ display: "flex", gap: 2, padding: "6px 10px 0", flexShrink: 0, overflowX: "auto", borderBottom: "1px solid var(--border)", background: "var(--bg-panel)" }}>
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
        ) : active.kind === "file" ? (
          <div style={{ height: "100%" }}>
            <FileViewer filePath={`${PROJECT_ROOT}/${active.path}`} cwd={PROJECT_ROOT} onSelectionToChat={onSelectionToChat} />
          </div>
        ) : active.kind === "entry" ? (
          <EntryWikiView path={active.path} title={active.title} onOpenEntry={onOpenEntry} />
        ) : active.kind === "kbcard" ? (
          <KbCardFetcher refId={active.ref} />
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
            <ProductionPage />
          </div>
        ) : null}
      </div>
    </div>
  );
}
