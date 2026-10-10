/**
 * 批次3a P6 · 快诊断（diag_scan 的逻辑本体）—— S 级确定性诊断 → diagnosis-report@1。
 *
 * 命名说明：`diag.ts` 已是 R8 的旁路失败留痕（diagnostics@1，recordDiag）；本件承载
 * 「跑成了的检查的结果」（diagnosis-report@1），两份契约的分工见 diagnosis-report.schema
 * 头注——扫描器抛错走那边留痕，扫描结论走这里。
 *
 * 立场（D5 决议 / ROADMAP 批次3a P6）：
 *  · **绝不让大模型进静默诊断链路**——本模块零 LLM、零 token；B 级主观审美归 agent 评审
 *    通道，不进本路径（`engines.agent.ran` 恒 false）。
 *  · **机器只出证据，不裁决**：S 级 findings 全量进 evidence[]（scanner=AE-id，可复核）；
 *    items[] 只由规则卡条款（rule-card@1）机械投影而来——severity/suggestion 都读卡面
 *    声明，不新造第二语义（同源铁律，ARCHITECTURE §3.2）。
 *  · **声明位变现**：`项目配置.json.validation`（批次2.5 P1 落的声明位）在此真正生效——
 *    tierThreshold 决定哪些分级通道跑 / cardScope 决定装载哪家卡 / severityFloor 过滤
 *    产出项。整块缺省 = 契约缺省语义（S+A / both / minor）。
 *  · S 级扫描器 = `aesthetic.ts::runAestheticAsserts` 真身（quality-cli / quality-scan.py
 *    引擎半边的同一实现，禁止第二份计数逻辑），进程内直调——**无 Python/tsx 子进程税**，
 *    这是 <100ms 延迟预算的架构取舍：prose-scan / zhuque-check 等 Python 件不进本路径
 *    （spawn 秒级且无稳定条款 id，按 diagnosis-validate --map 的口径无 id 标签不得冒充
 *    scanner）；要它们的证据走 quality_scan 动词。
 *  · 诚实边界（对账源）：扫描器条款（T 轨 AE-id）与卡条款（C 轨）刻意双轨，机械映射只在
 *    「条款 rule_id === AE-id」或「DECLARED_GAPS（kit-lint 同源表）」处成立；对不上的
 *    findings 如实全跑、只出证据、在 engines.s.note 点名——不硬造映射。
 *  · A 级（laya 学生头）只在 `proposal=true` **显式开启**时跑；venv/权重缺失 = 显式失败
 *    带回填指引（`LAYA_UNAVAILABLE`），绝不静默降级到任何 API/4B 兜底（人裁
 *    docs/人裁-laya唯一引擎-20260924.md）。
 */
import { KernelError, type Kernel } from "./kernel.js";
import { runAestheticAsserts } from "./aesthetic.js";
import { loadProjectConfig, configBudget, type ProjectConfig } from "./project-config.js";
import type { Validation } from "./types.js";

// ── 契约面常量（与 contracts/diagnosis-report.schema.json、project-config.schema.json 对齐）──

const REPORT_FORMAT = "diagnosis-report@1";
type Tier = "S" | "A" | "B";
type Severity = "block" | "major" | "minor";
const SEVERITY_RANK: Record<Severity, number> = { block: 0, major: 1, minor: 2 };

/** project-config.validation 声明位（批次2.5 P1 契约的可选块；整块缺省 = 缺省语义）。 */
export interface ValidationDecl {
  tierThreshold?: Tier[];
  cardScope?: "global" | "project" | "both";
  severityFloor?: Severity;
}

/** 声明位解析结果（consumed 口径随返回值回显，宿主可核对「我配的旋钮真的生效了」）。 */
export interface ResolvedValidation {
  tierThreshold: Tier[];
  cardScope: "global" | "project" | "both";
  severityFloor: Severity;
  /** 声明来源：project-config = 项目配置.json 显式声明；default = 整块缺省走契约缺省语义。 */
  source: "project-config" | "default";
}

const DEFAULT_VALIDATION: ResolvedValidation = {
  tierThreshold: ["S", "A"],
  cardScope: "both",
  severityFloor: "minor",
  source: "default",
};

/** DECLARED_GAPS：与 tools/lintlib.py 同源的官方语义映射（AE-id → 规则卡），无 repair 可依，
 *  只用于给 evidence 挂 rule_ref 线索，不据它造 items（没有条款就没有建议，同源铁律）。 */
const DECLARED_GAPS: Record<string, string> = {
  "AE-NAT-HIT": "kb/rules/ai-trace",
};

/** laya A 级运行时位（用户侧回填件，不入库；口径同 tools/laya-scan.py 头部）。 */
const LAYA_VENV_REL = ["tools", "_vendor", "laya-venv", "Scripts", "python.exe"];
const LAYA_STUDENT_REL = ["runs", "laya-run-0923", "student-v3"];

// ── 规则卡装载（rule-card@1 信封，knowledge/rules/ 全局档 + 项目 规则//文风/ 项目档）──

interface RuleClause {
  rule_id: string;
  tier: Tier;
  severity: Severity;
  repair?: string;
}

interface RuleCard {
  id: string;
  dimension: string;
  scope: "global" | "project";
  file: string;
  clauses: RuleClause[];
  scannerQids: string[];
}

/** 抽 md 头部 `---` 围栏里的 JSON 信封（rule-card@1 载体；与 tools/rules-init.py 产物同形）。 */
function parseCardEnvelope(text: string): Record<string, unknown> | undefined {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m?.[1]) return undefined;
  try {
    const parsed: unknown = JSON.parse(m[1]);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** 装一个目录下的规则卡；坏卡记进 issues 不静默（缺卡目录 = 空集，不算坏——项目可无项目卡）。 */
function loadCardsFromDir(kernel: Kernel, dir: string, scope: "global" | "project", issues: string[]): RuleCard[] {
  const { fs, path } = kernel;
  if (!fs.exists(dir)) return [];
  const out: RuleCard[] = [];
  for (const f of fs.readDir(dir).sort()) {
    if (!f.endsWith(".md") || f === "README.md") continue;
    const file = path.join(dir, f);
    const env = parseCardEnvelope(fs.readText(file));
    if (!env) {
      issues.push(`规则卡缺合法 JSON 信封，已跳过：${file}`);
      continue;
    }
    const id = typeof env.id === "string" ? env.id : `kb/rules/${path.basename(f, ".md")}`;
    const clausesRaw = Array.isArray(env.clauses) ? env.clauses : [];
    const clauses: RuleClause[] = [];
    for (const c of clausesRaw) {
      const cc = c as Record<string, unknown>;
      if (typeof cc.rule_id !== "string" || !cc.rule_id) continue;
      clauses.push({
        rule_id: cc.rule_id,
        // tier/severity 缺省按声明面最保守值：tier 缺省 B（不进确定性诊断）、severity 缺省 minor。
        tier: (cc.tier === "S" || cc.tier === "A" || cc.tier === "B" ? cc.tier : "B") as Tier,
        severity: (cc.severity === "block" || cc.severity === "major" ? cc.severity : "minor") as Severity,
        repair: typeof cc.repair === "string" && cc.repair ? cc.repair : undefined,
      });
    }
    out.push({
      id,
      dimension: typeof env.dimension === "string" ? env.dimension : path.basename(f, ".md"),
      scope,
      file,
      clauses,
      scannerQids: Array.isArray(env.scanner_qids) ? env.scanner_qids.map(String) : [],
    });
  }
  return out;
}

/** 按 cardScope 装载参与裁决的规则卡（global=repoRoot/knowledge/rules；project=<项目>/规则/＋文风/）。 */
function loadRuleCards(kernel: Kernel, projectDir: string, cardScope: ResolvedValidation["cardScope"], issues: string[]): RuleCard[] {
  const { path } = kernel;
  const cards: RuleCard[] = [];
  if (cardScope !== "project") {
    cards.push(...loadCardsFromDir(kernel, path.join(kernel.repoRoot, "knowledge", "rules"), "global", issues));
  }
  if (cardScope !== "global") {
    cards.push(...loadCardsFromDir(kernel, path.join(projectDir, "规则"), "project", issues));
    cards.push(...loadCardsFromDir(kernel, path.join(projectDir, "文风"), "project", issues));
  }
  return cards;
}

// ── 声明位解析 ──

/** 读 项目配置.json.validation 并按契约补缺省；坏配置大声失败（同 flow_run 口径，不静默降级）。 */
export function resolveValidation(kernel: Kernel, projectDir: string): { resolved: ResolvedValidation; cfg?: ProjectConfig } {
  let cfg: ProjectConfig | undefined;
  try {
    cfg = loadProjectConfig(projectDir, kernel.fs, kernel.path);
  } catch (e) {
    throw new KernelError("INVALID_INPUT", 400, `项目配置非法: ${e instanceof Error ? e.message : String(e)}`);
  }
  const raw = cfg?.validation as ValidationDecl | undefined;
  if (!raw || typeof raw !== "object") return { resolved: DEFAULT_VALIDATION, cfg };
  const resolved: ResolvedValidation = {
    // 数组元素收窄：契约值域 S|A|B 之外的取值在 loadProjectConfig 的 schema 校验已拦；
    // 这里再兜一层（直接 new Kernel 走库面的宿主可能绕过 assertSchema）。
    tierThreshold: Array.isArray(raw.tierThreshold) && raw.tierThreshold.length
      ? [...new Set(raw.tierThreshold.filter((t): t is Tier => t === "S" || t === "A" || t === "B"))]
      : DEFAULT_VALIDATION.tierThreshold,
    cardScope: raw.cardScope === "global" || raw.cardScope === "project" || raw.cardScope === "both"
      ? raw.cardScope
      : DEFAULT_VALIDATION.cardScope,
    severityFloor: raw.severityFloor === "block" || raw.severityFloor === "major" || raw.severityFloor === "minor"
      ? raw.severityFloor
      : DEFAULT_VALIDATION.severityFloor,
    source: "project-config",
  };
  return { resolved, cfg };
}

// ── laya A 级适配（服务形态接口；权重/venv 缺失 = 显式失败带回填指引，绝不静默降级）──

export interface LayaRow {
  case_id?: string;
  qid: string;
  problem_p: number;
  known_weakness?: string;
  章节位置?: string;
}

export interface LayaRun {
  rows: LayaRow[];
  /** laya-scan 报告落盘路径（= 本条 A 级证据的收据）。 */
  receipt: string;
  device?: string;
  loadS?: number;
  scanS?: number;
}

/** 拼回填指引（缺什么路径、去哪回填、回填后怎么验证）——文案是接口的一部分，逐字可测。 */
function layaGuidance(kernel: Kernel, missing: string[]): string {
  const venv = kernel.path.join(kernel.repoRoot, ...LAYA_VENV_REL);
  const student = kernel.path.join(kernel.repoRoot, ...LAYA_STUDENT_REL);
  const parts: string[] = [];
  if (missing.includes("venv")) parts.push(`学生头运行环境 ${venv}（torch cu126 venv，还原见 tools/_vendor/README.md「laya」节）`);
  if (missing.includes("weights")) parts.push(`学生权重目录 ${student}（口径见 tools/_vendor/README.md「laya」节）`);
  return [
    `A 级 laya 学生头不可用（缺 ${missing.join("、")}）——按人裁不回落 4B/API，停下报缺等人回填：`,
    `  ① 缺失件：${parts.join("；")}`,
    `  ② 回填后验证：重跑本动词（proposal=true）不再报 LAYA_UNAVAILABLE 即通；或直接 python tools/laya-scan.py --project <id> --file <项目内相对路径>`,
  ].join("\n");
}

/** laya A 级预检 + 单次批扫：可用性先行（缺件显式失败），可用则调 laya-scan.py 结构化取数。 */
export function runLayaAdapter(kernel: Kernel, projectId: string, rel: string, outReceiptAbs: string): LayaRun {
  const { fs, path, proc } = kernel;
  const venvPy = path.join(kernel.repoRoot, ...LAYA_VENV_REL);
  const student = kernel.path.join(kernel.repoRoot, ...LAYA_STUDENT_REL);
  const missing: string[] = [];
  if (!fs.exists(venvPy)) missing.push("venv");
  if (!fs.exists(student)) missing.push("weights");
  if (missing.length) {
    // 显式失败 = 错误信息自带回填指引；503 = 依赖未就绪（用户侧动作），不是代码缺陷。
    throw new KernelError("LAYA_UNAVAILABLE", 503, layaGuidance(kernel, missing));
  }
  // venv 在位 ⇒ 直接用 venv 解释器起 laya-scan（跳过系统 python stub 的 exit 49 坑；
  // laya-scan 自身 ensure_laya 也会 execv 到同一解释器，这里省掉那一跳）。
  let stdout = "";
  try {
    stdout = proc.exec(
      venvPy,
      [path.join(kernel.repoRoot, "tools", "laya-scan.py"), "--project", projectId, "--file", rel, "--out", outReceiptAbs],
      { cwd: kernel.repoRoot, timeoutMs: 600_000, maxBufferBytes: 32 * 1024 * 1024, envDelta: { PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" } },
    );
  } catch (e) {
    const err = e as { status?: number; stderr?: string; message?: unknown };
    throw new KernelError("LAYA_FAIL", 502, `laya-scan 执行失败(exit=${err.status ?? "?"}): ${String(err.stderr || err.message || e).slice(0, 800)}`);
  }
  void stdout; // laya-scan stdout 是人读进度行；结构化结果走 --out 落盘件
  if (!fs.exists(outReceiptAbs)) {
    // laya-scan stdout 是人读进度行；结构化结果走 --out 落盘件——没落盘 = 失败，带上原文尾部。
    throw new KernelError("LAYA_FAIL", 502, `laya-scan 未产出报告件：${outReceiptAbs}（stdout 尾部：${stdout.slice(-200)}）`);
  }
  const report = JSON.parse(fs.readText(outReceiptAbs)) as {
    device?: string;
    timing_s?: { load?: number; scan?: number };
    top?: { case_id?: string; qid: string; problem_p: number; known_weakness?: string; 章节位置?: string }[];
  };
  return {
    rows: report.top ?? [],
    receipt: outReceiptAbs,
    device: report.device,
    loadS: report.timing_s?.load,
    scanS: report.timing_s?.scan,
  };
}

// ── S 级 findings → evidence / items 投影 ──

export interface SProjection {
  evidence: Record<string, unknown>[];
  items: Record<string, unknown>[];
  /** 对不上任何卡条款的 AE-id（只出证据；点名进 engines.s.note，不硬造映射）。 */
  unmapped: string[];
  /** dims 域过滤丢弃的条数（对得上卡域但不属于所选域）。 */
  dimsDropped: number;
}

/**
 * 机械投影：findings（非 pass 的 AE 检查）→ evidence[]；能对上卡条款的再建 items[]。
 *  · 卡条款匹配 = clause.rule_id === AE-id（双轨下唯一机械成立的映射；DECLARED_GAPS 只挂 rule_ref 线索）。
 *  · tier=B 的条款不建项（B 归 agent 评审通道，契约缺省语义）；tier 不在 tierThreshold 的
 *    条款同样不建项（声明位消费：通道没开就不产出该分级）。
 *  · severityFloor 在 items 产出后过滤（评审优先级下限，不是提交闸）。
 *  · dims：对得上卡域的 findings，域不在所选子集 → 整条丢弃（证据+项一起）；对不上的全跑并注明。
 */
function projectSFindings(
  findings: Validation[],
  cards: RuleCard[],
  rel: string,
  receiptPath: string,
  resolved: ResolvedValidation,
  dims: Set<string> | undefined,
): SProjection {
  const evidence: Record<string, unknown>[] = [];
  const items: Record<string, unknown>[] = [];
  const unmapped = new Set<string>();
  let dimsDropped = 0;
  const tierSet = new Set<Tier>(resolved.tierThreshold);

  for (const f of findings) {
    const ae = f.name.split("#")[0] ?? f.name; // 「AE-X#sub」子键归主条款
    const gapCard = DECLARED_GAPS[ae];
    // 卡条款机械匹配：条款 id === AE-id（同 id 多卡 = 卡账问题，kit-lint 管账；此处取第一处）
    const hit = cards
      .map((c) => ({ card: c, clause: c.clauses.find((cl) => cl.rule_id === ae) }))
      .find((x) => x.clause !== undefined);

    // dims 域过滤：对得上卡域 → 域不在子集就整条丢弃；对不上 → 保留（如实全跑）
    if (dims) {
      const dom = hit?.card.dimension ?? (gapCard ? gapCard.replace(/^kb\/rules\//, "") : undefined);
      if (dom && !dims.has(dom)) {
        dimsDropped += 1;
        continue;
      }
    }

    evidence.push({
      ...(hit && hit.clause ? { rule_ref: `${hit.card.id}#${hit.clause.rule_id}` } : gapCard ? { rule_ref: gapCard } : {}),
      location: rel,
      scanner: f.name,
      metric: f.detail ?? f.status,
      receipt: receiptPath,
    });

    if (!hit?.clause) {
      unmapped.add(ae);
      continue;
    }
    const cl = hit.clause;
    // 通道门槛：B 恒不进确定性诊断；tier 不在 tierThreshold 的通道不产出。
    if (cl.tier === "B" || !tierSet.has(cl.tier)) continue;
    // 没有 repair 的条款出不了建议（同源铁律）——只出证据，不硬造建议。
    if (!cl.repair) continue;
    if (SEVERITY_RANK[cl.severity] > SEVERITY_RANK[resolved.severityFloor]) continue; // 低于下限不进报告
    items.push({
      rule_ref: `${hit.card.id}#${cl.rule_id}`,
      tier: cl.tier,
      severity: cl.severity,
      suggestion: cl.repair,
    });
  }
  return { evidence, items, unmapped: [...unmapped], dimsDropped };
}

// ── A 级 rows → evidence / items 投影 ──

/**
 * laya rows（按 qid 的复核优先级 p）→ evidence[]（scanner=qid，收据=laya 报告件）。
 * items 只在机械无歧义处建：qid ∈ 卡 scanner_qids（kit-lint E13 对账源）且该卡恰有一条
 * tier=A 且带 repair 的条款；problem_p ≥ 0.5（laya-scan 自身的「进 agent 二审清单」线）
 * 且非 known_weakness（信号权重自降，不建项）。除此之外只出证据——机器不裁决。
 */
function projectARows(
  rows: LayaRow[],
  cards: RuleCard[],
  rel: string,
  receiptPath: string,
): { evidence: Record<string, unknown>[]; items: Record<string, unknown>[]; unmapped: string[] } {
  const evidence: Record<string, unknown>[] = [];
  const items: Record<string, unknown>[] = [];
  const unmapped: string[] = [];
  for (const r of rows) {
    const ev: Record<string, unknown> = {
      location: `${rel}#${r.case_id ?? "case"}`,
      scanner: r.qid,
      metric: r.problem_p,
      receipt: receiptPath,
    };
    const card = cards.find((c) => c.scannerQids.includes(r.qid));
    const aClauses = card?.clauses.filter((cl) => cl.tier === "A" && cl.repair) ?? [];
    if (card && aClauses.length === 1) {
      const cl = aClauses[0];
      if (cl) {
        ev.rule_ref = `${card.id}#${cl.rule_id}`;
        if (r.problem_p >= 0.5 && !r.known_weakness) {
          items.push({ rule_ref: `${card.id}#${cl.rule_id}`, tier: "A", severity: cl.severity, suggestion: cl.repair ?? "" });
        }
      }
    } else {
      unmapped.push(r.qid);
    }
    evidence.push(ev);
  }
  return { evidence, items, unmapped };
}

// ── 主入口 ──

export interface DiagScanArgs {
  project: string;
  /** 待诊文本（与 path 二选一；落 内部/诊断暂存/ 留档，证据 location 指向它，可回查）。 */
  text?: string;
  /** 项目内相对路径（与 text 二选一）。 */
  path?: string;
  /** 规则域子集（dimension 名或 kb/rules/<域> 均可；缺省不过滤）。 */
  dims?: string[];
  /** A 级 laya 开关（缺省关；开启且权重缺失 = 显式失败带回填指引）。 */
  proposal?: boolean;
}

export interface DiagScanResult {
  ok: true;
  /** diagnosis-report@1 本体（过 tools/diagnosis-validate.py 同款形状）。 */
  report: Record<string, unknown>;
  report_path: string;
  receipt_path: string;
  timing_ms: { total: number; s_scan: number; a_scan?: number };
  applied_validation: ResolvedValidation;
}

export function diagScan(kernel: Kernel, args: DiagScanArgs): DiagScanResult {
  const { fs, path } = kernel;
  const t0 = Date.now();
  const projectId = args.project;
  const projectDir = kernel.projectDir(projectId);
  if (!fs.exists(projectDir)) {
    throw new KernelError("NO_PROJECT", 404, `项目不存在: ${projectDir}`);
  }
  if (!args.text && !args.path) {
    throw new KernelError("BAD_ARGS", 400, "diag_scan 需要 text 与 path 二选一（待诊文本或项目内相对路径）");
  }
  if (args.text !== undefined && args.path !== undefined) {
    throw new KernelError("BAD_ARGS", 400, "diag_scan 的 text 与 path 互斥，只给一个");
  }

  // ① 声明位变现：项目配置 validation（无则契约缺省语义），随返回值回显消费口径。
  const { resolved, cfg } = resolveValidation(kernel, projectDir);

  // ② 定位待诊对象：path 直用（缺件显式 404）；text 落 内部/诊断暂存/ 留档（证据可回查，不静默蒸发）。
  let rel: string;
  if (args.text !== undefined) {
    const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
    rel = path.join("内部", "诊断暂存", `diag-${stamp}.md`).replaceAll("\\", "/");
    const abs = path.join(projectDir, rel);
    fs.mkdir(path.dirname(abs), { recursive: true });
    fs.writeText(abs, args.text);
  } else {
    rel = String(args.path).replaceAll("\\", "/");
    if (!fs.exists(path.join(projectDir, rel))) {
      throw new KernelError("TARGET_MISSING", 404, `待诊文件不存在: ${rel}（项目 ${projectId}）`);
    }
  }

  // ③ 收据与报告落点：收据进 registry/receipts/（minitools 既有收据位），报告进 reports/
  //    （contracts/diagnosis-report.schema.json 的 canonical 落点）。
  const stampFull = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 17);
  const stem = path.basename(rel).replace(/\.md$/i, "") || "text";
  const receiptRel = path.join("registry", "receipts", `diag-scan-${stem}-${stampFull}.json`).replaceAll("\\", "/");
  const reportRel = path.join("reports", `diagnosis-${stem}-${stampFull}.json`).replaceAll("\\", "/");
  const receiptAbs = path.join(projectDir, receiptRel);

  // ④ S 级：aesthetic 引擎真身进程内直调（阈值预算吃 项目配置.阈值预算 实例层，与 flow_run 同源）。
  let sFindings: Validation[] = [];
  let sChecks = 0;
  const issues: string[] = [];
  const sStart = Date.now();
  if (resolved.tierThreshold.includes("S")) {
    const all = runAestheticAsserts(projectDir, rel, configBudget(cfg), fs, path);
    sChecks = all.length;
    sFindings = all.filter((v) => v.status !== "pass");
  }
  const sScanMs = Date.now() - sStart;

  // ⑤ 卡装载（cardScope 声明位消费）+ S 级投影。
  const cards = loadRuleCards(kernel, projectDir, resolved.cardScope, issues);
  const dims = args.dims?.length
    ? new Set(args.dims.map((d) => d.replace(/^kb\/rules\//, "").replace(/\/$/, "")))
    : undefined;
  const sProj = projectSFindings(sFindings, cards, rel, receiptRel, resolved, dims);

  const evidence: Record<string, unknown>[] = [...sProj.evidence];
  const items: Record<string, unknown>[] = [...sProj.items];
  const timing: DiagScanResult["timing_ms"] = { total: 0, s_scan: sScanMs };

  // ⑥ A 级：仅在 proposal=true 显式开启且 tierThreshold 含 A 时跑（通道门槛是声明位消费）。
  const engines: Record<string, { ran: boolean; note: string }> = {
    agent: { ran: false, note: "B 级主观审美归 agent 评审通道，不进确定性诊断（D5 决议）" },
  };
  if (args.proposal) {
    if (!resolved.tierThreshold.includes("A")) {
      engines.a = { ran: false, note: `A 级未跑：tierThreshold=[${resolved.tierThreshold.join(",")}] 不含 A（${resolved.source === "default" ? "缺省语义" : "项目配置.validation"}）` };
    } else {
      const aStart = Date.now();
      const laya = runLayaAdapter(kernel, projectId, rel, receiptAbs.replace(/\.json$/, "-laya.json"));
      timing.a_scan = Date.now() - aStart;
      const aProj = projectARows(laya.rows, cards, rel, laya.receipt);
      evidence.push(...aProj.evidence);
      items.push(...aProj.items);
      engines.a = {
        ran: true,
        note: `A 级 laya 学生头单次批扫：${laya.rows.length} 行（device=${laya.device ?? "?"}，load=${laya.loadS ?? "?"}s，scan=${laya.scanS ?? "?"}s）；` +
          `qid↔卡条款机械映射 ${laya.rows.length - aProj.unmapped.length}/${laya.rows.length}（对不上的只出证据：${aProj.unmapped.join("、") || "无"}）；` +
          `收据=${laya.receipt}`,
      };
    }
  } else {
    engines.a = { ran: false, note: "A 级未开启（proposal 缺省关；显式 proposal=true 开启，权重缺失显式报 LAYA_UNAVAILABLE）" };
  }
  engines.s = {
    ran: resolved.tierThreshold.includes("S"),
    note: resolved.tierThreshold.includes("S")
      ? `S 级确定性扫描（aesthetic 引擎真身，零 LLM）：检查 ${sChecks} 条，命中 ${sFindings.length} 条；` +
        `卡条款机械映射 ${sFindings.length - sProj.unmapped.length}/${sFindings.length}（对不上的只出证据不裁决：${sProj.unmapped.join("、") || "无"}）；` +
        (dims ? `dims=[${[...dims].join(",")}] 域外丢弃 ${sProj.dimsDropped} 条；` : "") +
        `cardScope=${resolved.cardScope}（装卡 ${cards.length} 张）${issues.length ? `；${issues.join("；")}` : ""}`
      : `S 级未跑：tierThreshold=[${resolved.tierThreshold.join(",")}] 不含 S（${resolved.source === "default" ? "缺省语义" : "项目配置.validation"}）`,
  };

  // ⑦ 收据落盘（报数必附收据，铁律 2）→ 报告落盘 → 返回。
  const summary =
    `快诊断 ${rel}：S 级检查 ${sChecks} 条、命中 ${sFindings.length} 条；建项 ${items.length} 条` +
    `（severityFloor=${resolved.severityFloor}，tierThreshold=[${resolved.tierThreshold.join(",")}]，cardScope=${resolved.cardScope}）；` +
    (engines.a?.ran ? "A 级 laya 已参与（见 engines.a）；" : "A 级未参与；") +
    `证据 ${evidence.length} 条全部带收据可回查：${receiptRel}`;
  const receipt = {
    tool: "diag-scan/v1",
    format: REPORT_FORMAT,
    project: projectId,
    target: rel,
    startedAt: new Date(t0).toISOString(),
    durationMs: { total: Date.now() - t0, s_scan: sScanMs, ...(timing.a_scan !== undefined ? { a_scan: timing.a_scan } : {}) },
    validation: resolved,
    dims: args.dims ?? undefined,
    s: {
      engine: "aesthetic.ts::runAestheticAsserts（quality-cli 同一真身，进程内直调）",
      checks: sChecks,
      findings: sFindings,
      cardsLoaded: cards.map((c) => ({ id: c.id, dimension: c.dimension, scope: c.scope, clauses: c.clauses.length })),
      unmapped: sProj.unmapped,
      dimsDropped: sProj.dimsDropped,
      issues,
    },
    a: engines.a?.ran ? { note: engines.a.note } : { ran: false, note: engines.a?.note ?? "" },
    note: "证据收据：本件不拦截、不裁决；items 由规则卡条款机械投影，建议=条款 repair 反向表达（同源铁律）",
  };
  fs.mkdir(path.dirname(receiptAbs), { recursive: true });
  fs.writeText(receiptAbs, JSON.stringify(receipt, null, 2) + "\n");

  const report: Record<string, unknown> = {
    format: REPORT_FORMAT,
    project: projectId,
    target: rel,
    engines,
    evidence,
    items,
    summary,
    receipt: receiptRel,
  };
  const reportAbs = path.join(projectDir, reportRel);
  fs.mkdir(path.dirname(reportAbs), { recursive: true });
  fs.writeText(reportAbs, JSON.stringify(report, null, 2) + "\n");

  timing.total = Date.now() - t0;
  return { ok: true, report, report_path: reportRel, receipt_path: receiptRel, timing_ms: timing, applied_validation: resolved };
}
