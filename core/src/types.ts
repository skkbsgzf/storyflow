// 类型镜像 contracts/*.schema.json（标准本体在 contracts/，此处仅为 TS 视图）
export interface FlowInputDef {
  type: "project" | "string" | "enum" | "number" | "boolean";
  required?: boolean;
  default?: unknown;
  options?: string[];
  min?: number;
  max?: number;
  desc?: string;
  bind?: { edge?: string; param?: string; gate?: string };
  /** R8 改点③：该输入的取值是「市场/风格先验」——flow_run 时内核据此落一条 decision（by=user.preference），
   *  由候选池按决策过滤；决策绝不写回 inputs（铁律 6，桥只单向）。 */
  feeds_decision?: string;
}

export interface FlowNode {
  kind: string; // novel-txt | core | agent | gate | srd
  title?: string;
  stage?: string;
  /** 产物路径——flow@2 唯一字段名（旧 file 兼容读，lint warn） */
  output?: string;
  /** @deprecated flow@2 起改用 output（规范 R4 §5.1） */
  file?: string;
  skill?: string;
  /** kit@1 域内操作引用：kit + op → skill + 判定条款（单一事实源，内核单点装载） */
  kit?: string;
  op?: string;
  assist?: string[];
  /** @deprecated 知识依据收编进 modules/<模块>/module.json 的 op.knowledge（规范 R4 §5.1；批D 起事实源唯一） */
  kb?: string[];
  minitool?: string;
  loads?: string[] | string;
  // v5.0：节点 asserts/check/review 声明字段随断言协议退役（质量条款 = op.knowledge 规则语料；机器项 = 扫描器证据）
  onFail?: string;
  filterBy?: string;
  template?: string;
  when?: WhenPredicate;
  webSearch?: boolean;
  route?: string;
  desc?: string;
  reviewers?: string[];
  /**
   * R5：门角色。唯一合法值 `kit-boundary`（kit 域切换处的人工验收）。
   * 旧值 stage/final/spot 已废弃 —— 门从图上节点降级为跨域交接验收（v5.0：质量归规则语料 + 扫描器证据）。
   */
  gate_role?: "kit-boundary" | "link" | string;
  /** R6：连接件两模式（gate_role="link" 的节点）；模块内部无门无打回 */
  link_mode?: "auto" | "manual";
  /** R6：产物归属的模块实例 id（派生节点 <实例id>.<tool> 的前缀） */
  module?: string;
  iterate?: { unit: string; [k: string]: unknown }; // K6：迭代实例节点——flow_submit 逐实例入账，--seal 收口
  /**
   * R5 内容配置项取值：覆盖 modules/<模块>/module.json 中该 op 的 `config.<key>.default`。
   * 键必须存在于 op.config（否则 flow-lint warn）。这是「tool 的内容可被用户/优化 agent 调优」的落点。
   */
  config?: Record<string, unknown>;
  /** R6：模块展开后此节点的标尺清单（含插件 adds.knowledge 合并）；替代废弃的 kb */
  knowledge?: string[];
}

/**
 * 条件谓词（规范 R4 §5.2）：结构化对象是唯一合法形态；
 * flow@1 字符串兼容形态已随 v4.0.0 处决（evalWhen 对非对象保守判不活跃）。
 */
export type WhenPredicate = StructuredWhen;

export interface StructuredWhen {
  verdict?: "none" | "awaiting" | "pass" | "pass-with-conditions" | "send-back" | "reject";
  challenge?: boolean;
  /** 根因指认，对照 state.lastRejectReason */
  cause?: string;
  input?: string;
  eq?: unknown;
  gt?: number;
  lt?: number;
  /** 回边：pending=还有未完成实例 */
  loop?: "pending" | "exhausted";
  any?: WhenPredicate[];
  all?: WhenPredicate[];
}

/** 边角色——flow@2 唯一判别（旧 optional/loop 布尔折算而来） */
export type EdgeRole = "flow" | "reject" | "optional" | "loop" | "batch";

export interface FlowEdge {
  id: string;
  from: string;
  to: string;
  /** 角色：流动 / 打回 / 可选 / 回环 / 批量 */
  role?: EdgeRole;
  /** 执行语义；与目标节点执行体一致时派生、不写（规范 R4 §5.1） */
  via?: string;
  when?: WhenPredicate;
  /** 面板可渲染的连线参数 */
  params?: { scope?: string; mode?: string; parallel?: boolean };
  desc?: string;
}

export interface FlowStage { id: string; name: string; entry: string; gate: string; nodes: string[]; question?: string }

export interface FlowDescriptor {
  format: string;
  id: string;
  title: string;
  desc?: string;
  version: string;
  status?: string;
  /** R5 编排策略：kit 边界验收 / 门语义 / 优化 agent 权力 / 预算（运行时被 overlay 的 set-policy 覆盖）。
   *  R6（flow@3）：kit_boundary/gate_mode 退役，只剩 link_default / adapt / budget。
   *  R7（OS-02A）：`maxRounds`（同一门重跑上限）/ `awaitTimeoutMs`（等待超时）对两种格式都生效。 */
  policy?: {
    kit_boundary?: "always" | "auto" | "off";
    gate_mode?: "auto" | "manual";
    link_default?: "auto" | "manual";
    adapt?: "off" | "propose" | "apply";
    /**
     * OS-02 阶段 C：**阈值预算面**（R7 规范 §二 C 表）。键名与区间白名单 = `budget.ts::DEFAULT_BUDGET`。
     * 改前此处声明 `tokens/latencyMs/humanGates` 三键而**零消费者**（「声明了没人读」）；
     * 现改为那 C 表常量的项目级覆盖入口——未知键由 `resolveBudget` 显式回显、契约侧 `additionalProperties:false` 硬拦。
     */
    budget?: Record<string, number>;
    /** R7：同一门累计驳回上限，超越即 blocked（缺省不限，但不再静默无限乒乓——越限必 journal 留痕）。 */
    maxRounds?: number;
    /** R7：等待态（suspended/awaiting_input）超时毫秒数；到点标 blocked + stalledAt，**不自动放行**。 */
    awaitTimeoutMs?: number;
  };
  inputs?: Record<string, FlowInputDef>;
  outputs?: FlowOutput[];
  graph: { format?: string; name?: string; nodes: Record<string, FlowNode>; edges: FlowEdge[]; outputs?: string[] };
  quality?: Record<string, unknown>;
  harness?: Record<string, unknown>;
  stages?: FlowStage[];
  changelog?: unknown[];
  /** R6 派生元数据（expandFlow3 产出，随派生描述符携带）：模块组合 / 连接件 / 模块节点表 / 产物目录 */
  r6?: {
    modules: Array<{
      id: string; module: string; name: string; order: number; dir: string;
      link: "auto" | "manual"; caps: string[]; capsEnabled: string[]; spine: string[]; plugins: string[];
    }>;
    links: Array<{ id: string; fromModule: string; toModule: string; mode: "auto" | "manual" }>;
    moduleNodes: Record<string, string[]>;
    dirs: Record<string, string>;
  };
  /** @deprecated 已并入 outputs[]（规范 R4 §5.1 交付清单唯一化） */
  deliverables?: unknown[];
}

/**
 * 交付出口条目（flow@2 唯一形态，规范 R4 §5.1/§三）。
 * 路径唯一事实源是节点 `output`（或 iterate.artifact）；`path` 仅在交付路径与节点产物不同时出现。
 * 定序由 `对外交付/NN-` 前缀承担，不再另设 order（避免第二处定序真相）。
 */
export interface FlowOutput {
  node?: string;
  /** flow@3：模块级交付——按模块声明（module 键），展开为该模块的交付产物 */
  module?: string;
  /** 交付路径；缺省取该节点的 output */
  path?: string;
  /** 交付名/说明（前端交付页标题） */
  title?: string;
  /** 交付规格：给谁看 */
  audience?: string;
  /** 交付规格：按什么标准 */
  style?: string;
  /** @deprecated 旧名，等价于 path */
  file?: string;
}

// run-state.schema.json v1.0.1
/**
 * R7（OS-02A）等待态显式化：`blocked` 与 `failed` 分开。
 *  - blocked = **停机等人**：重跑超 `policy.maxRounds`、等待超 `policy.awaitTimeoutMs`、源文件缺失。
 *    `flow_resume` 恢复；`advance` 不得自动越过（静默自动推进比停机坏得多）。
 *  - failed  = **终态**：门裁决 reject 终止。`flow_resume` 只能靠「重跑失效范围」救回，
 *    仅 `flow_rerun` / `flow_resume` 两条路。
 */
export type RunStatus = "running" | "awaiting_input" | "suspended" | "blocked" | "completed" | "failed";
export type NodeStatus = "none" | "running" | "done" | "pending" | "awaiting" | "rejected" | "stale";
export type GateVerdict = "none" | "awaiting" | "pass" | "pass-with-conditions" | "send-back" | "reject";

export interface NodeState {
  status: NodeStatus;
  round: number;
  note?: string;
  lastArtifact?: string;
  failCount?: number;
  verdict?: "pass" | "pass-with-conditions" | "send-back" | "reject";
  rootCauseStage?: string;
  stale?: boolean;
  committed?: string[]; // iterate 节点（K6）：本 await 窗口内已提交的实例文件清单，seal 收口时置 done
}

export interface GateBlock {
  verdict: GateVerdict;
  at?: string;
  node?: string;
  round?: number;
  token?: string;
  note?: string;
}

export interface RunState {
  runId: string;
  projectId?: string;
  /** 项目可读名：默认由灵感提炼（W-项目管理），切换器/管理面板展示用；缺省回落项目 id */
  title?: string;
  flowId: string;
  flowVersion: string;
  flowHash?: string;
  /** R5：编译时生效编排（flow ⊕ overlay ⊕ 边界注入）的计划指纹——不符即重编译（生成式 flow） */
  planHash?: string;
  /** R5：本计划所依据的 overlay 合成指纹（审计） */
  overlayHash?: string;
  /** R5：本 run 生效的编排策略快照 */
  policy?: Record<string, unknown>;
  status?: RunStatus;
  plan?: { order: string[] };
  nodes: Record<string, NodeState>;
  gate: GateBlock;
  presets?: Record<string, "auto" | "semi" | "manual">;
  focus?: string;
  inputs?: Record<string, unknown>;
  comments?: Record<string, string[]>;
  notes?: string[];
  lastRejectReason?: string;
  /** R7（OS-02A）：逐门累计驳回轮次 {gateNodeId: n}；`policy.maxRounds` 判据，超越即 blocked。 */
  rejects?: Record<string, number>;
  /** R7（OS-02A）：等待超 `policy.awaitTimeoutMs` 的到点时刻（ISO）；与 status=blocked 同写。 */
  stalledAt?: string;
  /** 生产线预设（PP1）：flow_run(opts.preset) 选中的预设 id；生效编排 = flow ⊕ 出厂 overlay ⊕ 预设 overlay ⊕ 项目 overlay。 */
  preset?: string;
  /**
   * AP1 §十：最近一次门点的**断言策略摘要**（preset 调制后仍未过的条款 + 门档/渐进档）。
   * 由 doSubmit 与 check_* 两处门点写入，下游任务包经 `task-package.diagnosticSummary` 消费。
   * 与 `lastRejectReason` 分工：那条只记打回根因，这条记调制结果（哪怕最终放行）。
   */
  diagnosticSummary?: string;
  /** AP1 §十：上面那份摘要出自哪个节点（成对写入，读侧据此知道是不是自己上游）。 */
  diagnosticFrom?: string;
}

// task-package.schema.json
export interface TaskPackage {
  runId: string;
  projectId: string;
  nodeId: string;
  kind: "agent" | "skill" | "llm" | "redline" | "review";
  instruction: { skill?: string; text: string };
  context: { ref: string; hash: string | null; excerpt?: string; truncated?: boolean }[];
  outputContract: { file: string; schema?: object };
  budget?: { maxContextChars?: number };
  parallelWith?: string[];
  /** 角色剖面投影：宿主按此把任务包派发给对应 subagent（编剧/审核/分析师…） */
  profile?: import("./profiles.js").TaskProfile;
  /** K1 项目背景卡：确定性组装的项目身份/阶段/甲方点子/交付物用途/合规红线（派发质量分析 R1） */
  background?: string;
  /** kit 标尺卡：本步判定条款（已注入 instruction.text，此处为可核对清单） */
  knowledge?: KnowledgeCard[];
  /** R5：本步生效的 tool 内容配置项取值（overlay > 节点 config > op.default > 通用默认） */
  toolConfig?: Record<string, unknown>;
  /** 本节点的 kit 引用回显（域/操作/技能），供宿主与校验器核对 */
  kitRef?: { kit: string; op: string; domain: string; skill: string; kind: string };
  /** artifact@1 头部模板（规范 R4 §二）：agent 须以它开头写产物，否则内核 block */
  headerTemplate?: string;
  /**
   * AP1 §十：上游门点的策略摘要（preset 调制后仍未过的条款 + 门档/渐进档）。
   * 空串 = 本轮门点没有触发任何条款，或预设不可用（特性不激活）；未定义 = 本项目还没走过门点。
   * 只作提示，不是判决——质量裁决归 agent 与人。
   */
  diagnosticSummary?: string;
}

export interface KnowledgeCard {
  id: string;
  path: string;
  chars: number;
  truncated?: boolean;
}

/** 就绪批成员：flow_next 一次派发的并行认知步 */
export interface BatchEntry {
  nodeId: string;
  taskPackage: TaskPackage;
}

// artifact.schema.json
export interface Validation { name: string; status: "pass" | "block" | "warn"; detail?: string }
export interface ArtifactEntry {
  path: string;
  node: string;
  round: number;
  sha1: string;
  ts: string;
  producer: string;
  inputs?: Record<string, string | null>;
  validations?: Validation[];
  delivery?: boolean;
  snapshot?: string;
}

// journal-event.schema.json
export type JournalEventKind =
  | "run-start" | "advance" | "submit" | "reject" | "gate-open" | "verdict"
  | "rerun" | "stale" | "snapshot" | "intake" | "deliver" | "run-end" | "note" | "warn"
  | "chain-out" | "chain-in";

export interface JournalEvent {
  ts: string;
  runId: string;
  nodeId?: string;
  event: JournalEventKind;
  actor: string;
  detail?: string;
  refs?: string[];
}

// metrics.schema.json · metric@1（R5）：单次 tool 执行的运行指标
export type MetricPhase = "dispatch" | "submit" | "gate" | "auto-gate" | "boundary" | "link" | "core";

export interface RunMetric {
  ts: string;
  runId: string;
  nodeId: string;
  kit?: string;
  op?: string;
  phase: MetricPhase;
  round?: number;
  latencyMs?: number;
  toolCalls?: number;
  tokensIn?: number;
  tokensOut?: number;
  ctx?: { offered?: number; used?: number; ids?: string[]; hitIds?: string[] };
  /** v5.0：提交链确定性完整性检查计数（存在/非空/残渣/头部/词汇表）。原断言三态（declared/unverified）已退役。 */
  checks?: {
    pass?: number;
    block?: number;
    warn?: number;
    names?: string[];
  };
  retries?: number;
  verdict?: string;
  config?: Record<string, unknown>;
  note?: string;
}
