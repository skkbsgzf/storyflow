// KB 检索/读卡（只读）：把 knowledge/ 的方法论资产暴露给 agent（verb 面）。
// 事实源 = knowledge/ 目录本身；index.json 只做 id→file 的权威映射（缺 index 时扫盘兜底）。
import * as fs from "node:fs";
import * as path from "node:path";

export interface KbHit {
  id: string;
  title: string;
  file: string; // 相对 knowledge/ 的路径
  dir: string;
  score: number;
  excerpt: string;
}

interface CardMeta {
  id?: string;
  title?: string;
  tags?: string[];
  dimension?: string;
  body: string;
}

function parseCard(raw: string): CardMeta {
  const meta: CardMeta = { body: raw };
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return meta;
  const head = m[1] ?? "";
  // 知识卡 frontmatter 是 JSON 风格（键带引号），兼容 YAML 裸键两种写法
  const scalar = (key: string): string | undefined => {
    const j = head.match(new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`));
    if (j) return (j[1] ?? "").trim();
    const y = head.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
    return y ? (y[1] ?? "").trim().replace(/^['"]|['"]$/g, "") : undefined;
  };
  meta.id = scalar("id");
  meta.title = scalar("title");
  meta.dimension = scalar("dimension");
  const tm = head.match(/"tags"\s*:\s*\[([^\]]*)\]/) ?? head.match(/^tags:\s*\[([^\]]*)\]/m);
  if (tm) meta.tags = (tm[1] ?? "").split(",").map((x) => x.trim().replace(/^['"]|['"]$/g, "").replace(/^"|"$/g, "")).filter(Boolean);
  return meta;
}

function scanFiles(knowledgeDir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const it of fs.readdirSync(d).sort()) {
      const abs = path.join(d, it);
      if (fs.statSync(abs).isDirectory()) walk(abs);
      else if (it.endsWith(".md")) out.push(abs);
    }
  };
  if (fs.existsSync(knowledgeDir)) walk(knowledgeDir);
  return out;
}

// ── v0.8 目标4 · HyperGraphRAG 装载（kit/hypergraph.rag.json = knowledge 层的 GitHub 发布形态）──

interface GraphEntry { id: string; title: string; domain: string; path: string; tags: string[] }
interface HyperGraph { format?: string; entries?: GraphEntry[]; relations?: { from: string; to: string; kind: string; weight: number }[] }

/** 编译图定位：<knowledgeDir>/../kit/hypergraph.rag.json；缺失或损坏返回 null（回落扫盘检索）。 */
export function loadGraph(knowledgeDir: string): HyperGraph | null {
  const p = path.join(knowledgeDir, "..", "kit", "hypergraph.rag.json");
  if (!fs.existsSync(p)) return null;
  try {
    const g = JSON.parse(fs.readFileSync(p, "utf-8")) as HyperGraph;
    return Array.isArray(g.entries) ? g : null;
  } catch { return null; }
}

function graphSearch(g: HyperGraph, opts: { q: string; dir?: string; k?: number }): { total: number; hits: KbHit[] } {
  const q = (opts.q ?? "").trim().toLowerCase();
  const terms = q.split(/[\s,，、;；/]+/).filter(Boolean);
  const k = Math.min(Math.max(opts.k ?? 8, 1), 30);
  const hits: KbHit[] = [];
  for (const e of g.entries ?? []) {
    if (opts.dir && e.domain !== opts.dir) continue;
    const title = (e.title ?? "").toLowerCase();
    const id = (e.id ?? "").toLowerCase();
    let score = 0;
    for (const t of terms) {
      if (title.includes(t)) score += 8;
      if (id.includes(t)) score += 5;
      if ((e.tags ?? []).some((x) => x.toLowerCase().includes(t))) score += 4;
      if (e.domain.toLowerCase().includes(t)) score += 2;
    }
    if (score > 0) hits.push({
      id: e.id, title: e.title, file: e.path, dir: e.domain, score,
      excerpt: (e.tags ?? []).length ? `标签：${e.tags.join("、")}` : `${e.domain} 域词条`,
    });
  }
  hits.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file, "zh"));
  return { total: hits.length, hits: hits.slice(0, k) };
}

export function kbSearch(
  knowledgeDir: string,
  opts: { q: string; dir?: string; k?: number },
): { total: number; hits: KbHit[] } {
  // v0.8 目标4 · HyperGraphRAG 装载：kit/hypergraph.rag.json 在场时检索走编译图（词条/标签/域打分），
  // 源 md 降级为「本地可插拔层」（不随仓库分发）——图命中但源卡缺失属正常形态。
  const graph = loadGraph(knowledgeDir);
  if (graph) return graphSearch(graph, opts);
  const q = (opts.q ?? "").trim().toLowerCase();
  const terms = q.split(/[\s,，、;；/]+/).filter(Boolean);
  const k = Math.min(Math.max(opts.k ?? 8, 1), 30);
  const files = scanFiles(knowledgeDir).filter((f) => {
    const rel = path.relative(knowledgeDir, f).replaceAll("\\", "/");
    return !opts.dir || rel.startsWith(opts.dir + "/");
  });
  const hits: KbHit[] = [];
  for (const f of files) {
    let raw: string;
    try { raw = fs.readFileSync(f, "utf-8"); } catch { continue; }
    const meta = parseCard(raw);
    const title = (meta.title ?? path.basename(f)).toLowerCase();
    const id = (meta.id ?? "").toLowerCase();
    const rel = path.relative(knowledgeDir, f).replaceAll("\\", "/");
    let score = 0;
    for (const t of terms) {
      if (title.includes(t)) score += 8;
      if (id.includes(t)) score += 5;
      if ((meta.tags ?? []).some((x) => x.toLowerCase().includes(t))) score += 4;
      if (raw.toLowerCase().includes(t)) score += 2;
    }
    if (score > 0) {
      const body = raw.replace(/^---[\s\S]*?---/, "").trim();
      hits.push({
        id: meta.id ?? rel.replace(/\.md$/, ""),
        title: meta.title ?? path.basename(f, ".md"),
        file: rel,
        dir: rel.split("/")[0] ?? "",
        score,
        excerpt: body.slice(0, 160),
      });
    }
  }
  hits.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file, "zh"));
  return { total: hits.length, hits: hits.slice(0, k) };
}

/** ref 归一：卡片 id（kb/<域>/<名>）、去前缀路径（<域>/<名>）、或带 .md 的相对路径。 */
export function kbResolve(knowledgeDir: string, ref: string): string | null {
  const clean = ref.trim().replace(/^\/+/, "").replaceAll("\\", "/");
  const withExt = clean.endsWith(".md") ? clean : clean + ".md";
  const tries = [
    path.resolve(knowledgeDir, withExt),
    path.resolve(knowledgeDir, withExt.replace(/^kb\//, "")),
    path.resolve(knowledgeDir, "kb", withExt),
  ];
  for (const c of tries) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  // index.json 权威映射兜底（entry.file 相对 knowledge/）
  try {
    const idx = JSON.parse(fs.readFileSync(path.join(knowledgeDir, "index.json"), "utf-8"));
    const entry = (idx.entries ?? []).find((e: { id?: string }) => e.id === clean.replace(/\.md$/, ""));
    if (entry?.file) {
      const c = path.resolve(knowledgeDir, entry.file as string);
      if (fs.existsSync(c)) return c;
    }
  } catch { /* 无 index 不致命 */ }
  return null;
}

export function kbRead(knowledgeDir: string, ref: string, maxChars = 16_000): { file: string; content: string } {
  const resolved = kbResolve(knowledgeDir, ref);
  if (!resolved) {
    // v0.8：md 是本地可插拔层（不随仓库分发）——图里有词条但源卡未安装属正常形态，报缺要带指引
    const g = loadGraph(knowledgeDir);
    const inGraph = g?.entries?.some((e) => e.id === ref.replace(/\.md$/, "") || e.path === `knowledge/${ref}`.replace(/^knowledge\/knowledge\//, "knowledge/"));
    throw new Error(inGraph
      ? `知识卡源文件未安装：${ref}（md 是本地可插拔层——把源卡放回 knowledge/ 对应位置即可读；图内元数据可用 kb_search 查询）`
      : `知识卡不存在：${ref}`);
  }
  const content = fs.readFileSync(resolved, "utf-8");
  return { file: path.relative(knowledgeDir, resolved).replaceAll("\\", "/"), content: content.length > maxChars ? content.slice(0, maxChars) + `\n…(截断，全长 ${content.length})` : content };
}
