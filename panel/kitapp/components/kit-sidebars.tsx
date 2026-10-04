"use client";

/** 工具侧栏（批A · Obsidian 模型）：随导航切换的纯列表（230px）。
 *  点任何条目 = 在主内容区开一个 tab（openWorkTab）；侧栏自身不渲染看板。 */
import { useEffect, useMemo, useState } from "react";
import { catColorOf, fetchWbGraph, type WbEntry } from "@/lib/worldbook-data";
import { KB_DOMAIN_STYLE } from "./KbShopView";
import type { WorkTab } from "./WorkTabs";

const ACCENT = "var(--accent, #a5433a)";

export type ToolId = "worldbook" | "timeline" | "knowledge" | "production" | "files" | "settings";
export type OpenWorkTab = (tab: WorkTab) => void;

const itemStyle = (on: boolean): React.CSSProperties => ({
  display: "block", width: "100%", textAlign: "left", fontSize: 12.5,
  padding: "5px 8px", borderRadius: 6, border: "none", cursor: "pointer",
  background: on ? "var(--bg-selected)" : "transparent",
  color: on ? ACCENT : "var(--text)",
  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
});
const sectionLabel: React.CSSProperties = { fontSize: 11, color: "var(--text-muted)", padding: "6px 8px 2px" };
const inputStyle: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: "5px 8px", marginBottom: 6,
  border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-panel, #fff)",
  color: "var(--text)", fontSize: 12, fontFamily: "inherit",
};
const wideBtn: React.CSSProperties = {
  width: "100%", padding: "6px 0", marginBottom: 8, border: `1px solid ${ACCENT}`,
  borderRadius: 6, background: "transparent", color: ACCENT, cursor: "pointer", fontSize: 12,
};

// ── 世界书侧栏：分类 + 词条列表 + RAG ─────────────────────────────
function WorldbookSidebar({ open }: { open: OpenWorkTab }) {
  const [graph, setGraph] = useState<WbEntry[] | null>(null);
  const [cat, setCat] = useState("全部");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ title?: string; path?: string | null }[] | null>(null);

  useEffect(() => {
    fetchWbGraph()
      .then((g) => setGraph(g.entries))
      .catch(() => setGraph([])); // kit 不可达 = 空列表（不卡 Loading）
  }, []);

  const cats = useMemo(() => {
    if (!graph) return [];
    const m = new Map<string, number>();
    for (const e of graph) m.set(e.cat, (m.get(e.cat) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [graph]);

  const visible = (graph ?? []).filter((e) => {
    if (cat !== "全部" && e.cat !== cat) return false;
    const w = q.trim();
    return !w || e.title.includes(w) || e.tags.some((t) => t.includes(w));
  });

  const runRag = () => {
    const word = q.trim();
    if (!word) return;
    fetch(`/api/kit/worldbook?q=${encodeURIComponent(word)}`)
      .then((r) => r.json())
      .then((body: { hits?: { title?: string; path?: string }[] }) => setHits(body.hits ?? []))
      .catch(() => setHits([]));
  };

  return (
    <div>
      <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { runRag(); setCat("全部"); } }} placeholder="搜索/RAG…" style={inputStyle} />
      <button type="button" onClick={() => { runRag(); setCat("全部"); }} style={wideBtn}>RAG 检索</button>
      <button type="button" onClick={() => open({ kind: "graph", id: "graph", title: "关系图谱" })} style={wideBtn}>🕸 关系图谱</button>
      <div style={sectionLabel}>分类</div>
      <button type="button" onClick={() => { setCat("全部"); setHits(null); }} style={itemStyle(cat === "全部")}>全部{graph ? ` · ${graph.length}` : ""}</button>
      {cats.map(([c, n]) => (
        <button key={c} type="button" onClick={() => { setCat(c); setHits(null); }} style={itemStyle(cat === c)}>{c} · {n}</button>
      ))}
      <div style={sectionLabel}>词条</div>
      {graph !== null && graph.length === 0 && (
        <div style={{ fontSize: 11, color: "var(--text-muted)", padding: "4px 8px" }}>kit 世界书为空或不可达</div>
      )}
      {(hits ?? visible).map((e) => {
        const title = ("title" in e ? e.title : (e as WbEntry).title) ?? "（无题）";
        const path = ("path" in (e as WbEntry) ? (e as WbEntry).path : (e as { path?: string }).path) ?? "";
        return (
          <button key={path || title} type="button" onClick={() => { if (path) open({ kind: "entry", id: `entry:${path}`, title, path }); }} style={itemStyle(false)}>
            {title}
          </button>
        );
      })}
    </div>
  );
}

// ── 知识库侧栏：域 + 检索命中 ─────────────────────────────────────
const KB_DOMAINS = ["aesthetic", "rules", "craft", "structure", "trope", "market", "formats", "method", "deconstruct", "continuity"];

/** 知识库侧栏：卡片商店入口 + 中文域列表（点域开商店并过滤）+ 检索（命中开深读卡）。 */
function KnowledgeSidebar({ open }: { open: OpenWorkTab }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ ref?: string; title?: string }[] | null>(null);
  const [domains, setDomains] = useState<{ key: string; name: string; count: number }[]>([]);
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/kit/kb-catalog")
      .then((r) => r.json())
      .then((c: { domains?: { key: string; name: string; count: number }[] }) => { if (alive) setDomains(c.domains ?? []); })
      .catch(() => { /* 目录缺席时侧栏域列表留空，商店页内仍有完整域签条 */ });
    return () => { alive = false; };
  }, []);

  const run = (word: string) => {
    const term = word.trim();
    if (!term) return;
    fetch(`/api/kit/kb?q=${encodeURIComponent(term)}`)
      .then((r) => r.json())
      .then((body: { hits?: { ref?: string; title?: string }[] }) => setHits(body.hits ?? []))
      .catch(() => setHits([]));
  };

  const openShop = (domain?: string) => {
    setActive(domain ?? null);
    open({ kind: "kbshop", id: "kb-shop", title: domain ? `卡片商店 · ${domains.find((d) => d.key === domain)?.name ?? domain}` : "卡片商店", domain });
  };

  return (
    <div>
      <button type="button" onClick={() => openShop()} style={{ ...wideBtn, borderColor: "var(--accent)" }}>🏪 卡片商店</button>
      <div style={sectionLabel}>语料域</div>
      {(domains.length ? domains : KB_DOMAINS.map((k) => ({ key: k, name: k, count: 0 }))).map((d) => {
        const st = KB_DOMAIN_STYLE[d.key] ?? { icon: "📦" };
        return (
          <button key={d.key} type="button" onClick={() => openShop(d.key)} style={itemStyle(active === d.key)}>
            <span style={{ marginRight: 6 }}>{st.icon}</span>
            {d.name}
            {d.count > 0 && <span style={{ float: "right", opacity: 0.65 }}>{d.count}</span>}
          </button>
        );
      })}
      <div style={sectionLabel}>检索{hits ? ` · 命中 ${hits.length}` : ""}</div>
      <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") run(q); }} placeholder="检索方法论…" style={inputStyle} />
      {(hits ?? []).map((h, i) => {
        const ref = h.ref ?? "";
        return (
          <button key={i} type="button" onClick={() => open({ kind: "kbcard", id: `kb:${ref}`, title: h.title ?? ref, ref })} style={itemStyle(false)}>
            {h.title ?? ref}
          </button>
        );
      })}
    </div>
  );
}

// ── 大事记侧栏 ────────────────────────────────────────────────────
function TimelineSidebar({ open }: { open: OpenWorkTab }) {
  return (
    <div>
      <button type="button" onClick={() => open({ kind: "timeline", id: "timeline", title: "大事记", project: "" })} style={wideBtn}>
        🕐 打开大事记时间轴
      </button>
      <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.7 }}>
        journal 台账流水（批次/节点/裁决）。数据随生产线运行增长。
      </div>
    </div>
  );
}

// ── 生产线侧栏 ────────────────────────────────────────────────────
function ProductionSidebar({ open }: { open: OpenWorkTab }) {
  const [projects, setProjects] = useState<{ id: string; title?: string }[]>([]);
  const [note, setNote] = useState("");

  useEffect(() => {
    fetch("/api/kit/hub")
      .then((r) => r.json())
      .then((hub: { groups?: { projects?: { id: string; title?: string }[] }[] }) => {
        setProjects((hub.groups ?? []).flatMap((g) => g.projects ?? []));
      })
      .catch(() => setNote("hub 不可达"));
  }, []);

  return (
    <div>
      <div style={sectionLabel}>项目 → 盘面</div>
      {projects.map((p) => (
        <button key={p.id} type="button" onClick={() => open({ kind: "production", id: `production:${p.id}`, title: `盘面 · ${p.title || p.id}`, project: p.id })} style={itemStyle(false)}>
          🏭 {p.title || p.id}
        </button>
      ))}
      {!projects.length && <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{note || "（无项目）"}</div>}
    </div>
  );
}

// ── 文件侧栏：递归树 ──────────────────────────────────────────────
function FilesSidebar({ open }: { open: OpenWorkTab }) {
  const [tree, setTree] = useState<{ name: string; isDir: boolean }[] | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ "世界书": true });

  useEffect(() => {
    fetch("/api/kit/files-root")
      .then((r) => r.json())
      .then((body: { entries?: { name: string; isDir: boolean }[] }) => setTree(body.entries ?? []))
      .catch(() => setTree([]));
  }, []);

  const renderDir = (dir: string, depth: number, entries: { name: string; isDir: boolean }[]) => (
    <div>
      {entries.map((item) => {
        const full = dir ? `${dir}/${item.name}` : item.name;
        const isOpen = expanded[full];
        return (
          <div key={full}>
            <button
              type="button"
              onClick={() => {
                if (item.isDir) setExpanded((prev) => ({ ...prev, [full]: !prev[full] }));
                else open({ kind: "file", id: `file:${full}`, title: item.name, path: full });
              }}
              style={{ ...itemStyle(false), paddingLeft: 6 + depth * 12 }}
            >
              {item.isDir ? `${isOpen ? "▾" : "▸"} ` : ""}{item.name}
            </button>
            {item.isDir && isOpen && <DirList dir={full} depth={depth + 1} renderDir={renderDir} />}
          </div>
        );
      })}
    </div>
  );

  return (
    <div>
      {tree === null && <div style={{ fontSize: 11, color: "var(--text-muted)", padding: 6 }}>装载…</div>}
      {tree !== null && renderDir("", 0, tree)}
    </div>
  );
}

function DirList({ dir, depth, renderDir }: { dir: string; depth: number; renderDir: (d: string, n: number, e: { name: string; isDir: boolean }[]) => React.ReactNode }) {
  const [children, setChildren] = useState<{ name: string; isDir: boolean }[] | null>(null);
  useEffect(() => {
    fetch(`/api/kit/files-root?dir=${encodeURIComponent(dir)}`)
      .then((r) => r.json())
      .then((body: { entries?: { name: string; isDir: boolean }[] }) => setChildren(body.entries ?? []))
      .catch(() => setChildren([]));
  }, [dir]);
  if (children === null) return null;
  return <>{renderDir(dir, depth, children)}</>;
}

// ── 设置侧栏（占位） ──────────────────────────────────────────────
function SettingsSidebar() {
  return (
    <div>
      <div style={sectionLabel}>设置（批3 后续迁入）</div>
      {["模型配置", "连接自探针", "外观"].map((s) => (
        <div key={s} style={{ ...itemStyle(false), cursor: "default", color: "var(--text-dim)" }}>{s}</div>
      ))}
    </div>
  );
}

// ── 分发 ──────────────────────────────────────────────────────────
export function ToolSidebar({ tool, onOpenWorkTab, onOpenEntry }: { tool: ToolId; onOpenWorkTab: OpenWorkTab; onOpenEntry?: (path: string, title: string) => void }) {
  switch (tool) {
    case "worldbook": return <WorldbookSidebar open={onOpenWorkTab} />;
    case "timeline": return <TimelineSidebar open={onOpenWorkTab} />;
    case "knowledge": return <KnowledgeSidebar open={onOpenWorkTab} />;
    case "production": return <ProductionSidebar open={onOpenWorkTab} />;
    case "files": return <FilesSidebar open={onOpenWorkTab} />;
    case "settings": return <SettingsSidebar />;
    default: return null;
  }
}
