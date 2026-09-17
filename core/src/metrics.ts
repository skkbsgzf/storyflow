/**
 * metric@1 · 运行指标（规范 R5 §五）
 *
 * 生成式 flow 的唯一调优依据。两条主指标：
 *   · **tool 效率** ω = 被下游真正消费的次数 / 成本（tokens + 时延 + 打回 + 重试）
 *   · **上下文命中率** = 注入的标尺卡/上游件中，被产物真正引用过的比例
 *
 * 命中率的机器可读信号来自 artifact@1 头部（R4 已把 upstream 带 sha 写进头部），
 * 因此「装了的条款有没有被用上」不需要任何人肉声明。
 */
import path from "node:path";
import type { RunMetric } from "./types.js";
import { appendJsonl, readJsonl } from "./fsio.js";
import { assertSchema } from "./schema.js";
import { nowIso } from "./ids.js";

export interface CtxUsage {
  offered: number;
  used: number;
  ids: string[];
  hitIds: string[];
}

export function metricsPath(projectDir: string): string {
  return path.join(projectDir, "registry", "metrics.jsonl");
}

export function recordMetric(projectDir: string, m: Omit<RunMetric, "ts"> & { ts?: string }): RunMetric {
  const e: RunMetric = { ts: m.ts ?? nowIso(), ...m } as RunMetric;
  assertSchema("metrics", e);
  appendJsonl(metricsPath(projectDir), e);
  return e;
}

export function readMetrics(projectDir: string): RunMetric[] {
  return readJsonl<RunMetric>(metricsPath(projectDir));
}

/**
 * 命中的机器判定：产物头部 `upstream:` 行里的路径/卡 id + 正文中出现过的 id。
 * 头部是 R4 就写好的既有事实，因此这里不引入新的写作负担。
 */
export function extractCtxUsage(artifactText: string, ids: string[]): CtxUsage {
  const text = artifactText.replace(/^\uFEFF/, "");
  const head = text.startsWith("---") ? text.slice(0, text.indexOf("\n---", 3) + 4) : "";
  const hitIds = ids.filter((id) => {
    const short = id.replace(/^kb\//, "");
    return head.includes(id) || head.includes(short) || text.includes(id) || (short.length > 3 && text.includes(short));
  });
  return { offered: ids.length, used: hitIds.length, ids, hitIds };
}

// ---------------- 聚合 ----------------

export interface NodeStats {
  nodeId: string;
  kit?: string;
  op?: string;
  runs: number;
  submits: number;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  assertPass: number;
  assertBlock: number;
  retries: number;
  ctxOffered: number;
  ctxUsed: number;
  hitRate: number;
  /** 产物被下游消费的次数（生成式 flow 的价值判据） */
  consumedBy: number;
  cost: number;
  efficiency: number;
  verdicts: string[];
}

export interface ToolStats extends NodeStats {
  nodes: string[];
}

export interface KbStat { id: string; offered: number; used: number; hitRate: number }

export interface MetricsSummary {
  events: number;
  byNode: Record<string, NodeStats>;
  byTool: Record<string, ToolStats>;
  knowledge: KbStat[];
  /** 人工门/边界验收的裁决分布 */
  gates: { nodeId: string; phase: string; passes: number; sendBacks: number; samples: number }[];
  window: { from?: string; to?: string };
}

const EPS = 1e-6;

function costOf(s: { tokensIn: number; tokensOut: number; latencyMs: number; assertBlock: number; retries: number }): number {
  // 成本口径：token 千分位 + 时延分钟位 + 打回/重试的返工溢价
  return Math.max(EPS, (s.tokensIn + s.tokensOut) / 1000 + s.latencyMs / 60000 + s.assertBlock * 5 + s.retries * 2);
}

export function summarizeMetrics(
  events: RunMetric[],
  opts: { pathToNode?: Record<string, string> } = {},
): MetricsSummary {
  const pathToNode = opts.pathToNode ?? {};
  const byNode: Record<string, NodeStats> = {};
  const kbOffered: Record<string, number> = {};
  const kbUsed: Record<string, number> = {};
  const gateMap: Record<string, { phase: string; passes: number; sendBacks: number; samples: number }> = {};

  const get = (id: string): NodeStats =>
    (byNode[id] ??= {
      nodeId: id, runs: 0, submits: 0, tokensIn: 0, tokensOut: 0, latencyMs: 0,
      assertPass: 0, assertBlock: 0, retries: 0, ctxOffered: 0, ctxUsed: 0,
      hitRate: 0, consumedBy: 0, cost: 0, efficiency: 0, verdicts: [],
    });

  for (const e of events) {
    const s = get(e.nodeId);
    if (e.kit) s.kit = e.kit;
    if (e.op) s.op = e.op;
    if (e.phase === "dispatch") s.runs += 1;
    if (e.phase === "submit" || e.phase === "core" || e.phase === "auto-gate") s.submits += 1;
    s.tokensIn += e.tokensIn ?? 0;
    s.tokensOut += e.tokensOut ?? 0;
    s.latencyMs += e.latencyMs ?? 0;
    s.assertPass += e.asserts?.pass ?? 0;
    s.assertBlock += e.asserts?.block ?? 0;
    s.retries = Math.max(s.retries, e.retries ?? 0);
    if (e.verdict) s.verdicts.push(e.verdict);
    for (const id of e.ctx?.ids ?? []) kbOffered[id] = (kbOffered[id] ?? 0) + 1;
    for (const id of e.ctx?.hitIds ?? []) {
      kbUsed[id] = (kbUsed[id] ?? 0) + 1;
      const producer = pathToNode[id];
      if (producer && producer !== e.nodeId) get(producer).consumedBy += 1;
    }
    if (e.phase === "boundary" || e.phase === "gate") {
      const g = (gateMap[e.nodeId] ??= { phase: e.phase, passes: 0, sendBacks: 0, samples: 0 });
      g.samples += 1;
      if (e.verdict === "send-back") g.sendBacks += 1;
      else g.passes += 1;
    }
  }

  // ctx 计数需 dispatch/submit 两相合并：dispatch 记装载量，submit 记真实命中量
  for (const e of events) {
    const s = byNode[e.nodeId];
    if (!s) continue;
    if (e.phase === "dispatch") s.ctxOffered += e.ctx?.offered ?? e.ctx?.ids?.length ?? 0;
    else if (e.phase === "submit" || e.phase === "core") s.ctxUsed += e.ctx?.used ?? 0;
  }

  for (const s of Object.values(byNode)) {
    s.cost = costOf(s);
    s.efficiency = s.consumedBy / s.cost;
    s.hitRate = s.ctxOffered > 0 ? s.ctxUsed / s.ctxOffered : 0;
  }

  // tool 视角：同一 kit.op 跨节点合并（换位置不换 tool，指标该跟着 tool 走）
  const byTool: Record<string, ToolStats> = {};
  for (const s of Object.values(byNode)) {
    if (!s.kit || !s.op) continue;
    const key = `${s.kit}.${s.op}`;
    const t = (byTool[key] ??= {
      nodeId: key, kit: s.kit, op: s.op,
      runs: 0, submits: 0, tokensIn: 0, tokensOut: 0, latencyMs: 0,
      assertPass: 0, assertBlock: 0, retries: 0, ctxOffered: 0, ctxUsed: 0,
      hitRate: 0, consumedBy: 0, cost: 0, efficiency: 0, verdicts: [], nodes: [],
    });
    t.runs += s.runs;
    t.submits += s.submits;
    t.tokensIn += s.tokensIn;
    t.tokensOut += s.tokensOut;
    t.latencyMs += s.latencyMs;
    t.assertPass += s.assertPass;
    t.assertBlock += s.assertBlock;
    t.retries = Math.max(t.retries, s.retries);
    t.ctxOffered += s.ctxOffered;
    t.ctxUsed += s.ctxUsed;
    t.consumedBy += s.consumedBy;
    t.nodes.push(s.nodeId);
  }
  for (const t of Object.values(byTool)) {
    t.nodes = [...new Set(t.nodes)];
    t.cost = costOf(t);
    t.efficiency = t.consumedBy / t.cost;
    t.hitRate = t.ctxOffered > 0 ? t.ctxUsed / t.ctxOffered : 0;
  }

  const knowledge: KbStat[] = [...new Set([...Object.keys(kbOffered), ...Object.keys(kbUsed)])]
    .map((id) => ({
      id,
      offered: kbOffered[id] ?? 0,
      used: kbUsed[id] ?? 0,
      hitRate: (kbOffered[id] ?? 0) > 0 ? (kbUsed[id] ?? 0) / (kbOffered[id] ?? 1) : 0,
    }))
    .sort((a, b) => a.hitRate - b.hitRate);

  return {
    events: events.length,
    byNode,
    byTool,
    knowledge,
    gates: Object.entries(gateMap).map(([nodeId, g]) => ({ nodeId, ...g })),
    window: { from: events[0]?.ts, to: events[events.length - 1]?.ts },
  };
}
