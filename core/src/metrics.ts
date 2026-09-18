/**
 * metric@1 · 运行指标（规范 R5 §五）
 *
 * 生成式 flow 的唯一调优依据。两条主指标：
 *   · **tool 效率** ω = 被下游真正消费的次数 / 成本（tokens + 时延 + 打回 + 重试）
 *   · **上下文命中率** = 注入的标尺卡/上游件中，被产物真正引用过的比例
 *
 * 命中率的机器可读信号来自 artifact@1 头部（R4 已把 upstream 带 sha 写进头部），
 * 因此「装了的条款有没有被用上」不需要任何人肉声明。
 */
import fs from "node:fs";
import path from "node:path";
import type { RunMetric } from "./types.js";
import { appendJsonl, readJsonl } from "./fsio.js";
import { assertSchema } from "./schema.js";
import { nowIso } from "./ids.js";

export interface CtxUsage {
  offered: number;
  used: number;
  ids: string[];
  hitIds: string[];
}

export function metricsPath(projectDir: string): string {
  return path.join(projectDir, "registry", "metrics.jsonl");
}

export function recordMetric(projectDir: string, m: Omit<RunMetric, "ts"> & { ts?: string }): RunMetric {
  const e: RunMetric = { ts: m.ts ?? nowIso(), ...m } as RunMetric;
  assertSchema("metrics", e);
  appendJsonl(metricsPath(projectDir), e);
  return e;
}

export function readMetrics(projectDir: string): RunMetric[] {
  return readJsonl<RunMetric>(metricsPath(projectDir));
}

// ---------------- 概念词命中层 ----------------
//
// 字面 id 匹配只能量到「头部/正文写过哪条技术路径」，量不到「正文吃进了卡的哪条知识」——
// 小说正文永远不会出现 "kb/trope/xxx" 这类路径（_918test 实证：31 张标尺卡仅 3 张被路径引用，
// 撞上结构性 0%）。概念层口径：每张知识卡用 标题/小节标题/加粗词 生成候选签名词
// （CJK n-gram + 拉丁词），再用全库文档频率（DF）滤掉跨卡万金油词；
// 产物正文含任一签名词即记一次概念命中。这是启发式近似：正文换词改写会漏，
// 幸存的通用词会少量误报——方向是宁可多报可复核的命中，不把结构性 0% 当「标尺没用上」的证据。

interface ConceptIndex {
  byCard: Map<string, string[]>;
  df: Map<string, number>;
  total: number;
  builtAt: number;
}

const CONCEPT_CACHE = new Map<string, ConceptIndex>();
const CONCEPT_TTL_MS = 5 * 60 * 1000;
const CONCEPT_MAX_DF_RATIO = 0.35;
const CONCEPT_TERM_CAP = 14;

const CONCEPT_STOPWORDS = new Set([
  "标准", "规范", "指南", "清单", "模板", "总纲", "手册", "卡片", "词条", "内容",
  "使用", "通过", "进行", "可以", "应该", "必须", "不能", "禁止", "如果", "但是",
  "然后", "因此", "所以", "以及", "或者", "关于", "针对", "相关", "以下", "以上",
  "所有", "全部", "情况", "问题", "方式", "方法", "用于", "基于", "提供", "参考",
  "按照", "依据", "确保", "完成", "处理", "支持", "判断", "检查", "校验", "产出",
  "输出", "输入", "目标", "适用", "范围", "基础", "通用", "常见", "注意", "建议",
  "优先", "避免", "防止", "场景", "作品", "写作", "创作", "故事", "小说", "剧本",
  "the", "and", "for", "with", "from", "that", "this", "are", "you", "your",
]);

function stripFrontmatter(text: string): { head: string; body: string } {
  const t = text.replace(/^\uFEFF/, "");
  if (t.startsWith("---")) {
    const end = t.indexOf("\n---", 3);
    if (end >= 0) return { head: t.slice(0, end + 4), body: t.slice(end + 4) };
  }
  return { head: "", body: t };
}

function cardTitleOf(head: string, body: string): string {
  try {
    const json = JSON.parse(head.replace(/^---\s*/, "").replace(/\s*---\s*$/, ""));
    if (json && typeof json.title === "string") return json.title;
  } catch {
    /* frontmatter 非 JSON 时退回正文首标题 */
  }
  const m = body.match(/^#\s+(.+)$/m);
  return m ? m[1] : "";
}

/** 从一段文本收集候选词：拉丁词（小写）+ CJK 2..4-gram + 整段 CJK run（≤6 字，权重 +1） */
function conceptTermsOfText(s: string, out: Map<string, number>, weight: number): void {
  for (const w of s.match(/[A-Za-z][A-Za-z0-9'-]+/g) ?? []) {
    // 拉丁词 ≥3 字符；全大写缩写（AI/NA）放宽到 2——「md」「s1」这类短词随机误配率过高
    if (w.length >= 3 || /^[A-Z]{2,}$/.test(w)) out.set(w.toLowerCase(), Math.max(out.get(w.toLowerCase()) ?? 0, weight));
  }
  for (const run of s.match(/[\u4e00-\u9fff]{2,}/g) ?? []) {
    if (run.length <= 6) out.set(run, Math.max(out.get(run) ?? 0, weight + 1));
    for (let n = 2; n <= Math.min(4, run.length); n++) {
      for (let i = 0; i + n <= run.length; i++) {
        const g = run.slice(i, i + n);
        out.set(g, Math.max(out.get(g) ?? 0, weight));
      }
    }
  }
}

/** 真词频计数（TF 与集合语义不同：同一词出现 N 次记 N） */
function conceptFreqOfText(s: string, freq: Map<string, number>): void {
  for (const w of s.match(/[A-Za-z][A-Za-z0-9'-]+/g) ?? []) {
    if (w.length >= 3 || /^[A-Z]{2,}$/.test(w)) freq.set(w.toLowerCase(), (freq.get(w.toLowerCase()) ?? 0) + 1);
  }
  for (const run of s.match(/[\u4e00-\u9fff]{2,}/g) ?? []) {
    for (let n = 2; n <= Math.min(4, run.length); n++) {
      for (let i = 0; i + n <= run.length; i++) {
        const g = run.slice(i, i + n);
        freq.set(g, (freq.get(g) ?? 0) + 1);
      }
    }
  }
}

/**
 * 卡内签名词生成。标题/小节/加粗词给权重。
 * 2-gram 是跨词边界碎渣的重灾区（人物审美→物审/美标、场景价值→景价），须**正文现身 ≥1 次
 * 且全卡 ≥2 次**才保留；≥3 字的 n-gram 与整段 run 自带辨识度（含「好感结算中」这类只出现
 * 一次、却会原样落进产物的标志性短语），不做 TF 管制，交给 DF 与停用词过滤。
 */
function conceptTermsFromCard(text: string): Map<string, number> {
  const { head, body } = stripFrontmatter(text);
  const weighted = new Map<string, number>();
  conceptTermsOfText(cardTitleOf(head, body), weighted, 3);
  for (const m of body.matchAll(/^#{1,4}\s+(.+)$/gm)) conceptTermsOfText(m[1], weighted, 2);
  for (const m of body.matchAll(/\*\*([^*\n]+)\*\*/g)) conceptTermsOfText(m[1], weighted, 2);
  const tfBody = new Map<string, number>();
  const tfAll = new Map<string, number>();
  conceptFreqOfText(body, tfBody);
  conceptFreqOfText(text, tfAll);
  for (const [t] of weighted) {
    if (/[\u4e00-\u9fff]/.test(t) && t.length === 2 && ((tfBody.get(t) ?? 0) < 1 || (tfAll.get(t) ?? 0) < 2)) {
      weighted.delete(t);
    }
  }
  return weighted;
}

function conceptCorpusSet(text: string): Set<string> {
  const all = new Map<string, number>();
  conceptTermsOfText(text, all, 1);
  return new Set(all.keys());
}

function keepSignatureTerms(sig: Map<string, number>, df: Map<string, number>, total: number): string[] {
  const kept: { term: string; w: number }[] = [];
  // DF 过滤只在语料够大时启用：小语料（新装库/测试夹具）里任意词的占比都虚高
  const dfActive = total >= 12;
  for (const [term, w] of sig) {
    if (CONCEPT_STOPWORDS.has(term) || /^\d+$/.test(term) || term.length < 2) continue;
    if (dfActive) {
      const docs = df.get(term) ?? 0;
      if (docs / total > CONCEPT_MAX_DF_RATIO) continue;
    }
    kept.push({ term, w });
  }
  // 标题词 > 小节/加粗词；同权重短词优先（短词在正文里更可能出现）
  kept.sort((a, b) => b.w - a.w || a.term.length - b.term.length);
  return kept.slice(0, CONCEPT_TERM_CAP).map((k) => k.term);
}

function buildConceptIndex(root: string): ConceptIndex | null {
  const cached = CONCEPT_CACHE.get(root);
  if (cached && Date.now() - cached.builtAt < CONCEPT_TTL_MS) return cached;
  const indexPath = path.join(root, "knowledge", "index.json");
  if (!fs.existsSync(indexPath)) return null;
  let entries: { id: string; file: string }[] = [];
  try {
    entries = (JSON.parse(fs.readFileSync(indexPath, "utf-8")).entries ?? []) as { id: string; file: string }[];
  } catch {
    return null;
  }
  const df = new Map<string, number>();
  const raws = new Map<string, string>();
  for (const e of entries) {
    const p = path.join(root, "knowledge", e.file ?? "");
    if (!e.file || !fs.existsSync(p)) continue;
    const text = fs.readFileSync(p, "utf-8");
    raws.set(e.id, text);
    for (const term of conceptCorpusSet(text)) df.set(term, (df.get(term) ?? 0) + 1);
  }
  const byCard = new Map<string, string[]>();
  for (const [id, text] of raws) {
    byCard.set(id, keepSignatureTerms(conceptTermsFromCard(text), df, raws.size));
  }
  const idx: ConceptIndex = { byCard, df, total: raws.size, builtAt: Date.now() };
  CONCEPT_CACHE.set(root, idx);
  return idx;
}

/** 诊断出口：某张卡当前的签名词表（recheck 工具用它解释「凭什么算命中」） */
export function conceptTermsOf(root: string, id: string): string[] {
  const idx = buildConceptIndex(root);
  if (!idx) return [];
  const known = idx.byCard.get(id);
  if (known) return known;
  const p = path.join(root, "knowledge", id.replace(/^kb\//, "") + ".md");
  if (!fs.existsSync(p)) return [];
  return keepSignatureTerms(conceptTermsFromCard(fs.readFileSync(p, "utf-8")), idx.df, idx.total + 1);
}

/**
 * 命中的机器判定：两层。
 * ① 字面层（R4 既有事实）：产物头部 `upstream:` 行里的路径/卡 id + 正文中出现过的 id；
 * ② 概念层（opts.root 给定时）：kb 卡签名词出现在产物**正文**（头部除外）即算命中，
 *    专治「正文吃进了知识但没抄路径」的结构性漏计。
 */
export function extractCtxUsage(
  artifactText: string,
  ids: string[],
  opts: { root?: string } = {},
): CtxUsage {
  const { head, body } = stripFrontmatter(artifactText);
  const hitIds = ids.filter((id) => {
    const short = id.replace(/^kb\//, "");
    return head.includes(id) || head.includes(short) || body.includes(id) || (short.length > 3 && body.includes(short));
  });
  if (opts.root) {
    const idx = buildConceptIndex(opts.root);
    if (idx) {
      const lowerBody = body.toLowerCase();
      const latinHit = (t: string) => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(lowerBody);
      for (const id of ids) {
        if (hitIds.includes(id) || !id.startsWith("kb/")) continue;
        const terms = conceptTermsOf(opts.root, id);
        // 纯拉丁词按词边界匹配（「na」不得命中「natural」），CJK 词子串匹配
        if (terms.some((t) => (/^[a-z0-9'-]+$/.test(t) ? latinHit(t) : lowerBody.includes(t)))) hitIds.push(id);
      }
    }
  }
  return { offered: ids.length, used: hitIds.length, ids, hitIds };
}

// ---------------- 聚合 ----------------

export interface NodeStats {
  nodeId: string;
  kit?: string;
  op?: string;
  runs: number;
  submits: number;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  assertPass: number;
  assertBlock: number;
  retries: number;
  ctxOffered: number;
  ctxUsed: number;
  hitRate: number;
  /** 产物被下游消费的次数（生成式 flow 的价值判据） */
  consumedBy: number;
  cost: number;
  efficiency: number;
  verdicts: string[];
}

export interface ToolStats extends NodeStats {
  nodes: string[];
}

export interface KbStat { id: string; offered: number; used: number; hitRate: number }

export interface MetricsSummary {
  events: number;
  byNode: Record<string, NodeStats>;
  byTool: Record<string, ToolStats>;
  knowledge: KbStat[];
  /** 人工门/边界验收的裁决分布 */
  gates: { nodeId: string; phase: string; passes: number; sendBacks: number; samples: number }[];
  window: { from?: string; to?: string };
}

const EPS = 1e-6;

function costOf(s: { tokensIn: number; tokensOut: number; latencyMs: number; assertBlock: number; retries: number }): number {
  // 成本口径：token 千分位 + 时延分钟位 + 打回/重试的返工溢价
  return Math.max(EPS, (s.tokensIn + s.tokensOut) / 1000 + s.latencyMs / 60000 + s.assertBlock * 5 + s.retries * 2);
}

export function summarizeMetrics(
  events: RunMetric[],
  opts: { pathToNode?: Record<string, string> } = {},
): MetricsSummary {
  const pathToNode = opts.pathToNode ?? {};
  const byNode: Record<string, NodeStats> = {};
  const kbOffered: Record<string, number> = {};
  const kbUsed: Record<string, number> = {};
  const gateMap: Record<string, { phase: string; passes: number; sendBacks: number; samples: number }> = {};

  const get = (id: string): NodeStats =>
    (byNode[id] ??= {
      nodeId: id, runs: 0, submits: 0, tokensIn: 0, tokensOut: 0, latencyMs: 0,
      assertPass: 0, assertBlock: 0, retries: 0, ctxOffered: 0, ctxUsed: 0,
      hitRate: 0, consumedBy: 0, cost: 0, efficiency: 0, verdicts: [],
    });

  for (const e of events) {
    const s = get(e.nodeId);
    if (e.kit) s.kit = e.kit;
    if (e.op) s.op = e.op;
    if (e.phase === "dispatch") s.runs += 1;
    if (e.phase === "submit" || e.phase === "core" || e.phase === "auto-gate") s.submits += 1;
    s.tokensIn += e.tokensIn ?? 0;
    s.tokensOut += e.tokensOut ?? 0;
    s.latencyMs += e.latencyMs ?? 0;
    s.assertPass += e.asserts?.pass ?? 0;
    s.assertBlock += e.asserts?.block ?? 0;
    s.retries = Math.max(s.retries, e.retries ?? 0);
    if (e.verdict) s.verdicts.push(e.verdict);
    // 分母只在 dispatch 相计数（只有装载那一刻才知道"装了什么"）。提交相也带 ctx.ids 时若一并计数，
    // 同一个 id 会被记两次、且两相 id 空间此前并不一致（glob 字面量 vs 展开后的具体条目）——
    // 命中率因此失真。分子则取任何带 hitIds 的事件（实际只有 submit/core 会算）。
    if (e.phase === "dispatch") {
      for (const id of e.ctx?.ids ?? []) kbOffered[id] = (kbOffered[id] ?? 0) + 1;
    }
    for (const id of e.ctx?.hitIds ?? []) {
      kbUsed[id] = (kbUsed[id] ?? 0) + 1;
      const producer = pathToNode[id];
      if (producer && producer !== e.nodeId) get(producer).consumedBy += 1;
    }
    if (e.phase === "boundary" || e.phase === "gate") {
      const g = (gateMap[e.nodeId] ??= { phase: e.phase, passes: 0, sendBacks: 0, samples: 0 });
      g.samples += 1;
      if (e.verdict === "send-back") g.sendBacks += 1;
      else g.passes += 1;
    }
  }

  // ctx 计数需 dispatch/submit 两相合并：dispatch 记装载量，submit 记真实命中量
  for (const e of events) {
    const s = byNode[e.nodeId];
    if (!s) continue;
    if (e.phase === "dispatch") s.ctxOffered += e.ctx?.offered ?? e.ctx?.ids?.length ?? 0;
    else if (e.phase === "submit" || e.phase === "core") s.ctxUsed += e.ctx?.used ?? 0;
  }

  for (const s of Object.values(byNode)) {
    s.cost = costOf(s);
    s.efficiency = s.consumedBy / s.cost;
    s.hitRate = s.ctxOffered > 0 ? s.ctxUsed / s.ctxOffered : 0;
  }

  // tool 视角：同一 kit.op 跨节点合并（换位置不换 tool，指标该跟着 tool 走）
  const byTool: Record<string, ToolStats> = {};
  for (const s of Object.values(byNode)) {
    if (!s.kit || !s.op) continue;
    const key = `${s.kit}.${s.op}`;
    const t = (byTool[key] ??= {
      nodeId: key, kit: s.kit, op: s.op,
      runs: 0, submits: 0, tokensIn: 0, tokensOut: 0, latencyMs: 0,
      assertPass: 0, assertBlock: 0, retries: 0, ctxOffered: 0, ctxUsed: 0,
      hitRate: 0, consumedBy: 0, cost: 0, efficiency: 0, verdicts: [], nodes: [],
    });
    t.runs += s.runs;
    t.submits += s.submits;
    t.tokensIn += s.tokensIn;
    t.tokensOut += s.tokensOut;
    t.latencyMs += s.latencyMs;
    t.assertPass += s.assertPass;
    t.assertBlock += s.assertBlock;
    t.retries = Math.max(t.retries, s.retries);
    t.ctxOffered += s.ctxOffered;
    t.ctxUsed += s.ctxUsed;
    t.consumedBy += s.consumedBy;
    t.nodes.push(s.nodeId);
  }
  for (const t of Object.values(byTool)) {
    t.nodes = [...new Set(t.nodes)];
    t.cost = costOf(t);
    t.efficiency = t.consumedBy / t.cost;
    t.hitRate = t.ctxOffered > 0 ? t.ctxUsed / t.ctxOffered : 0;
  }

  const knowledge: KbStat[] = [...new Set([...Object.keys(kbOffered), ...Object.keys(kbUsed)])]
    .map((id) => ({
      id,
      offered: kbOffered[id] ?? 0,
      used: kbUsed[id] ?? 0,
      hitRate: (kbOffered[id] ?? 0) > 0 ? (kbUsed[id] ?? 0) / (kbOffered[id] ?? 1) : 0,
    }))
    .sort((a, b) => a.hitRate - b.hitRate);

  return {
    events: events.length,
    byNode,
    byTool,
    knowledge,
    gates: Object.entries(gateMap).map(([nodeId, g]) => ({ nodeId, ...g })),
    window: { from: events[0]?.ts, to: events[events.length - 1]?.ts },
  };
}
