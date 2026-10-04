"use client";

/** 词条 wiki 视图（批A 从 WorldbookPage 抽出）：frontmatter 结构化 + markdown 正文 + 关联词条跳转。 */
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { parseFrontmatter } from "@/lib/frontmatter";
import { markdownPreviewRehypePlugins, markdownPreviewRemarkPlugins, markdownUrlTransform } from "@/lib/markdown";
import { fetchWbGraph, type WbEntry } from "@/lib/worldbook-data";

const ACCENT = "var(--accent, #a5433a)";

export function EntryWikiView({
  path,
  title,
  onOpenEntry,
  onClose,
}: {
  path: string;
  title: string;
  /** 关联词条跳转（宿主决定：开新 tab 或就地切换）。 */
  onOpenEntry?: (path: string, title: string) => void;
  onClose?: () => void;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [titles, setTitles] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    setContent(null);
    setError("");
    fetch(`/api/kit/entry?path=${encodeURIComponent(path)}`)
      .then((r) => r.json())
      .then((body: { content?: string }) => { if (alive) setContent(body.content ?? "（空卡片）"); })
      .catch((e) => { if (alive) setError(String(e)); });
    fetchWbGraph()
      .then((g) => { if (alive) setTitles(new Set(g.entries.map((e) => e.title))); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [path]);

  const fm = content !== null ? parseFrontmatter(content) : null;
  const meta = (fm?.data ?? {}) as { title?: string; cat?: string; tags?: string[]; links?: string[]; summary?: string };
  const body = fm ? fm.rest.replace(/^#[^\n]*\n/, "") : "";
  const tags = Array.isArray(meta.tags) ? meta.tags : [];
  const linkTitles = (Array.isArray(meta.links) ? meta.links : []).filter((t) => titles.has(t));

  return (
    <div style={{ padding: "18px 22px", maxWidth: 1080 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <b style={{ fontSize: 24, letterSpacing: 2 }}>{meta.title ?? title}</b>
        {meta.cat && <span style={{ padding: "2px 10px", borderRadius: 999, fontSize: 11, border: `1px solid ${ACCENT}`, color: ACCENT }}>{meta.cat}</span>}
        <span style={{ flex: 1 }} />
        {onClose && (
          <button type="button" onClick={onClose} style={{ padding: "3px 10px", borderRadius: 6, fontSize: 11, border: "1px solid var(--border)", background: "transparent", color: "var(--text-muted)", cursor: "pointer" }}>
            关闭
          </button>
        )}
      </div>
      {tags.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
          {tags.map((t) => (
            <span key={t} style={{ padding: "2px 8px", borderRadius: 6, fontSize: 11, background: "var(--bg-selected)", color: "var(--text-muted)" }}>{t}</span>
          ))}
        </div>
      )}
      {meta.summary && (
        <div style={{ marginTop: 10, fontSize: 13, lineHeight: 1.7, borderLeft: `3px solid ${ACCENT}`, paddingLeft: 10 }}>
          {meta.summary}
        </div>
      )}

      {content === null ? (
        <div style={{ marginTop: 14, fontSize: 12, color: "var(--text-muted)" }}>装载卡片…</div>
      ) : error ? (
        <div style={{ marginTop: 14, fontSize: 12, color: "var(--text-muted)" }}>{error}</div>
      ) : (
        <div className="markdown-body" style={{ marginTop: 14, fontSize: 14, lineHeight: 1.9 }}>
          <ReactMarkdown
            remarkPlugins={markdownPreviewRemarkPlugins}
            rehypePlugins={markdownPreviewRehypePlugins}
            urlTransform={markdownUrlTransform}
          >
            {body}
          </ReactMarkdown>
        </div>
      )}

      {linkTitles.length > 0 && onOpenEntry && (
        <div style={{ marginTop: 16, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>关联词条 · {linkTitles.length}</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {linkTitles.map((t) => (
              <button key={t} type="button" onClick={() => onOpenEntry(t, t)} style={{ padding: "3px 10px", borderRadius: 6, fontSize: 11, border: "1px solid var(--border)", background: "transparent", color: "var(--text)", cursor: "pointer" }}>
                {t} ↗
              </button>
            ))}
          </div>
        </div>
      )}
      <div style={{ marginTop: 12, fontSize: 11, color: "var(--text-muted)" }}>{path}</div>
    </div>
  );
}
