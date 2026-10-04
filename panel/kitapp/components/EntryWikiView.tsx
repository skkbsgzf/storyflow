"use client";

/** 词条 wiki 视图（批A 从 WorldbookPage 抽出；2026-10-05 pedia 形态对齐）：
 *  引用解析（裸标题也能开卡，修「关联跳转开出来是空卡片」）+ 关联 chips 就地导航（单页形态，不开新 tab）
 *  + 返回栈 + 分类色章。 */
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { parseFrontmatter } from "@/lib/frontmatter";
import { markdownPreviewRehypePlugins, markdownPreviewRemarkPlugins, markdownUrlTransform } from "@/lib/markdown";
import { CAT_PALETTE, catColorOf, fetchWbGraph, resolveEntryRef, type WbEntry } from "@/lib/worldbook-data";

const ACCENT = "var(--accent, #a5433a)";

export function EntryWikiView({
  path,
  title,
  onOpenEntry,
  onNavigateEntry,
  onClose,
}: {
  path: string;
  title: string;
  /** 图谱/外部开新 tab（宿主决定）。 */
  onOpenEntry?: (path: string, title: string) => void;
  /** 关联词条就地导航（pedia 单页形态：替换当前 tab 内容，不新开页）。 */
  onNavigateEntry?: (path: string, title: string) => void;
  onClose?: () => void;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [shownPath, setShownPath] = useState(path);
  const [shownTitle, setShownTitle] = useState(title);
  const [entries, setEntries] = useState<WbEntry[]>([]);
  // 就地导航返回栈：path prop 变化时把上一站压栈（tab 切换重挂载会清空，可接受）
  const backRef = useRef<{ path: string; title: string }[]>([]);
  const lastRef = useRef({ path, title });

  useEffect(() => {
    if (lastRef.current.path === path) return;
    backRef.current.push({ ...lastRef.current });
    lastRef.current = { path, title };
  }, [path, title]);

  useEffect(() => {
    let alive = true;
    setContent(null);
    setError("");
    setShownPath(path);
    setShownTitle(title);
    (async () => {
      try {
        const ent = await resolveEntryRef(path);
        if (!alive) return;
        const p = ent?.path ?? path;
        if (ent?.title) setShownTitle(ent.title);
        setShownPath(p);
        const body = await fetch(`/api/kit/entry?path=${encodeURIComponent(p)}`).then((r) => r.json() as Promise<{ content?: string; error?: string }>);
        if (!alive) return;
        if (typeof body.content === "string" && body.content.length > 0) setContent(body.content);
        else setError(ent ? "卡片内容为空" : `找不到词条：${title || path}`);
      } catch (e) {
        if (alive) setError(String((e as Error).message ?? e));
      }
    })();
    fetchWbGraph().then((g) => { if (alive) setEntries(g.entries); }).catch(() => undefined);
    return () => { alive = false; };
  }, [path, title]);

  const fm = content !== null ? parseFrontmatter(content) : null;
  const meta = (fm?.data ?? {}) as { title?: string; cat?: string; tags?: string[]; links?: string[]; summary?: string };
  const body = fm ? fm.rest.replace(/^#[^\n]*\n/, "") : "";
  const tags = Array.isArray(meta.tags) ? meta.tags : [];
  const byTitle = new Map(entries.map((e) => [e.title, e]));
  const linkEntries = (Array.isArray(meta.links) ? meta.links : [])
    .map((t) => byTitle.get(t))
    .filter((e): e is WbEntry => Boolean(e));
  const cat = meta.cat ?? "";
  const catColor = CAT_PALETTE[cat] ?? ACCENT;
  const navigate = (ent: WbEntry) => { (onNavigateEntry ?? onOpenEntry)?.(ent.path, ent.title); };

  return (
    <div style={{ padding: "18px 22px", maxWidth: 1080 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        {backRef.current.length > 0 && (
          <button
            type="button"
            onClick={() => {
              const prev = backRef.current.pop();
              if (prev) (onNavigateEntry ?? onOpenEntry)?.(prev.path, prev.title);
            }}
            style={{ padding: "3px 10px", borderRadius: 6, fontSize: 12, border: "1px solid var(--border)", background: "transparent", color: "var(--text-muted)", cursor: "pointer", alignSelf: "center" }}
          >← 返回</button>
        )}
        <b style={{ fontSize: 24, letterSpacing: 2 }}>{meta.title ?? shownTitle}</b>
        {cat && <span style={{ padding: "2px 10px", borderRadius: 999, fontSize: 11, border: `1px solid ${catColor}`, color: catColor }}>{cat}</span>}
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
        <div style={{ marginTop: 10, fontSize: 13, lineHeight: 1.7, borderLeft: `3px solid ${catColor}`, paddingLeft: 10 }}>
          {meta.summary}
        </div>
      )}

      {content === null ? (
        <div style={{ marginTop: 14, fontSize: 12, color: "var(--text-muted)" }}>装载卡片…</div>
      ) : error ? (
        <div style={{ marginTop: 14, fontSize: 13, color: "var(--text-muted)" }}>{error}</div>
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

      {linkEntries.length > 0 && (onNavigateEntry || onOpenEntry) && (
        <div style={{ marginTop: 16, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>关联词条 · {linkEntries.length}（点击在本页打开）</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {linkEntries.map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() => navigate(e)}
                title={`${e.cat} · ${e.summary?.slice(0, 60) ?? ""}`}
                style={{ padding: "3px 10px", borderRadius: 6, fontSize: 11, border: `1px solid ${catColorOf(e)}66`, background: "transparent", color: "var(--text)", cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}
              >
                <span style={{ width: 7, height: 7, borderRadius: 999, background: catColorOf(e), display: "inline-block" }} />
                {e.title}
              </button>
            ))}
          </div>
        </div>
      )}
      <div style={{ marginTop: 12, fontSize: 11, color: "var(--text-muted)" }}>{shownPath}</div>
    </div>
  );
}
