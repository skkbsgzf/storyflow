/**
 * 优化器（规范 R5 §六）：由运行指标反推编排调整提案。
 *
 * 关键立场：这是**确定性启发式**，不是 LLM。原因有二——
 *   ① 规则可审计：每条提案都带 metrics 证据（哪条指标、值多少、样本几条），
 *      前端/agent/人都能复核，杜绝「某轮 agent 心情不好把流水线改了」；
 *   ② 与内核同源：优化器能改的东西 = overlay 能表达的东西 = 前端面板能渲染的东西，
 *      三处一套契约，不会出现"提案写得出来、编排表达不了"。
 *
 * agent 的角色是**使用**这些提案（挑哪条、为什么、批不批），而不是凭感觉重画流程图。
 */
import fs from "node:fs";
import path from "node:path";
import type { FlowDescriptor } from "./types.js";
import type { MetricsSummary, NodeStats } from "./metrics.js";
import { BOUNDARY_PREFIX, isBoundaryGate, type FlowOverlay, type FlowPolicy, type OverlayPatch, isWorkGate } from "./overlay.js";
import { DEFAULT_POLICY } from "./overlay.js";
import { kitRegistry } from "./kits.js";
import { nowIso } from "./ids.js";

export interface Proposal {
  id: string;
  rule: string;
  severity: "high" | "medium" | "low";
  /** 自动落地的风险：low 可在 policy.adapt=apply 时自动应用，medium/high 永远待人工批 */
  risk: "low" | "medium" | "high";
  title: string;
  reason: string;
  evidence: { rule: string; metric: string; value: number | string; samples: number };
  patch: OverlayPatch;
}

/** glob 声明（kb/trope/*）也要能归因到具体条目——否则死条款提案会漏掉一半 op。 */
function coversRef(ref: string, id: string): boolean {
  return ref === id || (ref.endsWith("/*") && id.startsWith(ref.slice(0, -1)));
}

export interface KbIndexEntry { id: string; dimension?: string; title?: string }

/**
 * 结构类补丁：会改变图的形状（节点增删、换 op、边增删改）。
 * 这类改动无论乐观到什么程度都不许自动落地——改的是流水线的骨架，必须有人点头。
 * 内容类补丁（config / knowledge / asserts / model_tier / policy）才够格当 low risk。
 */
const STRUCTURAL_KINDS = new Set(["place-node", "remove-node", "set-op", "add-edge", "set-edge", "remove-edge"]);
export function isStructuralPatch(patch: { kind: string }): boolean {
  return STRUCTURAL_KINDS.has(patch.kind);
}

function readKbIndex(root: string): KbIndexEntry[] {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(root, "knowledge", "index.json"), "utf-8")) as { entries?: KbIndexEntry[] };
    return raw.entries ?? [];
  } catch {
    return [];
  }
}

function blockRate(s: { submits: number; assertBlock: number }): number {
  return s.submits > 0 ? s.assertBlock / s.submits : 0;
}

/**
 * 规则集（首版 8 条）。阈值取保守值：宁可漏报也不要误改流水线。
 * 用户说「不急着验证成文效果，希望每个 tool 都能被优化」——所以规则按 **tool 维度**（kit.op）而非节点维度生效：
 * 同一个 tool 换个位置，指标与提案照样跟着它走。
 */
export function proposeFromMetrics(
  flow: FlowDescriptor,
  summary: MetricsSummary,
  opts: { root: string; policy?: FlowPolicy; minSamples?: number } = { root: "." },
): Proposal[] {
  const policy = opts.policy ?? {};
  const minSamples = opts.minSamples ?? 3;
  const out: Proposal[] = [];
  const kitReg = kitRegistry(opts.root);
  const kbIndex = readKbIndex(opts.root);
  const totalSubmits = Object.values(summary.byNode).reduce((a, s) => a + s.submits, 0);
  const anyConsumed = Object.values(summary.byNode).some((s) => s.consumedBy > 0);
  // 消费信号可用性：没有任何节点被下游引用过 = 指标还没积累，裁撤类规则一律不出
  const pruningAllowed = totalSubmits >= 3 && anyConsumed;
  const nodes = flow.graph.nodes;

  // 交付节点：有 output 或出现在 flow.outputs 里 —— 冷门也不能裁
  const delivery = new Set<string>([
    ...(flow.outputs ?? []).map((o) => o.node).filter((x): x is string => !!x),
    ...Object.entries(nodes).filter(([, n]) => !!n.output).map(([id]) => id),
  ]);

  const push = (p: Proposal): void => {
    if (!out.some((x) => x.id === p.id)) out.push(p);
  };

  // ── R1 死条款：装了 N 次从没被引用过的知识卡 ──────────────────────
  for (const kb of summary.knowledge) {
    if (kb.offered < minSamples || kb.used > 0) continue;
    if (kb.id.startsWith("内部/") || kb.id.includes("/")) {
      // 上游产物路径不是知识卡，跳过（它们由 R5 消费规则管）
      if (!kb.id.startsWith("kb/")) continue;
    }
    const owners = kitReg.all()
      .flatMap((k) => Object.entries(k.ops).map(([opId, op]) => ({ kit: k.id, op: opId, refs: op.knowledge ?? [] })))
      .filter((o) => o.refs.includes(kb.id));
    for (const o of owners) {
      push({
        id: `R1@${o.kit}.${o.op}:${kb.id}`,
        rule: "R1-ctx-dead",
        severity: "low",
        risk: "low",
        title: `移除死条款：${o.kit}.${o.op} 的 ${kb.id}`,
        reason: `该条款装载 ${kb.offered} 次、被产物引用 0 次——占上下文预算却不参与判断。要么删，要么改写成能被引用的形式（如并入更相关的卡）。`,
        evidence: { rule: "R1-ctx-dead", metric: "ctx.hitRate", value: kb.hitRate, samples: kb.offered },
        patch: {
          kind: "set-tool", kit: o.kit, op: o.op, remove_knowledge: [kb.id],
          reason: `装载 ${kb.offered} 次零命中，移出标尺节省上下文预算`,
          evidence: { rule: "R1-ctx-dead", metric: "ctx.hitRate", value: 0, samples: kb.offered },
        },
      });
    }
  }

  // ── R2 标尺饥荒：打回高 + 命中率低 → 补条款 ────────────────────
  for (const [key, t] of Object.entries(summary.byTool)) {
    if (t.submits < minSamples || t.hitRate >= 0.4 || blockRate(t) < 0.3) continue;
    const [kitId, opId] = key.split(".");
    const op = kitReg.resolve(kitId, opId);
    if (!op) continue;
    const have = new Set(op.knowledge);
    const dims = new Set(kbIndex.filter((e) => have.has(e.id)).map((e) => e.dimension).filter(Boolean));
    const cand = kbIndex
      .filter((e) => e.id.startsWith("kb/") && !have.has(e.id) && (dims.size === 0 || dims.has(e.dimension)))
      .slice(0, 2)
      .map((e) => e.id);
    if (!cand.length) continue;
    push({
      id: `R2@${key}`,
      rule: "R2-ctx-starved",
      severity: "high",
      risk: "medium",
      title: `标尺饥荒：${key} 补装 ${cand.join("、")}`,
      reason: `打回率 ${(blockRate(t) * 100).toFixed(0)}% 且标尺命中率仅 ${(t.hitRate * 100).toFixed(0)}%——判断失准更像"没有判据"而非"能力不足"，先补条款再考虑升档。`,
      evidence: { rule: "R2-ctx-starved", metric: "asserts.blockRate", value: Number(blockRate(t).toFixed(3)), samples: t.submits },
      patch: {
        kind: "set-tool", kit: kitId, op: opId, add_knowledge: cand,
        reason: "高频打回 + 低命中：补同维度条款作为判据",
        evidence: { rule: "R2-ctx-starved", metric: "asserts.blockRate", value: Number(blockRate(t).toFixed(3)), samples: t.submits },
      },
    });
  }

  // ── R3 / R4 档位：打回高则该升档，零打回且贵则该降档 ─────────────
  const costs = Object.values(summary.byTool).map((t) => t.cost).sort((a, b) => a - b);
  const medianCost = costs.length ? costs[Math.floor(costs.length / 2)] : 0;
  for (const [key, t] of Object.entries(summary.byTool)) {
    const [kitId, opId] = key.split(".");
    const op = kitReg.resolve(kitId, opId);
    if (!op || t.submits < minSamples) continue;
    const tier = op.modelTier ?? "high";
    if (blockRate(t) >= 0.3 && tier !== "high") {
      push({
        id: `R3@${key}`, rule: "R3-tier-up", severity: "high", risk: "low",
        title: `档位偏轻：${key} 升到 high`,
        reason: `打回率 ${(blockRate(t) * 100).toFixed(0)}%（样本 ${t.submits}）——该 tool 承担的是判断类工作，轻量档出的错会一路放大。`,
        evidence: { rule: "R3-tier-up", metric: "asserts.blockRate", value: Number(blockRate(t).toFixed(3)), samples: t.submits },
        patch: {
          kind: "set-tool", kit: kitId, op: opId, model_tier: "high",
          reason: "打回率高，判断类工作不适合轻量档",
          evidence: { rule: "R3-tier-up", metric: "asserts.blockRate", value: Number(blockRate(t).toFixed(3)), samples: t.submits },
        },
      });
    } else if (blockRate(t) === 0 && t.hitRate >= 0.5 && t.cost > medianCost && tier === "high") {
      push({
        id: `R4@${key}`, rule: "R4-tier-down", severity: "medium", risk: "medium",
        title: `成本偏高：${key} 可试降 lite`,
        reason: `零打回、标尺命中 ${(t.hitRate * 100).toFixed(0)}%、成本居同域中位之上——先用一轮 lite 验证产物是否退化，退化即回滚（overlay 可 revert）。`,
        evidence: { rule: "R4-tier-down", metric: "efficiency", value: Number(t.efficiency.toFixed(4)), samples: t.submits },
        patch: {
          kind: "set-tool", kit: kitId, op: opId, model_tier: "lite",
          reason: "零打回且成本高，试降档（一轮验证，退化即回滚）",
          evidence: { rule: "R4-tier-down", metric: "cost", value: Number(t.cost.toFixed(2)), samples: t.submits },
        },
      });
    }
  }

  // ── R5 冷 tool：产物从没被下游消费过 ──────────────────────────
  if (pruningAllowed) {
    for (const s of Object.values(summary.byNode) as NodeStats[]) {
      if (s.submits < 2 || s.consumedBy > 0) continue;
      if (delivery.has(s.nodeId) || isBoundaryGate(nodes[s.nodeId])) continue;
      if (!nodes[s.nodeId]) continue;
      push({
        id: `R5@${s.nodeId}`, rule: "R5-prune-cold", severity: "medium", risk: "medium",
        title: `裁掉冷 tool：${s.nodeId}`,
        reason: `该 tool 跑了 ${s.submits} 次，产物被下游引用 0 次（成本 ${s.cost.toFixed(1)}）——它目前在流水线里是空转。裁掉或换 op（set-op）都行，先别留着。`,
        evidence: { rule: "R5-prune-cold", metric: "consumedBy", value: 0, samples: s.submits },
        patch: {
          kind: "remove-node", id: s.nodeId, rewire: "bridge",
          reason: `产物零消费，成本 ${s.cost.toFixed(1)}，移出编排（入边桥接到出边下游）`,
          evidence: { rule: "R5-prune-cold", metric: "consumedBy", value: 0, samples: s.submits },
        },
      });
    }
  }

  // ── R6 旧门清场：图上不该再常驻评审节点 ─────────────────────────
  // 判据分两类，样本门槛不同：
  //   · 纯汇合点（无产活）：它没产出任何东西，价值为零是**构造性的**，不需要样本即可提案；
  //   · 带产活的门（评审步）：必须先跑够样本才能说「它的产物没人要」——零样本时我们什么都不知道，
  //     此时提案等于凭格式猜，会把有效质量信号删掉。这是 optimizer 最容易犯的错。
  for (const [id, n] of Object.entries(nodes)) {
    if (n.kind !== "gate" || isBoundaryGate(n)) continue;
    const st = summary.byNode[id];
    const work = isWorkGate(n);
    const submits = st?.submits ?? 0;
    const consumedBy = st?.consumedBy ?? 0;
    if (work) {
      if (submits < minSamples) continue;      // 样本不足：不下结论
      if (consumedBy > 0) continue;            // 有人消费：留着（它还有信息价值，只是裁决自动）
    }
    const why = work
      ? `带产活的评审步（产物 ${n.output ?? "-"}）跑了 ${submits} 次，被下游引用 ${consumedBy} 次——它写的意见书没人消费，占着串行位`
      : `纯汇合点，无产活、无裁决价值（R5 起域内质量由各 tool 的 asserts/config 承担）`;
    const metricName = work ? "consumedBy" : "gate.node";
    const metricValue = work ? consumedBy : (n.title ?? id);
    const evidence = { rule: "R6-autogate-cleanup", metric: metricName, value: metricValue, samples: submits };
    push({
      id: `R6@${id}`, rule: "R6-autogate-cleanup", severity: "low", risk: "low",
      title: `清掉旧评审节点：${id}`,
      reason: `R5 起域内质量由各 tool 的 asserts/config 承担，图上不再需要固定评审节点。${why}。裁掉后编排更短、更少串行屏障。`,
      evidence,
      patch: {
        kind: "remove-node", id, rewire: "bridge",
        reason: work ? "R5：该评审步的产物无人消费，裁掉" : "R5 门降级：纯汇合点不再需要常驻图上",
        evidence,
      },
    });
  }

  // ── R7 边界验收降噪：连续全过 → 转 auto ────────────────────────
  for (const g of summary.gates) {
    if (!g.nodeId.startsWith(BOUNDARY_PREFIX)) continue;
    if (g.samples < minSamples || g.sendBacks > 0) continue;
    if ((policy.kit_boundary ?? DEFAULT_POLICY.kit_boundary) === "auto") continue;
    push({
      id: `R7@${g.nodeId}`, rule: "R7-boundary-auto", severity: "medium", risk: "low",
      title: `边界验收降噪：${g.nodeId} 连续 ${g.samples} 次全过`,
      reason: `该交界已经稳定（${g.samples} 次零打回），人工验收的价值递减——转 auto 后仅在跨界风险升高时才拦人。人工预算留给真正的新交界。`,
      evidence: { rule: "R7-boundary-auto", metric: "boundary.sendBacks", value: 0, samples: g.samples },
      patch: {
        kind: "set-policy", key: "kit_boundary", value: "auto",
        reason: `边界 ${g.nodeId} 连续 ${g.samples} 次零打回，降噪为 auto`,
        evidence: { rule: "R7-boundary-auto", metric: "boundary.sendBacks", value: 0, samples: g.samples },
      },
    });
  }

  // ── R9 热门 tool 加深度：被高频消费 → 值得给更多预算 ─────────────
  for (const s of Object.values(summary.byNode) as NodeStats[]) {
    const n = nodes[s.nodeId];
    if (!n || n.kind !== "agent") continue;
    if (s.consumedBy < 2 || s.hitRate < 0.6) continue;
    if ((n.config ?? {}).depth === "深") continue;
    push({
      id: `R9@${s.nodeId}`, rule: "R9-hot-depth", severity: "low", risk: "low",
      title: `热门 tool 加注：${s.nodeId} depth → 深`,
      reason: `产物被下游引用 ${s.consumedBy} 次、标尺命中 ${(s.hitRate * 100).toFixed(0)}%——它是流水线的承重墙，投入深度回报最高。`,
      evidence: { rule: "R9-hot-depth", metric: "consumedBy", value: s.consumedBy, samples: s.submits },
      patch: {
        kind: "set-node", id: s.nodeId, config: { depth: "深" },
        reason: `下游引用 ${s.consumedBy} 次，提高本步投入深度`,
        evidence: { rule: "R9-hot-depth", metric: "consumedBy", value: s.consumedBy, samples: s.submits },
      },
    });
  }

  // 排序：severity desc → risk asc
  const sev = { high: 0, medium: 1, low: 2 } as const;
  const rk = { low: 0, medium: 1, high: 2 } as const;
  return out.sort((a, b) => sev[a.severity] - sev[b.severity] || rk[a.risk] - rk[b.risk] || a.id.localeCompare(b.id));
}

export interface OptimizeReport {
  format: "optimize@1";
  flowId: string;
  at: string;
  policy: FlowPolicy;
  metrics: { events: number; window: { from?: string; to?: string } };
  /** 提案来源：metrics=确定性规则；miner=编排挖掘师（质性，逐条带证据，risk 恒 medium） */
  sources: ("metrics" | "miner")[];
  /** 挖掘师的结构类拍板项（改骨架的想法不进 overlay，只进这份清单等人拍板） */
  mineStructural: { id: string; title: string; structural: string; evidence: MinerEvidence[] }[];
  proposals: Proposal[];
}

export function buildReport(
  flow: FlowDescriptor,
  summary: MetricsSummary,
  policy: FlowPolicy,
  proposals: Proposal[],
  extra: { sources?: ("metrics" | "miner")[]; mineStructural?: OptimizeReport["mineStructural"] } = {},
): OptimizeReport {
  return {
    format: "optimize@1",
    flowId: flow.id,
    at: nowIso(),
    policy,
    metrics: { events: summary.events, window: summary.window },
    sources: extra.sources ?? ["metrics"],
    mineStructural: extra.mineStructural ?? [],
    proposals,
  };
}

/**
 * 提案 → overlay（规范 R5 §六）：`adapt` 决定自动化的边界。
 *   off      → 不产出（只观测）
 *   propose  → 全部 status="proposed"，等人在前端/CLI 批
 *   apply    → risk=low 直接 applied，其余仍 proposed
 * 注意：**没有任何策略能让 risk≥medium 的改动自动落地**——那类改动会改变编排结构，
 * 必须有人（或明确授权的优化 agent 会话）点头。
 */
export function overlayFromProposals(
  proposals: Proposal[],
  opts: { flowId: string; adapt?: FlowPolicy["adapt"]; reason?: string },
): FlowOverlay {
  const adapt = opts.adapt ?? DEFAULT_POLICY.adapt;
  const auto = (p: Proposal): boolean =>
    adapt === "apply" && p.risk === "low" && !isStructuralPatch(p.patch);
  const patches: OverlayPatch[] = proposals.map((p) => ({
    ...p.patch,
    proposal: p.id,
    status: auto(p) ? "applied" : "proposed",
  }));
  return {
    format: "flow-overlay@1",
    flowId: opts.flowId,
    origin: "optimizer",
    reason: opts.reason ?? `优化器提案 ${patches.length} 条（adapt=${adapt}）`,
    patches,
  };
}

/* ============================================================================
 * R5 §六补强（编排挖掘师）：质性通道。
 * proposeFromMetrics 只看得见数字；journal / 批注 / 打回根因 / 中间文件里的「为什么」
 * 由通用 Skill orchestration-miner 挖掘，产出 findings@1（每条带可溯源证据）。
 * 这里的职责只有一个：**把质性发现翻译成与确定性提案同一套契约**——
 *   · 带 patch 且非结构类 → Proposal（risk 一律 medium：LLM 的建议不享受 low 的自动落地）
 *   · 结构类 / 无 patch   → 只进拍板清单（mineStructural），永远不变成 overlay
 * 红线同 §六：挖掘师提建议，不落地；落地权在 flow_overlay 的人批。
 * ==========================================================================*/

export interface MinerEvidence {
  source: string; // "journal:<行号>" | "artifact:<项目相对路径>" | "metrics:<字段>" | "comment:<文件>"
  quote: string; // ≤120 字引文/事实
}

export interface MinerFinding {
  id: string; // 建议格式 M<维度>@<目标>，如 Mctx@search.find-trope
  dimension: "ctx" | "coverage" | "structure" | "quality" | "cost";
  severity: "high" | "medium" | "low";
  title: string;
  reason: string;
  evidence: MinerEvidence[];
  /** 非结构类改动才允许给 patch（OverlayPatch 子集）；结构类想法写 structural 字段 */
  patch?: OverlayPatch;
  /** 结构类改动的拍板项描述（如「把 S2/S3 的断言步并行」）——只进拍板清单，不进 overlay */
  structural?: string;
}

export interface MinerFindingsFile {
  format: "miner-findings@1";
  flowId: string;
  runId?: string;
  at: string;
  findings: MinerFinding[];
}

export function readMinerFindings(root: string, flowId: string): { file: MinerFindingsFile; path: string } | null {
  const p = path.join(root, "registry", "miner-findings.json");
  if (!fs.existsSync(p)) return null;
  let raw: MinerFindingsFile;
  try {
    raw = JSON.parse(fs.readFileSync(p, "utf-8")) as MinerFindingsFile;
  } catch {
    throw new Error(`miner-findings.json 不可解析（须为 findings@1 JSON）`);
  }
  if (raw.format !== "miner-findings@1") throw new Error(`miner-findings.json format 非法: ${String(raw.format)}`);
  if (raw.flowId !== flowId) throw new Error(`miner-findings.json 属于流 ${raw.flowId}，当前流 ${flowId}`);
  return { file: raw, path: p };
}

const SEV_RANK = { high: "high", medium: "medium", low: "low" } as const;
const DIM_LABEL = { ctx: "上下文命中", coverage: "规则覆盖", structure: "编排结构", quality: "产物质量", cost: "成本" } as const;

/** findings → 与确定性提案同一套契约的 Proposal 列表 + 结构类拍板清单。 */
export function minerToProposals(
  file: MinerFindingsFile,
): { proposals: Proposal[]; structural: { id: string; title: string; structural: string; evidence: MinerEvidence[] }[] } {
  const proposals: Proposal[] = [];
  const structural: { id: string; title: string; structural: string; evidence: MinerEvidence[] }[] = [];
  for (const f of file.findings ?? []) {
    const ev = (f.evidence ?? []).map((e) => `${e.source}：${e.quote}`).join("；");
    if (f.patch && !f.structural && !isStructuralPatch(f.patch)) {
      proposals.push({
        id: f.id.startsWith("M") ? f.id : `M@${f.id}`,
        rule: `M-${f.dimension}`,
        severity: SEV_RANK[f.severity] ?? "medium",
        risk: "medium", // 质性发现不享受 low 的自动落地——人批才生效
        title: `[挖掘·${DIM_LABEL[f.dimension] ?? f.dimension}] ${f.title}`,
        reason: `${f.reason}${ev ? `（证据：${ev}）` : ""}`,
        evidence: { rule: `M-${f.dimension}`, metric: "miner.evidence", value: (f.evidence ?? []).length, samples: (f.evidence ?? []).length },
        patch: f.patch,
      });
    } else {
      structural.push({
        id: f.id.startsWith("M") ? f.id : `M@${f.id}`,
        title: f.title,
        structural: f.structural ?? f.reason ?? "",
        evidence: f.evidence ?? [],
      });
    }
  }
  return { proposals, structural };
}
