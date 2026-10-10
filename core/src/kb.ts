// KB 检索/读卡（只读）：把 knowledge/ 的方法论资产暴露给 agent（verb 面）。
// 事实源 = knowledge/ 目录本身；index.json 只做 id→file 的权威映射（缺 index 时扫盘兜底）。
import { nodeFs, nodePath } from "./abstraction/defaults.js";
import type { IFileSystem, IFsPath } from "./abstraction/fs.js";

export interface KbHit {
  id: string;
  title: string;
  file: string; // 相对 knowledge/ 的路径（项目档命中 = 相对项目根的路径）
  dir: string;
  score: number;
  excerpt: string;
  /** R2.2 双根合并来源标记：编译图命中时必带（global=全局 kit 图 / project=项目 kit 图）；
   *  扫盘兜底路径不带（= 全局目录直扫，历史行为）。 */
  source?: "global" | "project";
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

function scanFiles(knowledgeDir: string, fs: IFileSystem = nodeFs, path: IFsPath = nodePath): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const it of fs.readDir(d).sort()) {
      const abs = path.join(d, it);
      if (fs.stat(abs)?.isDirectory) walk(abs);
      else if (it.endsWith(".md")) out.push(abs);
    }
  };
  if (fs.exists(knowledgeDir)) walk(knowledgeDir);
  return out;
}

// ── v0.8 目标4 · HyperGraphRAG 装载（kit/hypergraph.rag.json = knowledge 层的 GitHub 发布形态）──

interface GraphEntry { id: string; title: string; domain: string; path: string; tags: string[] }
interface HyperGraph { format?: string; entries?: GraphEntry[]; relations?: { from: string; to: string; kind: string; weight: number }[] }

/** 编译图定位：<knowledgeDir>/../kit/hypergraph.rag.json；缺失或损坏返回 null（回落扫盘检索）。 */
export function loadGraph(knowledgeDir: string, fs: IFileSystem = nodeFs, path: IFsPath = nodePath): HyperGraph | null {
  const p = path.join(knowledgeDir, "..", "kit", "hypergraph.rag.json");
  if (!fs.exists(p)) return null;
  try {
    const g = JSON.parse(fs.readText(p)) as HyperGraph;
    return Array.isArray(g.entries) ? g : null;
  } catch { return null; }
}

/** R2.2 · 项目级编译图定位：<projectDir>/kit/hypergraph.rag.json（tools/kit-compile.py --project 产物）。
 *  缺失或损坏返回 null——项目档未编译 = 检索行为与无项目上下文完全一致（零回归）。 */
export function loadProjectGraph(projectDir: string, fs: IFileSystem = nodeFs, path: IFsPath = nodePath): HyperGraph | null {
  const p = path.join(projectDir, "kit", "hypergraph.rag.json");
  if (!fs.exists(p)) return null;
  try {
    const g = JSON.parse(fs.readText(p)) as HyperGraph;
    return Array.isArray(g.entries) ? g : null;
  } catch { return null; }
}

function graphSearch(g: HyperGraph, baseDir: string, opts: { q: string; dir?: string; k?: number }, fs: IFileSystem, path: IFsPath, source: "global" | "project"): { total: number; hits: KbHit[] } {
  const q = (opts.q ?? "").trim().toLowerCase();
  const terms = q.split(/[\s,，、;；/]+/).filter(Boolean);
  const k = Math.min(Math.max(opts.k ?? 8, 1), 30);
  const hits: KbHit[] = [];
  for (const e of g.entries ?? []) {
    if (opts.dir && e.domain !== opts.dir) continue;
    // 编译图已知缺陷：多数 title 被压缩成 "---"（front-matter 分隔线误提）——
    // 这类 title 不参与标题打分，展示回退 id/路径，避免「标题全废→查询恒 0」。
    const rawTitle = (e.title ?? "").trim();
    const usableTitle = Boolean(rawTitle) && !/^-+$/.test(rawTitle);
    const title = usableTitle ? rawTitle.toLowerCase() : "";
    const id = (e.id ?? "").toLowerCase();
    let score = 0;
    for (const t of terms) {
      if (title && title.includes(t)) score += 8;
      if (id.includes(t)) score += 5;
      if ((e.tags ?? []).some((x) => x.toLowerCase().includes(t))) score += 4;
      if (e.domain.toLowerCase().includes(t)) score += 2;
    }
    // 正文打分（中文查询恒 0 的修复）：编译图条目不带正文——源卡在 baseDir（全局=knowledge/，项目=项目根）本地时
    // 按 body 子串匹配 +2，并用真实正文首段做摘要；源卡缺失=可插拔层，按元数据命中处理。
    let excerpt = (e.tags ?? []).length ? `标签：${e.tags.join("、")}` : `${e.domain} 域词条`;
    if (e.path && baseDir) {
      try {
        // 图内 path 有两种形态：带 knowledge/ 前缀（repo 根相对）或不带（baseDir 相对）——都归一到真实文件。
        // 项目档条目 path 是项目根相对（如 世界书/设定.md），不带 knowledge/ 前缀，直接按 baseDir 拼接。
        // 绝对路径判定用正则：IFsPath 抽象层没有 isAbsolute（R7 解绑面只保 join/relative 等窄面）。
        const rel = String(e.path).replaceAll("\\", "/");
        const abs = /^([a-zA-Z]:[\\/]|\/)/.test(rel) ? rel
          : rel.startsWith("knowledge/") ? path.join(baseDir, "..", rel)
          : path.join(baseDir, rel);
        const raw = fs.readText(abs);
        const low = raw.toLowerCase();
        const body = raw.replace(/^---[\s\S]*?---/, "").trim();
        let bodyHit = false;
        for (const t of terms) {
          if (low.includes(t)) { score += 2; bodyHit = true; }
        }
        if (bodyHit && body) excerpt = body.slice(0, 160);
      } catch { /* 源卡不在本地：仅元数据打分 */ }
    }
    if (score > 0) hits.push({
      id: e.id, title: usableTitle ? rawTitle : (e.id || e.path), file: e.path, dir: e.domain, score,
      excerpt, source,
    });
  }
  hits.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file, "zh"));
  return { total: hits.length, hits: hits.slice(0, k) };
}

export function kbSearch(
  knowledgeDir: string,
  opts: { q: string; dir?: string; k?: number; projectDir?: string },
  fs: IFileSystem = nodeFs,
  path: IFsPath = nodePath,
): { total: number; hits: KbHit[] } {
  // R2.2 双根合并检索：全局 kit/hypergraph.rag.json + projects/<id>/kit/hypergraph.rag.json 各查一遍，
  // 同一打分排序后合并，命中带 source 标记（global|project）。项目档缺席（未编译）= 只查全局，
  // 行为与历史版本完全一致（仅多出 source 字段）；两图都缺 = 回落扫盘（历史行为原样）。
  const graph = loadGraph(knowledgeDir, fs, path);
  const pGraph = opts.projectDir ? loadProjectGraph(opts.projectDir, fs, path) : null;
  if (graph || pGraph) {
    const k = Math.min(Math.max(opts.k ?? 8, 1), 30);
    const g = graph ? graphSearch(graph, knowledgeDir, opts, fs, path, "global") : { total: 0, hits: [] as KbHit[] };
    const p = pGraph && opts.projectDir
      ? graphSearch(pGraph, opts.projectDir, opts, fs, path, "project")
      : { total: 0, hits: [] as KbHit[] };
    const merged = [...g.hits, ...p.hits].sort((a, b) => b.score - a.score || a.file.localeCompare(b.file, "zh"));
    return { total: g.total + p.total, hits: merged.slice(0, k) };
  }
  const q = (opts.q ?? "").trim().toLowerCase();
  const terms = q.split(/[\s,，、;；/]+/).filter(Boolean);
  const k = Math.min(Math.max(opts.k ?? 8, 1), 30);
  const files = scanFiles(knowledgeDir, fs, path).filter((f) => {
    const rel = path.relative(knowledgeDir, f).replaceAll("\\", "/");
    return !opts.dir || rel.startsWith(opts.dir + "/");
  });
  const hits: KbHit[] = [];
  for (const f of files) {
    let raw: string;
    try { raw = fs.readText(f); } catch { continue; }
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
export function kbResolve(knowledgeDir: string, ref: string, fs: IFileSystem = nodeFs, path: IFsPath = nodePath): string | null {
  const clean = ref.trim().replace(/^\/+/, "").replaceAll("\\", "/");
  const withExt = clean.endsWith(".md") ? clean : clean + ".md";
  const tries = [
    path.resolve(knowledgeDir, withExt),
    path.resolve(knowledgeDir, withExt.replace(/^kb\//, "")),
    path.resolve(knowledgeDir, "kb", withExt),
  ];
  for (const c of tries) {
    if (fs.stat(c)?.isFile) return c;
  }
  // index.json 权威映射兜底（entry.file 相对 knowledge/）
  try {
    const idx = JSON.parse(fs.readText(path.join(knowledgeDir, "index.json")));
    const entry = (idx.entries ?? []).find((e: { id?: string }) => e.id === clean.replace(/\.md$/, ""));
    if (entry?.file) {
      const c = path.resolve(knowledgeDir, entry.file as string);
      if (fs.exists(c)) return c;
    }
  } catch { /* 无 index 不致命 */ }
  return null;
}

/** 项目内 ref 归一（R2.2 kb_read 项目回落）：项目根相对路径（世界书/设定.md）或 pj/ 前缀 id。 */
function resolveInProject(projectDir: string, ref: string, fs: IFileSystem, path: IFsPath): string | null {
  const clean = ref.trim().replace(/^\/+/, "").replaceAll("\\", "/");
  const withExt = clean.endsWith(".md") ? clean : clean + ".md";
  const tries = [
    path.resolve(projectDir, withExt),
    path.resolve(projectDir, withExt.replace(/^pj\//, "")),
  ];
  for (const c of tries) {
    if (fs.stat(c)?.isFile) return c;
  }
  return null;
}

export function kbRead(
  knowledgeDir: string,
  ref: string,
  maxChars = 16_000,
  fs: IFileSystem = nodeFs,
  path: IFsPath = nodePath,
  projectDir?: string,
): { file: string; content: string } {
  let resolved = kbResolve(knowledgeDir, ref, fs, path);
  let fromProject = false;
  if (!resolved && projectDir) {
    // R2.2 项目回落：全局未命中且给了项目上下文 → 在 projects/<id>/ 下找项目卡（世界书/规则）
    resolved = resolveInProject(projectDir, ref, fs, path);
    fromProject = Boolean(resolved);
  }
  if (!resolved) {
    // v0.8：md 是本地可插拔层（不随仓库分发）——图里有词条但源卡未安装属正常形态，报缺要带指引
    const g = loadGraph(knowledgeDir, fs, path);
    const inGraph = g?.entries?.some((e) => e.id === ref.replace(/\.md$/, "") || e.path === `knowledge/${ref}`.replace(/^knowledge\/knowledge\//, "knowledge/"));
    throw new Error(inGraph
      ? `知识卡源文件未安装：${ref}（md 是本地可插拔层——把源卡放回 knowledge/ 对应位置即可读；图内元数据可用 kb_search 查询）`
      : `知识卡不存在：${ref}`);
  }
  const content = fs.readText(resolved);
  // file 字段锚在命中根上：全局卡相对 knowledge/，项目卡相对项目根（与 kb_search 命中的 file 口径一致）
  const base = fromProject && projectDir ? projectDir : knowledgeDir;
  return { file: path.relative(base, resolved).replaceAll("\\", "/"), content: content.length > maxChars ? content.slice(0, maxChars) + `\n…(截断，全长 ${content.length})` : content };
}
