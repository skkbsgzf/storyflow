// B9（2026-09-28）· 指标面的纯计算层：上下文占用 / 成本 / 压缩压力。
//   数据来源只有一个：会话 JSONL 的 usage 行（message.usage 逐条 + run_event(chat_turn_end) 每回合收口）。
//   本文件不读盘、不起 agent、不发请求——给它行号＋事件，它给面板数字；这样「面板上的数」与
//   「磁盘上的账」是同一份，收据能逐行对（铁律 10：报数必附收据）。
//   口径说明（不藏）：
//   · context.used 沿用 pi 自己的 calculateContextTokens／estimateContextTokens（provider 实报用量
//     ＋其后尚无用量消息的字符估算），与压缩阈值同一把尺，面板与压缩判定不许各算一套。
//   · cost 由 pi 按 model.cost 价率算好；自定义端点价率为 0 → cost 记 0 并显式标「价率未配」，不编数。
//   · 本底座的对话环（pi Agent）**不自动压缩**：compact() 属 harness 层（另一套 session Entry 存储），
//     未接入。所以 compaction 明细出的是「压力读数＋该压了没有」，并显式声明 supported:false——查无就说查无。
import { DEFAULT_COMPACTION_SETTINGS, shouldCompact, type CompactionSettings } from "@earendil-works/pi-agent-core";
import { addUsage, contextTokensOf, normUsage, zeroUsage, type SessionEvent, type TokenUsage } from "./sessions.js";

/** 带行号的事件行（readSessionNumbered 的产物；ts 在盘上是首字段，类型里没声明所以这里补可选）。 */
export type EventRow = { line: number; event: SessionEvent & { ts?: string } };

export interface ModelMeta {
  provider: string;
  model: string;
  contextWindow: number;
  maxTokens: number;
  /** 价率（$/token，pi 目录自带）；全 0 = 该端点不计费 */
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  priced: boolean;
}

export interface ContextReadout {
  /** 模型上下文窗口（token）；0 = 未知 */
  window: number;
  /** 当前上下文占用（pi 压缩口径） */
  used: number;
  /** used/window，0-100 一位小数 */
  pct: number;
  /** 其中 provider 实报的部分 */
  usageTokens: number;
  /** 其后按字符估算补齐的部分 */
  trailingTokens: number;
  /** 这个数字从哪来：jsonl 的 usage 行 / 纯估算 / 查无 */
  basis: "provider" | "estimate" | "none";
}

export interface CompactionReadout {
  /** 本底座对话环是否会自动压缩（当前 false——harness 层 compact() 未接入） */
  supported: boolean;
  /** pi 默认压缩设置，用作压力线（threshold = window - reserveTokens） */
  reserveTokens: number;
  keepRecentTokens: number;
  thresholdTokens: number;
  /** 占用是否已越过压力线（该压缩了） */
  over: boolean;
  note: string;
}

/** 每轮一行（轨迹页逐轮表的行形状）。 */
export interface TurnStat {
  idx: number;
  ts: string;
  /** 该轮用户消息首 60 字，只为人眼定位，不是正文（正文在 transcript 面） */
  text: string;
  rounds: number;
  toolCalls: number;
  usage: TokenUsage;
  cost: number;
  /** 本轮 usage 行是否带 cost（false = 旧行未记成本，面板写「查无」） */
  costKnown: boolean;
  /** 成本来源（C7）：provider=供应商回报；rate=本地价率表估算；缺省=旧行为（provider 或查无） */
  costBasis?: "provider" | "rate";
  /** 本轮的上下文占用读数（该轮最后一条 usage） */
  contextUsed: number;
  contextWindow: number;
  /** 数字家在哪：message=逐条 usage 行求和（新会话）；turn=本回合收口行；legacy-cumulative=旧行只记累计 */
  basis: "message" | "turn" | "legacy-cumulative" | "none";
  /** 该轮 chat_turn_end 行号（无则 0） */
  line: number;
  /** 用量取自哪一行（对账用） */
  usageLine: number;
}

export interface SessionStats {
  sid: string;
  /** 账本文件（收据引用文件名用） */
  file: string;
  /** 整会话的数据来源形态；面板据此决定列标题是「本轮」还是「累计」 */
  source: "message" | "legacy" | "mixed" | "none";
  model: ModelMeta;
  turns: TurnStat[];
  totals: { turns: number; usage: TokenUsage; cost: number; costKnown: boolean; basis: string; costBasis?: "provider" | "rate" | "mixed" | "none" };
  context: ContextReadout;
  compaction: CompactionReadout;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** usage 行里到底有没有 cost 字段：B9 之前的旧行只写 {input,output}，成本查无 → 面板不许报 $0。 */
const hasCostField = (u: unknown): boolean =>
  !!u && typeof u === "object" && (u as { cost?: unknown }).cost !== undefined;

/** C7 · 价率估算（USD / 1M tokens）：供应商没回报 cost 时按本地价率表兜底；cacheRead 未配价不计。 */
export type CostRate = { input: number; output: number; cacheRead?: number };
export function rateCost(u: TokenUsage, r: CostRate): number {
  return (u.input * r.input + u.output * r.output + u.cacheRead * num(r.cacheRead)) / 1e6;
}
/** 查价率表：`provider/model` 优先、裸 model id 兜底；未配置或全 0 价 = null（照旧查无）。 */
export function rateOf(pricing: Record<string, CostRate> | undefined, provider: string, model: string): CostRate | null {
  const hit = pricing?.[`${provider}/${model}`] ?? pricing?.[model];
  if (!hit || !(num(hit.input) > 0 || num(hit.output) > 0)) return null;
  return { input: num(hit.input), output: num(hit.output), ...(num(hit.cacheRead) > 0 ? { cacheRead: num(hit.cacheRead) } : {}) };
}

/** 把 pi 的 Model 归一为面板要读的元信息（不可解析时全 0，不抛）。 */
export function modelMeta(m: { provider?: string; id?: string; contextWindow?: number; maxTokens?: number; cost?: Partial<ModelMeta["cost"]> } | undefined): ModelMeta {
  const cost = {
    input: num(m?.cost?.input), output: num(m?.cost?.output),
    cacheRead: num(m?.cost?.cacheRead), cacheWrite: num(m?.cost?.cacheWrite),
  };
  return {
    provider: m?.provider ?? "",
    model: m?.id ?? "",
    contextWindow: num(m?.contextWindow),
    maxTokens: num(m?.maxTokens),
    cost,
    priced: cost.input + cost.output + cost.cacheRead + cost.cacheWrite > 0,
  };
}

/** 上下文占用读数（pi 的 estimateContextTokens 结果 → 面板形状）。 */
export function contextReadout(
  window: number,
  est: { tokens: number; usageTokens: number; trailingTokens: number },
  basis?: ContextReadout["basis"],
): ContextReadout {
  const used = num(est?.tokens);
  const b: ContextReadout["basis"] = basis ?? (used > 0 ? (num(est.usageTokens) > 0 ? "provider" : "estimate") : "none");
  return {
    window: num(window),
    used,
    pct: window > 0 ? Math.round((used / window) * 1000) / 10 : 0,
    usageTokens: num(est.usageTokens),
    trailingTokens: num(est.trailingTokens),
    basis: b,
  };
}


/** 压缩压力读数。supported=false 是本底座的实情（对话环不自动压缩），读数照样给。
 *  「该压了没有」直接问 pi 自己的 shouldCompact——判定尺不自己复刻一遍。 */
export function compactionReadout(ctx: ContextReadout, settings: CompactionSettings = DEFAULT_COMPACTION_SETTINGS, supported = false): CompactionReadout {
  const threshold = ctx.window > 0 ? ctx.window - settings.reserveTokens : 0;
  const over = ctx.window > 0 && shouldCompact(ctx.used, ctx.window, settings);
  return {
    supported,
    reserveTokens: settings.reserveTokens,
    keepRecentTokens: settings.keepRecentTokens,
    thresholdTokens: threshold,
    over,
    note: supported
      ? "自动压缩已接入"
      : `本底座对话环不自动压缩（pi harness 的 compact() 未接入）；此处只出压力线 ${threshold > 0 ? `${threshold} tok` : "窗口未知"}${over ? "，已越线：该收尾或手工摘要" : ""}`,
  };
}

/** 旧会话那行 chat_turn_end 只带 {input,output} 的累计用量——识别形态用。 */
function isLegacyRow(e: Record<string, unknown>): boolean {
  return e.event === "chat_turn_end" && e.sessionUsage === undefined;
}

const contentText = (c: unknown): string => {
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c.map((b) => {
      const x = b as { type?: string; text?: string };
      return x?.type === "text" ? x.text ?? "" : "";
    }).join("");
  }
  return "";
};

/**
 * 从会话事件重放指标（不读盘、不猜）。
 * fallback：当前配置的模型元信息——旧会话没记 window 时用它，并在 basis 里说明数字家在哪。
 */
export function replayStats(rows: EventRow[], file: string, fallback: ModelMeta, rates?: CostRate | null): SessionStats {
  const turns: TurnStat[] = [];
  const pushCtx: { used: number; window: number; line: number; usageTokens: number; trailingTokens: number; basis?: ContextReadout["basis"] } =
    { used: 0, window: fallback.contextWindow, line: 0, usageTokens: 0, trailingTokens: 0 };
  let meta = fallback;
  let cur: TurnStat | null = null;
  let session = zeroUsage();
  let legacyMax: TokenUsage | null = null;
  let sawMessage = false;
  let sawLegacy = false;

  const openTurn = (ts: string, text: string) => {
    if (cur) turns.push(cur);
    cur = {
      idx: turns.length + 1, ts, text: text.slice(0, 60), rounds: 0, toolCalls: 0,
      usage: zeroUsage(), cost: 0, costKnown: false, contextUsed: 0, contextWindow: meta.contextWindow,
      basis: "none", line: 0, usageLine: 0,
    };
  };

  for (const { line, event } of rows) {
    if (event.kind === "session_start") {
      // 首行 meta 里若存过模型名（执行器会话会记），用于列头展示
      const mm = (event as unknown as { meta?: { model?: string } }).meta?.model;
      if (mm && !meta.model) meta = { ...meta, model: mm };
    } else if (event.kind === "message") {
      if (event.role === "user") openTurn(event.ts ?? "", contentText(event.content));
      if (!cur) openTurn(event.ts ?? "", "");            // 无用户消息打头的会话（执行器轨迹）也要有行
      const u = normUsage(event.usage);
      if (u) {
        sawMessage = true;
        session = addUsage(session, u);
        cur!.usage = addUsage(cur!.usage, u);
        cur!.cost = cur!.usage.cost.total;
        if (hasCostField(event.usage)) cur!.costKnown = true;
        else if (rates) { cur!.cost = rateCost(u, rates); cur!.costKnown = true; cur!.costBasis = "rate"; }
        cur!.basis = "message";
        cur!.usageLine = line;
        const used = contextTokensOf(u);
        pushCtx.used = used; pushCtx.window = meta.contextWindow; pushCtx.line = line;
        pushCtx.usageTokens = used; pushCtx.trailingTokens = 0;
        cur!.contextUsed = used; cur!.contextWindow = meta.contextWindow;
      }
    } else if (event.kind === "run_event") {
      const e = event.event as Record<string, unknown>;
      if (e?.event !== "chat_turn_end") continue;
      if (!cur) openTurn(event.ts ?? "", "");
      cur!.rounds = num(e.rounds); cur!.toolCalls = num(e.toolCalls); cur!.line = line;
      const mm = e.model as { provider?: string; id?: string; contextWindow?: number } | undefined;
      if (mm && num(mm.contextWindow) > 0) {
        meta = { ...meta, provider: mm.provider ?? meta.provider, model: mm.id ?? meta.model, contextWindow: num(mm.contextWindow) };
      }
      if (isLegacyRow(e)) {
        // 旧行（B9 之前）：usage 是「全会话逐条 input/output 求和」= 生命周期累计用量，
        // 不是本轮增量，也**推不出上下文占用**（最后一次请求的 prompt 大小没存过）。
        // 所以：本轮取最大的一行（累计口径下最大即最完整），上下文一律不填 → 面板显式「查无」。
        const cum = normUsage(e.usage);
        if (cum) {
          sawLegacy = true;
          if (cur!.basis !== "legacy-cumulative" || contextTokensOf(cum) >= contextTokensOf(cur!.usage)) {
            cur!.usage = cum; cur!.cost = cum.cost.total; cur!.basis = "legacy-cumulative"; cur!.usageLine = line;
            cur!.costKnown = hasCostField(e.usage);
          }
          if (!legacyMax || contextTokensOf(cum) > contextTokensOf(legacyMax)) legacyMax = cum;
        }
      } else {
        const c = e.context as Partial<ContextReadout> | undefined;
        if (c && num(c.used) > 0) {
          pushCtx.used = num(c.used);
          pushCtx.window = num(c.window) || meta.contextWindow;
          pushCtx.usageTokens = num(c.usageTokens);
          pushCtx.trailingTokens = num(c.trailingTokens);
          pushCtx.basis = c.basis === "estimate" || c.basis === "provider" ? c.basis : undefined;
          pushCtx.line = line;
          cur!.contextUsed = pushCtx.used; cur!.contextWindow = pushCtx.window;
          // 逐条 message 行缺失（provider 不回报 usage）时，收口行的本轮用量兜底
          if (cur!.basis === "none") {
            const perTurn = normUsage(e.usage);
            if (perTurn) {
              cur!.usage = perTurn; cur!.cost = perTurn.cost.total; cur!.basis = "turn"; cur!.usageLine = line;
              cur!.costKnown = hasCostField(e.usage);
              if (!cur!.costKnown && rates) { cur!.cost = rateCost(perTurn, rates); cur!.costKnown = true; cur!.costBasis = "rate"; }
            }
          }
        } else if (cur!.basis === "none") {
          const perTurn = normUsage(e.usage);
          if (perTurn) {
            cur!.usage = perTurn; cur!.cost = perTurn.cost.total; cur!.basis = "turn"; cur!.usageLine = line;
            cur!.costKnown = hasCostField(e.usage);
            if (!cur!.costKnown && rates) { cur!.cost = rateCost(perTurn, rates); cur!.costKnown = true; cur!.costBasis = "rate"; }
          }
        }
      }
    }
  }
  if (cur) turns.push(cur);

  const source: SessionStats["source"] =
    sawMessage && sawLegacy ? "mixed" : sawMessage ? "message" : sawLegacy ? "legacy" : "none";
  const totalsUsage = sawMessage ? session : legacyMax ?? zeroUsage();
  const context = contextReadout(
    pushCtx.window,
    { tokens: pushCtx.used, usageTokens: pushCtx.usageTokens, trailingTokens: pushCtx.trailingTokens },
    pushCtx.basis,
  );
  // C7 · 有已知成本的轮次（provider 或价率）才计入总额；逐行口径下不会重复灌水（legacy 累计行各带
  // 累计快照，求和会重复——那条路维持「取最大行」老语义）。
  const anyKnown = turns.some((t) => t.costKnown);
  const totalCost = source === "message" && anyKnown
    ? turns.reduce((s, t) => s + (t.costKnown ? t.cost : 0), 0)
    : totalsUsage.cost.total;
  const costBasis: "provider" | "rate" | "mixed" | "none" = !anyKnown
    ? "none"
    : turns.some((t) => t.costKnown && t.costBasis === "rate")
      ? (turns.some((t) => t.costKnown && t.costBasis !== "rate") ? "mixed" : "rate")
      : "provider";
  return {
    sid: "",
    file,
    source,
    model: meta,
    turns,
    totals: {
      turns: turns.length,
      usage: totalsUsage,
      cost: totalCost,
      costKnown: anyKnown,
      costBasis,
      basis: sawMessage && sawLegacy
        ? "升级后逐条 message.usage 行求和（升级前的旧累计行不计入，避免重复灌水）"
        : sawMessage
          ? "逐条 message.usage 行求和"
          : sawLegacy
            ? "旧会话只记累计：取总 token 最大的一行（agent 重启会重新起算，可能偏低）"
            : "查无：该会话没有任何用量行",
    },
    context,
    compaction: compactionReadout(context, DEFAULT_COMPACTION_SETTINGS, false),
  };
}
