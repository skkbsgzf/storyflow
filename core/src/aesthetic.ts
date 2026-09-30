import { nodeEnv, nodeFs, nodePath } from "./abstraction/defaults.js";
import type { IFileSystem, IFsPath } from "./abstraction/fs.js";
import type { Validation } from "./types.js";
import { recordDiag } from "./diag.js";
import { DEFAULT_BUDGET } from "./budget.js";

/**
 * OS-02 阶段 C：阈值从「引擎常量」改读**阈值预算面**（`budget.ts::DEFAULT_BUDGET`）。
 * `budget` 由调用方（内核/`runCoreNode`）用 `resolveBudget(eff.policy)` 解析后传入；
 * 未传/未覆盖 = 出厂默认。键名与语义见 budget.ts——**不要再在这里写死数字**。
 */
function th(budget: Record<string, number> | undefined, key: string): number {
  return budget?.[key] ?? DEFAULT_BUDGET[key]?.value ?? 0;
}

/** 中文集数解析：第X集 → 数字（支持 一~九十九 的常见写法） */
const DIGITS: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
export function cnEpisodeToInt(cn: string): number {
  const s = cn.trim();
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  if (s.startsWith("十")) return 10 + (DIGITS[s[1] ?? ""] ?? 0);
  const m = s.match(/^([一二两三四五六七八九])十([一二三四五六七八九])?$/);
  if (m) {
    const d1 = m[1] ?? "";
    const d2 = m[2] ?? "";
    return (DIGITS[d1] ?? NaN) * 10 + (d2 ? DIGITS[d2] ?? NaN : 0);
  }
  return DIGITS[s] ?? NaN;
}

interface ParsedBeat {
  no: number;
  hookType: string;
  durationS: number;
  has0_3s: boolean;
  hasStoryboard: boolean;
  hasDialogue: boolean;
  hasPerformance: boolean;
  hasTailhook: boolean;
}

interface ParsedEp {
  no: number;
  head: string;
  body: string;
  firstHookType?: string;
  beats: ParsedBeat[];
}

function parseBeatStructure(text: string): ParsedEp[] {
  const eps: ParsedEp[] = [];
  // 用 split 前瞻切集：JS 无 \Z，且 /m 下 $ 匹配每行行尾会把正文截断——禁用终止锚写法
  const parts = text.split(/(?=^## 第[一二三四五六七八九十百零]+集)/m);
  for (const part of parts) {
    const hm = part.match(/^## 第([一二三四五六七八九十百零]+)集《([^》]*)》/);
    if (!hm || !hm[1]) continue;
    const no = cnEpisodeToInt(hm[1]);
    const body = part.slice(part.indexOf("\n") + 1);
    const beats: ParsedBeat[] = [];
    for (const bm of body.matchAll(/\*\*B(\d+)｜([^｜]+)｜(\d+)秒\*\*\n?([\s\S]*?)(?=\*\*B\d+｜|$)/g)) {
      const hook = bm[2] ?? "";
      const seg = bm[4] ?? "";
      beats.push({
        no: parseInt(bm[1] ?? "", 10),
        hookType: hook.trim(),
        durationS: parseInt(bm[3] ?? "0", 10),
        has0_3s: seg.includes("【0-3秒】"),
        hasStoryboard: seg.includes("分镜：") || seg.includes("行动：") || seg.includes("开场画面："),
        hasDialogue: seg.includes("台词："),
        hasPerformance: seg.includes("表演："),
        hasTailhook: seg.includes("尾钩"),
      });
    }
    const first = beats[0];
    eps.push({ no, head: part.split("\n")[0] ?? "", body, firstHookType: first?.hookType, beats });
  }
  return eps;
}

/** 项目级配置：词汇表.json 扩展字段（memes/banned），缺省空。 */
function projectConfig(projectDir: string, fs: IFileSystem, path: IFsPath): { memes: string[]; banned: string[] } {
  try {
    const g = JSON.parse(fs.readText(path.join(projectDir, "词汇表.json"))) as {
      memes?: unknown;
      banned?: unknown;
    };
    return {
      memes: Array.isArray(g.memes) ? g.memes.map(String) : [],
      banned: Array.isArray(g.banned) ? g.banned.map(String) : [],
    };
  } catch (e) {
    // 区分「没配」与「坏了」：词汇表是可选项，ENOENT 是合法常态（检查本就不适用），
    // 只有**存在但读不出来**才是真故障——那意味着去机味/禁忌检查静默失效却仍报"通过"。
    if ((e as NodeJS.ErrnoException)?.code !== "ENOENT") {
      recordDiag({ fs, path }, projectDir, "aesthetic", "projectConfig:词汇表.json", e);
    }
    return { memes: [], banned: [] };
  }
}

/** 大纲编排表声明的合法集数集合（对外交付/02-大纲.md 的 `| n-m |` 行）；无大纲 → undefined。 */
function outlineEpisodeBounds(projectDir: string, fs: IFileSystem, path: IFsPath): Set<number> | undefined {
  const p = path.join(projectDir, "对外交付", "02-大纲.md");
  if (!fs.exists(p)) return undefined;
  const text = fs.readText(p);
  const set = new Set<number>();
  for (const m of text.matchAll(/^\|\s*(\d+)(?:\s*-\s*(\d+))?\s*\|/gm)) {
    const a = parseInt(m[1] ?? "", 10);
    const b = m[2] ? parseInt(m[2], 10) : a;
    if (b >= a && b < 1000) for (let i = a; i <= b; i++) set.add(i);
  }
  return set.size ? set : undefined;
}

/* ============================================================================
 * R5 §4.1 WO-A②：文本层校验器补齐
 * 目标：让「断言校验」core 步声明的每条断言要么真跑、要么诚实标注切片口径。
 * 红线：不引 LLM 当机器校验器；启发式切片的 warn 不冒充语义级 pass（detail 必须带口径）。
 * 台账：纯净度标记 = knowledge/aesthetic/purity-markers.json（与 tools/check-purity.py 共享）。
 * ==========================================================================*/

function repoRootOf(projectDir: string, path: IFsPath): string {
  return nodeEnv.get("MINIFLOW_ROOT") ?? path.join(projectDir, "..", "..");
}

let purityReCache: { root: string; re: RegExp[] } | null = null;
function purityRegexps(projectDir: string, fs: IFileSystem, path: IFsPath): RegExp[] {
  const root = repoRootOf(projectDir, path);
  if (purityReCache && purityReCache.root === root) return purityReCache.re;
  const out: RegExp[] = [];
  try {
    const j = JSON.parse(fs.readText(path.join(root, "knowledge", "aesthetic", "purity-markers.json"))) as {
      regex?: string[];
    };
    for (const s of j.regex ?? []) {
      try {
        out.push(new RegExp(s));
      } catch (e) {
        // 台账里的坏正则：跳过是对的（不拖垮整检），但"一条标记静默失效"必须可见。
        recordDiag({ fs, path }, projectDir, "aesthetic", `purityRegexps:bad-regex`, `${s} :: ${String(e)}`);
      }
    }
  } catch (e) {
    // 台账缺失 ⇒ 纯净度检查**整项不适用**（返回空表，调用方视作"无需检查"）。
    // 与 check-purity.py 共享同一份台账，缺失时两边都不报——最典型的"静默不设防"。
    recordDiag({ fs, path }, projectDir, "aesthetic", "purityRegexps:knowledge/aesthetic/purity-markers.json", e);
  }
  purityReCache = { root, re: out };
  return out;
}

/** AE-OUTPUT-PURITY（block）：执行元数据不得进入成文产物正文（标记台账共享，见 purity-markers.json）。 */
export function purityAssert(projectDir: string, text: string, fs: IFileSystem = nodeFs, path: IFsPath = nodePath): Validation {
  const res = purityRegexps(projectDir, fs, path);
  if (!res.length) {
    return { name: "AE-OUTPUT-PURITY", status: "warn", detail: "纯净度标记台账缺失（knowledge/aesthetic/purity-markers.json）——本检查不适用" };
  }
  const body = text.replace(/^---[\s\S]*?---/, "");
  const hits: string[] = [];
  body.split("\n").forEach((ln, i) => {
    for (const re of res) {
      if (re.test(ln)) {
        hits.push(`L${i + 1}:${ln.trim().slice(0, 40)}`);
        break;
      }
    }
  });
  return hits.length
    ? {
        name: "AE-OUTPUT-PURITY",
        status: "block",
        detail: `执行元数据入正文: ${hits.slice(0, 6).join("；")}${hits.length > 6 ? "…" : ""}`,
      }
    : { name: "AE-OUTPUT-PURITY", status: "pass", detail: "无执行元数据（标记台账共享）" };
}

/** 不可拍摄内容词（AE-VIS-EMPTY 的机器切片：心理/抒情类词入画面行）。 */
const VIS_BAD_RE = /(心理描写|内心独白|心想|暗想|心中暗道|暗自思忖|内心[：:]|百感交集|思绪万千|不禁感慨|抒情)/;

/** AE-WNF-HOOK（block）：长篇每章结尾必须留钩；连续同型钩判 major（四型轮换，读上一章尾判定）。 */
export function chapterHookAssert(projectDir: string, relPath: string, text: string, fs: IFileSystem = nodeFs, path: IFsPath = nodePath): Validation {
  const body = text.replace(/^---[\s\S]*?---/, "");
  const paras = body.split("\n").map((s) => s.trim()).filter(Boolean);
  const near = paras.slice(-3).join("").slice(-260);
  let t = "";
  if (/？/.test(near)) t = "悬念";
  else if (/(却|但|谁知|没想到|偏偏|然而|话音未落|下一秒|就在这时)/.test(near)) t = "转折";
  else if (/(！|发誓|咬牙|等着|记住|攥紧|红了眼)/.test(near)) t = "情绪";
  if (!t) {
    return { name: "AE-WNF-HOOK", status: "block", detail: "章末无钩（末三段无悬念？/转折词/情绪信号）——每章结尾必须留钩" };
  }
  let status: Validation["status"] = "pass";
  let extra = "";
  const m = relPath.match(/第(\d+)章/);
  if (m) {
    const n = parseInt(m[1] ?? "", 10);
    if (n > 1) {
      try {
        const prevText = fs.readText(path.join(path.dirname(path.join(projectDir, relPath)), `第${n - 1}章.md`));
        const prev = tailHookTypeOf(prevText.replace(/^---[\s\S]*?---/, ""));
        if (prev && prev === t) {
          status = "warn";
          extra = `；与第${n - 1}章同型（${prev}）——连续同型钩，四型轮换`;
        }
      } catch {
        /* 上一章缺失，跳过轮换检查 */
      }
    }
  }
  return { name: "AE-WNF-HOOK", status, detail: `章末钩型：${t}${extra}` };
}

function tailHookTypeOf(text: string): string {
  const paras = text.split("\n").map((s) => s.trim()).filter(Boolean);
  const near = paras.slice(-3).join("").slice(-260);
  if (/？/.test(near)) return "悬念";
  if (/(却|但|谁知|没想到|偏偏|然而|话音未落|下一秒|就在这时)/.test(near)) return "转折";
  if (/(！|发誓|咬牙|等着|记住|攥紧|红了眼)/.test(near)) return "情绪";
  return "";
}

function projectOwnTerms(projectDir: string, fs: IFileSystem, path: IFsPath): string[] {
  try {
    const g = JSON.parse(fs.readText(path.join(projectDir, "词汇表.json"))) as { own?: unknown };
    return Array.isArray(g.own) ? g.own.map(String) : [];
  } catch {
    return [];
  }
}

/** 连续性切片三件套（AE-CONT-KNOW/ITEM/FORESHADOW）：audit 步对成文产物声明的机器可查层。
 *  只在成文产物路径上生效（小纲/大纲是过程件，合法承载流程词汇，切片不适用 → 返回空）。 */
function ledgerSliceAsserts(projectDir: string, relPath: string, text: string, fs: IFileSystem, path: IFsPath): Validation[] {
  const rel = relPath.replaceAll("\\", "/");
  const prosePath = /章节正文|第\d+章|正文|终稿|剧本|试稿|对外交付/.test(rel) && !/小纲|大纲|意见书/.test(rel);
  if (!prosePath) return [];
  return [
    continuityKnownAssert(projectDir, text, fs, path),
    continuityItemAssert(projectDir, text, fs, path),
    foreshadowAssert(projectDir, relPath, fs, path),
  ];
}

/** AE-CONT-KNOW（启发式切片）：正文引号词条 ×（词汇表 own ∪ 世界书词条）比对，未登记高频词判 warn。 */
export function continuityKnownAssert(projectDir: string, text: string, fs: IFileSystem = nodeFs, path: IFsPath = nodePath): Validation {
  const own = projectOwnTerms(projectDir, fs, path);
  if (!own.length) {
    return { name: "AE-CONT-KNOW", status: "warn", detail: "项目未登记词汇表.json own[]——越权专名切片不适用（语义级越权归红方）" };
  }
  const ledger = new Set(own);
  try {
    for (const f of fs.readDir(path.join(projectDir, "世界书"))) {
      if (!f.endsWith(".md")) continue;
      const wt = fs.readText(path.join(projectDir, "世界书", f));
      for (const m of wt.matchAll(/^#{1,3} (.+)$/gm)) ledger.add((m[1] ?? "").trim());
      for (const m of wt.matchAll(/\*\*([^*\n]{2,12})\*\*/g)) ledger.add((m[1] ?? "").trim());
    }
  } catch {
    /* 无世界书目录 */
  }
  const body = text.replace(/^---[\s\S]*?---/, "");
  const counts = new Map<string, number>();
  for (const m of body.matchAll(/[「『]([^」』]{2,6})[」』]/g)) {
    const t = m[1] ?? "";
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const suspicious = [...counts.entries()].filter(([t, n]) => n >= 2 && !ledger.has(t) && !/^\d/.test(t));
  return suspicious.length
    ? {
        name: "AE-CONT-KNOW",
        status: "warn",
        detail: `未登记专名（启发式切片，语义裁决归红方）: ${suspicious.slice(0, 8).map(([t, n]) => `「${t}」×${n}`).join("、")}`,
      }
    : { name: "AE-CONT-KNOW", status: "pass", detail: "切片未见越权专名（引号词条×台账比对；语义级越权归红方）" };
}

/** AE-CONT-ITEM（启发式切片）：世界书数字事实（岁/年/万…）vs 正文同专名不同数值 → warn。 */
export function continuityItemAssert(projectDir: string, text: string, fs: IFileSystem = nodeFs, path: IFsPath = nodePath): Validation {
  const facts = new Map<string, { n: number; unit: string; src: string }>();
  const factRe = /([^\s：:，,。｜|]{2,8})[^\n]{0,16}?(\d+(?:\.\d+)?)\s*(岁|周年|年|万元|亿元|万|亿|米|层|天|小时|公斤|人)/g;
  try {
    for (const f of fs.readDir(path.join(projectDir, "世界书"))) {
      if (!f.endsWith(".md")) continue;
      const wt = fs.readText(path.join(projectDir, "世界书", f));
      for (const m of wt.matchAll(factRe)) {
        const term = (m[1] ?? "").trim();
        // 只收纯词元（汉字/字母/数字）：markdown 记号、括号等一概不作事实项（事故：'**伏笔无额度**' 入 RegExp 崩掉整段切片检查）
        if (!/^[\u4e00-\u9fffA-Za-z0-9]+$/.test(term)) continue;
        if (/^\d+$/.test(term) || facts.has(term)) continue;
        facts.set(term, { n: parseFloat(m[2] ?? ""), unit: m[3] ?? "", src: f });
      }
    }
  } catch {
    /* 无世界书目录 */
  }
  if (!facts.size) {
    return { name: "AE-CONT-ITEM", status: "warn", detail: "世界书无可解析数字事实（专名+数值+单位）——矛盾切片不适用（语义级矛盾归红方）" };
  }
  const body = text.replace(/^---[\s\S]*?---/, "");
  const conflicts: string[] = [];
  for (const [term, f0] of facts) {
    const re = new RegExp(term + "[^\\n]{0,24}?(\\d+(?:\\.\\d+)?)\\s*" + f0.unit, "g");
    for (const m of body.matchAll(re)) {
      const v = parseFloat(m[1] ?? "");
      if (Number.isFinite(v) && v !== f0.n) {
        conflicts.push(`${term}: 台账 ${f0.n}${f0.unit} vs 正文 ${m[1]}${f0.unit}`);
        break;
      }
    }
  }
  return conflicts.length
    ? {
        name: "AE-CONT-ITEM",
        status: "warn",
        detail: `与台账数字事实疑似冲突（启发式切片，语义裁决归红方）: ${conflicts.slice(0, 5).join("；")}`,
      }
    : {
        name: "AE-CONT-ITEM",
        status: "pass",
        detail: `数字事实切片一致（${facts.size} 条台账事实比对；语义级矛盾归红方）`,
      };
}

/**
 * 「已回收」判定：只有出现这些词才算兑现。
 * 不能裸判 /回收/ ——「待回收」「未回收」是**未**兑现，裸判会把最常见的状态词误读成已完成，
 * 于是逾期检查永远不触发（断言空转，比没有断言更坏：它报 pass）。见 test/r5-generative 的 woa3。
 */
const FORESHADOW_DONE_RE = /(已回收|已兑现|已关闭|已废弃|已完成|^已|完成)/;

/** AE-CONT-FORESHADOW：伏笔台账到期未回收（当前章 ≥ 预期回收章 且状态未回收）；卡点级判 block。 */
export function foreshadowAssert(projectDir: string, relPath: string, fs: IFileSystem = nodeFs, path: IFsPath = nodePath): Validation {
  let tf: string | null = null;
  for (const c of ["世界书/伏笔台账.md", "伏笔台账.md"]) {
    if (fs.exists(path.join(projectDir, c))) {
      tf = c;
      break;
    }
  }
  if (!tf) {
    try {
      for (const f of fs.readDir(path.join(projectDir, "世界书"))) {
        if (/伏笔/.test(f) && f.endsWith(".md")) {
          tf = "世界书/" + f;
          break;
        }
      }
    } catch {
      /* 无世界书目录 */
    }
  }
  if (!tf) {
    return { name: "AE-CONT-FORESHADOW", status: "warn", detail: "无伏笔台账——逾期切片不适用（语义级判断归红方）" };
  }
  const m = relPath.match(/第(\d+)章/);
  const cur = m ? parseInt(m[1] ?? "", 10) : NaN;
  if (!Number.isFinite(cur)) {
    return { name: "AE-CONT-FORESHADOW", status: "warn", detail: "非章节产物，逾期切片不适用" };
  }
  const text = fs.readText(path.join(projectDir, tf));
  const rows = text.split("\n").filter((l) => l.trim().startsWith("|")).filter((l) => !/^[\s|:\-]+$/.test(l));
  const bodyRows = rows.filter((r) => !/(编号|状态|内容|说明|回收章|埋设章)/.test(r.split("|")[1] ?? ""));
  if (!bodyRows.length) {
    return { name: "AE-CONT-FORESHADOW", status: "warn", detail: `伏笔台账（${tf}）无可解析表行——逾期切片不适用` };
  }
  const overdue: string[] = [];
  let checkedN = 0;
  for (const r of bodyRows) {
    const cells = r.split("|").map((c) => c.trim()).filter(Boolean);
    const nums = cells.map((c) => (/^\d+$/.test(c) ? parseInt(c, 10) : NaN)).filter((n) => Number.isFinite(n));
    const statusCell = cells.find((c) => /(回收|兑现|关闭|废弃|逾期|待|未|埋设|观察)/.test(c)) ?? "";
    if (!nums.length || !statusCell) continue;
    checkedN++;
    const due = Math.max(...nums);
    if (due <= cur && !FORESHADOW_DONE_RE.test(statusCell)) {
      overdue.push(`${cells[0]}（预期第${due}章，状态:${statusCell}${/卡点/.test(r) ? "，卡点级" : ""}）`);
    }
  }
  if (!checkedN) {
    return { name: "AE-CONT-FORESHADOW", status: "warn", detail: `伏笔台账（${tf}）行不可解析（需数字章号+状态列）——切片不适用` };
  }
  const hard = overdue.some((o) => o.includes("卡点级"));
  return overdue.length
    ? {
        name: "AE-CONT-FORESHADOW",
        status: hard ? "block" : "warn",
        detail: `到期伏笔未回收 ${overdue.length} 条: ${overdue.slice(0, 5).join("；")}`,
      }
    : { name: "AE-CONT-FORESHADOW", status: "pass", detail: `伏笔台账 ${checkedN} 条无逾期（当前第${cur}章）` };
}

/**
 * AE-REPORT-DENSITY（block）· 小说流 v2 m1「选题报告」验收职责：
 * 梗密度（高传播梗素材 ≥8 条）、竞品对标（≥2 部，带借鉴点）、可用话题（清单在场）、热度数据（n/万 在场）。
 * 用户口径：「验收标准则是梗的密度，可以用的话题以及剧情，可以借鉴的东西」。
 */
export function reportDensityAssert(text: string): Validation {
  const problems: string[] = [];
  // 表格内容行 = 以 | 开头且非纯分隔行；语义行 = 行内含 梗/话题/对标/素材/借鉴 关键词
  const rows = text.split("\n").filter((l) => {
    const t = l.trim();
    return t.startsWith("|") && !/^\|[\s:|-]+\|$/.test(t);
  });
  const tropeRows = rows.filter((l) => /梗|话题|对标|素材|借鉴/.test(l)).length;
  const bench = (text.match(/[《「][^》」]{2,30}[》」]/g) ?? []).length;
  // 热度数据：数字紧跟「万」，或表格行内裸数字且上方 3 行内的表头声明了（万）——
  // 口径过窄会把「表头带单位、单元格裸数字」的规范表格误判为无数据（p-slj-001 实证）
  const textLines = text.split("\n");
  let heat = 0;
  for (let i = 0; i < textLines.length; i++) {
    const l = textLines[i] ?? "";
    const direct = l.match(/\d{2,6}(\.\d+)?\s*万/g) ?? [];
    heat += direct.length;
    if (!direct.length && l.includes("|") && /\d{2,6}(\.\d+)?/.test(l)) {
      const headerCtx = textLines.slice(Math.max(0, i - 3), i).join("");
      if (/（?万）?|均热/.test(headerCtx)) heat += (l.match(/\d{2,6}(\.\d+)?/g) ?? []).length;
    }
  }
  if (tropeRows < 8) problems.push(`梗/话题/对标行 ${tropeRows} < 8（梗密度不足）`);
  if (bench < 2) problems.push(`竞品对标引用 ${bench} < 2（缺可借鉴件）`);
  if (!/话题/.test(text)) problems.push("缺「可用话题」清单节");
  if (heat < 3) problems.push(`热度数据（n/万）${heat} < 3 处（结论必须挂数据）`);
  return problems.length === 0
    ? { name: "AE-REPORT-DENSITY", status: "pass", detail: `梗/话题行 ${tropeRows}、对标 ${bench}、热度数据 ${heat} 处` }
    : { name: "AE-REPORT-DENSITY", status: "block", detail: problems.join("；") };
}

/**
 * AE-SCRIPT-FIELDS（block）· 剧本验收职责（2026-09-19 用户口径重写）：
 * 正常剧本格式——逐集（第X集），每集有 场景头 / 角色:台词（≥2 行）/ 动作（△ 或 行动）/ 集末「卡点：」。
 * 5W1H 字段行废止：剧本要通顺流畅，结构意图（每段表达什么、什么效果）写在创作里，不摆表单。
 */
export function scriptFieldsAssert(text: string, budget?: Record<string, number>): Validation {
  const problems: string[] = [];
  const minBeats = th(budget, "minBeats");
  const eps = text.split(/(?=^第[一二三四五六七八九十百0-9]+集\s*(?:《|$))/gm).filter((s) => /^第[一二三四五六七八九十百0-9]+集/.test(s));
  if (eps.length < minBeats) problems.push(`集数 ${eps.length} < ${minBeats}（试稿至少 ${minBeats} 集，每集一个完整冲突回合）`);
  let missScene = 0, missDlg = 0, missAct = 0, missCard = 0;
  for (const e of eps) {
    if (!/场景[:：]/.test(e)) missScene++;
    const dlgLines = e.split("\n").filter((l) => /^[^\s△][^：\n]{1,12}(（[^）]*）)?：/.test(l.trim())).length;
    if (dlgLines < 2) missDlg++;
    if (!/△|动作[:：]|（[^）]*(走|站|坐|推|抓|扔|抬|举|跑)[^）]*）/.test(e)) missAct++;
    if (!/卡点[:：]/.test(e)) missCard++;
  }
  if (missScene) problems.push(`${missScene} 集缺「场景：」头`);
  if (missDlg) problems.push(`${missDlg} 集缺台词（角色名：台词 至少 2 行）`);
  if (missAct) problems.push(`${missAct} 集缺动作（△ 或 动作：）`);
  if (missCard) problems.push(`${missCard} 集缺集末「卡点：」（每集必须回答：观众为什么看下一集）`);
  return problems.length === 0
    ? { name: "AE-SCRIPT-FIELDS", status: "pass", detail: `${eps.length} 集剧本格式齐备（场景/台词/动作/卡点）` }
    : { name: "AE-SCRIPT-FIELDS", status: "block", detail: problems.join("；") };
}

/**
 * AE-CH-LEN（major/block）· 多章正文每章 CJK 字数下限（诊断 2026-09-19）：
 * ghostwrite.chapterMin 声明了 1500/章 却无断言兜底——p-slj-001 三章 2187 字（729/章）无人报警。
 * 自门控：正文含 ≥2 个「## 第N章」小节才生效；单章文件不适用。
 * 阈值：每章 <800 CJK 判 block，<1800 判 warn（对齐 chapterMin 默认值，章长基准 2000/章）。
 */
export function chapterLengthAssert(text: string, budget?: Record<string, number>): Validation {
  const chapters = text.split(/^##\s*第[一二三四五六七八九十百0-9]+章/gm).slice(1);
  if (chapters.length < 2) {
    return { name: "AE-CH-LEN", status: "warn", detail: "非多章正文（章节数 <2），章长检查不适用" };
  }
  const blockMin = th(budget, "chapterBlockChars");
  const warnMin = th(budget, "chapterWarnChars");
  const cjk = (s: string) => (s.match(/[一-鿿]/g) ?? []).length;
  const lens = chapters.map(cjk);
  const blocks = lens.filter((n) => n < blockMin);
  const warns = lens.filter((n) => n < warnMin);
  if (blocks.length) {
    return {
      name: "AE-CH-LEN",
      status: "block",
      detail: `${chapters.length} 章中有 ${blocks.length} 章 CJK 字数 <${blockMin}（各章：${lens.join("/")}）——概览代叙不是正文`,
    };
  }
  if (warns.length) {
    return {
      name: "AE-CH-LEN",
      status: "warn",
      detail: `${warns.length} 章低于 ${warnMin} 字下限（各章：${lens.join("/")}）——信息密度待加厚`,
    };
  }
  return { name: "AE-CH-LEN", status: "pass", detail: `${chapters.length} 章字数达标（${lens.join("/")}）` };
}

/**
 * check_aesthetic_asserts 的内核实现（M2 正式版）。
 * 机器可查维度：钩型四型/拍三件套/时长区间/尾钩在场/台词密度/梗点/卡点位/合规禁词/自造专名限额/编排表忠实性。
 * 视角类维度（代入感/节奏体感…）机器查不了——不在此表，归红方剖面。
 */
export function runAestheticAsserts(
  projectDir: string,
  relPath: string,
  budget?: Record<string, number>,
  fs: IFileSystem = nodeFs,
  path: IFsPath = nodePath,
): Validation[] {
  const results: Validation[] = [];
  let text: string;
  try {
    text = fs.readText(path.join(projectDir, relPath));
  } catch {
    return [{ name: "AE-EXISTS", status: "block", detail: `产物缺失: ${relPath}` }];
  }
  // 选题报告（小说流 v2·m1 模块交付）：验收职责 = 梗密度 / 竞品对标 / 可用话题，全为文本层可查。
  // 路由用 R6 精确路径——老 flow@2 的 对外交付/01-选题报告.md 不适用此验收（职责契约不同，勿误伤）
  const relNorm = relPath.replaceAll("\\", "/");
  if (/^01-选题\/选题报告\.md$/.test(relNorm)) {
    return [reportDensityAssert(text), ...ledgerSliceAsserts(projectDir, relPath, text, fs, path)];
  }
  // 剧本 IR（小说流 v2·m2 模块交付）：验收职责 = 每场 5W1H/行动/台词/价值/钩 字段齐备
  if (/^02-编剧\/剧本\.md$/.test(relNorm) && /###\s*场/.test(text)) {
    return [scriptFieldsAssert(text, budget), ...ledgerSliceAsserts(projectDir, relPath, text, fs, path)];
  }
  // 剧本类产物（成品剧本/试稿）：脚本格式专项断言（M2.5，客户版式契约）+ 连续性切片
  if (/剧本|试稿/.test(relPath) && !/\*\*B\d{4}｜/.test(text)) {
    return [...scriptFormatAsserts(text, projectDir, fs, path), ...ledgerSliceAsserts(projectDir, relPath, text, fs, path)];
  }
  // 非拍级且非剧本：小说正文走 prose 断言表（K7/R2 事故后接入，规则同 tools/prose-scan.py）
  // + WO-A② 文本层校验器：章末钩/越权切片/台账矛盾切片/伏笔逾期/纯净度
  const allBeats = [...text.matchAll(/\*\*B(\d+)｜([^｜]+)｜(\d+)秒\*\*[\s\S]*?(?=\*\*B\d+｜|$)/g)];
  if (allBeats.length === 0) {
    if (/章节正文|第\d+章|正文|终稿/.test(relPath)) {
      return [
        ...proseAsserts(text, budget),
        chapterHookAssert(projectDir, relPath, text, fs, path),
        ...ledgerSliceAsserts(projectDir, relPath, text, fs, path),
        purityAssert(projectDir, text, fs, path),
      ];
    }
    return [{ name: "AE-SKIP-NON-BEAT", status: "warn", detail: "非拍级产物，美学断言不适用（转红方视角层）" }];
  }
  const eps = parseBeatStructure(text);
  const cfg = projectConfig(projectDir, fs, path);
  const add = (id: string, ok: boolean, detail: string, level: "block" | "major" | "minor" = "major") =>
    results.push({ name: id, status: ok ? "pass" : level === "block" ? "block" : "warn", detail });

  // AE-HOOK-EVENT（block）：每集首拍钩型 ∈ 四型
  const badHooks = eps.filter((e) => !["悬念", "反常", "危险", "承诺"].includes(e.firstHookType ?? ""));
  add(
    "AE-HOOK-EVENT",
    badHooks.length === 0,
    badHooks.length === 0
      ? `${eps.length} 集首拍钩型全部四型之一`
      : `首拍钩型违规: ${badHooks.map((e) => `第${e.no}集(${e.firstHookType ?? "无"})`).join("、")}`,
    "block",
  );

  // AE-BEAT-FORMAT（major）：三件套 + 时长 6-15s
  const all = eps.flatMap((e) => e.beats.map((b) => ({ ...b, ep: e.no })));
  const missingTrio = all.filter((b) => !(b.hasStoryboard && b.hasDialogue && b.hasPerformance));
  add(
    "AE-BEAT-FORMAT",
    missingTrio.length === 0,
    missingTrio.length === 0
      ? `${all.length} 拍三件套（分镜/台词/表演）完整`
      : `三件套缺失 ${missingTrio.length} 拍: ${missingTrio.slice(0, 5).map((b) => `B${String(b.no).padStart(4, "0")}@ep${b.ep}`).join("、")}…`,
  );
  const badDur = all.filter((b) => !(6 <= b.durationS && b.durationS <= 15));
  add(
    "AE-BEAT-FORMAT#dur",
    badDur.length === 0,
    badDur.length === 0 ? `时长全部 6-15s` : `时长越界: ${badDur.slice(0, 5).map((b) => `B${b.no}(${b.durationS}s)`).join("、")}…`,
  );

  // AE-STRUCT-CAUSE#tailhook（block）：每拍尾钩在场
  const noHook = all.filter((b) => !b.hasTailhook);
  add(
    "AE-STRUCT-CAUSE#tailhook",
    noHook.length === 0,
    noHook.length === 0 ? "每拍尾钩在场" : `尾钩缺失: ${noHook.slice(0, 5).map((b) => `B${b.no}`).join("、")}…`,
    "block",
  );

  // AE-DENSITY-WORDS（major）：每集台词字数 150-350（去舞台提示）
  const densityFail: string[] = [];
  for (const e of eps) {
    const lines = e.body.split("\n").filter((l) => l.includes("台词："));
    let dlg = lines.map((l) => l.replace(/.*台词：/, "")).join("");
    dlg = dlg.replace(/（[^）]*）/g, "");
    const chars = dlg.replace(/[\s"：:.-]/g, "").length;
    if (chars > 0 && !(150 <= chars && chars <= 350)) densityFail.push(`第${e.no}集≈${chars}字`);
  }
  add("AE-DENSITY-WORDS", densityFail.length === 0, densityFail.length === 0 ? "各集台词密度在规范区间" : `密度越界: ${densityFail.join("、")}`);

  // AE-MEME-POINT（major）：每集 ≥1 梗点（项目梗表驱动；未配置则跳过）
  if (cfg.memes.length) {
    const noMeme = eps.filter((e) => !cfg.memes.some((m) => e.body.includes(m)));
    add("AE-MEME-POINT", noMeme.length === 0, noMeme.length === 0 ? "各集梗点在场" : `梗点缺失: ${noMeme.map((e) => `第${e.no}集`).join("、")}`);
  }

  // AE-CARD-END（major）：卡点体检位
  add(
    "AE-CARD-END",
    text.includes("卡点体检") || text.includes("为什么看下一集"),
    "集末卡点体检位在场",
  );

  // AE-COMPLIANCE（block）：违禁词（真实运动员/机构等，项目配置）
  const bannedHits = cfg.banned.filter((b) => text.includes(b));
  add("AE-COMPLIANCE", bannedHits.length === 0, bannedHits.length === 0 ? "无违禁词命中" : `命中: ${bannedHits.join("、")}`, "block");

  // AE-CHOREO-FIDELITY（block，编排表忠实性）：集号连续 + 落在大纲编排表范围内
  const epNos = eps.map((e) => e.no).sort((a, b) => a - b);
  if (epNos.length >= 2) {
    const gaps: string[] = [];
    for (let i = 1; i < epNos.length; i++) {
      const prev = epNos[i - 1] ?? 0;
      const cur = epNos[i] ?? 0;
      if (cur - prev > 1) gaps.push(`缺第 ${prev + 1}~${cur - 1} 集`);
    }
    add("AE-CHOREO-GAP", gaps.length === 0, gaps.length === 0 ? `集号连续（${epNos[0]}-${epNos[epNos.length - 1]}）` : `集号断档: ${gaps.join("、")}`, "block");
    const bounds = outlineEpisodeBounds(projectDir, fs, path);
    if (bounds) {
      const outside = epNos.filter((n) => !bounds.has(n));
      add(
        "AE-CHOREO-BOUNDS",
        outside.length === 0,
        outside.length === 0 ? `${epNos.length} 集全部在大纲编排表范围内` : `超出大纲编排表: 第 ${outside.join("、")} 集`,
        "block",
      );
    }
  }

  // AE-VIS-EMPTY（block）：禁空镜禁不可拍摄内容——分镜/行动/表演行含心理/抒情词
  const visHits: string[] = [];
  text.split("\n").forEach((ln, i) => {
    if (/(分镜：|行动：|表演：)/.test(ln) && VIS_BAD_RE.test(ln)) visHits.push(`L${i + 1}:${ln.trim().slice(0, 40)}`);
  });
  add(
    "AE-VIS-EMPTY",
    visHits.length === 0,
    visHits.length === 0 ? "分拍可拍摄性合格（无心理/抒情标注）" : `不可拍摄内容（心理/抒情）入分镜: ${visHits.slice(0, 5).join("；")}`,
    "block",
  );

  // 连续性切片（成文产物路径生效；小纲/大纲过程件自动跳过）
  results.push(...ledgerSliceAsserts(projectDir, relPath, text, fs, path));
  // 章长下限（AE-CH-LEN）：自门控——文本含 ≥2 章节头才生效
  results.push(chapterLengthAssert(text, budget));

  return results;
}

/**
 * 小说正文 prose 断言（kb/formats/webnovel-fastfood「排比配额」+ kb/aesthetic/slop-list 的机器可查层）。
 * 语义层排比（管X叫Y 式）机器抓不全——归新读者官通读，本表只管硬配额。
 * 配额口径：三连排比每章 ≤1（文书体/笑点本体豁免，定场区不豁免——豁免判给人工，此处超 1 即 warn）；
 * 「不是A(而)是B」每章 ≤2；突然/仿佛/似乎 ≤2；slop 高频词零容忍。
 */
export function proseAsserts(text: string, budget?: Record<string, number>): Validation[] {
  const results: Validation[] = [];
  const add = (id: string, ok: boolean, detail: string, level: "major" | "minor" = "major") =>
    results.push({ name: id, status: ok ? "pass" : "warn", detail });
  const body = text.replace(/^---[\s\S]*?---/, "").replace(/^#.*$/gm, "");

  // AE-PROSE-TRIPLET：模板句三连（首字同+逗号位同+字长差≤1）+ 同句子句三连（首2或末2字同）
  const sents = body.split(/(?<=[。！？])/).map((s) => s.trim()).filter((s) => s.length >= 4);
  const shape = (s: string) => {
    const b = s.replace(/[「」『』“”\s]/g, "");
    return { first: b[0], comma: b.indexOf("，"), cjk: (b.match(/[\u4e00-\u9fff]/g) ?? []).length };
  };
  const trips: string[] = [];
  for (let i = 0; i + 2 < sents.length; i++) {
    const a = shape(sents[i] ?? ""), b = shape(sents[i + 1] ?? ""), c = shape(sents[i + 2] ?? "");
    if (a.first === b.first && b.first === c.first && a.comma === b.comma && b.comma === c.comma &&
        Math.abs(a.cjk - b.cjk) <= 1 && Math.abs(b.cjk - c.cjk) <= 1)
      trips.push(`${sents[i]}｜${sents[i + 1]}｜${sents[i + 2]}`);
  }
  for (const sent of body.split(/[。！？…]+/)) {
    const cs = sent.split(/[，；、]+/).map((s) => s.trim()).filter((s) => s.length >= 2);
    for (let i = 0; i + 2 < cs.length; i++) {
      const x = cs[i] ?? "", y = cs[i + 1] ?? "", z = cs[i + 2] ?? "";
      if (/^(第一|第二|第三)/.test(x)) continue;
      if ((x.slice(0, 2) === y.slice(0, 2) && y.slice(0, 2) === z.slice(0, 2)) ||
          (x.slice(-2) === y.slice(-2) && y.slice(-2) === z.slice(-2)))
        trips.push(`${x}，${y}，${z}`);
    }
  }
  const parallelQuota = th(budget, "parallelQuota");
  add(
    "AE-PROSE-TRIPLET",
    trips.length <= parallelQuota,
    trips.length === 0 ? "无三连排比"
      : trips.length <= parallelQuota ? `三连排比 ${trips.length} 处（配额内，须为笑点/文书本体）: ${trips[0]?.slice(0, 42)}`
      : `三连排比 ${trips.length} 处超配额(≤${parallelQuota}): ${trips.slice(0, 3).join(" ⋅ ")}`,
  );

  // AE-PROSE-NOTBUT：假转折配额
  const contrastQuota = th(budget, "contrastQuota");
  const nb = [...body.matchAll(/不是[^。！？\n]{1,18}?[，。；][^。！？\n]{0,6}?(而是|是)/g)].length;
  add("AE-PROSE-NOTBUT", nb <= contrastQuota, `「不是A(而)是B」${nb} 处（配额 ${contrastQuota}）${nb > contrastQuota ? "——超配额" : ""}`);

  // AE-PROSE-RHYTHM：节奏词
  const fillerQuota = th(budget, "fillerQuota");
  const rhythm = (body.match(/突然|仿佛|似乎/g) ?? []).length;
  add("AE-PROSE-RHYTHM", rhythm <= fillerQuota, `突然/仿佛/似乎 ${rhythm} 处（≤${fillerQuota}）${rhythm > fillerQuota ? "——超配额" : ""}`, "minor");

  // AE-PROSE-SLOP：AI 高频词（OpenAI 8 类中文映射的词句层）
  const slopWords = ["值得注意的是", "综上", "总之", "可以说", "真的", "确实", "其实", "显然", "某种程度", "一定程度上", "深入探讨", "赋能", "彰显"];
  const hits = slopWords.map((w) => ({ w, n: body.split(w).length - 1 })).filter((h) => h.n > 0);
  add("AE-PROSE-SLOP", hits.length === 0, hits.length === 0 ? "无 AI 高频词" : `slop 词: ${hits.map((h) => `「${h.w}」×${h.n}`).join(" ")}`);

  return results;
}

/**
 * 成品剧本客户版式断言（模板：templates/剧本试稿模板.md + 甲方版式规范 2026-09-16）：
 * 1) 前置件：背景/主角/剧情概括 三件必须在文首
 * 2) 零元词：过程标注（拍号/钩型/尾钩/卡点体检/切片梗点/质检/流程说明）不得出现（AE-OUTPUT-PURITY）
 * 3) 【】规范：场景与动作提示用全角【】包裹
 */
export function scriptFormatAsserts(text: string, projectDir?: string, fs: IFileSystem = nodeFs, path: IFsPath = nodePath): Validation[] {
  const results: Validation[] = [];
  const head = text.split("\n").slice(0, 60).join("\n");
  const frontMissing = ["背景", "主角", "剧情概括"].filter((k) => !head.includes(k));
  results.push(
    frontMissing.length === 0
      ? { name: "AE-SCRIPT-FRONT", status: "pass", detail: "前置件齐备（背景/主角/剧情概括）" }
      : { name: "AE-SCRIPT-FRONT", status: "block", detail: `前置件缺失: ${frontMissing.join("、")}` },
  );

  const metaRe =
    /(产物完|dialogue-polish 技能|未读取 projects|无 git 操作|质检附注|卡点体检|切片梗点|伏笔回收|伏笔台账|\*\*B\d{4}｜|尾钩→|钩型｜|档位台词|A\/B 计量|快照 \d{4}-\d{2}-\d{2})/;
  const metaHits: string[] = [];
  text.split("\n").forEach((ln, i) => {
    const m = ln.match(metaRe);
    if (m) metaHits.push(`L${i + 1}:${m[1]}`);
  });
  results.push(
    metaHits.length === 0
      ? { name: "AE-SCRIPT-PURITY", status: "pass", detail: "无过程标注泄漏" }
      : { name: "AE-SCRIPT-PURITY", status: "block", detail: `与剧本无关的提示性内容: ${metaHits.slice(0, 6).join("、")}${metaHits.length > 6 ? "…" : ""}` },
  );

  const bracketCount = (text.match(/【[^】]{2,80}】/g) ?? []).length;
  const sceneCount = (text.match(/^\s*场景[:：]/gm) ?? []).length + (text.match(/【场景/g) ?? []).length;
  results.push(
    bracketCount >= Math.max(3, sceneCount)
      ? { name: "AE-SCRIPT-BRACKET", status: "pass", detail: `【】标注 ${bracketCount} 处（场景/动作）` }
      : { name: "AE-SCRIPT-BRACKET", status: "block", detail: `【】标注不足（${bracketCount} 处，场景/动作提示须用全角【】包裹）` },
  );

  // AE-VIS-EMPTY（block）：场景/动作/【】行含心理/抒情词 = 不可拍摄
  const visHits: string[] = [];
  text.split("\n").forEach((ln, i) => {
    if (/(场景[:：]|动作[:：]|【)/.test(ln) && VIS_BAD_RE.test(ln)) visHits.push(`L${i + 1}:${ln.trim().slice(0, 40)}`);
  });
  results.push(
    visHits.length === 0
      ? { name: "AE-VIS-EMPTY", status: "pass", detail: "画面信息合格（无心理/抒情标注）" }
      : { name: "AE-VIS-EMPTY", status: "block", detail: `不可拍摄内容（心理/抒情）: ${visHits.slice(0, 5).join("；")}` },
  );

  // AE-OUTPUT-PURITY（block）：与 AE-SCRIPT-PURITY 同证据、按注册表 id 另发一条（声明名精确匹配）
  if (projectDir) results.push(purityAssert(projectDir, text, fs, path));
  return results;
}
