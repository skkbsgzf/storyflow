"use client";

// 世界书面板（工单-20261002 深度适配 · kit 独有能力）：
// 检索走 kit worldbook_search（词面打分 + 一跳图扩展），卡片正文走 kit 文件读取。
// 数据经桥路由 /api/kit/worldbook 与 /api/kit/entry（mock/router.ts），组件不自知 kit 地址。
import { useCallback, useState } from "react";

interface Hit {
  title?: string;
  summary?: string;
  path?: string | null;
  cat?: string;
}

export function WorldbookPanel() {
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [entry, setEntry] = useState<{ path: string; content: string } | null>(null);
  const [error, setError] = useState("");

  const search = useCallback(async (query: string) => {
    const word = query.trim();
    if (!word) return;
    setLoading(true);
    setError("");
    setEntry(null);
    try {
      const res = await fetch(`/api/kit/worldbook?q=${encodeURIComponent(word)}`);
      const body = (await res.json()) as { hits?: Hit[] };
      setHits(body.hits ?? []);
      if (!(body.hits ?? []).length) setError("无命中——试试更短的词（人物名 / 绰号 / 地标）");
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setLoading(false);
    }
  }, []);

  const openEntry = useCallback(async (path: string) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/kit/entry?path=${encodeURIComponent(path)}`);
      const body = (await res.json()) as { path: string; content: string };
      setEntry(body);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setLoading(false);
    }
  }, []);

  const inputStyle: React.CSSProperties = {
    flex: 1,
    minWidth: 0,
    padding: "6px 10px",
    border: "1px solid var(--border)",
    borderRadius: 6,
    background: "var(--bg-input, #fff)",
    color: "var(--text)",
    fontSize: 13,
    fontFamily: "inherit",
  };
  const btnStyle: React.CSSProperties = {
    padding: "6px 12px",
    border: "1px solid var(--accent, #a5433a)",
    borderRadius: 6,
    background: "var(--accent, #a5433a)",
    color: "#fff",
    cursor: loading ? "wait" : "pointer",
    fontSize: 12,
    whiteSpace: "nowrap",
  };

  return (
    <div
      className="worldbook-panel"
      style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 10 }}
    >
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <b style={{ fontSize: 13, whiteSpace: "nowrap" }}>📖 世界书</b>
        <input
          style={inputStyle}
          value={q}
          placeholder="检索本书设定（人物 / 绰号 / 地标 / 规则）"
          onChange={(event) => setQ(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void search(q);
          }}
        />
        <button type="button" style={btnStyle} onClick={() => void search(q)} disabled={loading}>
          检索
        </button>
      </div>

      {error && (
        <div style={{ color: "var(--text-muted)", fontSize: 12 }}>{error}</div>
      )}

      {entry ? (
        <div>
          <button
            type="button"
            onClick={() => setEntry(null)}
            style={{ ...btnStyle, background: "transparent", color: "var(--text-muted)", borderColor: "var(--border)", marginBottom: 8 }}
          >
            ← 返回检索结果
          </button>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>{entry.path}</div>
          <pre
            style={{
              margin: 0,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              fontFamily: "inherit",
              fontSize: 13,
              lineHeight: 1.7,
              maxHeight: "52vh",
              overflow: "auto",
              background: "var(--bg-panel, transparent)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: 12,
            }}
          >
            {entry.content}
          </pre>
        </div>
      ) : (
        hits && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: "56vh", overflow: "auto" }}>
            {hits.length === 0 && !error && (
              <div style={{ color: "var(--text-muted)", fontSize: 12 }}>（无命中）</div>
            )}
            {hits.map((hit, i) => (
              <div
                key={`${hit.title ?? "hit"}-${i}`}
                style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px" }}
              >
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <b style={{ fontSize: 13 }}>{hit.title ?? "（无题）"}</b>
                  {hit.cat && (
                    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{hit.cat}</span>
                  )}
                </div>
                {hit.summary && (
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4, lineHeight: 1.6 }}>
                    {hit.summary}
                  </div>
                )}
                {hit.path && (
                  <button
                    type="button"
                    onClick={() => void openEntry(hit.path!)}
                    style={{ ...btnStyle, background: "transparent", color: "var(--accent, #a5433a)", marginTop: 6 }}
                  >
                    读卡片全文
                  </button>
                )}
              </div>
            ))}
          </div>
        )
      )}

      {!hits && !error && (
        <div style={{ color: "var(--text-muted)", fontSize: 12 }}>
          检索世界书词条（GraphHyperRAG：标题 / 标签 / 摘要 / 正文打分 + 一跳关系扩展）。
          结果是证据与素材，不构成裁决。
        </div>
      )}
    </div>
  );
}
