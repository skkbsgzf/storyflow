// kernel-optimize.ts —— 效果视图 / 优化提案落地 / 挖矿 / overlay 变更（从 kernel.ts 拆出，委托见 kernel.ts）。

import fs from "node:fs";
import path from "node:path";
import type { FlowDescriptor, RunState, TaskPackage, Validation } from "./types.js";
import { ROOT, assertSchema } from "./schema.js";
import { atomicWriteText, LockDir } from "./fsio.js";
import { listDecisions, setDecision, decisionsDir } from "./decisions.js";
import { gateToken, nowIso } from "./ids.js";
import { compilePlan, PlanCycleError, upstreamOf } from "./plan.js";
import { resolveInputs, evalWhen, isBackEdge, condContextOf, pendingInstancesOf, type CondContext } from "./cond.js";
import {
  freshState, loadState, saveState, migrateRunState, writeJournalSeed,
  legacyStatePath, planDrifted,
} from "./state.js";
import { journalAppend, journalQuery } from "./journal.js";
import {
  makeArtifact, captureSnapshot, inputFingerprint, listArtifacts, readRegisteredText, readSnapshots,
} from "./registry.js";
import { runIntegrityAsserts, runHeaderAsserts, blocked, checkGlossary, dedupeValidations } from "./asserts.js";
import { runCoreNode, artifactPathOf, nodeOutput, outputPathOf } from "./minitools.js";
import { buildTaskPackage, effectiveUpstreams, resolveNodeOp } from "./assembler.js";
import { effectiveFlow3 } from "./modules.js";
import { resolveBudget } from "./budget.js";
import { renderSpawnPrompt } from "./spawn.js";
import { loadProjectConfig, configToInputs, configBudget, type ProjectConfig } from "./project-config.js";
import { listConfigTemplates } from "./cfg-template.js";
import type { BatchEntry, FlowNode, MetricPhase, RunMetric } from "./types.js";
import {
  effectiveFlow, isBoundaryGate, isWorkGate, factoryOverlayPath, projectOverlayPath, readOverlay, writeProjectOverlay,
  type EffectiveFlow, type FlowOverlay, type FlowPolicy, type OverlayPatch,
} from "./overlay.js";
import { recordMetric, readMetrics, summarizeMetrics, extractCtxUsage } from "./metrics.js";
import { recordDiag, summarizeDiags } from "./diag.js";
import { proposeFromMetrics, buildReport, overlayFromProposals, readMinerFindings, minerToProposals } from "./optimize.js";
import { resolveToolConfig } from "./kits.js";
import { fnv1a, stableStringify } from "./ids.js";
import type { Kernel, AdvanceStop, GateRequest } from "./kernel.js";
import { KernelError } from "./kernel-base.js";
import { advance } from "./kernel-run.js";
export function viewEffect(kernel: Kernel, projectId: string) {
    const projectDir = kernel.projectDir(projectId);
    const state = loadState(projectDir);
    if (!state) throw new KernelError("NO_RUN", 404, `项目无 state.json: ${projectId}`);
    const raw = kernel.loadFlow(state.flowId);
    const eff = kernel.effectiveOf(projectDir, raw, state.preset);
    kernel.persistEffective(projectDir, eff, state);
    kernel.persistMetricsSummary(projectDir, state, eff);
    const events = readMetrics(projectDir);
    const pathToNode: Record<string, string> = {};
    for (const id of Object.keys(eff.flow.graph.nodes)) {
      const p = artifactPathOf(eff.flow, id);
      if (p) pathToNode[p] = id;
    }
    const summary = summarizeMetrics(events, { pathToNode, budget: resolveBudget(eff.policy).values });
    const overlay = readOverlay(projectOverlayPath(projectDir));
    // 编排挖掘提示（R5 §六 质性通道）：距上次挖掘又积累了一轮运行 → 建议跑 flow_mine
    let mine: { due: boolean; events: number; eventsAtLastMine: number; lastMinedAt?: string } = {
      due: false,
      events: events.length,
      eventsAtLastMine: 0,
    };
    try {
      const ms = JSON.parse(fs.readFileSync(path.join(projectDir, "registry", "miner-state.json"), "utf-8")) as {
        eventsAtMine?: number;
        lastMinedAt?: string;
      };
      const at = ms.eventsAtMine ?? 0;
      mine = { due: events.length >= 8 && events.length > at, events: events.length, eventsAtLastMine: at, lastMinedAt: ms.lastMinedAt };
    } catch {
      mine = { due: events.length >= 8, events: events.length, eventsAtLastMine: 0 };
    }
    // 验收门悬置提醒（挖掘 M3）：gate-open 超 24h 无人裁决 → due 列表置顶提示。
    // 依据 journal 最近一次 gate-open 时间；project status 已 completed 的不再提示。
    const gatesDue: { nodeId: string; openAt: string; hours: number }[] = [];
    if (state.status !== "completed") {
      try {
        const jlines = fs.readFileSync(path.join(projectDir, "journal.jsonl"), "utf-8").split("\n");
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
        const DAY = 24 * 3600 * 1000;
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
    // 页面与 flow_effect 都消费它；`count > 0` 意味着"本项目的某个结论可能不可信"。
    const diagnostics = summarizeDiags(projectDir);
    return {
      projectId,
      flowId: eff.flow.id,
      policy: eff.policy,
      overlayHash: eff.overlayHash,
      planHash: state.planHash,
      boundaries: eff.boundaries,
      composition: eff.notes,
      applied: eff.appliedCount,
      overlay: overlay ? { origin: overlay.origin, patches: overlay.patches, history: overlay.history ?? [] } : null,
      metrics: { events: events.length, window: summary.window, byTool: summary.byTool, knowledge: summary.knowledge, gates: summary.gates },
      diagnostics,
      mine,
      gatesDue,
    };
  }

  /** R5 优化：由指标产出提案（写 registry/optimize.json）；`--apply` 落成 overlay（低风险自动，其余待批）。
   *  WO-挖掘：registry/miner-findings.json（编排挖掘师产物，flow_mine → Skill → findings@1）存在时并入：
   *  非结构类 finding → M@ 提案（risk 恒 medium，人批才落地）；结构类 → report.mineStructural 拍板清单。 */

export function flowOptimize(kernel: Kernel, projectId: string, opts: { apply?: boolean; actor?: string } = {}) {
    const projectDir = kernel.projectDir(projectId);
    const state = loadState(projectDir);
    if (!state) throw new KernelError("NO_RUN", 404, `项目无 state.json: ${projectId}`);
    const raw = kernel.loadFlow(state.flowId);
    const eff = kernel.effectiveOf(projectDir, raw, state.preset);
    const pathToNode: Record<string, string> = {};
    for (const id of Object.keys(eff.flow.graph.nodes)) {
      const p = artifactPathOf(eff.flow, id);
      if (p) pathToNode[p] = id;
    }
    const summary = summarizeMetrics(readMetrics(projectDir), { pathToNode, budget: resolveBudget(eff.policy).values });
    const proposals = proposeFromMetrics(eff.flow, summary, { root: kernel.repoRoot, policy: eff.policy });
    let sources: ("metrics" | "miner")[] = ["metrics"];
    let mineStructural: ReturnType<typeof minerToProposals>["structural"] = [];
    const mine = readMinerFindings(kernel.repoRoot, eff.flow.id) ?? readMinerFindings(projectDir, eff.flow.id);
    if (mine) {
      const mp = minerToProposals(mine.file);
      const known = new Set(proposals.map((p) => p.id));
      proposals.push(...mp.proposals.filter((p) => !known.has(p.id)));
      mineStructural = mp.structural;
      sources = ["metrics", "miner"];
      // 消费游标：findings 已并入提案，挖掘状态推进到 consumed
      atomicWriteText(
        path.join(projectDir, "registry", "miner-state.json"),
        JSON.stringify({ eventsAtMine: summary.events, lastMinedAt: nowIso(), phase: "consumed", findings: mine.file.findings.length }, null, 2) + "\n",
      );
    }
    // W-06 批注接线：用户批注是负反馈的证据源——并入报告供优化 agent 消费（内核不做 LLM 转译）
    let userFeedback: { count: number; items: { id: string; node?: string; text: string }[] } | undefined;
    try {
      const annoPath = path.join(projectDir, "内部", "批注与意见.json");
      const items: { id: string; node?: string; text: string }[] = [];
      if (fs.existsSync(annoPath)) {
        const aj = JSON.parse(fs.readFileSync(annoPath, "utf-8")) as { annos?: Record<string, unknown>; comments?: Record<string, unknown> };
        for (const [k, v] of Object.entries(aj.annos ?? {})) {
          const t = typeof v === "string" ? v : ((v as { text?: string }).text ?? "");
          if (t) items.push({ id: k, node: typeof v === "object" ? (v as { node?: string }).node : undefined, text: String(t).slice(0, 200) });
        }
        for (const [k, v] of Object.entries(aj.comments ?? {})) {
          if (v) items.push({ id: k, text: String(v).slice(0, 200) });
        }
      }
      for (const [k, v] of Object.entries((state.comments as Record<string, unknown>) ?? {})) {
        if (v) items.push({ id: k, text: String(v).slice(0, 200) });
      }
      if (items.length) userFeedback = { count: items.length, items };
    } catch {
      /* 批注读取旁路 */
    }
    const report = {
      ...buildReport(eff.flow, summary, eff.policy, proposals, { sources, mineStructural }),
      ...(userFeedback ? { userFeedback } : {}),
    };
    fs.mkdirSync(path.join(projectDir, "registry"), { recursive: true });
    atomicWriteText(path.join(projectDir, "registry", "optimize.json"), JSON.stringify(report, null, 2) + "\n");
    let written: string | undefined;
    const adaptMode = eff.policy.adapt ?? "propose";
    if (opts.apply && proposals.length && adaptMode !== "off") {
      const ov = overlayFromProposals(proposals, { flowId: eff.flow.id, adapt: eff.policy.adapt });
      written = writeProjectOverlay(projectDir, ov, opts.actor ?? "optimizer", state.overlayHash, undefined);
      journalAppend(projectDir, state.runId, "note", {
        actor: opts.actor ?? "optimizer",
        detail: `优化提案落地 ${ov.patches.filter((p) => p.status === "applied").length} 条（adapt=${adaptMode}），其余 ${ov.patches.filter((p) => p.status === "proposed").length} 条待批；来源 ${sources.join("+")}；挖掘师结构类拍板项 ${mineStructural.length} 条未入 overlay`,
      });
    } else if (opts.apply && proposals.length && adaptMode === "off") {
      // N2：`adapt=off` = 只观测。**不落 overlay、也不许静默** —— 显式记一条 journal，
      // 否则「0 条落地」和「跑失败」在日志里长得一样。
      journalAppend(projectDir, state.runId, "note", {
        actor: opts.actor ?? "optimizer",
        detail: `adapt=off：只观测，不产出提案（观测到 ${proposals.length} 条，已记入 registry/optimize.json，未落 overlay）；来源 ${sources.join("+")}`,
      });
    }
    return { report, written, adapt: adaptMode, mineStructural };
  }

  /**
   * W-04 模块结果报告读模型（module-report@1）：模块收口（全部节点 done）即生成
   * registry/module-report-<mid>.json —— 产出物 + 验收三态 + 模块粒度指标 + 反馈计数。
   * 负反馈的人工入口：用户对着这份报告批注，批注经 flow_optimize 并入提案池。
   */

export function flowMine(kernel: Kernel, projectId: string) {
    const projectDir = kernel.projectDir(projectId);
    const state = loadState(projectDir);
    if (!state) throw new KernelError("NO_RUN", 404, `项目无 state.json: ${projectId}`);
    const raw = kernel.loadFlow(state.flowId);
    const eff = kernel.effectiveOf(projectDir, raw, state.preset);
    kernel.persistEffective(projectDir, eff, state);
    kernel.persistMetricsSummary(projectDir, state, eff);

    const journalRels: string[] = [];
    const journalEvents = journalQuery(projectDir, { limit: 400 });
    // 打回与裁决事件是挖掘的高价值区，单独归组
    const sendBacks = journalEvents.filter((e) => e.detail?.includes("打回") || e.detail?.includes("send-back"));
    const metricsEvents = readMetrics(projectDir);
    const minerStatePath = path.join(projectDir, "registry", "miner-state.json");
    let eventsAtMine = 0;
    try {
      eventsAtMine = (JSON.parse(fs.readFileSync(minerStatePath, "utf-8")) as { eventsAtMine?: number }).eventsAtMine ?? 0;
    } catch {
      /* 首次挖掘 */
    }

    // 证据文件清单：中间文件（内部/对外交付/世界书）+ 质量扫描/检查报告 + 批注（都给相对路径，挖掘师自行取阅）
    const evidence: string[] = [];
    const scan = (dir: string, cap: number): void => {
      const base = path.join(projectDir, dir);
      if (!fs.existsSync(base)) return;
      const walk = (d: string): void => {
        for (const f of fs.readdirSync(d)) {
          const abs = path.join(d, f);
          const st = fs.statSync(abs);
          if (st.isDirectory()) walk(abs);
          else if (/\.(md|json)$/i.test(f) && evidence.length < cap) evidence.push(path.relative(projectDir, abs).replaceAll("\\", "/"));
        }
      };
      walk(base);
    };
    scan(path.join("内部"), 120);
    scan(path.join("对外交付"), 60);
    scan(path.join("世界书"), 40);
    for (const extra of ["梗卡.md", "选题素材.md", "项目配置.json", path.join("内部", "批注与意见.json"), "registry/metrics-summary.json", "registry/effective.json", "registry/optimize.json"]) {
      if (fs.existsSync(path.join(projectDir, extra)) && !evidence.includes(extra)) evidence.unshift(extra);
    }

    const pkg = {
      format: "mine-package@1" as const,
      projectId,
      flowId: eff.flow.id,
      flowTitle: raw.title ?? eff.flow.id,
      version: raw.version ?? "",
      runId: state.runId,
      policy: eff.policy,
      boundaries: eff.boundaries,
      nodes: Object.fromEntries(Object.entries(eff.flow.graph.nodes).map(([id, n]) => [id, { kind: n.kind, kit: n.kit, op: n.op, title: n.title, output: n.output, config: n.config }])),
      sources: {
        journal: { path: "journal.jsonl", events: journalEvents.length, tail: journalEvents.slice(-60) },
        sendBacks: sendBacks.slice(-20),
        metrics: { path: "registry/metrics.jsonl", events: metricsEvents.length, eventsAtLastMine: eventsAtMine, summary: "registry/metrics-summary.json" },
        evidenceFiles: evidence,
        scanReports: evidence.filter((e) => e.includes("质量扫描")),
        comments: (state.comments ? Object.keys(state.comments).length : 0),
      },
      goals: ["上下文命中率（标尺被产物真正引用）", "规则语料激活质量（激活决策带证据、剔除有理由、装载有回显）", "编排结构（并行化/冷 tool/重复劳动）", "产物质量（反复重写/批注聚集/纯净度）", "成本（档位/深度/耗时）"],
      rules: [
        "每条 finding 必须带 evidence（journal 行/文件路径 + ≤120 字引文），无证据不立案",
        "patch 只允许非结构类（set-tool/set-node config/knowledge/policy）；结构类写 structural 字段进拍板清单",
        "扫描器输出只是证据不是判决；不许把语义规则『补』成机器闸（v5.0：提交链无断言闸，判决归 agent 与人）",
        "不自动落地：落地权在 flow_overlay 的人批",
      ],
    };
    fs.mkdirSync(path.join(projectDir, "registry"), { recursive: true });
    atomicWriteText(path.join(projectDir, "registry", "mine-package.json"), JSON.stringify(pkg, null, 2) + "\n");
    // 挖掘游标：组装即记账，flow_effect 的 mine.due 据此判断「又积累了一轮」
    atomicWriteText(minerStatePath, JSON.stringify({ eventsAtMine: metricsEvents.length, lastMinedAt: nowIso(), phase: "packaged", runId: state.runId }, null, 2) + "\n");
    journalAppend(projectDir, state.runId, "note", {
      actor: "kernel:mine",
      detail: `编排挖掘包已组装（journal ${journalEvents.length} 事件 / 证据文件 ${evidence.length} 件 / 打回记录 ${sendBacks.length} 条）`,
      refs: ["registry/mine-package.json"],
    });
    const spawnPrompt = [
      `你是编排挖掘师（skills/orchestration-miner.md）。`,
      `任务：通读 ${projectId}（${pkg.flowTitle} v${pkg.version}）的挖掘包 registry/mine-package.json 与其引用的证据文件，`,
      `对刚才结束的运行做事后挖掘：上下文命中、规则覆盖、编排结构、产物质量、成本五个维度逐一过，`,
      `产出 registry/miner-findings.json（findings@1，每条带可溯源证据）+ 人读报告 内部/意见/编排挖掘-${state.runId}.md。`,
      `红线：只提案不落地；结构类改动只进拍板清单；无证据不立案。`,
    ].join("");
    return { package: pkg, packagePath: "registry/mine-package.json", spawnPrompt };
  }

  /**
   * R5 编排改写（人 / 优化 agent 共用入口）：写 registry/overlay.json。
   * `approve`：把先前 proposed 的提案按 id 批准为 applied；`replan`：立即重编译计划。
   */

export async function flowOverlay(kernel: Kernel,
    projectId: string,
    req: { patches?: OverlayPatch[]; approve?: string[]; actor?: string; reason?: string; replan?: boolean },
  ): Promise<{ file?: string; applied: number; proposed: number; stop?: AdvanceStop }> {
    const projectDir = kernel.projectDir(projectId);
    const state = loadState(projectDir);
    if (!state) throw new KernelError("NO_RUN", 404, `项目无 state.json: ${projectId}`);
    const raw = kernel.loadFlow(state.flowId);
    const prev = readOverlay(projectOverlayPath(projectDir));
    const hashBefore = state.overlayHash;

    const next: FlowOverlay = {
      format: "flow-overlay@1",
      flowId: raw.id,
      origin: "user",
      reason: req.reason ?? "人工/agent 编排改写",
      patches: [...(prev?.patches ?? [])],
    };
    const approve = new Set(req.approve ?? []);
    if (approve.size) {
      for (const p of next.patches) {
        const pid = (p as { proposal?: string }).proposal;
        if (pid && approve.has(pid)) p.status = "applied";
      }
    }
    if (req.patches?.length) next.patches.push(...req.patches);

    const applied = next.patches.filter((p) => !p.status || p.status === "applied").length;
    const proposed = next.patches.length - applied;
    const file = writeProjectOverlay(projectDir, next, req.actor ?? "user", hashBefore, undefined);
    journalAppend(projectDir, state.runId, "note", {
      actor: req.actor ?? "user",
      detail: `编排改写：applied ${applied} / proposed ${proposed}${req.reason ? `｜${req.reason}` : ""}`,
    });
    if (!req.replan) {
      // 改写即刷新读模型：页面/优化 agent 下一次读到的必须是改后的编排，而不是改前快照
      const eff0 = kernel.effectiveOf(projectDir, raw, state.preset);
      kernel.persistEffective(projectDir, eff0, state);
      kernel.persistMetricsSummary(projectDir, state, eff0);
      return { file, applied, proposed };
    }
    const eff = kernel.effectiveOf(projectDir, raw, state.preset);
    kernel.persistEffective(projectDir, eff, state);
    state.overlayHash = "force-replan"; // 触发 replan 分支（真实哈希由 replan 写回）
    state.status = "running";
    const lock = kernel.acquireLock(projectDir);
    try {
      const stop = await advance(kernel, projectId, state, projectDir, raw);
      void eff;
      return { file, applied, proposed, stop };
    } finally {
      lock.release();
    }
  }

  /** 活跃前向边视角的上游表（与 compilePlan 同一过滤：loop 剔除、gate 绑定裁剪、when 裁剪、节点级 when）。 */
