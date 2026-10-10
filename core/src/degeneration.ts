import type { Validation } from "./types.js";

/**
 * 批次3d · 退化指纹扫描条款组（S 级直扩，additive）。
 *
 * provenance：机制搬运自 pinax 退化扫描——`D:\pinax-storyharness` 的
 * `src/services/agents/authoring/writingSkillChecks/checkDegeneration.js`（384 行纯函数；
 * MIT 上游 oh-story-claudecode `skills/story-review/scripts/check-degeneration.js`，
 * 固定版本 0ffe7db4，上游逐字参照与 fixture 对照在 pinax 仓 `scripts/writing-skills/` 下）。
 * 只搬机制不搬数据：正则口径按 kit 正文语料（中文小说/剧本）适配，非逐字移植——
 *  · 引号剥离 + 剥离后下标→原文下标映射沿用 pinax 机制（台词复读不误报；定位必须换算回
 *    原文坐标，否则 exact 切片整体前移、指到别的句子）；
 *  · frontmatter 与 `#` 标题行豁免沿用 pinax（正文合法承载章题结构）；
 *  · 占位符 XXX/TODO 从 pinax 的 hard（引号内也算）降为 soft（只看引号外）——kit 语料
 *    实证：台词内合法出现「XXX断开网络连接」式系统掩码（proj_muxulht3n90m 第008章）；
 *  · 工程词泄漏按本批口径以「代码/JSON/markdown 标记进正文」为主半边（代码围栏/行内代码/
 *    HTML 标签/JSON 对象/表格行/行内强调），pinax tier1 流水线术语（细纲/卷纲/章首钩子…）
 *    保留为次半边；tier2（第X章/前文/伏笔/读者）不搬——中文叙述层词频高、误报面大，
 *    语义级判读归 A/B 通道；
 *  · 挂载面 = `aesthetic.ts::runAestheticAsserts` 正文路径（章节正文/第N章/正文/终稿）。
 *    拍级与剧本路径不挂：拍格式标记（**B0001｜**）与剧本【】提示在彼语料是合法形态，
 *    挂上会与 AE-SCRIPT-* / AE-BEAT-* 家法打架。
 *
 * additive 纪律：只新增检查项（AE-DEGEN-REPEAT / AE-DEGEN-TRUNCATED / AE-DEGEN-PLACEHOLDER /
 * AE-DEGEN-METALEAK 四名），不改既有检查项的输出形状；status 一律 warn（证据优先、不构成
 * 提交闸；升 block 属闸行为变更，须人裁）。detail 带逐条命中位置（L行号 + 逐字切片），
 * 随收据（diag_scan registry/receipts/、quality_scan validations[]）落盘可复核。
 * 零依赖：不 import fs/path/proc（架构红线 3），纯字符串进出。
 */

/** 四组检查的 validation 名（消费方可据此过滤；新检查项新名，不复用旧名）。 */
export const DEGEN_CHECK_NAMES = [
  "AE-DEGEN-REPEAT",
  "AE-DEGEN-TRUNCATED",
  "AE-DEGEN-PLACEHOLDER",
  "AE-DEGEN-METALEAK",
] as const;

/** 长句复读：句子可见字 ≥12 且全文出现 ≥3 次（引号剥离后计）。 */
const REPEAT_MIN_VISIBLE = 12;
const REPEAT_MIN_COUNT = 3;
/** 紧邻整段重复：剥离引号后可见字 ≥8 才计（短行/分隔行不打转嫌疑）。 */
const ADJACENT_MIN_VISIBLE = 8;
/** 截断切片窗口（末尾逐字证据长度）。 */
const TAIL_WINDOW = 24;
/** detail 里逐条命中最多展开条数（超出折叠为总数）。 */
const DETAIL_MAX_HITS = 8;

/** 引号对（与 pinax QUOTED_SPAN_PATTERNS 同构；ASCII 引号带词元守卫，防英文缩写撇号误配）。 */
const QUOTED_SPAN_PATTERNS: RegExp[] = [
  /「[^」]*」/g,
  /『[^』]*』/g,
  /【[^】]*】/g,
  /“[^”]*”/g,
  /"[^"]*"/g,
  /(?<![A-Za-z0-9_])‘(?:[^’]|(?<=[A-Za-z0-9_])’(?=[A-Za-z0-9_]))*(?!(?<=[A-Za-z0-9_])’[A-Za-z0-9_])’/g,
  /(?<![A-Za-z0-9_])'(?:[^']|(?<=[A-Za-z0-9_])'(?=[A-Za-z0-9_]))*(?!(?<=[A-Za-z0-9_])'[A-Za-z0-9_])'/g,
];

/**
 * 占位符/元信息残留。hard=引号内也算（词面残渣无正当语境）；
 * soft=只看引号外（台词是角色的话语空间，kit 语料实证 XXX/系统掩码可在引号内合法）。
 */
const PLACEHOLDER_HARD: { re: RegExp; label: string }[] = [
  { re: /〔[^〕]{0,30}〕/, label: "占位符（〔〕残留）" },
  { re: /[（(](?:此处|以下|这里|下文|后续)?\s*(?:省略|略)(?:去|过)?[^）)]{0,10}[）)]/, label: "占位符（括号省略）" },
  { re: /未完待续/, label: "占位符（未完待续）" },
  {
    re: /^(?:Sure|Certainly)[,!:]?[ \t]+(?:here(?:'s| is| are)|I (?:can|will))\b|^(?:As an AI|I (?:cannot|can't|am unable|apologize))\b/i,
    label: "元信息泄漏（英文 AI 腔开头）",
  },
];
const PLACEHOLDER_SOFT: { re: RegExp; label: string }[] = [
  { re: /\b(?:TODO|FIXME|XXX)\b/, label: "占位符（TODO/XXX 残留）" },
  { re: /占位(?:符|内容|文本)|待补(?:充|完|写)|待填/, label: "占位符（待补/待填残留）" },
  {
    re: /作为(?:一个)?(?:AI|人工智能|大?语言模型|智能助手|聊天机器人|语言模型)/,
    label: "元信息泄漏（AI 自指）",
  },
  {
    re: /我(?:无法|不能)(?:继续(?:写|创作|生成|下去)|生成(?:内容|文本|正文)?|创作|续写|完成(?:这个|本)?(?:章|篇|创作|请求))/,
    label: "元信息泄漏（生成拒绝语）",
  },
];

/** 工程词泄漏主半边：代码/JSON/markdown 标记进正文（引号外才算——台词是角色的话语空间）。 */
const CODE_MARKERS: { re: RegExp; label: string; raw?: boolean }[] = [
  { re: /```/, label: "代码围栏 ```" },
  { re: /`[^`\n]+`/, label: "行内代码标记" },
  { re: /<\/?(?:div|span|p|br|b|i|u|font|section|style|script|img|a)\b[^>]*>/i, label: "HTML 标签" },
  // JSON 形状的引号是结构引号不是话语引号——在原文上查（maskQuotedSpans 会先把 "…" 盲掉）
  { re: /\{\s*"[^"\n]{1,40}"\s*:/, label: "JSON 对象", raw: true },
  { re: /\*\*[^*\n]{1,60}\*\*/, label: "markdown 行内强调 **（若为刻意的系统面板/视觉强调，人工复核后可豁免）" },
];

/** 工程词泄漏次半边：写作流水线术语（pinax tier1 原表；引号外才算）。 */
const PIPELINE_TERMS_RE = /细纲|情节点|卷纲|功能标签|目标情绪|字数目标|章首钩子|章尾钩子/;

/** 句末/收尾标点（截断判定的合法收尾集，pinax 原集 + kit 补 〕》）。 */
const CLOSING_PUNCT_RE = /[。！？.!?…”’"』」）)】…〕》]$/;

interface ContentLine {
  text: string;
  trimmed: string;
  lineNo: number;
}

interface DegenHit {
  line: number;
  label: string;
  excerpt: string;
}

function visibleLength(s: string): number {
  const m = s.match(/[一-鿿Ａ-ｚA-Za-z0-9]/g);
  return m ? m.length : 0;
}

function compact(s: string, cap = 42): string {
  const normalized = s.replace(/\s+/g, " ").trim();
  return normalized.length > cap ? `${normalized.slice(0, cap - 1)}…` : normalized;
}

/** 引号内容置盲（等长空格替换）——「引号外」检查的基准面。 */
function maskQuotedSpans(text: string): string {
  let masked = text;
  for (const pattern of QUOTED_SPAN_PATTERNS) {
    masked = masked.replace(pattern, (match) => " ".repeat(match.length));
  }
  return masked;
}

function stripQuoted(text: string): string {
  return stripQuotedWithIndexMap(text).stripped;
}

/**
 * 剥离引号内容并记录「剥离后下标 → 原文下标」映射（pinax stripQuotedWithIndexMap 同机制）：
 * 检测在剥离文本上进行，定位换算回原文坐标——否则 exact 切片整体前移、指到别的句子。
 */
function stripQuotedWithIndexMap(textValue: string): { stripped: string; indexMap: number[] } {
  let current = textValue;
  let indexMap: number[] = Array.from(current, (_, i) => i);
  for (const pattern of QUOTED_SPAN_PATTERNS) {
    pattern.lastIndex = 0;
    let match = pattern.exec(current);
    if (!match) continue;
    const kept: string[] = [];
    const keptMap: number[] = [];
    let cursor = 0;
    while (match) {
      for (let i = cursor; i < match.index; i += 1) {
        kept.push(current[i] ?? "");
        keptMap.push(indexMap[i] ?? i);
      }
      cursor = match.index + match[0].length;
      match = pattern.exec(current);
    }
    for (let i = cursor; i < current.length; i += 1) {
      kept.push(current[i] ?? "");
      keptMap.push(indexMap[i] ?? i);
    }
    current = kept.join("");
    indexMap = keptMap;
  }
  return { stripped: current, indexMap };
}

/** YAML frontmatter 识别（pinax hasYamlFrontMatter 同机制：首行 --- + 字段形 + 闭合 ---）。 */
function hasYamlFrontMatter(lines: string[]): boolean {
  const first = lines[0];
  if (!first || first.trim() !== "---") return false;
  let sawYamlField = false;
  for (let i = 1; i < Math.min(lines.length, 40); i += 1) {
    const t = (lines[i] ?? "").trim();
    if (t === "---") return sawYamlField;
    if (/^[A-Za-z0-9_-]+:\s*/.test(t)) sawYamlField = true;
  }
  return false;
}

/**
 * 正文内容行：非空、非 `#` 标题、非 `---` 分隔线；frontmatter 整块跳过但**行号保留原文坐标**
 * （pinax 同机制——L 行号是给收据复核用的，必须与原文编辑器行号一致，不能剥离后重排）。
 */
function contentLines(text: string): ContentLine[] {
  const out: ContentLine[] = [];
  const lines = text.split(/\r?\n/);
  let inFrontMatter = hasYamlFrontMatter(lines);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();
    if (inFrontMatter) {
      if (i > 0 && trimmed === "---") inFrontMatter = false;
      continue;
    }
    if (!trimmed || trimmed.startsWith("#") || /^-{3,}$/.test(trimmed)) continue;
    out.push({ text: line, trimmed, lineNo: i + 1 });
  }
  return out;
}

// ── ① 复读（AE-DEGEN-REPEAT）：紧邻整段重复 + 长句全文重复 ──────────────────

function findRepeatHits(lines: ContentLine[]): DegenHit[] {
  const hits: DegenHit[] = [];
  // ①a 紧邻整段重复（引号剥离后可见字 ≥8——台词整段复读不计，台词是角色的话语空间）
  for (let i = 1; i < lines.length; i += 1) {
    const cur = lines[i]!;
    const prev = lines[i - 1]!;
    if (cur.trimmed === prev.trimmed && visibleLength(stripQuoted(cur.trimmed)) >= ADJACENT_MIN_VISIBLE) {
      hits.push({ line: cur.lineNo, label: "紧邻整段重复", excerpt: compact(cur.trimmed) });
    }
  }
  // ①b 长句全文重复（≥12 可见字 × ≥3 次；引号剥离后计，定位换算回原文坐标）
  const counts = new Map<string, number>();
  for (const l of lines) {
    for (const raw of stripQuoted(l.trimmed).split(/[。！？!?]/)) {
      const s = raw.trim();
      if (visibleLength(s) < REPEAT_MIN_VISIBLE) continue;
      counts.set(s, (counts.get(s) ?? 0) + 1);
    }
  }
  const flagged = new Set([...counts.entries()].filter(([, n]) => n >= REPEAT_MIN_COUNT).map(([s]) => s));
  for (const l of lines) {
    if (!flagged.size) break;
    const { stripped, indexMap } = stripQuotedWithIndexMap(l.text);
    for (const raw of stripped.split(/[。！？!?]/)) {
      const s = raw.trim();
      if (!flagged.has(s)) continue;
      const relative = stripped.indexOf(s);
      const at = relative >= 0 && relative < indexMap.length ? indexMap[relative] ?? 0 : 0;
      hits.push({
        line: l.lineNo,
        label: `长句复读×${counts.get(s) ?? 0}`,
        excerpt: compact(l.text.slice(at, at + s.length) || s),
      });
      flagged.delete(s); // 每个复读句只报首处（同 pinax）
    }
  }
  return hits;
}

// ── ② 截断（AE-DEGEN-TRUNCATED）：正文末段句中断崖 ──────────────────────────

function findTruncationHits(lines: ContentLine[]): DegenHit[] {
  if (!lines.length) return [];
  const last = lines[lines.length - 1]!;
  if (CLOSING_PUNCT_RE.test(last.trimmed)) return [];
  return [{ line: last.lineNo, label: "末段无句末/收尾标点", excerpt: compact(last.trimmed.slice(-TAIL_WINDOW)) }];
}

// ── ③ 占位符（AE-DEGEN-PLACEHOLDER）：TODO/XXX/〔〕残留 + AI 自指/拒绝语 ─────

function findPlaceholderHits(lines: ContentLine[]): DegenHit[] {
  const hits: DegenHit[] = [];
  for (const l of lines) {
    let hit: { m: RegExpExecArray; label: string } | undefined;
    for (const { re, label } of PLACEHOLDER_HARD) {
      const m = re.exec(l.trimmed);
      if (m) {
        hit = { m, label };
        break;
      }
    }
    if (!hit) {
      const outside = maskQuotedSpans(l.trimmed);
      for (const { re, label } of PLACEHOLDER_SOFT) {
        const m = re.exec(outside);
        if (m) {
          hit = { m, label };
          break;
        }
      }
    }
    if (!hit) continue;
    const at = hit.m.index || 0;
    hits.push({
      line: l.lineNo,
      label: hit.label,
      excerpt: compact(l.trimmed.slice(Math.max(0, at - 4), at + hit.m[0].length + 12)),
    });
  }
  return hits;
}

// ── ④ 工程词泄漏（AE-DEGEN-METALEAK）：代码/JSON/markdown 标记 + 流水线术语 ──

function findMetaLeakHits(lines: ContentLine[]): DegenHit[] {
  const hits: DegenHit[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const l = lines[i]!;
    const outside = maskQuotedSpans(l.trimmed);
    let hit: { at: number; len: number; label: string } | undefined;
    for (const { re, label, raw } of CODE_MARKERS) {
      const m = re.exec(raw ? l.trimmed : outside);
      if (m) {
        hit = { at: m.index, len: m[0].length, label };
        break;
      }
    }
    if (!hit) {
      // markdown 表格：连续 ≥2 行管道行才算（孤立管道字符不报）
      const isRow = /^\s*\|.+\|\s*$/.test(l.trimmed);
      const next = lines[i + 1];
      if (isRow && next && /^\s*\|.+\|\s*$/.test(next.trimmed)) {
        hit = { at: 0, len: l.trimmed.length, label: "markdown 表格行" };
      }
    }
    if (!hit) {
      const m = PIPELINE_TERMS_RE.exec(outside);
      if (m) hit = { at: m.index, len: m[0].length, label: `流水线术语「${m[0]}」` };
    }
    if (!hit) continue;
    hits.push({
      line: l.lineNo,
      label: hit.label,
      excerpt: compact(l.trimmed.slice(Math.max(0, hit.at - 4), hit.at + hit.len + 12)),
    });
  }
  return hits;
}

// ── 组装：四组 validation（pass / warn，warn detail 带逐条命中位置）──────────

function groupValidation(name: string, hits: DegenHit[], passDetail: string, failPrefix: string): Validation {
  if (!hits.length) return { name, status: "pass", detail: passDetail };
  const locs = hits
    .slice(0, DETAIL_MAX_HITS)
    .map((h) => `L${h.line} ${h.label}「${h.excerpt}」`)
    .join("；");
  const more = hits.length > DETAIL_MAX_HITS ? `；…共 ${hits.length} 处` : "";
  return { name, status: "warn", detail: `${failPrefix}${locs}${more}` };
}

/**
 * 退化指纹扫描（四组确定性检查，零 LLM 零 token）。
 * 输出四条 validation，status ∈ pass|warn；warn 的 detail 带逐条命中位置（L行号 + 逐字切片）。
 * 空正文（无内容行）时四组均回 warn「不适用」——诚实标注检查没跑成，不冒充 pass。
 */
export function degenerationAsserts(text: string): Validation[] {
  const lines = contentLines(text);
  if (!lines.length) {
    const note = "无正文行（空/仅标题/frontmatter），检查不适用";
    return DEGEN_CHECK_NAMES.map((name) => ({ name, status: "warn" as const, detail: note }));
  }
  return [
    groupValidation(
      "AE-DEGEN-REPEAT",
      findRepeatHits(lines),
      "无复读指纹（紧邻整段 / 长句≥12字×3次，引号剥离后计）",
      "复读指纹（疑似模型打转；刻意复沓先确认非刻意再改）: ",
    ),
    groupValidation(
      "AE-DEGEN-TRUNCATED",
      findTruncationHits(lines),
      "末段以句末/收尾标点结束，无截断指纹",
      "疑似截断（正文末尾句中断崖，补完结尾或重写收尾）: ",
    ),
    groupValidation(
      "AE-DEGEN-PLACEHOLDER",
      findPlaceholderHits(lines),
      "无占位符/AI 自指/生成拒绝语残留（硬词面引号内也算，软信号只看引号外）",
      "占位符/元信息残留（正文混入残渣，重写本段干净落地）: ",
    ),
    groupValidation(
      "AE-DEGEN-METALEAK",
      findMetaLeakHits(lines),
      "无工程词泄漏（代码/JSON/markdown 标记与流水线术语，引号外计）",
      "工程词泄漏（写作流水线标记进了正文，剔除或改场景内表达）: ",
    ),
  ];
}
