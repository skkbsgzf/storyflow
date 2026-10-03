"use client";

/** 知识库专有页（工单-20261002 批3）：RAG 方法论检索 + 读卡。
 *  数据 = kit 内核动词 kb_search / kb_read（经桥路由 /api/kit/kb | kb-read）。 */
import { useCallback, useState } from "react";
import ReactMarkdown from "react-markdown";

interface KbHit {
  ref?: string;
  id?: string;
  title?: string;
  snippet?: string;
}

const ACCENT = "var(--accent, #a5433a)";
/** kit 标准语料域（README §2.4）；点分类 = 以域名为词检索并按 ref 过滤。 */
const DOMAINS = ["aesthetic", "rules", "craft", "structure", "trope", "market", "formats", "method", "deconstruct", "continuity"];

export function KnowledgePage() {
  const [q, setQ] = useState("");
  const [domain, setDomain] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [hits, setHits] = useState<KbHit[] | null>(null);
  const [card, setCard] = useState<{ ref: string; content: string } | null>(null);
  const [error, setError] = useState("");

  const search = useCallback(async (word: string, filter: string | null) => {
    const term = (word || filter || "").trim();
    if (!term) return;
    setSearching(true);
    setError("");
    setCard(null);
    try {
      const r = await fetch(`/api/kit/kb?q=${encodeURIComponent(term)}`);
      const body = (await r.json()) as { hits?: KbHit[] };
      let list = body.hits ?? [];
      if (filter) list = list.filter((h) => (h.ref ?? h.id ?? "").includes(filter));
      setHits(list);
      if (!list.length) setError("无命中——换个词试试（如 节奏 / 视角 / 去AI味 / 钩子）");
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setSearching(false);
    }
  }, []);

  const openCard = useCallback((ref: string) => {
    fetch(`/api/kit/kb-read?ref=${encodeURIComponent(ref)}`)
      .then((r) => r.json())
      .then((body: { content?: string }) => setCard({ ref, content: body.content ?? "（读卡失败）" }))
      .catch(() => setCard({ ref, content: "（读卡失败）" }));
  }, []);

  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 300, background: "var(--bg)", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <b style={{ fontSize: 15, letterSpacing: 2, whiteSpace: "nowrap" }}>📚 知识库</b>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void search(q, domain); }}
          placeholder="检索写作方法论与标尺卡（aesthetic/rules/craft/structure…）"
          style={{ flex: 1, minWidth: 0, padding: "7px 12px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg-panel, #fff)", color: "var(--text)", fontSize: 13, fontFamily: "inherit" }}
        />
        <button type="button" onClick={() => void search(q, domain)} disabled={searching} style={{ padding: "7px 16px", border: `1px solid ${ACCENT}`, borderRadius: 8, background: ACCENT, color: "#fff", cursor: searching ? "wait" : "pointer", fontSize: 13, whiteSpace: "nowrap" }}>
          {searching ? "检索中…" : "检索"}
        </button>
      </div>

      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {/* 左栏：语料域 */}
        <div style={{ width: 170, flexShrink: 0, borderRight: "1px solid var(--border)", overflow: "auto", padding: "10px 8px", display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "4px 8px" }}>语料域</div>
          <button type="button" onClick={() => { setDomain(null); }} style={chip(!domain)}>全部</button>
          {DOMAINS.map((d) => (
            <button key={d} type="button" onClick={() => { setDomain(d); void search(q, d); }} style={chip(domain === d)}>{d}</button>
          ))}
        </div>

        <div style={{ flex: 1, minWidth: 0, overflow: "auto", padding: 14 }}>
          {error && <div style={{ color: "var(--text-muted)", marginBottom: 10 }}>{error}</div>}

          {card ? (
            <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: "18px 22px", background: "var(--bg-panel, transparent)", maxWidth: 980 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <b style={{ fontSize: 18 }}>{card.ref}</b>
                <span style={{ flex: 1 }} />
                <button type="button" onClick={() => setCard(null)} style={chip(false)}>← 返回</button>
              </div>
              <div className="markdown-body" style={{ fontSize: 14, lineHeight: 1.9 }}>
                <ReactMarkdown>{card.content}</ReactMarkdown>
              </div>
            </div>
          ) : (
            hits && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 980 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>检索结果 · {hits.length} 命中</div>
                {hits.length === 0 && !error && <div style={{ color: "var(--text-muted)", fontSize: 12 }}>（无命中）</div>}
                {hits.map((hit, i) => {
                  const ref = hit.ref ?? hit.id ?? "";
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => openCard(ref)}
                      style={{ textAlign: "left", border: "1px solid var(--border)", borderLeft: `3px solid ${ACCENT}`, borderRadius: 8, padding: "10px 12px", background: "var(--bg-panel, transparent)", cursor: "pointer", color: "var(--text)" }}
                    >
                      <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                        <b style={{ fontSize: 13 }}>{hit.title ?? ref}</b>
                        <span style={{ fontSize: 11, color: ACCENT }}>{ref}</span>
                      </div>
                      {hit.snippet && <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4, lineHeight: 1.6 }}>{hit.snippet}</div>}
                    </button>
                  );
                })}
              </div>
            )
          )}

          {!hits && !card && !error && (
            <div style={{ color: "var(--text-muted)", fontSize: 13 }}>
              kit 本地语料层：方法论 / 标尺 / 市场面（aesthetic·rules·craft…）。
              检索是证据与素材，不构成裁决。
            </div>
          )}
        </div>
      </div>
    </div>
  );

  function chip(on: boolean): React.CSSProperties {
    return {
      padding: "4px 10px", borderRadius: 6, fontSize: 12, cursor: "pointer", textAlign: "left",
      border: `1px solid ${on ? ACCENT : "var(--border)"}`,
      background: on ? "var(--bg-selected)" : "transparent",
      color: on ? ACCENT : "var(--text-muted)",
      whiteSpace: "nowrap",
    };
  }
}
