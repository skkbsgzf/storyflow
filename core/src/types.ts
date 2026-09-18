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
  /** @deprecated 知识依据收编进 kits/<kit>/kit.json 的 op.knowledge（规范 R4 §5.1） */
  kb?: string[];
  minitool?: string;
  loads?: string[] | string;
  /** 校验声明——flow@2 唯一字段名（旧 check/review 兼容读，lint warn） */
  asserts?: string[];
  /** @deprecated flow@2 起改用 asserts */
  check?: string[];
  onFail?: string;
  filterBy?: string;
  template?: string;
  when?: WhenPredicate;
  webSearch?: boolean;
  route?: string;
  desc?: string;
  /** @deprecated flow@2 起改用 asserts */
  review?: string;
  reviewers?: string[];
  /**
   * R5：门角色。唯一合法值 `kit-boundary`（kit 域切换处的人工验收）。
   * 旧值 stage/final/spot 已废弃 —— 门从图上节点降级为 op 的 asserts/config。
   */
  gate_role?: "kit-boundary" | "link" | string;
  /** R6：连接件两模式（gate_role="link" 的节点）；模块内部无门无打回 */
  link_mode?: "auto" | "manual";
  /** R6：产物归属的模块实例 id（派生节点 <实例id>.<tool> 的前缀） */
  module?: string;
  iterate?: { unit: string; [k: string]: unknown }; // K6：迭代实例节点——flow_submit 逐实例入账，--seal 收口
  /**
   * R5 内容配置项取值：覆盖 kits/<kit>/kit.json 中该 op 的 `config.<key>.default`。
   * 键必须存在于 op.config（否则 flow-lint warn）。这是「tool 的内容可被用户/优化 agent 调优」的落点。
   */
  config?: Record<string, unknown>;
  /** R6：模块展开后此节点的标尺清单（含插件 adds.knowledge 合并）；替代废弃的 kb */
  knowledge?: string[];
}

/**
 * 条件谓词（规范 R4 §5.2）：结构化对象为推荐形态，前端与内核同源求值；
 * 字符串为 flow@1 兼容形态（可解析 warn，不可解析 block）。
 */
export type WhenPredicate = string | StructuredWhen;

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
  /** @deprecated flow@2 起由 role 判别 */
  transform?: string;
  when?: WhenPredicate;
  /** 面板可渲染的连线参数 */
  params?: { scope?: string; mode?: string; parallel?: boolean };
  desc?: string;
  /** @deprecated flow@2 起改用 role:"optional" */
  optional?: boolean;
  /** @deprecated flow@2 起改用 role:"loop" */
  loop?: boolean;
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
   *  R6（flow@3）：kit_boundary/gate_mode 退役，只剩 link_default / adapt / budget。 */
  policy?: {
    kit_boundary?: "always" | "auto" | "off";
    gate_mode?: "auto" | "manual";
    link_default?: "auto" | "manual";
    adapt?: "off" | "propose" | "apply";
    budget?: { tokens?: number; latencyMs?: number; humanGates?: number };
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
export type RunStatus = "running" | "awaiting_input" | "suspended" | "completed" | "failed";
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
}

// task-package.schema.json
export interface TaskPackage {
  runId: string;
  projectId: string;
  nodeId: string;
  kind: "agent" | "skill" | "llm" | "redline" | "review";
  instruction: { skill?: string; text: string };
  context: { ref: string; hash: string | null; excerpt?: string; truncated?: boolean }[];
  outputContract: { file: string; schema?: object; asserts?: string[] };
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
  | "rerun" | "stale" | "snapshot" | "intake" | "deliver" | "run-end" | "note" | "warn";

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
  asserts?: {
    pass?: number;
    block?: number;
    warn?: number;
    names?: string[];
    /** 本步有效断言声明数（node.asserts ∪ kit.op.asserts） */
    declared?: number;
    /** 声明了但无机器校验器的断言 id（语义层，未执行、不冒充通过） */
    unverified?: string[];
  };
  retries?: number;
  verdict?: string;
  config?: Record<string, unknown>;
  note?: string;
}
