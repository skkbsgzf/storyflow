/**
 * OS-02 阶段 C · 阈值预算面（单一事实源）
 *
 * 问题：R7 规范 §二 C 表列的常量**全是引擎内硬编码**（assembler/aesthetic/optimize/metrics 四处），
 * ⇒ 项目级改不了 ⇒ 初始化面板「阈值预算区」无字段可渲染（§四）。
 * 同时 `policy.budget` 在契约里声明了 `tokens/latencyMs/humanGates`，**零消费者**（§二 D 表）——
 * 「声明了但没人读」的反面教材。
 *
 * 本文件把两者合成一件事：**`policy.budget` 就是阈值预算面**，把 C 表常量抬升为
 * 「出厂默认 + 项目可覆盖」。规则与 `resolveToolConfig` 同构：
 *   出厂默认 ← `flow.policy.budget` 覆盖（节点/op 级不参与——这些是全局口径，不是单步旋钮）
 * 未知键 / 非数 / 越界 **一律进 `issues` 并显式回显**，绝不静默丢弃（本仓第一铁律）。
 *
 * 消费点：`assembler.ts`（上下文/知识装载预算）、`aesthetic.ts`（章长与文风配额）、
 * `optimize.ts`（规则阈值）、`metrics.ts`（成本系数）。
 */
import type { FlowPolicy } from "./overlay.js";

/** 单个旋钮的出厂声明。值 + 合法区间 + 人话说明（面板直接渲染本表）。 */
export interface BudgetKnob {
  value: number;
  min?: number;
  max?: number;
  unit?: string;
  /** 面板分组（中文；顺序 = 首次出现顺序）。分组只此一处声明，页面不许再写第二份 */
  group: string;
  /** 该值由哪个模块消费（面板显示「谁读这个旋钮」，杜绝「填了没人读」） */
  consumer: string;
  desc: string;
  effect?: string;
}

export const DEFAULT_BUDGET: Record<string, BudgetKnob> = {
  // ── 上下文与知识装载（assembler.ts）──
  contextBudget: {
    value: 20000, min: 2000, max: 200000, unit: "字",
    group: "上下文与知识装载", consumer: "assembler.ts",
    desc: "任务包正文（标尺+方法论+上游产物）的总字数上限",
    effect: "提高 = 上下文更全但更贵；过低会截断方法论",
  },
  skillCap: {
    value: 6000, min: 1000, max: 60000, unit: "字",
    group: "上下文与知识装载", consumer: "assembler.ts",
    desc: "单个 skill 方法论文本的装载上限（超出截断并显式标注）",
    effect: "提高 = 方法论更完整；过长会挤掉上游产物",
  },
  kbCardCap: {
    value: 1600, min: 200, max: 20000, unit: "字",
    group: "上下文与知识装载", consumer: "assembler.ts",
    desc: "单张知识卡（标尺条款）的装载上限",
    effect: "提高 = 单条判据更完整；过高会让少数卡吃光预算",
  },
  kbTotalCap: {
    value: 9000, min: 1000, max: 100000, unit: "字",
    group: "上下文与知识装载", consumer: "assembler.ts",
    desc: "本步全部知识卡的装载总量上限",
    effect: "提高 = 判据更全；过长挤占产物上下文",
  },
  maxContextChars: {
    value: 35000, min: 5000, max: 400000, unit: "字",
    group: "上下文与知识装载", consumer: "assembler.ts（pkg.budget 声明）",
    desc: "任务包 `pkg.budget.maxContextChars`（宿主消费的硬上限声明）",
    effect: "应与 contextBudget 同向调整，否则声明与实际不符",
  },
  // ── 章长与文风配额（aesthetic.ts）──
  chapterBlockChars: {
    value: 800, min: 100, max: 20000, unit: "字/章",
    group: "章长与文风配额", consumer: "aesthetic.ts（AE-CH-LEN）",
    desc: "多章正文的每章下限：低于此值判 block（硬拦）",
    effect: "提高 = 更早拦下注水/欠写；过高会误伤短章体裁",
  },
  chapterWarnChars: {
    value: 1800, min: 100, max: 40000, unit: "字/章",
    group: "章长与文风配额", consumer: "aesthetic.ts（AE-CH-LEN）",
    desc: "多章正文的每章下限：低于此值判 warn（提醒不拦）；章长基准 2000/章（用户口径 2026-09-21）",
    effect: "对应 op 的 `chapterMin` 默认值；两者宜一致",
  },
  parallelQuota: {
    value: 1, min: 0, max: 200, unit: "处",
    group: "章长与文风配额", consumer: "aesthetic.ts（AE-PROSE-TRIPLET）",
    desc: "三连排比配额上限（本实现按**全文**计数，注释写的「每章」口径见 OS-03）",
    effect: "降低到 0 = 只要出现即算超标；提高 = 放宽",
  },
  contrastQuota: {
    value: 2, min: 0, max: 100, unit: "处",
    group: "章长与文风配额", consumer: "aesthetic.ts（AE-PROSE-NOTBUT）",
    desc: "「不是 A，是 B」假转折配额上限",
    effect: "降低 = 减少模板腔",
  },
  fillerQuota: {
    value: 2, min: 0, max: 200, unit: "处",
    group: "章长与文风配额", consumer: "aesthetic.ts（AE-PROSE-RHYTHM）",
    desc: "AI 节奏词（突然/仿佛/似乎）配额上限",
    effect: "降低 = 去 AI 味更狠；过高不拦",
  },
  minBeats: {
    value: 3, min: 1, max: 200, unit: "集",
    group: "章长与文风配额", consumer: "aesthetic.ts（AE-SCRIPT-FIELDS）",
    desc: "剧本类产物的集数下限",
    effect: "降低 = 允许短剧；提高 = 强制成规模（短篇体会被拦）",
  },
  // ── 优化器规则（optimize.ts）──
  optMinSamples: {
    value: 3, min: 1, max: 100, unit: "样本",
    group: "优化器规则", consumer: "optimize.ts（全部规则）",
    desc: "优化器规则生效所需的最少样本数",
    effect: "提高 = 提案更保守（少误改）；过低会被噪声带偏",
  },
  optBlockRateHigh: {
    value: 0.3, min: 0, max: 1,
    group: "优化器规则", consumer: "optimize.ts（R2 / R3）",
    desc: "打回率高于此值 → 触发升档/补判据类提案",
    effect: "降低 = 更早介入；提高 = 只在明显有问题时提",
  },
  optHitRateLow: {
    value: 0.4, min: 0, max: 1,
    group: "优化器规则", consumer: "optimize.ts（R2）",
    desc: "标尺命中率低于此值 → 视为「判据没被用上」",
    effect: "提高 = 更激进地裁剪死条款",
  },
  optHitRateHigh: {
    value: 0.5, min: 0, max: 1,
    group: "优化器规则", consumer: "optimize.ts（R4）",
    desc: "标尺命中率高于此值 → 视为「判据在起作用」",
    effect: "与 optHitRateLow 共同划分「死条款 / 有效条款」",
  },
  // ── 成本系数（metrics.ts::costOf）──
  // 口径：cost = (tokensIn+tokensOut)/costTokenDivisor + latencyMs/costLatencyDivisor
  //              + checkBlock*costBlockPremium + retries*costRetryPremium
  costTokenDivisor: {
    value: 1000, min: 1, max: 1000000, unit: "token/成本单位",
    group: "成本系数", consumer: "metrics.ts（costOf）",
    desc: "每多少 token 折合 1 成本单位（成本函数第一项的分母）",
    effect: "提高 = token 消耗在成本中的占比变小",
  },
  costLatencyDivisor: {
    value: 60000, min: 1000, max: 600000, unit: "ms/成本单位",
    group: "成本系数", consumer: "metrics.ts（costOf）",
    desc: "每多少毫秒时延折合 1 成本单位（默认 1 分钟 = 1 成本单位）",
    effect: "提高 = 时延在成本中的占比变小",
  },
  costBlockPremium: {
    value: 5, min: 0, max: 1000, unit: "成本/次",
    group: "成本系数", consumer: "metrics.ts（costOf）",
    desc: "被断言打回一次的额外成本溢价（打回是「这一步没守住」的直接信号）",
    effect: "提高 = 优化器更优先处理爱打回的步",
  },
  costRetryPremium: {
    value: 2, min: 0, max: 1000, unit: "成本/次",
    group: "成本系数", consumer: "metrics.ts（costOf）",
    desc: "重试一次的额外成本溢价",
    effect: "提高 = 更看重「一次做对」的步",
  },
};

export interface BudgetResolution {
  /** 生效取值（出厂默认已被 policy 覆盖） */
  values: Record<string, number>;
  /** 出厂声明（面板/任务包据此渲染「这个旋钮存在、区间多少、干什么的」） */
  defs: Record<string, BudgetKnob>;
  /** 逐键来源：factory=出厂默认 / policy=项目声明 */
  sources: Record<string, "factory" | "policy">;
  /** 未知键 / 非数 / 越界——**必须显式回显**（本仓最反感的就是静默丢弃） */
  issues: string[];
  /** 是否有任何项目级覆盖（面板据此显示「本项目已调过阈值」） */
  overridden: boolean;
}

/**
 * 解析生效阈值。`policy.budget` 是唯一覆盖入口（见 R7 规范 §二 C 表）。
 * 除 `policy` 外不接受第二真源——避免「两处各改一半」。
 */
export function resolveBudget(policy?: FlowPolicy | null): BudgetResolution {
  const values: Record<string, number> = {};
  const sources: Record<string, "factory" | "policy"> = {};
  const issues: string[] = [];
  for (const [k, d] of Object.entries(DEFAULT_BUDGET)) {
    values[k] = d.value;
    sources[k] = "factory";
  }
  const raw = (policy as { budget?: Record<string, unknown> } | undefined)?.budget;
  if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw)) {
      const d = DEFAULT_BUDGET[k];
      if (!d) {
        issues.push(`budget.${k}（未知阈值键——不在 R7 §二 C 表白名单内，未生效）`);
        continue;
      }
      if (typeof v !== "number" || !Number.isFinite(v)) {
        issues.push(`budget.${k}（须 number，得 ${typeof v}；未生效）`);
        continue;
      }
      if ((d.min !== undefined && v < d.min) || (d.max !== undefined && v > d.max)) {
        issues.push(`budget.${k}=${v}（越界：允许 ${d.min ?? "-∞"}~${d.max ?? "+∞"}；未生效）`);
        continue;
      }
      values[k] = v;
      sources[k] = "policy";
    }
  }
  // 交叉校验：`maxContextChars` 是宿主消费的硬上限，而实际装载量由前三项决定。
  // 若三者之和已超上限 ⇒ 声明与实际不符（会静默截断），必须响亮报出来。
  const loadSum = values.contextBudget + values.skillCap + values.kbTotalCap;
  if (values.maxContextChars < loadSum) {
    issues.push(
      `budget.maxContextChars=${values.maxContextChars} 小于 contextBudget+skillCap+kbTotalCap=${loadSum}（装载必然被截断；请同步抬高 maxContextChars）`,
    );
  }
  return { values, defs: DEFAULT_BUDGET, sources, issues, overridden: Object.values(sources).includes("policy") };
}
