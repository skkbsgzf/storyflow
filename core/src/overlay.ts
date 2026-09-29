/**
 * flow-overlay@1 · 运行时编排覆盖层（规范 R5）
 *
 * 设计前提（用户拍板）：放弃把红蓝对抗做成图上固定节点，改拥抱生成式 flow——
 *   · flow.json = bootstrap 骨架，稳定不动；
 *   · 运行编排 = bootstrap ⊕ 出厂 overlay ⊕ 项目 overlay（人 / 优化 agent 随时改）；
 *   · tool 的**位置**（place/remove/set-op/set-edge）与 tool 的**内容配置**
 *     （set-node.config / set-tool.knowledge）都是 overlay 的一等对象；
 *   · 人工裁决只出现在 **kit 域切换处**（边界验收），由本模块自动派生。
 *
 * 一切应用都是纯函数：applyOverlay(flow, overlays) 幂等、可审计、结果只取决于输入。
 */
import fs from "node:fs";
import path from "node:path";
import type { FlowDescriptor, FlowEdge, FlowNode } from "./types.js";
import { fnv1a, stableStringify } from "./ids.js";
import { isBackEdge } from "./cond.js";

export type BoundaryPolicy = "always" | "auto" | "off";
export type GateMode = "auto" | "manual";
export type AdaptPolicy = "off" | "propose" | "apply";

export interface FlowPolicy {
  kit_boundary?: BoundaryPolicy;
  gate_mode?: GateMode;
  /** R6：模块间连接件缺省模式（flow@3；旧 kit_boundary/gate_mode 对 flow@2 沿用） */
  link_default?: "auto" | "manual";
  adapt?: AdaptPolicy;
  /** OS-02 阶段 C：阈值预算面（键名/区间见 `budget.ts::DEFAULT_BUDGET`）。改前是零消费者的占位三键。 */
  budget?: Record<string, number>;
  /** R7（OS-02A）：同一门累计驳回上限 / 等待态超时毫秒。见 kernel.ts 的 blocked 出口。 */
  maxRounds?: number;
  awaitTimeoutMs?: number;
}

export interface OverlayEvidence {
  rule?: string;
  metric?: string;
  value?: unknown;
  samples?: number;
}

export interface OverlayPatch {
  /**
   * 14 种 kind，**逐项对齐** `contracts/flow-overlay.schema.json`。
   * R7/N4 勘误：TS 联合此前只有 11 种，而 `modules.ts::effectiveFlow3` 早已消费
   * `set-module`/`insert-tool`（靠 `as any` 绕类型）——契约、实现、类型三方各说一套。
   * 现补齐并加 `set-link`（per-link 降级通道）。
   */
  kind:
    | "set-node" | "set-op" | "place-node" | "remove-node"
    | "set-edge" | "add-edge" | "remove-edge"
    | "set-tool" | "set-policy" | "suppress-boundary" | "set-input"
    | "set-module" | "insert-tool" | "set-link";
  reason: string;
  evidence?: OverlayEvidence;
  status?: "applied" | "proposed" | "rejected";
  id?: string;
  config?: Record<string, unknown>;
  when?: unknown;
  output?: string;
  role?: string;
  params?: Record<string, unknown>;
  kit?: string;
  op?: string;
  minitool?: string;
  node?: Partial<FlowNode> & { id: string };
  after?: string[];
  before?: string[];
  wire?: "chain" | "fan-in" | "fan-out";
  rewire?: "bridge" | "drop";
  edge?: Partial<FlowEdge> & { id: string; from: string; to: string };
  add_knowledge?: string[];
  remove_knowledge?: string[];
  model_tier?: "high" | "lite";
  key?: string;
  value?: unknown;
  from?: string;
  to?: string;
  /** set-module：模块实例 id */
  module?: string;
  /** insert-tool：模块实例 id（`module` 亦可）+ slot 锚点 + 要插入的 tool */
  tool?: string;
  slot?: string;
  caps?: string[];
  /** set-link：目标连接件 id（`<实例id>.link` 或裸实例 id）+ 该处交界的裁决模式 */
  link?: string;
  mode?: "auto" | "manual";
  /** 来源提案 id（优化器产出时带上；人可凭它批准 proposed → applied） */
  proposal?: string;
}

export interface FlowOverlay {
  format: "flow-overlay@1";
  flowId: string;
  origin: "user" | "optimizer" | "factory" | "kernel";
  reason?: string;
  basedOn?: Record<string, unknown>;
  patches: OverlayPatch[];
  history?: Record<string, unknown>[];
}

export interface ToolOverride {
  add_knowledge?: string[];
  remove_knowledge?: string[];
  model_tier?: "high" | "lite";
  config?: Record<string, unknown>;
}

export interface EffectiveFlow {
  flow: FlowDescriptor;
  policy: FlowPolicy;
  inputs: Record<string, unknown>;
  /** 生效的 tool 级改写，key = `<kit>.<op>`；由 assembler 装载时叠加 */
  toolOverrides: Record<string, ToolOverride>;
  /** 本次自动派生的 kit 边界验收节点 id（R5；R6 下恒为 []，改由 links 表达） */
  boundaries: string[];
  /** R6：模块间连接件（取代 boundaries）；展开器派生 */
  links?: Array<{ id: string; fromModule: string; toModule: string; mode: "auto" | "manual" }>;
  /** R6：模块组合与模块节点表（expandFlow3 产出，persistEffective 落 effective@2） */
  r6?: {
    modules: Array<{ id: string; module: string; name: string; order: number; dir: string; link: "auto" | "manual"; caps: string[]; capsEnabled: string[]; spine: string[]; plugins: string[] }>;
    links: Array<{ id: string; fromModule: string; toModule: string; mode: "auto" | "manual" }>;
    moduleNodes: Record<string, string[]>;
    dirs: Record<string, string>;
  };
  /** 应用日志（进 journal / 前端编排说明） */
  notes: string[];
  /**
   * flow@3 独有的「未被消费的 patch」清单（N3：不许静默丢弃）。
   * flow@2 无此面（applyOverlay 逐条 note 跳过原因）。**必须透传到 EffectiveFlow**，
   * 否则调用方只能看到 notes 里的一句汇总，拿不到可编程的清单。
   */
  unsupported?: string[];
  overlayHash: string;
  /** 只含 applied 补丁的合成层（写回磁盘时用它） */
  appliedCount: number;
}

/**
 * 出厂缺省策略。
 *
 * R7（OS-02A）改动：`kit_boundary` 由 `"always"` 改 `"auto"`。
 * 开源部署的第一道阻塞就在这里——`always` 会在**每一个跨域交接**插一道人工验收门：
 * 一份干净的 clone 跑起来立刻被拦在门外，而仓储里 7 条 flow@2 的 `policy` 全是 `{}`（全吃缺省）。
 * `auto` 不是「不派生」：边界门照派生（页面看得见、boundaries 清单里有、优化器认它、指标照记），
 * 只是由 `advance` **在计划内自动裁决**——可见、可审计、不阻塞。
 * 要人工验收的 flow 显式写 `policy.kit_boundary="always"`：策略是旋钮，不是硬编码。
 */
export const DEFAULT_POLICY: Required<Pick<FlowPolicy, "kit_boundary" | "gate_mode" | "adapt">> = {
  kit_boundary: "auto",
  gate_mode: "auto",
  adapt: "propose",
};

export const BOUNDARY_PREFIX = "itb-";

export function isBoundaryGate(node: FlowNode | undefined): boolean {
  return !!node && node.kind === "gate" && node.gate_role === "kit-boundary";
}

/**
 * 「带产活的门」：kind=gate，但挂了 skill / kit.op / minitool，或声明了 output —— 它其实是**评审步**，
 * 不是纯汇合点。R5 允许这种门的**裁决**自动（域内质量交回规则语料 + 扫描器证据，v5.0 agent-only），
 * 但这一步的**执行**不许跳过：跳过 = 产物凭空消失而节点照样判 done，那是静默断路，
 * 比「多一道门」坏得多。所以它按 agent 步派发、产物照出、裁决自动。
 */
export function isWorkGate(node: FlowNode | undefined): boolean {
  return !!node && node.kind === "gate" && !!(node.output || node.skill || node.op || node.minitool);
}

export function factoryOverlayPath(root: string, flowId: string): string {
  return path.join(root, "flows", flowId, "overlay.default.json");
}

export function projectOverlayPath(projectDir: string): string {
  return path.join(projectDir, "registry", "overlay.json");
}

/** 读一份 overlay（不存在返回 undefined；非法抛——坏编排不许静默降级）。 */
export function readOverlay(file: string): FlowOverlay | undefined {
  if (!fs.existsSync(file)) return undefined;
  const raw = JSON.parse(fs.readFileSync(file, "utf-8")) as FlowOverlay;
  if (raw.format !== "flow-overlay@1") throw new Error(`overlay 格式非法: ${file}（format=${raw.format}）`);
  if (!Array.isArray(raw.patches)) throw new Error(`overlay 缺 patches: ${file}`);
  for (const [i, p] of raw.patches.entries()) {
    if (!p || typeof p.kind !== "string") throw new Error(`overlay patch[${i}] 缺 kind: ${file}`);
    if (!p.reason) throw new Error(`overlay patch[${i}]（${p.kind}）缺 reason: ${file}`);
    if (raw.origin === "optimizer" && p.status === "applied" && !p.evidence) {
      throw new Error(`overlay patch[${i}]（${p.kind}）origin=optimizer 且 applied 必须带 evidence: ${file}`);
    }
  }
  return raw;
}

// ---------------- 纯函数：应用补丁 ----------------

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function edgeExists(nodes: Record<string, FlowNode>, from: string, to: string): boolean {
  return false || (nodes && false); // 占位，保留签名便于后续扩展
}

/** place/remove 用：某节点的前向出边目标去重。 */
function forwardOut(edges: FlowEdge[], id: string): string[] {
  return [...new Set(edges.filter((e) => e.from === id && !isBackEdge(e)).map((e) => e.to))];
}

export interface ApplyResult {
  flow: FlowDescriptor;
  toolOverrides: Record<string, ToolOverride>;
  policy: FlowPolicy;
  inputs: Record<string, unknown>;
  suppressed: Set<string>;
  notes: string[];
  applied: number;
}

/**
 * 应用一层或多层 overlay（按数组顺序，后层覆盖前层；`status:"proposed"` 的补丁不参与合成）。
 * 幂等性：同一组补丁重复应用，结果稳定（set/remove 类收敛；place/add 类按 id 去重）。
 */
export function applyOverlay(flow: FlowDescriptor, overlays: FlowOverlay[]): ApplyResult {
  const out = clone(flow);
  const toolOverrides: Record<string, ToolOverride> = {};
  const policy: FlowPolicy = { ...(flow.policy ?? {}) };
  const inputs: Record<string, unknown> = {};
  const suppressed = new Set<string>();
  const notes: string[] = [];
  let applied = 0;

  const delEdge = (id: string): void => {
    out.graph.edges = out.graph.edges.filter((e) => e.id !== id);
  };
  const touch = (p: OverlayPatch, tag: string): void => {
    applied += 1;
    notes.push(`${tag}｜${p.reason}${p.evidence ? `（依据 ${p.evidence.rule ?? ""} ${p.evidence.metric ?? ""}=${String(p.evidence.value ?? "")}）` : ""}`);
  };

  for (const ov of overlays) {
    for (const p of ov.patches) {
      if (p.status && p.status !== "applied") continue;
      switch (p.kind) {
        case "set-node": {
          const n = p.id ? out.graph.nodes[p.id] : undefined;
          if (!n) { notes.push(`跳过 set-node：节点不存在 ${p.id}`); break; }
          if (p.config) n.config = { ...(n.config ?? {}), ...p.config };
          if (p.when !== undefined) n.when = p.when as FlowNode["when"];
          if (p.output) n.output = p.output;
          touch(p, `set-node ${p.id}`);
          break;
        }
        case "set-op": {
          const n = p.id ? out.graph.nodes[p.id] : undefined;
          if (!n || !p.kit || !p.op) { notes.push(`跳过 set-op：${p.id}`); break; }
          n.kit = p.kit;
          n.op = p.op;
          delete n.skill; // kit+op 是唯一事实源，避免漂移
          if (p.minitool) n.minitool = p.minitool;
          touch(p, `set-op ${p.id} → ${p.kit}.${p.op}`);
          break;
        }
        case "place-node": {
          const spec = p.node;
          if (!spec?.id) { notes.push("跳过 place-node：缺 node.id"); break; }
          if (out.graph.nodes[spec.id]) { notes.push(`跳过 place-node：节点已存在 ${spec.id}`); break; }
          const { id, ...rest } = spec;
          out.graph.nodes[id] = { kind: "agent", title: id, ...rest } as FlowNode;
          const after = (p.after ?? []).filter((x) => out.graph.nodes[x]);
          const before = (p.before ?? []).filter((x) => out.graph.nodes[x]);
          const tails = before.length ? before : [...new Set(after.flatMap((a) => forwardOut(out.graph.edges, a)))];
          for (const a of after) {
            const eid = `e-ov-${id}-in-${a}`;
            if (!out.graph.edges.some((e) => e.id === eid)) {
              out.graph.edges.push({ id: eid, from: a, to: id, role: "flow" });
            }
          }
          for (const b of tails) {
            const eid = `e-ov-${id}-out-${b}`;
            if (!out.graph.edges.some((e) => e.id === eid)) {
              out.graph.edges.push({ id: eid, from: id, to: b, role: "flow" });
            }
          }
          touch(p, `place-node ${id}（after ${after.join(",") || "-"} / before ${tails.join(",") || "-"}）`);
          break;
        }
        case "remove-node": {
          if (!p.id || !out.graph.nodes[p.id]) { notes.push(`跳过 remove-node：${p.id}`); break; }
          const ins = out.graph.edges.filter((e) => e.to === p.id && !isBackEdge(e)).map((e) => e.from);
          const outs = forwardOut(out.graph.edges, p.id);
          delete out.graph.nodes[p.id];
          out.graph.edges = out.graph.edges.filter((e) => e.from !== p.id && e.to !== p.id);
          if ((p.rewire ?? "bridge") === "bridge") {
            for (const a of ins) for (const b of outs) {
              const eid = `e-ov-br-${a}-${b}`;
              if (!out.graph.edges.some((e) => e.id === eid)) {
                out.graph.edges.push({ id: eid, from: a, to: b, role: "flow" });
              }
            }
          }
          if (out.outputs) out.outputs = out.outputs.filter((o) => o.node !== p.id);
          touch(p, `remove-node ${p.id}（rewire=${p.rewire ?? "bridge"}）`);
          break;
        }
        case "set-edge": {
          const e = p.id ? out.graph.edges.find((x) => x.id === p.id) : undefined;
          if (!e) { notes.push(`跳过 set-edge：${p.id}`); break; }
          if (p.role) e.role = p.role as FlowEdge["role"];
          if (p.when !== undefined) e.when = p.when as FlowEdge["when"];
          if (p.params) e.params = { ...(e.params ?? {}), ...p.params } as FlowEdge["params"];
          touch(p, `set-edge ${p.id}`);
          break;
        }
        case "add-edge": {
          const spec = p.edge;
          if (!spec) { notes.push("跳过 add-edge：缺 edge"); break; }
          if (!out.graph.nodes[spec.from] || !out.graph.nodes[spec.to]) { notes.push(`跳过 add-edge：端点不存在 ${spec.from}→${spec.to}`); break; }
          if (out.graph.edges.some((e) => e.id === spec.id)) { notes.push(`跳过 add-edge：边已存在 ${spec.id}`); break; }
          out.graph.edges.push({ role: "flow", ...spec } as FlowEdge);
          touch(p, `add-edge ${spec.id} ${spec.from}→${spec.to}`);
          break;
        }
        case "remove-edge": {
          if (!p.id) break;
          delEdge(p.id);
          touch(p, `remove-edge ${p.id}`);
          break;
        }
        case "set-tool": {
          if (!p.kit || !p.op) { notes.push("跳过 set-tool：缺 kit/op"); break; }
          const key = `${p.kit}.${p.op}`;
          const cur = toolOverrides[key] ?? {};
          if (p.add_knowledge) cur.add_knowledge = [...(cur.add_knowledge ?? []), ...p.add_knowledge];
          if (p.remove_knowledge) cur.remove_knowledge = [...(cur.remove_knowledge ?? []), ...p.remove_knowledge];
          if (p.model_tier) cur.model_tier = p.model_tier;
          if (p.config) cur.config = { ...(cur.config ?? {}), ...p.config };
          toolOverrides[key] = cur;
          touch(p, `set-tool ${key}`);
          break;
        }
        case "set-policy": {
          if (!p.key) break;
          const cur = (policy as Record<string, unknown>)[p.key];
          // R6/R7 的 policy 键都是标量；`budget`（OS-02 C）是对象 ⇒ **按 key 浅合并**。
          // 整体替换会让「只调一个阈值」的 patch 把项目声明的其余阈值静默抹掉——
          // 那正是本仓最反感的「静默丢配置」。与 set-node.config / set-tool.config 同语义。
          const objMerge = p.value && typeof p.value === "object" && !Array.isArray(p.value) &&
            cur && typeof cur === "object" && !Array.isArray(cur);
          const val = objMerge
            ? { ...(cur as Record<string, unknown>), ...(p.value as Record<string, unknown>) }
            : p.value;
          (policy as Record<string, unknown>)[p.key] = val;
          touch(p, `set-policy ${p.key}=${JSON.stringify(val)}`);
          break;
        }
        case "suppress-boundary": {
          if (p.to) suppressed.add(p.to);
          touch(p, `suppress-boundary ${p.from ?? "?"}→${p.to ?? "?"}`);
          break;
        }
        case "set-input": {
          if (!p.key) break;
          inputs[p.key] = p.value;
          touch(p, `set-input ${p.key}=${String(p.value)}`);
          break;
        }
        default:
          notes.push(`跳过未知补丁 kind=${String((p as { kind?: string }).kind)}`);
      }
    }
  }
  return { flow: out, toolOverrides, policy, inputs, suppressed, notes, applied };
}

// ---------------- kit 域与边界验收派生 ----------------

/** 前向拓扑序（忽略条件与裁边，纯结构序；用于域序列与边界定位）。 */
export function forwardOrder(flow: FlowDescriptor): string[] {
  const nodes = Object.keys(flow.graph.nodes);
  const indeg = new Map<string, number>(nodes.map((n) => [n, 0]));
  const out = new Map<string, string[]>(nodes.map((n) => [n, []]));
  for (const e of flow.graph.edges) {
    if (isBackEdge(e)) continue;
    if (!indeg.has(e.from) || !indeg.has(e.to)) continue;
    indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
    out.get(e.from)!.push(e.to);
  }
  const q = nodes.filter((n) => (indeg.get(n) ?? 0) === 0).sort();
  const order: string[] = [];
  while (q.length) {
    const n = q.shift()!;
    order.push(n);
    for (const m of out.get(n) ?? []) {
      indeg.set(m, (indeg.get(m) ?? 0) - 1);
      if (indeg.get(m) === 0) q.push(m);
    }
  }
  for (const n of nodes) if (!order.includes(n)) order.push(n); // 环内节点兜底（不静默丢）
  return order;
}

/** 非 kit-boundary 的门是**透明**的：它不再定义域（R5 门降级）。 */
function isTransparent(node: FlowNode | undefined): boolean {
  if (!node) return true;
  if (node.kind === "gate") return !isBoundaryGate(node);
  return !node.kit;
}

/**
 * 节点所属 kit 域：自身有 kit 且非透明 → 自身域；否则取最近上游执行域的共识。
 * 多域汇入（mix）时取拓扑序最靠前的那个，并把 mix 记入 warn 供优化器参考。
 */
export function domainMap(flow: FlowDescriptor): { dom: Map<string, string | undefined>; mixed: string[] } {
  const dom = new Map<string, string | undefined>();
  const mixed: string[] = [];
  const preds = new Map<string, string[]>();
  for (const n of Object.keys(flow.graph.nodes)) preds.set(n, []);
  for (const e of flow.graph.edges) {
    if (isBackEdge(e)) continue;
    if (preds.has(e.to) && preds.has(e.from)) preds.get(e.to)!.push(e.from);
  }
  for (const id of forwardOrder(flow)) {
    const node = flow.graph.nodes[id];
    if (!isTransparent(node)) { dom.set(id, node.kit); continue; }
    const seen: string[] = [];
    for (const p of preds.get(id) ?? []) {
      const d = dom.get(p);
      if (d && !seen.includes(d)) seen.push(d);
    }
    if (seen.length > 1) mixed.push(id);
    dom.set(id, seen[0]);
  }
  return { dom, mixed };
}

export interface BoundaryDerivation {
  flow: FlowDescriptor;
  gates: string[];
  notes: string[];
}

/**
 * kit 边界人工验收的自动派生（R5 §四）：域切换处挂且仅挂一个 `itb-<目标节点>` 验收门。
 * 幂等：已有边界门覆盖同一 (源域→目标节点) 时不再插入；`suppress-boundary` 的目标直接跳过。
 */
export function injectKitBoundaries(
  flow: FlowDescriptor,
  opts: { policy?: BoundaryPolicy; suppressed?: Set<string> } = {},
): BoundaryDerivation {
  const policy = opts.policy ?? DEFAULT_POLICY.kit_boundary;
  if (policy === "off") return { flow, gates: [], notes: ["kit_boundary=off：不派生边界验收（全自动）"] };

  const out = clone(flow);
  const { dom, mixed } = domainMap(out);
  const notes: string[] = [];
  if (mixed.length) notes.push(`多域汇入节点（优化器可考虑在此处补装/重组 tool）：${mixed.join("、")}`);

  const covered = new Map<string, Set<string>>();
  const gates: string[] = [];
  for (const [id, node] of Object.entries(out.graph.nodes)) {
    if (!isBoundaryGate(node)) continue;
    // 手工书写的边界门同样计入 boundaries：它本来就是边界验收，
    // 只是不是本次派生的。漏掉会导致「页面上有门、边界清单里没有，优化器以为这里没人管」。
    gates.push(id);
    for (const t of forwardOut(out.graph.edges, id)) {
      const s = dom.get(id);
      if (!s) continue;
      if (!covered.has(t)) covered.set(t, new Set());
      covered.get(t)!.add(s);
    }
  }

  const groups = new Map<string, FlowEdge[]>();
  for (const e of out.graph.edges) {
    if (isBackEdge(e)) continue;
    const f = out.graph.nodes[e.from], t = out.graph.nodes[e.to];
    if (!f || !t) continue;
    if (isBoundaryGate(f)) continue;                 // 已是边界门输出，不再套娃
    if (isTransparent(t)) continue;                  // 落点不是执行域节点（门/core/素材）
    if (opts.suppressed?.has(e.to)) continue;
    const S = dom.get(e.from), T = t.kit;
    if (!S || !T || S === T) continue;
    if (covered.get(e.to)?.has(S)) continue;         // 已有边界门承担这一交接
    if (!groups.has(e.to)) groups.set(e.to, []);
    groups.get(e.to)!.push(e);
  }

  for (const [to, edges] of groups) {
    const T = out.graph.nodes[to].kit as string;
    const S = dom.get(edges[0].from) as string;
    const id = `${BOUNDARY_PREFIX}${to}`;
    if (out.graph.nodes[id]) continue;    out.graph.nodes[id] = {
      kind: "gate",
      gate_role: "kit-boundary",
      title: `跨域交接验收：${S} → ${T}`,
      desc: `R5 人工验收点：${S} 域的产物交给 ${T} 域执行前，由人确认交接口径（范围/术语/依据）。域内质量由规则语料（agent 裁决）与扫描器证据（收据制）负责（v5.0）。`,
      // R7（OS-02A）修：此处**不得**用节点级 when 关掉边界门。`compilePlan` 会把不活跃节点的
      // 出入边一起裁掉（plan.ts:52）⇒ 边界门的下游整段失去活跃入边、又不是源点、直接不可达：
      // 计划在门上截断、run 判 completed，人看到的却是「还有一半节点 status=none」。
      // 探针实证（policy=auto 时 plan.order 止于 gate-r1）。改为「留在计划内、由 advance 自动裁决」。
    };
    for (const e of edges) e.to = id;   // 原地改线：保留边 id 与既有 role/when/params
    const eid = `e-${id}-out`;
    out.graph.edges.push({ id: eid, from: id, to, role: "flow", desc: "边界验收通过后放行" });
    gates.push(id);
    notes.push(`派生边界验收 ${id}：${S} → ${T}（接管 ${edges.length} 条跨界入边 ${edges.map((e) => e.id).join(",")}）`);
  }
  return { flow: out, gates, notes };
}

/** 已 applied 的补丁合成指纹（审计用；proposed 不参与，所以"批准提案"会改变指纹 → 触发重编译）。 */
export function overlayHashOf(overlays: FlowOverlay[], injectedBoundaries: string[]): string {
  const applied = overlays.map((o) => ({
    origin: o.origin,
    patches: o.patches.filter((p) => !p.status || p.status === "applied"),
  }));
  return fnv1a(stableStringify({ applied, injectedBoundaries }));
}

// ---------------- 主编排装载 ----------------

/**
 * 生效编排装载（内核唯一入口）：
 *   flows/<id>/flow.json  ⊕  出厂 overlay  ⊕  项目 overlay  ⊕  kit 边界派生
 * 返回的 flow 应贯穿 plan / advance / assembler / 前端 payload —— 一处改，处处生效。
 */
export function effectiveFlow(
  root: string,
  flow: FlowDescriptor,
  opts: { projectDir?: string; overlays?: (FlowOverlay | undefined)[] } = {},
): EffectiveFlow {
  const list: FlowOverlay[] = [];
  if (opts.overlays) list.push(...(opts.overlays.filter(Boolean) as FlowOverlay[]));
  const factory = readOverlay(factoryOverlayPath(root, flow.id));
  if (factory) list.unshift(factory);                      // 出厂建议先应用（项目层可覆盖）
  const project = opts.projectDir ? readOverlay(projectOverlayPath(opts.projectDir)) : undefined;
  if (project) list.push(project);

  const res = applyOverlay(flow, list);
  const policy: FlowPolicy = {
    kit_boundary: res.policy.kit_boundary ?? DEFAULT_POLICY.kit_boundary,
    gate_mode: res.policy.gate_mode ?? DEFAULT_POLICY.gate_mode,
    adapt: res.policy.adapt ?? DEFAULT_POLICY.adapt,
    ...(res.policy.budget ? { budget: res.policy.budget } : {}),
    // R7：两个可中断旋钮对 flow@2 同样生效（此前只在 flow@3 的 policy 白名单里，flow@2 静默丢弃）
    ...(res.policy.maxRounds !== undefined ? { maxRounds: res.policy.maxRounds } : {}),
    ...(res.policy.awaitTimeoutMs !== undefined ? { awaitTimeoutMs: res.policy.awaitTimeoutMs } : {}),
  };
  const b = injectKitBoundaries(res.flow, { policy: policy.kit_boundary, suppressed: res.suppressed });
  return {
    flow: b.flow,
    policy,
    inputs: res.inputs,
    toolOverrides: res.toolOverrides,
    boundaries: b.gates,
    notes: [...res.notes, ...b.notes],
    overlayHash: overlayHashOf(list, b.gates),
    appliedCount: res.applied,
  };
}

/** 写回项目 overlay（人 / 优化 agent 共用的落地点）。 */
export function writeProjectOverlay(projectDir: string, overlay: FlowOverlay, actor: string, hashBefore?: string, hashAfter?: string): string {
  const file = projectOverlayPath(projectDir);
  const prev = readOverlay(file);
  const history = [...(prev?.history ?? []), {
    at: new Date().toISOString(),
    actor,
    ...(hashBefore ? { flowHashBefore: hashBefore } : {}),
    ...(hashAfter ? { flowHashAfter: hashAfter } : {}),
    note: overlay.reason ?? "",
  }];
  const merged: FlowOverlay = { ...overlay, history };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(merged, null, 2) + "\n", "utf-8");
  return file;
}
