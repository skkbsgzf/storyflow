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
  /**
   * AP1 §七（disable-assertion 覆盖落点）：true = 该断言不再拦人。
   * **不是「不检查」**：确定性检查照跑、证据照出（status 降级为 warn，progressive 不计数），
   * AE-* 类则连执行一起免（见 declaredAestheticTypes）。
   * 与组级 `disabled` 表达式的区别：表达式是「按现场条件临时不生效」，本字段是「人明确点名免掉」。
   */
  disabled?: boolean;
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

// ═══════════════════════════════════════════
// 断言覆盖（AP1 §七）：overlay patch → 挂载预设的派生调制
// ═══════════════════════════════════════════

/** `patch` 载荷：gate-preset.yml 的 config 面去掉身份键（assertionType）后的可调子集。 */
export interface AssertionPatch {
  gateMode?: GateMode;
  warnThreshold?: number;
  blockThreshold?: number;
  when?: string;
  hintTemplate?: string;
}

/**
 * 三类覆盖的判别联合（一 kind 一形状，字段名与 contracts/flow-overlay.schema.json 逐字相同——
 * 契约键、内部结构、面板读到的三者不许各有名字）。
 * 由 `modules.ts::effectiveFlow3` 从 overlay patch 解析进 `EffectiveFlow.assertionOverrides`，
 * 门点经 `executor.ts::applyAssertionOverrides` 合成到挂载上——**不改图，只改策略**。
 */
export type AssertionOverride =
  /** 改阈值/门档：对 `assertions` 里每一条断言套用同一份 `patch` */
  | { kind: "set-assertion-preset"; presetId?: string; assertions: string[]; patch: AssertionPatch }
  /** 禁用：该断言在本挂载上整轮不生效（原 preset 声明保留，换挂载即复原） */
  | { kind: "disable-assertion"; presetId?: string; assertion: string }
  /** 组内插入：往指定组追加一条 preset 里没有的断言配置 */
  | { kind: "insert-assertion"; presetId?: string; group: string; assertion: string; patch?: AssertionPatch };
