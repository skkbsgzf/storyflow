// kernel-effect.ts —— 生效编排/指标的只读效果视图（flow_effect）。
//
// 批1 出清（2026-10-14 决议 §二.2）：本文件原有 flowOptimize / flowMine / flowOverlay 三个
// 「引擎自己改自己编排」的入口（提案自动落地、挖掘包组装、overlay 运行时改写），已随
// optimize.ts 与三个动词一并删除。编排改写的唯一入口回到声明面（flows/ + modules/），
// 判断权归宿主——引擎不再拥有自己运行时的改写能力。

import { artifactPathOf } from "./minitools.js";
import { loadState } from "./state.js";
import { readMetrics, summarizeMetrics } from "./metrics.js";
import { summarizeDiags } from "./diag.js";
import { resolveBudget } from "./budget.js";
import type { Kernel } from "./kernel.js";
import { KernelError } from "./kernel-base.js";

/**
 * 效果视图（只读）：重算并落生效编排读模型 + 指标汇总，回显指标/诊断/悬置门。
 * 本函数不写 overlay、不产提案——它只把已经发生的事实汇总一遍。
 */
export function viewEffect(kernel: Kernel, projectId: string) {
  const projectDir = kernel.projectDir(projectId);
  const state = loadState(projectDir, kernel.fs, kernel.path);
  if (!state) throw new KernelError("NO_RUN", 404, `项目无 state.json: ${projectId}`);
  const raw = kernel.loadFlow(state.flowId);
  const eff = kernel.effectiveOf(projectDir, raw, state.preset);
  kernel.persistEffective(projectDir, eff, state);
  kernel.persistMetricsSummary(projectDir, state, eff);
  const events = readMetrics(kernel, projectDir);
  const pathToNode: Record<string, string> = {};
  for (const id of Object.keys(eff.flow.graph.nodes)) {
    const p = artifactPathOf(eff.flow, id);
    if (p) pathToNode[p] = id;
  }
  const summary = summarizeMetrics(events, { pathToNode, budget: resolveBudget(eff.policy).values });
  // 验收门悬置提醒（挖掘 M3）：gate-open 超 24h 无人裁决 → due 列表置顶提示。
  // 依据 journal 最近一次 gate-open 时间；project status 已 completed 的不再提示。
  const gatesDue: { nodeId: string; openAt: string; hours: number }[] = [];
  if (state.status !== "completed") {
    try {
      const jlines = kernel.fs.readText(kernel.path.join(projectDir, "journal.jsonl")).split("\n");
      const lastOpenAt: Record<string, string> = {};
      for (const l of jlines) {
        if (!l.trim()) continue;
        try {
          const e = JSON.parse(l) as { ts?: string; event?: string; nodeId?: string; detail?: string };
          if (e.event === "gate-open" && e.nodeId && e.ts) lastOpenAt[e.nodeId] = e.ts;
        } catch {
          /* 半行跳过 */
        }
      }
      for (const [nid, ns] of Object.entries(state.nodes ?? {})) {
        if (ns.status !== "awaiting") continue;
        const openAt = lastOpenAt[nid] ?? (state.gate?.node === nid ? state.gate.at : undefined);
        if (!openAt) continue;
        const hours = (Date.now() - Date.parse(openAt)) / (3600 * 1000);
        if (hours >= 24) gatesDue.push({ nodeId: nid, openAt, hours: Math.round(hours) });
      }
      gatesDue.sort((a, b) => b.hours - a.hours);
    } catch {
      /* journal 缺失 = 无提醒（旁路） */
    }
  }
  // R8-OPS 诊断通道：旁路失败不再静默——指标/扫描器/知识库台账的读取失败在此汇总暴露。
  // `count > 0` 意味着"本项目的某个结论可能不可信"。
  const diagnostics = summarizeDiags(kernel, projectDir);
  return {
    projectId,
    flowId: eff.flow.id,
    policy: eff.policy,
    overlayHash: eff.overlayHash,
    planHash: state.planHash,
    boundaries: eff.boundaries,
    composition: eff.notes,
    applied: eff.appliedCount,
    metrics: { events: events.length, window: summary.window, byTool: summary.byTool, knowledge: summary.knowledge, gates: summary.gates },
    diagnostics,
    gatesDue,
  };
}
