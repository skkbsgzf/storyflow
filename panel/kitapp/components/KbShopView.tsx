"use client";

/** 知识库 · 卡片商店（工单-20261005）：语料卡以商店卡墙呈现——
 *  域签条（中文名+计数+域色）+ 检索过滤 + 卡片网格（图标/中文题/类型徽章/摘要/版本脚注）。
 *  点卡 → 开 kbcard tab 深读。数据：/api/kit/kb-catalog（盘上 115 卡 frontmatter 静态汇总）。 */
import { useEffect, useMemo, useState } from "react";
import type { KitKbCard, KitKbCatalog } from "@/mock/kit/client";

/** 域视觉语言：图标 + 主色（侧栏与卡墙共用一套口径） */
export const KB_DOMAIN_STYLE: Record<string, { icon: string; color: string }> = {
  aesthetic: { icon: "🎨", color: "#b58ee0" },
  structure: { icon: "🏗", color: "#7aa7e0" },
  craft: { icon: "✒", color: "#5fb3a1" },
  market: { icon: "📊", color: "#e0a95a" },
  formats: { icon: "📐", color: "#5fb8c9" },
  method: { icon: "🧭", color: "#7ec97e" },
  trope: { icon: "🔥", color: "#e0856a" },
  benchmark: { icon: "📏", color: "#d97fa6" },
  rules: { icon: "⚖", color: "#d3b84f" },
  continuity: { icon: "🔗", color: "#8f9fe0" },
  deconstruct: { icon: "🔍", color: "#a98ad8" },
  "semif-calibration": { icon: "🎯", color: "#9aa7b4" },
};

/** 卡类型中文名（与 knowledge/index.json types 表同口径） */
export const KB_TYPE_NAMES: Record<string, string> = {
  "aesthetic-standard": "审美判定标准",
  "style-route": "风格路线档位",
  "rule-corpus": "规则语料卡",
  "market-snapshot": "市场快照",
  "market-standard": "网感公式标准",
  "deconstruct-protocol": "拆解协议",
  "continuity-standard": "连续性标准",
  "format-standard": "形态标准",
  "structure-catalog": "结构选型目录",
  "meme-standard": "梗密度约束",
  "trope": "梗条目",
  "benchmark": "对标件",
  "craft-standard": "成文工艺标准",
};

const OK = "#5f9c7a";

export function KbShopView({
  domain,
  onOpenCard,
}: {
  domain?: string;
  onOpenCard: (ref: string, title: string) => void;
}) {
  const [catalog, setCatalog] = useState<KitKbCatalog | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<string>(domain ?? "all");
  const [q, setQ] = useState("");
  const [nonce, setNonce] = useState(0);

  useEffect(() => { setFilter(domain ?? "all"); }, [domain]);
  useEffect(() => {
    let alive = true;
    setError("");
    fetch("/api/kit/kb-catalog")
      .then((r) => r.json())
      .then((c: KitKbCatalog) => {
        if (!alive) return;
        // 失败体（{error:...}）也走错误态——catalog.cards 未校验曾把整棵应用树炸掉
        if (!c || !Array.isArray(c.cards)) throw new Error(String((c as { error?: string })?.error ?? "目录格式非法"));
        setCatalog(c);
      })
      .catch((e) => { if (alive) setError(String((e as Error).message ?? e)); });
    return () => { alive = false; };
  }, [nonce]);

  const cards = Array.isArray(catalog?.cards) ? catalog.cards : [];
  const shown = useMemo(() => {
    const word = q.trim().toLowerCase();
    return cards.filter((c) => {
      if (filter !== "all" && c.domain !== filter) return false;
      if (!word) return true;
      return `${c.title} ${c.summary} ${c.typeName} ${c.id}`.toLowerCase().includes(word);
    });
  }, [cards, filter, q]);

  if (error) {
    return (
      <div style={{ padding: 20 }}>
        <div style={{ border: "1px solid #b3564d", borderRadius: 10, padding: "12px 14px", fontSize: 13, color: "#d98a83", marginBottom: 12 }}>
          目录装载失败：{error}
        </div>
        <button type="button" onClick={() => setNonce((n) => n + 1)} style={{ padding: "7px 16px", border: "1px solid var(--border)", borderRadius: 8, background: "transparent", color: "var(--text)", cursor: "pointer", fontSize: 13 }}>
          重试
        </button>
      </div>
    );
  }
  if (!catalog) return <div style={{ padding: 20, fontSize: 13, color: "var(--text-muted)" }}>装载卡片目录…</div>;

  const domains = Array.isArray(catalog.domains) ? catalog.domains : [];
  const total = catalog.total ?? cards.length;

  return (
    <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
      {/* 头：总量 + 检索 */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <b style={{ fontSize: 15 }}>🏪 卡片商店</b>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>共 {total} 张语料卡 · 写手 agent 的弹药库</span>
        <span style={{ flex: 1 }} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="过滤：标题 / 摘要 / 类型…"
          style={{ width: 240, padding: "7px 10px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg-panel, transparent)", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none" }}
        />
      </div>

      {/* 域签条 */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" onClick={() => setFilter("all")} style={chip(filter === "all", "var(--accent)")}>
          全部 · {total}
        </button>
        {domains.map((d) => {
          const st = KB_DOMAIN_STYLE[d.key] ?? { icon: "📦", color: "var(--text-muted)" };
          return (
            <button key={d.key} type="button" onClick={() => setFilter(d.key)} title={d.desc} style={chip(filter === d.key, st.color)}>
              <span>{st.icon}</span>
              <span>{d.name}</span>
              <span style={{ opacity: 0.75 }}>· {d.count}</span>
            </button>
          );
        })}
      </div>

      {/* 当前域说明 */}
      {filter !== "all" && (
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {domains.find((d) => d.key === filter)?.desc ?? ""}
        </div>
      )}

      {/* 卡墙 */}
      {shown.length === 0 ? (
        <div style={{ padding: "30px 0", fontSize: 13, color: "var(--text-muted)", textAlign: "center" }}>没有匹配的卡片——换个词或换个域。</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(236px, 1fr))", gap: 12 }}>
          {shown.map((c) => (
            <ShopCard key={c.id} card={c} onOpen={() => onOpenCard(c.id, c.title)} />
          ))}
        </div>
      )}
    </div>
  );
}

function chip(on: boolean, color: string): React.CSSProperties {
  return {
    display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 12px", fontSize: 12,
    borderRadius: 999, cursor: "pointer", fontFamily: "inherit",
    border: `1px solid ${on ? color : "var(--border)"}`,
    background: on ? `${color}1c` : "transparent",
    color: on ? color : "var(--text-muted)",
  };
}

function ShopCard({ card, onOpen }: { card: KitKbCard; onOpen: () => void }) {
  const st = KB_DOMAIN_STYLE[card.domain] ?? { icon: "📦", color: "var(--text-muted)" };
  const active = card.status === "active";
  return (
    <div
      role="button"
      aria-label={`卡片 ${card.title}`}
      onClick={onOpen}
      style={{
        display: "flex", flexDirection: "column", gap: 7, padding: "12px 13px", cursor: "pointer",
        border: "1px solid var(--border)", borderRadius: 12, background: "var(--bg-panel, transparent)",
        transition: "transform .12s ease, border-color .12s ease, box-shadow .12s ease",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.borderColor = st.color; e.currentTarget.style.boxShadow = `0 4px 14px ${st.color}22`; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = "none"; e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.boxShadow = "none"; }}
    >
      {/* 域 + 状态 */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 13 }}>{st.icon}</span>
        <span style={{ fontSize: 11, color: st.color }}>{card.domain}</span>
        <span style={{ flex: 1 }} />
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10.5, color: active ? OK : "var(--text-dim, #6b7280)" }}>
          <span style={{ width: 6, height: 6, borderRadius: 999, background: active ? OK : "var(--text-dim, #6b7280)", display: "inline-block" }} />
          {card.status || "未知"}
        </span>
      </div>
      {/* 中文题 */}
      <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.45, color: "var(--text)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
        {card.title}
      </div>
      {/* 类型徽章 */}
      {card.typeName && (
        <div>
          <span style={{ fontSize: 10.5, padding: "2px 8px", borderRadius: 999, border: "1px solid var(--border)", color: "var(--text-muted)" }}>
            {card.typeName}
          </span>
        </div>
      )}
      {/* 摘要 */}
      <div style={{ fontSize: 12, lineHeight: 1.6, color: "var(--text-muted)", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden", minHeight: 38 }}>
        {card.summary || "（无摘要——点开阅读全文）"}
      </div>
      {/* 脚注 */}
      <div style={{ display: "flex", gap: 8, fontSize: 10.5, color: "var(--text-dim, #6b7280)", fontFamily: "var(--font-mono)", marginTop: "auto" }}>
        <span>v{card.version || "?"}</span>
        {card.updated && <span>{card.updated}</span>}
        <span style={{ marginLeft: "auto", opacity: 0.8 }}>阅读 →</span>
      </div>
    </div>
  );
}
