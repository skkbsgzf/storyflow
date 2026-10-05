"use client";

/** 固定资源管理器侧栏（Obsidian 模型，工单-20261005；20261006 分流：左=文件管理+功能面板，会话归右侧 agent dock）：
 *  左侧栏 = 一棵常驻的分区树（文件/世界书/知识库/大事记/生产线/设置），
 *  手风琴式单区展开；工作台激活的 tab 自动跟随——切到归属区、展开到对应节点、
 *  高亮并滚动可见。导航栏与区头都是常驻入口。 */
import { useEffect, useMemo, useRef, useState } from "react";
import { fetchWbGraph, type WbEntry } from "@/lib/worldbook-data";
import { KB_DOMAIN_STYLE } from "./KbShopView";
import { kitHtmlUrl } from "../mock/kit/client";
import { kitProjectName } from "../mock/kit/hydrate";
import type { WorkTab } from "./WorkTabs";

const ACCENT = "var(--accent, #a5433a)";

export type ExplorerSection = "worldbook" | "knowledge" | "timeline" | "production" | "files" | "settings";
export type OpenWorkTab = (tab: WorkTab) => void;

const SECTIONS: { id: ExplorerSection; icon: string; label: string }[] = [
  { id: "files", icon: "📄", label: "文件" },
  { id: "worldbook", icon: "📖", label: "世界书" },
  { id: "knowledge", icon: "📚", label: "知识库" },
  { id: "timeline", icon: "🕐", label: "大事记" },
  { id: "production", icon: "🏭", label: "生产线" },
  { id: "settings", icon: "⚙", label: "设置" },
];

/** 工作台 tab → 归属区（文件 tab 除外——正文 tab 常驻，不抢焦点）。 */
const TAB_SECTION: Partial<Record<WorkTab["kind"], ExplorerSection>> = {
  entry: "worldbook",
  graph: "worldbook",
  kbcard: "knowledge",
  kbshop: "knowledge",
  timeline: "timeline",
  production: "production",
};

const rowStyle = (on: boolean, indent = 0): React.CSSProperties => ({
  display: "flex", alignItems: "center", gap: 6, width: "100%", textAlign: "left",
  fontSize: 12.5, padding: `4px 8px 4px ${8 + indent * 12}px`, borderRadius: 6,
  border: "none", cursor: "pointer",
  background: on ? "var(--bg-selected)" : "transparent",
  color: on ? ACCENT : "var(--text)",
  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
});
const inputStyle: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: "5px 8px",
  border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-panel, #fff)",
  color: "var(--text)", fontSize: 12, fontFamily: "inherit",
};

export function ExplorerSidebar({
  focused,
  onFocusSection,
  activeTab,
  onOpenWorkTab,
  onOpenSettings,
}: {
  focused: ExplorerSection;
  onFocusSection: (s: ExplorerSection) => void;
  activeTab: WorkTab | null;
  onOpenWorkTab: OpenWorkTab;
  onOpenSettings?: (section: "models" | "skills" | "general") => void;
}) {
  const followRef = useRef(onFocusSection);
  followRef.current = onFocusSection;
  const lastTabId = useRef<string | null>(null);
  const [followKind, setFollowKind] = useState<string | null>(null);

  // 跟随：工作台激活 tab 变化 → 焦点切到归属区（挂载时的初始 tab 不跟随，保持会话为家）
  useEffect(() => {
    const id = activeTab?.id ?? null;
    if (lastTabId.current === null) { lastTabId.current = id; return; }
    if (id === lastTabId.current) return;
    lastTabId.current = id;
    const section = activeTab ? TAB_SECTION[activeTab.kind] : undefined;
    if (!section) { setFollowKind(null); return; }
    setFollowKind(activeTab!.kind);
    followRef.current(section);
  }, [activeTab]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {SECTIONS.map((s) => {
        const open = focused === s.id;
        return (
          <div key={s.id} style={{
            display: "flex", flexDirection: "column",
            flex: open ? "1 1 0" : "0 0 auto", minHeight: 0, overflow: "hidden",
            borderBottom: "1px solid var(--border)",
          }}>
            <button
              type="button"
              onClick={() => onFocusSection(s.id)}
              aria-expanded={open}
              style={{
                display: "flex", alignItems: "center", gap: 7, flexShrink: 0,
                padding: "7px 10px", border: "none", cursor: "pointer",
                background: open ? "var(--bg-panel, transparent)" : "transparent",
                color: open ? "var(--text)" : "var(--text-muted)",
                fontSize: 12, fontWeight: open ? 700 : 500, textAlign: "left",
                fontFamily: "inherit",
              }}
            >
              <span style={{ color: "var(--text-dim, #6b7280)", fontSize: 9, transform: open ? "rotate(90deg)" : "none", transition: "transform .15s" }}>▶</span>
              <span>{s.icon}</span>
              <span>{s.label}</span>
            </button>
            <div style={{
              display: open ? "flex" : "none",
              flex: 1, minHeight: 0, flexDirection: "column", overflow: "hidden",
            }}>
              {s.id === "worldbook" && <WorldbookSection activeTab={activeTab} follow={followKind === "entry" || followKind === "graph"} onOpenWorkTab={onOpenWorkTab} />}
              {s.id === "knowledge" && <KnowledgeSection activeTab={activeTab} follow={followKind === "kbcard" || followKind === "kbshop"} onOpenWorkTab={onOpenWorkTab} />}
              {s.id === "timeline" && <TimelineSection follow={followKind === "timeline"} onOpenWorkTab={onOpenWorkTab} />}
              {s.id === "production" && <ProductionSection activeTab={activeTab} follow={followKind === "production"} onOpenWorkTab={onOpenWorkTab} />}
              {s.id === "files" && <FilesSection activeTab={activeTab} follow={followKind === "file"} onOpenWorkTab={onOpenWorkTab} />}
              {s.id === "settings" && <SettingsSection onOpenSettings={onOpenSettings} />}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** 高亮滚动：revealId 变化后把对应节点滚进可视区。 */
function useRevealScroll(hl: string | null, deps: unknown[]) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!hl) return;
    const t = setTimeout(() => {
      ref.current?.querySelector(`[data-node="${CSS.escape(hl)}"]`)?.scrollIntoView({ block: "nearest" });
    }, 80);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hl, ...deps]);
  return ref;
}

/** kit 就绪门闩：资源管理器各区在页面加载即挂载（display:none 也算），
 *  而 kitMode 要等会话水合完成才为 true——先等门再拉数，否则桥路由 503。 */
async function whenKitReady(timeoutMs = 15000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const { kitMode } = await import("../mock/kit/hydrate");
      if (kitMode()) return true;
    } catch { /* 模块未就绪，继续等 */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

// ── 世界书区：检索 + 图谱 + 分类→词条 树 ──────────────────────────
function WorldbookSection({ activeTab, follow, onOpenWorkTab }: { activeTab: WorkTab | null; follow: boolean; onOpenWorkTab: OpenWorkTab }) {
  const [entries, setEntries] = useState<WbEntry[] | null>(null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ title?: string; path?: string | null }[] | null>(null);
  const [openCats, setOpenCats] = useState<Record<string, boolean>>({});
  const [hl, setHl] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      if (!(await whenKitReady()) || !alive) return;
      try {
        const g = await fetchWbGraph();
        if (alive) setEntries(g.entries);
      } catch { if (alive) setEntries([]); }
    })();
    return () => { alive = false; };
  }, []);

  // 跟随：entry tab → 展开所属分类并高亮；graph tab → 高亮图谱节点
  useEffect(() => {
    if (!follow || !activeTab) return;
    if (activeTab.kind === "graph") { setHl("wb:graph"); return; }
    if (activeTab.kind !== "entry" || !entries) return;
    const bare = activeTab.path.replace(/\.md$/i, "");
    const entry = entries.find((e) => e.path === activeTab.path || e.path === `${activeTab.path}.md` || e.path === bare || e.title === bare);
    if (!entry) return;
    setOpenCats((prev) => ({ ...prev, [entry.cat]: true }));
    setHl(`wb:${entry.path}`);
  }, [follow, activeTab, entries]);

  const bodyRef = useRevealScroll(hl, [entries, openCats]);

  const cats = useMemo(() => {
    if (!entries) return [];
    const m = new Map<string, number>();
    for (const e of entries) m.set(e.cat, (m.get(e.cat) ?? 0) + 1);
    return [...m.entries()].sort((a: [string, number], b: [string, number]) => b[1] - a[1]);
  }, [entries]);

  const runRag = () => {
    const word = q.trim();
    if (!word) { setHits(null); return; }
    fetch(`/api/kit/worldbook?q=${encodeURIComponent(word)}`)
      .then((r) => r.json())
      .then((body: { hits?: { title?: string; path?: string }[] }) => setHits(body.hits ?? []))
      .catch(() => setHits([]));
  };

  const searching = q.trim().length > 0;
  return (
    <div ref={bodyRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "4px 6px" }}>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") runRag(); }}
        placeholder="搜索/RAG…（回车检索）"
        style={{ ...inputStyle, marginBottom: 6 }}
      />
      <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
        <button type="button" onClick={runRag} style={{ flex: 1, padding: "5px 0", border: "1px solid var(--border)", borderRadius: 6, background: "transparent", color: "var(--text-muted)", cursor: "pointer", fontSize: 12 }}>RAG 检索</button>
        <button
          type="button"
          data-node="wb:graph"
          onClick={() => onOpenWorkTab({ kind: "graph", id: "graph", title: "关系图谱" })}
          style={rowStyle(hl === "wb:graph", 0)}
        >🕸 关系图谱</button>
      </div>
      <button
        type="button"
        data-node="wb:pedia"
        onClick={() => onOpenWorkTab({ kind: "html", id: "html:wb-pedia", title: "世界书 · pedia 全页", src: kitHtmlUrl(`/api/panel/worldbook-page?project=${encodeURIComponent(kitProjectName() ?? "")}`) })}
        style={rowStyle(hl === "wb:pedia", 0)}
      >📖 pedia 全页（嵌入面板）</button>
      {searching && hits !== null && (
        <div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", padding: "2px 8px" }}>RAG 命中 · {hits.length}</div>
          {hits.map((h, i) => (
            <button key={i} type="button" onClick={() => { if (h.path) onOpenWorkTab({ kind: "entry", id: `entry:${h.path}`, title: h.title ?? h.path, path: h.path }); }} style={rowStyle(false, 1)}>
              {h.title ?? h.path}
            </button>
          ))}
        </div>
      )}
      {!searching && cats.map(([c, n]) => {
        const openCat = openCats[c] ?? false;
        return (
          <div key={c}>
            <button type="button" onClick={() => setOpenCats((prev) => ({ ...prev, [c]: !prev[c] }))} style={rowStyle(false, 1)}>
              <span style={{ color: "var(--text-dim, #6b7280)", fontSize: 9, width: 10 }}>{openCat ? "▾" : "▸"}</span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{c}</span>
              <span style={{ marginLeft: "auto", opacity: 0.6, fontSize: 11 }}>{n}</span>
            </button>
            {openCat && (entries ?? []).filter((e) => e.cat === c).map((e) => (
              <button
                key={e.path}
                type="button"
                data-node={`wb:${e.path}`}
                onClick={() => onOpenWorkTab({ kind: "entry", id: `entry:${e.path}`, title: e.title, path: e.path })}
                style={rowStyle(hl === `wb:${e.path}`, 2)}
              >
                {e.title}
              </button>
            ))}
          </div>
        );
      })}
      {entries !== null && entries.length === 0 && (
        <div style={{ fontSize: 11, color: "var(--text-muted)", padding: "4px 8px" }}>kit 世界书为空或不可达</div>
      )}
    </div>
  );
}

// ── 知识库区：卡片商店 + 域→卡 树 ─────────────────────────────────
function KnowledgeSection({ activeTab, follow, onOpenWorkTab }: { activeTab: WorkTab | null; follow: boolean; onOpenWorkTab: OpenWorkTab }) {
  const [domains, setDomains] = useState<{ key: string; name: string; count: number }[]>([]);
  const [cards, setCards] = useState<{ id: string; domain: string; title: string }[] | null>(null);
  const [openDoms, setOpenDoms] = useState<Record<string, boolean>>({});
  const [hl, setHl] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      if (!(await whenKitReady()) || !alive) return;
      try {
        const c = await fetch("/api/kit/kb-catalog").then((r) => r.json()) as { domains?: { key: string; name: string; count: number }[]; cards?: { id: string; domain: string; title: string }[] };
        if (!alive) return;
        setDomains(c.domains ?? []);
        setCards(c.cards ?? []);
      } catch { if (alive) { setDomains([]); setCards([]); } }
    })();
    return () => { alive = false; };
  }, []);

  // 跟随：kbcard → 展开所属域并高亮；kbshop → 高亮商店节点（带域过滤则展开该域）
  useEffect(() => {
    if (!follow || !activeTab) return;
    if (activeTab.kind === "kbshop") {
      setHl("kb:shop");
      if (activeTab.domain) setOpenDoms((prev) => ({ ...prev, [activeTab.domain as string]: true }));
      return;
    }
    if (activeTab.kind !== "kbcard") return;
    const domain = activeTab.ref.split("/")[1] ?? "";
    if (domain) setOpenDoms((prev) => ({ ...prev, [domain]: true }));
    setHl(`kb:${activeTab.ref}`);
  }, [follow, activeTab]);

  const bodyRef = useRevealScroll(hl, [cards, openDoms]);

  return (
    <div ref={bodyRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "4px 6px" }}>
      <button
        type="button"
        data-node="kb:shop"
        onClick={() => onOpenWorkTab({ kind: "kbshop", id: "kb-shop", title: "卡片商店" })}
        style={{ ...rowStyle(hl === "kb:shop"), borderColor: hl === "kb:shop" ? ACCENT : "var(--border)", borderWidth: 1, borderStyle: "solid", marginBottom: 4 }}
      >🏪 卡片商店</button>
      {(domains.length ? domains : []).map((d) => {
        const st = KB_DOMAIN_STYLE[d.key] ?? { icon: "📦" };
        const openDom = openDoms[d.key] ?? false;
        return (
          <div key={d.key}>
            <button type="button" onClick={() => setOpenDoms((prev) => ({ ...prev, [d.key]: !prev[d.key] }))} style={rowStyle(false, 1)}>
              <span style={{ color: "var(--text-dim, #6b7280)", fontSize: 9, width: 10 }}>{openDom ? "▾" : "▸"}</span>
              <span>{st.icon}</span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{d.name}</span>
              <span style={{ marginLeft: "auto", opacity: 0.6, fontSize: 11 }}>{d.count}</span>
            </button>
            {openDom && (cards ?? []).filter((c) => c.domain === d.key).map((c) => (
              <button
                key={c.id}
                type="button"
                data-node={`kb:${c.id}`}
                onClick={() => onOpenWorkTab({ kind: "kbcard", id: `kb:${c.id}`, title: c.title, ref: c.id })}
                style={rowStyle(hl === `kb:${c.id}`, 2)}
              >
                {c.title}
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ── 大事记区：单入口 ──────────────────────────────────────────────
function TimelineSection({ follow, onOpenWorkTab }: { follow: boolean; onOpenWorkTab: OpenWorkTab }) {
  const [hl, setHl] = useState<string | null>(null);
  useEffect(() => { if (follow) setHl("tl:open"); }, [follow]);
  const bodyRef = useRevealScroll(hl, []);
  return (
    <div ref={bodyRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "4px 6px" }}>
      <button
        type="button"
        data-node="tl:open"
        onClick={() => onOpenWorkTab({ kind: "timeline", id: "timeline", title: "大事记", project: "" })}
        style={rowStyle(hl === "tl:open")}
      >🕐 打开大事记时间轴</button>
      <button
        type="button"
        data-node="tl:page"
        onClick={() => onOpenWorkTab({ kind: "html", id: "html:journal-page", title: "大事记 · 台账页", src: kitHtmlUrl(`/api/panel/journal-page?project=${encodeURIComponent(kitProjectName() ?? "")}`) })}
        style={rowStyle(false)}
      >🗂 台账页（嵌入面板）</button>
      <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.7, padding: "4px 8px" }}>
        journal 台账流水（批次/节点/裁决）。数据随生产线运行增长。
      </div>
    </div>
  );
}

// ── 生产线区：项目 → 盘面 ─────────────────────────────────────────
function ProductionSection({ activeTab, follow, onOpenWorkTab }: { activeTab: WorkTab | null; follow: boolean; onOpenWorkTab: OpenWorkTab }) {
  const [projects, setProjects] = useState<{ id: string; title?: string }[]>([]);
  const [note, setNote] = useState("");
  const [hl, setHl] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      if (!(await whenKitReady()) || !alive) return;
      try {
        const hub = await fetch("/api/kit/hub").then((r) => r.json()) as { groups?: { projects?: { id: string; title?: string }[] }[] };
        if (alive) setProjects((hub.groups ?? []).flatMap((g) => g.projects ?? []));
      } catch { if (alive) setNote("hub 不可达"); }
    })();
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    if (!follow || !activeTab || activeTab.kind !== "production") return;
    setHl(`prod:${activeTab.project}`);
  }, [follow, activeTab]);
  const bodyRef = useRevealScroll(hl, [projects]);

  return (
    <div ref={bodyRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "4px 6px" }}>
      {projects.map((p) => (
        <button
          key={p.id}
          type="button"
          data-node={`prod:${p.id}`}
          onClick={() => onOpenWorkTab({ kind: "production", id: `production:${p.id}`, title: `盘面 · ${p.title || p.id}`, project: p.id })}
          style={rowStyle(hl === `prod:${p.id}`, 1)}
        >
          🏭 {p.title || p.id}
        </button>
      ))}
      {!projects.length && <div style={{ fontSize: 11, color: "var(--text-muted)", padding: "4px 8px" }}>{note || "（无项目）"}</div>}
    </div>
  );
}

// ── 文件区：懒加载目录树 + 路径跟随展开 ───────────────────────────
interface DirEntry { name: string; isDir: boolean }

function FilesSection({ activeTab, follow, onOpenWorkTab }: { activeTab: WorkTab | null; follow: boolean; onOpenWorkTab: OpenWorkTab }) {
  const [dirs, setDirs] = useState<Record<string, DirEntry[]>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [hl, setHl] = useState<string | null>(null);

  const fetchDir = useRef(async (dir: string) => {
    const body = await fetch(`/api/kit/files-root?dir=${encodeURIComponent(dir)}`).then((r) => r.json()) as { entries?: DirEntry[] };
    setDirs((prev) => ({ ...prev, [dir]: body.entries ?? [] }));
  });

  useEffect(() => {
    let alive = true;
    void (async () => {
      if (!(await whenKitReady()) || !alive) return;
      await fetchDir.current("").catch(() => {});
    })();
    return () => { alive = false; };
  }, []);

  // 跟随：file tab → 逐级加载祖先目录、展开、高亮
  const lastReveal = useRef<string | null>(null);
  useEffect(() => {
    if (!follow || !activeTab || activeTab.kind !== "file") return;
    const path = activeTab.path;
    if (lastReveal.current === path) return;
    lastReveal.current = path;
    let alive = true;
    void (async () => {
      const segs = path.split("/");
      for (let i = 1; i < segs.length; i++) {
        const dir = segs.slice(0, i).join("/");
        await fetchDir.current(dir).catch(() => {});
        if (!alive) return;
        setOpen((prev) => ({ ...prev, [dir]: true }));
      }
      if (alive) setHl(`file:${path}`);
    })();
    return () => { alive = false; };
  }, [follow, activeTab]);

  const bodyRef = useRevealScroll(hl, [dirs, open]);

  const renderEntries = (dir: string, depth: number, entries: DirEntry[]) => (
    <>
      {entries.map((item) => {
        const full = dir ? `${dir}/${item.name}` : item.name;
        if (item.isDir) {
          const isOpen = open[full] ?? false;
          const children = dirs[full];
          return (
            <div key={`d:${full}`}>
              <button type="button" data-node={`dir:${full}`} onClick={() => { setOpen((prev) => ({ ...prev, [full]: !prev[full] })); if (!children) void fetchDir.current(full).catch(() => {}); }} style={rowStyle(false, depth)}>
                <span style={{ color: "var(--text-dim, #6b7280)", fontSize: 9, width: 10 }}>{isOpen ? "▾" : "▸"}</span>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{item.name}</span>
              </button>
              {isOpen && children && renderEntries(full, depth + 1, children)}
            </div>
          );
        }
        return (
          <button
            key={`f:${full}`}
            type="button"
            data-node={`file:${full}`}
            onClick={() => onOpenWorkTab({ kind: "file", id: `file:${full}`, title: item.name, path: full })}
            style={rowStyle(hl === `file:${full}`, depth)}
          >
            {item.name}
          </button>
        );
      })}
    </>
  );

  return (
    <div ref={bodyRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "4px 6px" }}>
      {dirs[""] ? renderEntries("", 0, dirs[""]) : <div style={{ fontSize: 11, color: "var(--text-muted)", padding: 6 }}>装载…</div>}
    </div>
  );
}

// ── 设置区：三个入口（全屏设置页的分节直跳） ─────────────────────
function SettingsSection({ onOpenSettings }: { onOpenSettings?: (section: "models" | "skills" | "general") => void }) {
  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "4px 6px" }}>
      {([["models", "⚙ 模型配置"], ["skills", "🧩 技能"], ["general", "🔧 通用设置"]] as const).map(([sec, label]) => (
        <button key={sec} type="button" onClick={() => onOpenSettings?.(sec)} style={rowStyle(false, 1)}>{label}</button>
      ))}
      <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.7, padding: "4px 8px" }}>
        设置页为全屏视图——打开后经其「返回」回到工作台。
      </div>
    </div>
  );
}
