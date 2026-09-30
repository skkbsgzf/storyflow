/**
 * Assertion Preset v1 —— 断言预设四层架构（对标 DSH Agent Presets）。
 *
 * 分层：discovery（扫描/健康检查）→ registry（AssertionPresets 服务）→ mount（站立挂载缓存）
 * → composition（gate-preset.yml 声明式组合）。策略以 Validation[] 为输入输出（见 executor.ts），
 * 接入点：doSubmit 提交链（integrity/header/glossary 结果）与 runCoreNode check_* 节点
 * （额外按声明执行 AE-* 注册表断言）。
 */

// ═══════════════════════════════════════════
// Trust 来源（对标 DSH PresetTrust）
// ═══════════════════════════════════════════
export type PresetTrust = "system" | "user";

/** preset 搜索根：system = 仓库自带（repoRoot/presets），user = 数据根自定义（root/presets） */
export interface PresetRoot {
  path: string;
  trust: PresetTrust;
}

/** 单个 preset 的发现结果（broken 非空 = 加载失败但仍可列出） */
export interface AssertionPreset {
  /** preset id：目录名 */
  readonly id: string;
  /** 信任来源（由所在 root 决定） */
  readonly trust: PresetTrust;
  /** 组合文件绝对路径（gate-preset.yml） */
  readonly path: string;
  /** 显示名（preset.yml name 或 id） */
  readonly name?: string;
  /** 一句话描述（preset.yml description） */
  readonly description?: string;
  /** 为什么不能挂载；为空 = 健康 */
  readonly broken?: string;
}

// ═══════════════════════════════════════════
// Gate 行为（对标 DSH isolate realm / standing mount generation）
// ═══════════════════════════════════════════
/**
 * warn-only：失败永不阻断（block 一律降级 warn）；
 * block-critical：确定性 block 照拦，warn 在 progressive blocking 档升级为 block；
 * strict：任何失败都拦（warn 一律升级 block）。
 */
export type GateMode = "warn-only" | "block-critical" | "strict";

export type ProgressiveLevel = "normal" | "warning" | "blocking";

/** 单条断言的策略配置（gate-preset.yml 一行 config） */
export interface AssertionConfig {
  /** Validation.name：integrity 面（exists/no-debris/…）或 aesthetic 面（AE-*） */
  assertionType: string;
  gateMode?: GateMode;
  /** 连续失败达到该次数进入 warning 档（缺省 2） */
  warnThreshold?: number;
  /** 连续失败达到该次数进入 blocking 档（缺省 5） */
  blockThreshold?: number;
  /** 条件启用表达式；求值 false = 该断言本轮跳过（结果丢弃） */
  when?: string;
  /** 诊断提示模板（{{count}}/{{type}} 占位） */
  hintTemplate?: string;
}

export interface AssertionGroup {
  id: string;
  assertions: AssertionConfig[];
  /** 组级默认 gateMode（缺省用顶层 defaultGateMode） */
  gateMode?: GateMode;
  /** v1 仅声明回显：progressive 计数全局按断言类型 */
  isolate?: boolean;
  /** 条件禁用表达式（成立 = 整组不生效） */
  disabled?: string;
}

/** 解析后的完整组合（gate-preset.yml） */
export interface AssertionPresetComposition {
  id: string;
  trust: PresetTrust;
  groups: AssertionGroup[];
  defaultGateMode: GateMode;
  diagnosticEnabled: boolean;
  progressiveResetMs: number;
}

// ═══════════════════════════════════════════
// 站立挂载（对标 DSH PresetMount）
// ═══════════════════════════════════════════
export interface StandingMount {
  readonly presetId: string;
  /** 解析一次，进程内共享 */
  readonly composition: AssertionPresetComposition;
  /** progressive 计数：断言类型 → { count, firstAt }（首次触发时间用于 resetMs 回滚） */
  readonly progressiveState: Map<string, { count: number; firstAt: number }>;
  /** 文件 stamp：热重载检测（变化 = 新 generation，progressive 清零） */
  readonly stamp: { mtimeMs: number; size: number };
}

/** 单条断言的门裁决结果（诊断面；策略本体见 executor.applyGatePreset） */
export interface GateOutcome {
  assertionType: string;
  failed: boolean;
  /** 策略后的最终状态（策略可能改写 warn↔block） */
  finalStatus: "pass" | "warn" | "block";
  gateMode: GateMode;
  progressiveLevel: ProgressiveLevel;
  triggerCount: number;
  diagnostic: string;
}
