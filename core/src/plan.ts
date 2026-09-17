import type { CondContext } from "./cond.js";
import type { FlowDescriptor, FlowEdge } from "./types.js";
import { evalWhen, isBackEdge } from "./cond.js";

export class PlanCycleError extends Error {
  constructor(public cycle: string[]) {
    super(`流程图存在环: ${cycle.join(" -> ")}`);
  }
}

/** 求值上下文的统一构造：inputs 为必填，其余（门裁决/根因/未完成实例）按需叠加。 */
export function condOf(inputs: Record<string, unknown>, extra?: Partial<CondContext>): CondContext {
  return { inputs, ...extra };
}

/**
 * 计划编译（v3 planGraphExecution 语义的 v4 化简版）：
 * - loop 边不进前向计划（循环由 gate send-back 语义表达）
 * - when 不活跃的边裁掉
 * - bind.gate 布尔输入为假时裁掉对应门边（v3 flow.ts 的门裁剪）
 * - 源点出发可达性过滤 + Kahn 拓扑 + 环防御
 * - 每节点一个任务（门天然独立）
 */
export function compilePlan(
  flow: FlowDescriptor,
  inputs: Record<string, unknown>,
  extra?: Partial<CondContext>,
): string[] {
  const ctx = condOf(inputs, extra);
  const nodes = flow.graph.nodes;
  const all = Object.keys(nodes);
  if (all.length === 0) return [];

  // 门裁剪：bind.gate 的布尔输入为假 → 删对应边
  const prunedEdgeIds = new Set<string>();
  for (const [inputName, def] of Object.entries(flow.inputs ?? {})) {
    const gateEdge = def.bind?.gate;
    if (!gateEdge) continue;
    const v = inputs[inputName];
    if (v === false || v === "off" || v === undefined || v === null) prunedEdgeIds.add(gateEdge);
  }

  // 节点级 when（可选模块开关，与边谓词同构）：不活跃的节点连同其出入边一起裁掉。
  // 与边的区别：节点 when 表达"这个模块本次运行根本不参与"，而非"这条线不走"。
  const inactiveNodes = new Set(
    all.filter((n) => nodes[n]?.when !== undefined && !evalWhen(nodes[n]?.when, ctx).active),
  );

  const activeEdges = flow.graph.edges.filter((e: FlowEdge) => {
    if (isBackEdge(e)) return false;
    if (prunedEdgeIds.has(e.id)) return false;
    if (inactiveNodes.has(e.from) || inactiveNodes.has(e.to)) return false;
    const c = evalWhen(e.when, ctx);
    return c.active;
  });

  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  for (const n of all) {
    incoming.set(n, []);
    outgoing.set(n, []);
  }
  for (const e of activeEdges) {
    if (!incoming.has(e.to) || !incoming.has(e.from)) continue;
    incoming.get(e.to)!.push(e.from);
    outgoing.get(e.from)!.push(e.to);
  }

  // 真源点：novel-txt 声明的素材源 ∪ 零前向入度节点（并行根，如无条件 kb_load 装载步）。
  // 注意不能用「活跃边零入边」当源点——when 裁掉的纯支线（如 route≠dual 的 baseline）会变成假源点；
  // 零入度判定看全量前向边：条件支线在全图里有入边，不会被误判成根。
  const declaredSources = all.filter((n) => nodes[n]?.kind === "novel-txt");
  const fullIncoming = new Map<string, string[]>();
  for (const n of all) fullIncoming.set(n, []);
  for (const e of flow.graph.edges) {
    if (isBackEdge(e)) continue;
    if (fullIncoming.has(e.to)) fullIncoming.get(e.to)!.push(e.from);
  }
  const zeroIn = all.filter((n) => (fullIncoming.get(n) ?? []).length === 0);
  const sources = [...new Set([...declaredSources, ...zeroIn])].filter((n) => !inactiveNodes.has(n));

  // 可达性（沿活跃边）
  const reachable = new Set<string>();
  const stack = [...sources];
  while (stack.length) {
    const n = stack.pop()!;
    if (reachable.has(n)) continue;
    reachable.add(n);
    for (const m of outgoing.get(n) ?? []) stack.push(m);
  }

  // Kahn 拓扑（环防御）
  const indeg = new Map<string, number>();
  for (const n of reachable) indeg.set(n, 0);
  for (const e of activeEdges) {
    if (reachable.has(e.from) && reachable.has(e.to)) indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  }
  const order: string[] = [];
  const queue = [...reachable].filter((n) => (indeg.get(n) ?? 0) === 0).sort();
  while (queue.length) {
    const n = queue.shift()!;
    order.push(n);
    for (const m of outgoing.get(n) ?? []) {
      if (!reachable.has(m)) continue;
      indeg.set(m, (indeg.get(m) ?? 0) - 1);
      if ((indeg.get(m) ?? 0) === 0) queue.push(m);
    }
  }
  if (order.length !== reachable.size) {
    const cycle = [...reachable].filter((n) => !order.includes(n));
    throw new PlanCycleError(cycle);
  }
  return order;
}

/** 活跃边视角的上游节点（assembler 组装上下文用）。 */
export function upstreamOf(
  flow: FlowDescriptor,
  nodeId: string,
  inputs: Record<string, unknown>,
  extra?: Partial<CondContext>,
): string[] {
  const ctx = condOf(inputs, extra);
  const nodes = flow.graph.nodes;
  const active = (id: string): boolean => nodes[id]?.when === undefined || evalWhen(nodes[id]?.when, ctx).active;
  return flow.graph.edges
    .filter((e) => e.to === nodeId && !isBackEdge(e) && evalWhen(e.when, ctx).active)
    .map((e) => e.from)
    .filter(active);
}
