"use client";

/** 文件专有页（工单-20261002 批3 落地）：文件树升格主区多 tab。
 *  数据走 mock/files 的 kit 桥（树/读取/预览已接 kit /api/panel/*）；正文选区可发会话卡片。 */
import { useCallback, useEffect, useState } from "react";
import { FileViewer } from "./FileViewer";
import { listDirectory, readFileText } from "@/mock/files";
import { PROJECT_ROOT } from "@/mock/paths";
import type { SelectionCard } from "@/lib/selection-card";

interface FileTab { path: string; name: string }

export function FilesPage({ onSelectionToChat }: { onSelectionToChat?: (card: SelectionCard) => void }) {
  const [tree, setTree] = useState<{ name: string; isDir: boolean }[] | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ "世界书": true });
  const [tabs, setTabs] = useState<FileTab[]>([]);
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    listDirectory(PROJECT_ROOT).then((entries) => setTree(entries ?? [])).catch(() => setTree([]));
  }, []);

  const openFile = useCallback(async (path: string) => {
    const name = path.split("/").pop() ?? path;
    setTabs((prev) => (prev.some((t) => t.path === path) ? prev : [...prev, { path, name }]));
    setActive(path);
    // 预热读取（失败静默——FileViewer 自己也会读）
    void readFileText({ path, size: 0 }).catch(() => undefined);
  }, []);

  const closeTab = useCallback((path: string) => {
    setTabs((prev) => {
      const next = prev.filter((t) => t.path !== path);
      setActive((cur) => (cur === path ? next[next.length - 1]?.path ?? null : cur));
      return next;
    });
  }, []);

  const renderTree = (dir: string, depth: number, entries: { name: string; isDir: boolean }[]) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
      {entries.map((item) => {
        const full = dir ? `${dir}/${item.name}` : item.name;
        const isOpen = expanded[full];
        return (
          <div key={full}>
            <button
              type="button"
              onClick={() => {
                if (item.isDir) setExpanded((prev) => ({ ...prev, [full]: !prev[full] }));
                else void openFile(full);
              }}
              style={{
                display: "block", width: "100%", textAlign: "left", fontSize: 12.5,
                padding: `3px 6px 3px ${8 + depth * 14}px`, border: "none", borderRadius: 5,
                background: active === full ? "var(--bg-selected)" : "transparent",
                color: active === full ? "var(--accent)" : "var(--text-muted)",
                cursor: "pointer", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              }}
            >
              {item.isDir ? `${isOpen ? "▾" : "▸"} ` : ""}{item.name}
            </button>
            {item.isDir && isOpen && (
              <DirChildren dir={full} depth={depth + 1} renderTree={renderTree} />
            )}
          </div>
        );
      })}
    </div>
  );

  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 300, background: "var(--bg)", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <b style={{ fontSize: 15, letterSpacing: 2 }}>📄 文件</b>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>项目文件树 · 点开成 tab · 正文选区可发会话卡片</span>
      </div>
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <div style={{ width: 230, flexShrink: 0, borderRight: "1px solid var(--border)", overflow: "auto", padding: "10px 6px" }}>
          {tree === null && <div style={{ fontSize: 12, color: "var(--text-muted)", padding: 6 }}>装载文件树…</div>}
          {tree !== null && renderTree("", 0, tree)}
        </div>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          {tabs.length > 0 && (
            <div style={{ display: "flex", gap: 2, padding: "6px 10px 0", flexShrink: 0, overflowX: "auto", borderBottom: "1px solid var(--border)", background: "var(--bg-panel)" }}>
              {tabs.map((t) => (
                <div
                  key={t.path}
                  onClick={() => setActive(t.path)}
                  style={{
                    display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", cursor: "pointer",
                    fontSize: 12, borderRadius: "8px 8px 0 0", whiteSpace: "nowrap",
                    border: `1px solid ${active === t.path ? "var(--accent)" : "var(--border)"}`,
                    borderBottom: active === t.path ? "none" : "1px solid var(--border)",
                    background: active === t.path ? "var(--bg)" : "transparent",
                    color: active === t.path ? "var(--text)" : "var(--text-muted)",
                  }}
                >
                  <span>{t.name}</span>
                  <span
                    role="button"
                    aria-label={`关闭 ${t.name}`}
                    onClick={(e) => { e.stopPropagation(); closeTab(t.path); }}
                    style={{ color: "var(--text-dim)", cursor: "pointer", padding: "0 2px" }}
                  >×</span>
                </div>
              ))}
            </div>
          )}
          {active ? (
            <div style={{ flex: 1, minHeight: 0 }}>
              <FileViewer filePath={`${PROJECT_ROOT}/${active}`} cwd={PROJECT_ROOT} onSelectionToChat={onSelectionToChat} />
            </div>
          ) : (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 13 }}>
              从左侧树打开文件（正文 / 世界书卡 / 交付物…）
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DirChildren({ dir, depth, renderTree }: { dir: string; depth: number; renderTree: (d: string, n: number, e: { name: string; isDir: boolean }[]) => React.ReactNode }) {
  const [children, setChildren] = useState<{ name: string; isDir: boolean }[] | null>(null);
  useEffect(() => {
    listDirectory(`${PROJECT_ROOT}/${dir}`).then((entries) => setChildren(entries ?? [])).catch(() => setChildren([]));
  }, [dir]);
  if (children === null) return <div style={{ fontSize: 11, color: "var(--text-dim)", padding: `2px 6px 2px ${10 + depth * 14}px` }}>…</div>;
  return <>{renderTree(dir, depth, children)}</>;
}
