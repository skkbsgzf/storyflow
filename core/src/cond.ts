import type { EdgeRole, FlowDescriptor, FlowEdge, WhenPredicate } from "./types.js";

export interface CondContext {
  /** 已解析的输入绑定（state.inputs，缺省已回填 flow.inputs[].default） */
  inputs: Record<string, unknown>;
  /** 最近一次 send-back 的根因（when『根因/cause』取值处） */
  lastRejectReason?: string;
  /** 门裁决（state.gate.verdict）——when『verdict』取值处 */
  gateVerdict?: string;
  /** 各节点裁决（state.nodes[*].verdict）——when『challenge』取值处 */
  nodeVerdicts?: Record<string, string | undefined>;
  /** 未完成实例数（iterate/批次）——when『loop:"pending"』取值处 */
  pendingInstances?: number;
}

export interface CondResult {
  active: boolean;
  reason?: string;
}

/** 边角色判定：role 是唯一判别（flow@1 的 optional/loop 布尔折算已随 v4.0.0 处决）。 */
export function edgeRole(e: FlowEdge): EdgeRole {
  return e.role ?? "flow";
}

/**
 * 回边判定：loop（回环）与 reject（打回回注）都不进前向计划。
 * 打回边在图上指向更早的节点，若混入前向拓扑会直接构成环——这是 role 单值化后必须显式表达的一条。
 */
export function isBackEdge(e: FlowEdge): boolean {
  const r = edgeRole(e);
  return r === "loop" || r === "reject";
}

/**
 * 边的执行语义（规范 R4 §5.1）：与目标节点执行体一致时**派生、不写**。
 * 目标节点 —— agent/gate：kit.op；core：core.<minitool>；其余按 kind。
 * `via` 仅在确有差异时显式声明，此时优先。
 */
export function edgeVia(flow: FlowDescriptor, e: FlowEdge): string {
  if (e.via) return e.via;
  const to = flow.graph.nodes[e.to];
  if (!to) return "";
  if (to.kit && to.op) return `${to.kit}.${to.op}`;
  if (to.minitool) return `core.${to.minitool}`;
  return to.kind ?? "";
}

const VERDICT_ALIAS: Record<string, string> = {
  rejected: "send-back", // 旧页面 isEdgeActive 口径：rejected ≡ 打回
  "send_back": "send-back",
};

/**
 * when 谓词求值（规范 R4 §5.2）：结构化对象是唯一合法形态。
 * 非对象（flow@1 字符串形态，v4.0.0 已处决）→ 保守判不活跃 + reason 供 journal warn。
 */
export function evalWhen(when: WhenPredicate | undefined, ctx: CondContext): CondResult {
  if (when === undefined || when === null) return { active: true };
  if (typeof when === "object") return evalStructured(when, ctx);
  return { active: false, reason: `when 必须是结构化谓词（flow@1 字符串形态「${String(when)}」已处决，不静默放行）` };
}

function evalStructured(w: WhenPredicate, ctx: CondContext): CondResult {
  const keys = Object.keys(w).filter((k) => (w as Record<string, unknown>)[k] !== undefined);
  if (!keys.length) return { active: true };

  if (w.any?.length) {
    const rs = w.any.map((x) => evalWhen(x, ctx));
    const hit = rs.find((r) => r.active);
    return hit ? { active: true } : { active: false, reason: rs.map((r) => r.reason).filter(Boolean).join(" ｜ ") || "any 全不成立" };
  }
  if (w.all?.length) {
    const rs = w.all.map((x) => evalWhen(x, ctx));
    const miss = rs.filter((r) => !r.active);
    return miss.length === 0 ? { active: true } : { active: false, reason: miss.map((r) => r.reason).filter(Boolean).join(" ｜ ") };
  }

  if (w.verdict !== undefined) {
    const want = VERDICT_ALIAS[w.verdict] ?? w.verdict;
    const got = ctx.gateVerdict ?? "none";
    const active = got === want;
    if (!active) return { active, reason: `门裁决 ${got}（需 ${want}）` };
  }

  if (w.challenge !== undefined) {
    const votes = Object.values(ctx.nodeVerdicts ?? {}).map((v) => String(v ?? ""));
    const got = votes.includes("challenge") || (ctx.gateVerdict ?? "") === "challenge";
    if (got !== w.challenge) return { active: false, reason: `挑战票=${got}（需 ${w.challenge}）` };
  }

  if (w.cause !== undefined) {
    const want = String(w.cause);
    const got = ctx.lastRejectReason ?? "";
    if (!(got.includes(want) || want.includes(got))) {
      return { active: false, reason: `根因不匹配（want=${want}, got=${got || "无"}）` };
    }
  }

  if (w.input !== undefined) {
    const got = ctx.inputs[w.input];
    if (w.eq !== undefined) {
      if (got === undefined || String(got) !== String(w.eq)) {
        return { active: false, reason: `输入 ${w.input}=${String(got ?? "未绑定")}（需 ${String(w.eq)}）` };
      }
    }
    if (w.gt !== undefined && !(Number(got) > w.gt)) {
      return { active: false, reason: `输入 ${w.input}=${String(got ?? "未绑定")}（需 > ${w.gt}）` };
    }
    if (w.lt !== undefined && !(Number(got) < w.lt)) {
      return { active: false, reason: `输入 ${w.input}=${String(got ?? "未绑定")}（需 < ${w.lt}）` };
    }
  }

  if (w.loop !== undefined) {
    const pending = ctx.pendingInstances ?? 0;
    const want = w.loop === "pending" ? pending > 0 : pending === 0;
    if (!want) return { active: false, reason: `未完成实例 ${pending}（需 loop=${w.loop}）` };
  }

  return { active: true };
}

/** 解析 flow inputs：校验类型/枚举/范围，回填缺省。inject 由内核预注入（如 type:"project" 的项目上下文）。非法即抛。 */
export function resolveInputs(
  flow: FlowDescriptor,
  raw: Record<string, unknown> | undefined,
  inject: Record<string, unknown> = {},
): Record<string, unknown> {
  const defs = flow.inputs ?? {};
  const out: Record<string, unknown> = { ...inject };
  for (const [key, def] of Object.entries(defs)) {
    if (key in out) continue; // 已由内核注入
    let v = raw?.[key];
    if (v === undefined || v === null || v === "") {
      if (def.required) throw new Error(`缺少必填输入: ${key}（${def.desc ?? ""}）`);
      v = def.default;
    }
    if (v === undefined) {
      // R8 铁律 1：enum = 选择。选择既无取值又无 default 时绝不静默未绑定——
      // 未绑定的 inputs 会让 when:{input,eq} 条件边悄悄判死（route=dual 事故形态）。开跑即失败。
      // 唯一豁免 = 显式 `required:false` 的**先验**输入（如 region）：人不表态就不猜，
      // 取值交给运行中的决策生产者（调研步 set_decision）——缺席 ≠ 兜底，是"尚无可滤标签"。
      if (def.type === "enum" && def.required !== false)
        throw new Error(
          `选择未决: 输入 ${key}（enum）无取值——开跑前须显式选（CLI --inputs / 项目配置.json / 初始化面板），或走决策（decisions/）`,
        );
      continue;
    }
    switch (def.type) {
      case "number": {
        const n = Number(v);
        if (Number.isNaN(n)) throw new Error(`输入 ${key} 需为数字`);
        if (def.min !== undefined && n < def.min) throw new Error(`输入 ${key} < min(${def.min})`);
        if (def.max !== undefined && n > def.max) throw new Error(`输入 ${key} > max(${def.max})`);
        out[key] = n;
        break;
      }
      case "boolean":
        out[key] = v === true || v === "true" || v === "on" || v === 1;
        break;
      case "enum":
        if (def.options && !def.options.map(String).includes(String(v))) {
          throw new Error(`输入 ${key}=${v} 不在枚举 [${def.options.join("/")}]`);
        }
        out[key] = v;
        break;
      default:
        out[key] = v;
    }
  }
  // 未声明的输入原样保留（runstate.inputs 兼容旧页面的条件开关）
  for (const [k, v] of Object.entries(raw ?? {})) {
    if (!(k in out)) out[k] = v;
  }
  return out;
}

/** 由 run 状态构造求值上下文（规范 R4 §5.2：前端与内核同源求值）。 */
export function condContextOf(state: {
  inputs?: Record<string, unknown>;
  lastRejectReason?: string;
  gate?: { verdict?: string };
  nodes?: Record<string, { verdict?: string }>;
  pendingInstances?: number;
}): CondContext {
  const nodeVerdicts: Record<string, string | undefined> = {};
  for (const [id, n] of Object.entries(state.nodes ?? {})) nodeVerdicts[id] = n?.verdict;
  return {
    inputs: state.inputs ?? {},
    lastRejectReason: state.lastRejectReason,
    gateVerdict: state.gate?.verdict,
    nodeVerdicts,
    pendingInstances: state.pendingInstances,
  };
}

/**
 * 未收口的迭代节点数（`{loop:"pending"}` 的运行时取值）。
 * 语义：还有 iterate 节点没 seal 完 —— 即"还有未写章"。上一批 seal 收口后归零，回边随之失效，
 * 流水线转下一批（flow@1 那条不可求值的字符串谓词 `when:"还有未写章"` 已由本结构化谓词接替并处决）。
 * 前端面板与内核共用本函数，保证"线是活的"与"页面上看到的一致"。
 */
export function pendingInstancesOf(
  flow: { graph: { nodes: Record<string, { iterate?: unknown }> } },
  state: { nodes?: Record<string, { status?: string }> },
): number {
  return Object.entries(flow.graph.nodes).filter(
    ([id, n]) => !!n?.iterate && (state.nodes?.[id]?.status ?? "none") !== "done",
  ).length;
}
