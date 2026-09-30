// kernel-run.ts —— 七动词运行引擎（flow_list/run/next/submit/resume/gate/rerun + advance/metric/门裁决）。
// 从 kernel.ts 拆出：方法体实现为 free function（kernel: Kernel 显式传参），kernel.ts 保留同名委托与 JSDoc 契约。
// Kernel 仅 type 引入——运行时依赖单向（kernel.ts → 本文件），无环。

import type { FlowDescriptor, RunState, TaskPackage, Validation } from "./types.js";
import { ROOT, assertSchema } from "./schema.js";
import type { LockDir } from "./abstraction/jsonio.js";
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
import { applyGatePreset, gateContext } from "./assertion-preset/executor.js";
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

/**
 * 提交链检查指标（v5.0：断言协议退役，只剩确定性完整性检查的计数）。
 * 旧写法 `pass: problems.length, block: 0` 是错报——把全部裁决算成通过、打回次数恒 0，
 * 直接污染优化器的成本口径（costOf 里的 checkBlock 溢价）与「这一步到底守住没」的判断。
 */
function checksCounts(
  problems: Validation[],
): { pass: number; block: number; warn: number; names: string[] } {
  return {
    pass: problems.filter((p) => p.status === "pass").length,
    block: problems.filter((p) => p.status === "block").length,
    warn: problems.filter((p) => p.status === "warn").length,
    names: [...new Set(problems.map((p) => p.name))],
  };
}

export function planHashOf(kernel: Kernel, order: string[], effective: FlowDescriptor, overlayHash: string): string {
    const shape = order.map((id) => {
      const n = effective.graph.nodes[id];
      return `${id}:${n?.kind}:${n?.kit ?? ""}.${n?.op ?? n?.minitool ?? ""}:${fnv1a(stableStringify(n?.config ?? {}))}`;
    });
    return fnv1a(stableStringify({ order: shape, overlayHash }));
  }

  // ---------- 七动词 ----------


export function flow_list(kernel: Kernel) {
    return kernel.listFlows();
  }


export async function flow_run(kernel: Kernel, flowId: string, projectId: string, inputs: Record<string, unknown> = {}, opts: { preset?: string } = {}): Promise<AdvanceStop> {
    const bootstrap = kernel.loadFlow(flowId);
    const projectDir = kernel.projectDir(projectId);
    if (loadState(projectDir, kernel.fs, kernel.path)) throw new KernelError("RUN_EXISTS", 409, `项目已有 state.json: ${projectId}`);
    // PP1 生产线预设：显式传入时必须存在（大声失败），选定后随 state.preset 持久——
    // 生效编排 = flow ⊕ 出厂 overlay ⊕ 预设 overlay ⊕ 项目 overlay（见 effectiveOf）。
    if (opts.preset && !kernel.listPresets().some((p) => p.id === opts.preset)) {
      throw new KernelError("INVALID_INPUT", 400, `生产线预设 "${opts.preset}" 不存在（可用：${kernel.listPresets().map((p) => p.id).join("、") || "无"}）`);
    }
    // R5：运行编排 = bootstrap ⊕ overlay ⊕ kit 边界派生（项目级 overlay 在此生效）
    const eff = kernel.effectiveOf(projectDir, bootstrap, opts.preset);
    const flow = eff.flow;
    // K1.5 项目初始化配置：合并序 = 显式入参 > 项目配置.json > flow 默认（配置非法开跑前大声失败）
    const cfg = readProjectConfig(kernel, projectDir);
    const cfgInputs = cfg ? configToInputs(cfg, flow) : {};

    // 现网 run-state.json 自动迁移（幂等入口）
    if (kernel.fs.exists(legacyStatePath(projectDir, kernel.path))) {
      const resolved = resolveInputs(flow, { ...cfgInputs, ...inputs }, { project: projectId });
      const { state, seedEvents } = migrateRunState(projectDir, projectId, flow, resolved, kernel.fs, kernel.path);
      if (cfg?.presets) state.presets = { ...state.presets, ...cfg.presets };
      if (opts.preset) state.preset = opts.preset;
      saveState(projectDir, state, kernel.fs, kernel.path);
      writeJournalSeed(projectDir, seedEvents, kernel.fs, kernel.path);
      journalAppend(kernel, projectDir, state.runId, "run-start", {
        actor: "kernel:migrate",
        detail: `迁移自 run-state.json（${flow.id}@${flow.version}），gate=${state.gate.verdict}`,
      });
      noteConfig(kernel, projectDir, state.runId, cfg);
      state.status = state.gate.verdict === "awaiting" ? "suspended" : "running";
      state.overlayHash = eff.overlayHash;
      state.policy = eff.policy as Record<string, unknown>;
      state.planHash = planHashOf(kernel, state.plan?.order ?? [], flow, eff.overlayHash);
      saveState(projectDir, state, kernel.fs, kernel.path);
      return advance(kernel, projectId, state, projectDir, bootstrap);
    }

    let resolved: Record<string, unknown>;
    try {
      resolved = resolveInputs(flow, { ...cfgInputs, ...eff.inputs, ...inputs }, { project: projectId }); // type:"project" 的输入由内核注入
    } catch (e) {
      throw new KernelError("INVALID_INPUT", 400, e instanceof Error ? e.message : String(e));
    }
    kernel.fs.mkdir(projectDir, { recursive: true });
    const state = freshState(flow, projectId, resolved);
    if (opts.preset) state.preset = opts.preset;
    seedPreferenceDecisions(kernel, flow, projectDir, resolved, state.runId);
    if (cfg?.presets) state.presets = { ...state.presets, ...cfg.presets };
    state.overlayHash = eff.overlayHash;
    state.policy = eff.policy as Record<string, unknown>;
    state.planHash = planHashOf(kernel, state.plan?.order ?? [], flow, eff.overlayHash);
    journalAppend(kernel, projectDir, state.runId, "run-start", { detail: `${flow.id}@${flow.version} 计划 ${state.plan?.order.length ?? 0} 节点` });
    if (eff.notes.length) {
      journalAppend(kernel, projectDir, state.runId, "note", { actor: "kernel:overlay", detail: `生效编排合成：${eff.notes.join(" ｜ ")}` });
    }
    noteConfig(kernel, projectDir, state.runId, cfg);
    saveState(projectDir, state, kernel.fs, kernel.path);
    return advance(kernel, projectId, state, projectDir, bootstrap);
  }

  /**
   * PP1 Phase 2 · 跨流水线级联（E2E 转换报告 chain-flow 的落地形态）。
   *
   * 为什么不是 overlay patch：overlay 只作用于**单条 flow 的编排组合**（模块裁剪/工具追加），
   * 「Flow A 的产物喂给 Flow B」是 run 级操作——需要新项目、素材在盘、双边接力留痕，patch 表达不了。
   * 落地形态 = 内核方法：把调用方点名的源项目产物**确定性搬运**到新项目的素材目录
   * （对齐 novel/screenplay `sourceMaterials` 的「在盘即声明：素材优先/验收+补全」语义），
   * 再以调用方显式给出的输入开跑目标流水线（preset 透传）。转换本身由目标流水线的
   * agent 步消费在盘素材完成——内核不做隐式转换（不猜值，与铁律 6 同源）。
   *
   * 接力可审计：源项目 journal 记 `chain-out`（搬了什么、去哪），目标项目记 `chain-in`（素材在盘、来自谁）。
   */
export async function flow_chain(
    kernel: Kernel,
    fromProjectId: string,
    toFlowId: string,
    opts: {
      /** 目标项目 id（缺省 `<源项目>.<toFlow>`） */
      projectId?: string;
      /** 目标流水线预设（透传 flow_run，PP1） */
      preset?: string;
      /** 目标 flow 输入（必填项须由调用方给足——内核不猜值） */
      inputs?: Record<string, unknown>;
      /** 要搬运的源产物（项目内相对路径；不传 = 只开跑不搬运） */
      copyArtifacts?: string[];
      /** 素材落点目录（缺省 "00-素材"，与 sourceMaterials 声明口径一致） */
      materialDir?: string;
    } = {},
  ): Promise<{ projectId: string; copied: string[]; stop: AdvanceStop }> {
    const fromDir = kernel.projectDir(fromProjectId);
    const fromState = loadState(fromDir, kernel.fs, kernel.path);
    if (!fromState) throw new KernelError("NO_RUN", 404, `源项目无 state.json: ${fromProjectId}`);
    const toProjectId = opts.projectId ?? `${fromProjectId}.${toFlowId}`;
    const toDir = kernel.projectDir(toProjectId);
    if (loadState(toDir, kernel.fs, kernel.path)) throw new KernelError("RUN_EXISTS", 409, `目标项目已有 state.json: ${toProjectId}`);

    const materialDir = `${(opts.materialDir ?? "00-素材").replaceAll("\\", "/").replace(/\/$/, "")}`;
    const copied: string[] = [];
    for (const rel of opts.copyArtifacts ?? []) {
      const src = kernel.path.join(fromDir, rel);
      if (!kernel.fs.exists(src)) {
        throw new KernelError("FILE_MISSING", 404, `源产物不存在: ${rel}（项目 ${fromProjectId}）`);
      }
      const dest = kernel.path.join(toDir, materialDir, rel);
      kernel.fs.mkdir(kernel.path.dirname(dest), { recursive: true });
      kernel.fs.copy(src, dest);
      copied.push(`${materialDir}/${rel.replaceAll("\\", "/")}`);
    }
    journalAppend(kernel, fromDir, fromState.runId, "chain-out", {
      detail: `级联 → ${toFlowId}（目标项目 ${toProjectId}）搬运 ${copied.length} 项产物`,
      refs: copied,
    });

    const stop = await flow_run(kernel, toFlowId, toProjectId, opts.inputs ?? {}, { preset: opts.preset });
    const toState = loadState(toDir, kernel.fs, kernel.path);
    if (toState) {
      journalAppend(kernel, toDir, toState.runId, "chain-in", {
        detail: `级联自 ${fromProjectId}（${fromState.flowId}@${fromState.flowVersion}）——素材 ${copied.length} 项在盘（${materialDir}/）`,
        refs: copied,
      });
    }
    return { projectId: toProjectId, copied, stop };
  }

  /**
   * R8 改点③：开跑先验 → 决策事实（单向桥）。`inputs.<k>.feeds_decision=<key>` 声明「这个输入的取值
   * 是某个选择面的先验」——人给了就在 decisions/ 落一条 by=user.preference 的决策，供候选池按标签过滤；
   * 人没给（required:false 缺席）不落不猜，等运行中的调研步 set_decision 补证据。
   * 铁律 6 的另一半：决策绝不写回 state.inputs（那是伪造历史），先验→决策才是合法方向。
   */

export function seedPreferenceDecisions(kernel: Kernel,
    flow: FlowDescriptor,
    projectDir: string,
    resolved: Record<string, unknown>,
    runId: string,
  ): void {
    for (const [key, def] of Object.entries(flow.inputs ?? {})) {
      const dkey = def.feeds_decision;
      const v = resolved[key];
      if (!dkey || v === undefined || v === null || v === "") continue;
      if (kernel.fs.exists(kernel.path.join(decisionsDir(kernel, projectDir), `${dkey}.json`))) continue; // 已有决策（含调研覆盖后的）不回填
      setDecision(kernel, projectDir, {
        key: dkey,
        picked: [String(v)],
        by: "user.preference",
        evidence: `开跑先验：inputs.${key}=${v}（flow ${flow.id}）`,
      });
      journalAppend(kernel, projectDir, runId, "note", {
        actor: "kernel:preference",
        detail: `决策落盘 decision:${dkey} picked=${v}（来源=开跑先验，调研步 set_decision 可覆盖）`,
      });
    }
  }

  /** 项目初始化配置装载（不存在=undefined；非法=开跑前大声失败）。 */

export function readProjectConfig(kernel: Kernel, projectDir: string): ProjectConfig | undefined {
    try {
      return loadProjectConfig(projectDir, kernel.fs, kernel.path);
    } catch (e) {
      throw new KernelError("INVALID_INPUT", 400, `项目配置非法: ${e instanceof Error ? e.message : String(e)}`);
    }
  }


export function noteConfig(kernel: Kernel, projectDir: string, runId: string, cfg: ProjectConfig | undefined): void {
    if (!cfg) return;
    const bits = [
      cfg.严肃性 ? `严肃性=${cfg.严肃性}` : "",
      cfg.风格 ? `风格=${cfg.风格}` : "",
      cfg.AB测试 !== undefined ? `AB=${cfg.AB测试 ? "on" : "off"}` : "",
    ].filter(Boolean);
    journalAppend(kernel, projectDir, runId, "note", { actor: "kernel:config", detail: `初始化配置装载：${bits.join(" ")}` });
  }

  /** 调度推进：core 步就地执行，认知步产出任务包，门挂起。幂等。 */

export async function flow_next(kernel: Kernel,
    projectId: string,
    opts: { spawnPrompt?: boolean } = {},
  ): Promise<AdvanceStop & { spawnPrompt?: string; batch?: Array<BatchEntry & { spawnPrompt?: string }> }> {
    const lock = kernel.acquireLock(kernel.projectDir(projectId));
    try {
      const { state, projectDir, raw } = kernel.ctx(projectId);
      if (state.status === "completed" || state.status === "failed") return { status: state.status };
      // bootstrap 必须是盘上原始描述符（flow@3）：派生图（flow@2 形态）喂给 effectiveOf 会落进
      // legacy 分支——项目/出厂 overlay 被丢、link 门被 itb-* 边界门顶替（批B 处决的系统性错位）。
      const stop = await advance(kernel, projectId, state, projectDir, raw);
      if (!opts.spawnPrompt || stop.status !== "awaiting_input") return stop;
      // K2 派发头：任务包 → 规范 spawn 文本（宿主复制即用，禁止手写必读清单）
      const out = stop as typeof stop & { spawnPrompt?: string; batch?: Array<BatchEntry & { spawnPrompt?: string }> };
      out.spawnPrompt = renderSpawnPrompt(out.taskPackage);
      for (const b of out.batch ?? []) b.spawnPrompt = renderSpawnPrompt(b.taskPackage);
      return out;
    } finally {
      lock.release();
    }
  }

  /** 并发守卫：多 subagent 同时提交/裁决时的状态串行化（typed busy，宿主重试）。 */

export async function flow_submit(kernel: Kernel,
    projectId: string,
    nodeId: string,
    output: { content?: string; file?: string; notes?: string; seal?: boolean },
  ): Promise<{ status: "accepted" | "rejected"; problems?: Validation[]; committed?: string[]; sealed?: boolean; next?: AdvanceStop }> {
    const lock = kernel.acquireLock(kernel.projectDir(projectId));
    try {
      return await doSubmit(kernel, projectId, nodeId, output, lock);
    } finally {
      lock.release();
    }
  }


export async function doSubmit(kernel: Kernel,
    projectId: string,
    nodeId: string,
    output: { content?: string; file?: string; notes?: string; seal?: boolean },
    _lock: LockDir,
  ): Promise<{ status: "accepted" | "rejected"; problems?: Validation[]; committed?: string[]; sealed?: boolean; next?: AdvanceStop }> {
    const { state, projectDir, flow, eff, raw } = kernel.ctx(projectId);
    const node = flow.graph.nodes[nodeId];
    const ns = state.nodes[nodeId];
    if (!node || !ns) throw new KernelError("NO_NODE", 404, `图中无节点 ${nodeId}`);
    // R5：带产活的门是评审步，走与 agent 步同一条交卷路径（否则它的产物永远没人收，节点却照判 done）
    const workGate = isWorkGate(node) && !isBoundaryGate(node);
    const isLink = node.gate_role === "link";
    if (node.kind !== "agent" && !workGate) {
      throw new KernelError("NOT_AGENT_NODE", 409, `节点 ${nodeId} 不是可交卷的步（kind=${node.kind}${isLink ? "，连接件只接受 flow_gate 裁决（pass/reject）" : isBoundaryGate(node) ? "，kit 边界验收门只接受 flow_gate 裁决" : ""}）`);
    }
    if (ns.status !== "awaiting") {
      // 门未放行时提交下游节点，必须说清「谁挡的、怎么解」——
      // 否则调用方拿到 NODE_NOT_AWAITING（status=none）无法区分「没派发」和「被门挡住」
      const gateAwaiting = state.gate?.verdict === "awaiting" ? state.gate.node : undefined;
      if (gateAwaiting && gateAwaiting !== nodeId) {
        throw new KernelError("GATE_NOT_OPEN", 409, `验收门 ${gateAwaiting} 待裁决，节点 ${nodeId} 未派发——先 flow_gate 放行该门（token 见 state.gate.token）`);
      }
      throw new KernelError("NODE_NOT_AWAITING", 409, `节点 ${nodeId} 不在等待提交（status=${ns.status}）`);
    }

    const contractFile = artifactPathOf(flow, nodeId);
    const rel = output.file ?? contractFile;
    if (!rel) throw new KernelError("NO_OUTPUT_CONTRACT", 400, `节点 ${nodeId} 未声明产物路径`);
    const abs = kernel.path.resolve(projectDir, rel);
    if (!abs.startsWith(kernel.path.resolve(projectDir) + kernel.path.sep)) {
      throw new KernelError("PATH_ESCAPE", 400, `产物路径越界: ${rel}`);
    }
    if (output.content !== undefined) {
      kernel.fs.writeTextAtomic(abs, output.content);
    } else if (!kernel.fs.exists(abs)) {
      throw new KernelError("FILE_MISSING", 404, `产物文件不存在且未提供 content: ${rel}`);
    }

    const problems = runIntegrityAsserts(projectDir, rel, kernel.fs, kernel.path);
    // 过程交付件头部（规范 R4 §二）：版本/上游/审核背景的唯一真相，正文不得复述
    problems.push(
      ...runHeaderAsserts(projectDir, rel, {
        node: nodeId,
        round: (ns.round ?? 0) + 1,
        by: node.module
          ? `module/${node.module}.${node.op ?? node.minitool ?? nodeId}`
          : node.kit && node.op
            ? `kit/${node.kit}.${node.op}`
            : node.minitool
              ? `core/${node.minitool}`
              : undefined,
        rootInputs: Object.entries(flow.graph.nodes)
          .filter(([, n]) => n.kind === "novel-txt")
          .map(([, n]) => nodeOutput(n))
          .filter((p): p is string => !!p),
      }, kernel.fs, kernel.path),
    );
    const glossary = checkGlossary(kernel.root, projectDir, rel, kernel.fs, kernel.path);
    if (glossary) problems.push(glossary);
    // v5.0（工单 §三）：提交链上不再存在任何断言闸——runDeclaredAsserts 三态派发与
    // 对外交付/ 引擎全量闸均已下架。提交只保留确定性完整性（integrity/头部/词汇表）；
    // 质量证据由 scan_quality 内建步与 agent 自主调用的 tools/quality-scan.py 产出（收据制），
    // 语义裁决归 knowledge/rules/ 语料卡 + agent，端尾 kit 边界人裁验收。
    const finalProblems = dedupeValidations(problems);
    // Assertion Preset v1：提交链策略层（gateMode 降级/升级、progressive 渐进、条件丢弃）。
    // 预设不可用 = 结果原样透传（特性不激活，不拦死流水线）。v5.0 契约不变：提交链只有
    // integrity/header/glossary 到场，AE-* 质量闸在 check_* 节点由注册表执行（见 minitools）。
    const presetMount = kernel.assertionMount(eff, projectDir);
    const gated = presetMount
      ? applyGatePreset(presetMount, finalProblems, gateContext(projectDir, nodeId, node, rel, (ns.round ?? 0) + 1, kernel.fs, kernel.path))
      : { problems: finalProblems, outcomes: [], summary: "" };
    const gatedProblems = gated.problems;
    // AP1 §十：策略摘要写进 state（运行时事实），下游任务包据此注入 diagnosticSummary。
    // 空摘要不写空串——留着上一次非空的更没用，所以一律覆盖为「本轮的事实」。
    state.diagnosticSummary = gated.summary;
    state.diagnosticFrom = nodeId;
    const blocks = blocked(gatedProblems);
    if (blocks.length) {
      ns.failCount = (ns.failCount ?? 0) + 1;
      // 打回必须落指标——否则 R5 的成本口径（checkBlock 溢价）永远是 0，优化器看不到打回
      metric(kernel, projectDir, state, nodeId, node, "submit", {
        checks: checksCounts(gatedProblems),
        retries: ns.failCount,
        verdict: "rejected",
        note: `打回：${blocks.map((b) => b.name).join("、")}`,
      });
      journalAppend(kernel, projectDir, state.runId, "reject", {
        nodeId,
        detail: blocks.map((b) => `${b.name}: ${b.detail}`).join("; "),
        refs: [rel],
      });
      saveState(projectDir, state, kernel.fs, kernel.path);
      return { status: "rejected", problems: gatedProblems };
    }

    // 接受：注册 + 快照 + journal。iterate 节点（K6）未 seal 时保持 awaiting，逐实例入账；seal 收口置 done
    const batchable = !!node.iterate;
    if (batchable) {
      ns.committed = ns.committed ?? [];
      const ci = ns.committed.indexOf(rel);
      if (ci >= 0) ns.committed[ci] = rel;
      else ns.committed.push(rel);
    }
    if (!batchable || output.seal) {
      ns.status = "done";
      ns.round += 1;
      ns.lastArtifact = rel;
      ns.stale = false;
    } else {
      ns.stale = false;
    }
    if (output.notes) ns.note = output.notes;
    const upstreamFiles = effectiveUpstreams(flow, nodeId, state.inputs ?? {}, 0, condContextOf(state))
      .map((up) => artifactPathOf(flow, up))
      .filter((p): p is string => !!p);
    makeArtifact(projectDir, {
      path: rel,
      node: nodeId,
      round: Math.max(ns.round, 1),
      producer: "host-submit",
      inputs: inputFingerprint(projectDir, upstreamFiles, kernel.fs, kernel.path),
      validations: finalProblems,
    }, kernel.fs, kernel.path);
    captureSnapshot(projectDir, nodeId, { [rel]: kernel.fs.readText(abs) }, `submit r${Math.max(ns.round, 1)}·${kernel.path.basename(rel)}`, kernel.fs, kernel.path);
    // R5 指标：命中率 = 注入的标尺卡/上游件中，产物真正引用过的比例（信号取自 artifact@1 头部 upstream 与正文）
    try {
      // D1（计量口径）：提交侧的提取清单必须与 dispatch 相**同一 id 空间**。
      // dispatch 记的是装载后的精确卡 id（glob 已展开、预算已裁）+ 上下文 ref；
      // 此处若改用 op 声明的**原始**清单，`kb/trope/*` 这类通配符会以字面形态占着分母、
      // 永不可能命中 → 标尺卡命中率被系统性压到 0（_918test 实证：梗卡明明引用了 5 张，
      // 计数仍是 0）。故重算任务包，取与派发完全同源的那份清单。
      const pkg = buildTaskPackage(projectDir, flow, state, nodeId, eff.toolOverrides, eff.policy, kernel.fs, kernel.path);
      const injected = [...(pkg.knowledge ?? []).map((k) => k.id), ...pkg.context.map((c) => c.ref)];
      // 概念词命中层（D1 第一层改造）：kb 卡按签名词在正文的落点计命中，
      // 路径字面匹配只作保底——知识库根以 repoRoot 为准（knowledge/ 与 projects/ 分居）。
      const usage = extractCtxUsage(kernel.fs.readText(abs), injected, { root: kernel.repoRoot, io: kernel });
      metric(kernel, projectDir, state, nodeId, node, "submit", {
        ctx: usage,
        checks: checksCounts(finalProblems),
        retries: ns.failCount ?? 0,
        verdict: ns.verdict,
      });
    } catch {
      /* 指标是旁路 */
    }
    journalAppend(kernel, projectDir, state.runId, "submit", { nodeId, detail: rel, refs: [rel] });
    journalAppend(kernel, projectDir, state.runId, "snapshot", { nodeId, detail: `r${ns.round}·${kernel.path.basename(rel)}`, refs: [rel] });
    // R5：评审步交卷即自动裁决（不再等人开门）。v5.0 起域内质量 = 规则语料（agent 裁决）+ 扫描器证据；
    // 要人接手的唯一入口是 kit 边界验收门，或 policy.gate_mode=manual。
    if (workGate && (eff.policy.gate_mode ?? "auto") === "auto") {
      ns.verdict = "pass";
      state.gate = { verdict: "pass", node: nodeId, at: nowIso(), note: "R5 自动裁决：域内评审步，交卷完整性检查全过即过" };
      metric(kernel, projectDir, state, nodeId, node, "auto-gate", { verdict: "pass", note: "R5 评审步自动裁决" });
      journalAppend(kernel, projectDir, state.runId, "verdict", {
        nodeId,
        detail: "auto-pass（R5：域内评审步自动裁决；要人接手请置 policy.gate_mode=manual，或由优化器按指标裁掉该步）",
      });
    }
    state.status = "running";
    saveState(projectDir, state, kernel.fs, kernel.path);
    if (batchable && !output.seal) {
      return { status: "accepted", committed: ns.committed, sealed: false };
    }
    const next = await advance(kernel, projectId, state, projectDir, raw);
    return { status: "accepted", committed: ns.committed, sealed: true, next };
  }


export async function flow_resume(kernel: Kernel, projectId: string): Promise<AdvanceStop> {
    const { state, projectDir, flow, raw } = kernel.ctx(projectId);
    if (state.status === "completed") return { status: state.status };
    // R7（OS-02A）：failed / blocked 此前对 resume 是**空操作**（原样返回 status）——
    // 人以为「恢复了」，实际 run 早就停了，下游永远等不到。现在显式重跑「被打回门的上游范围」。
    if (state.status === "failed" || state.status === "blocked") {
      return recoverRejected(kernel, projectId, state, projectDir, flow, raw);
    }
    // 恢复纪律：running 的半成品宁重跑；awaiting（等提交）保留
    for (const ns of Object.values(state.nodes)) {
      if (ns.status === "running") ns.status = "none";
    }
    if (planDrifted(state, flow)) {
      journalAppend(kernel, projectDir, state.runId, "warn", { detail: "flow 指纹与快照不一致——沿用快照内计划（恢复不读图）" });
    }
    state.status = state.gate.verdict === "awaiting" ? "suspended" : "running";
    state.stalledAt = undefined; // 人工已介入：清停机标记
    saveState(projectDir, state, kernel.fs, kernel.path);
    return advance(kernel, projectId, state, projectDir, raw);
  }

  /** R7（OS-02A）：停机态出口。把「为什么停下」原样交给宿主，而不是一个没有上下文的 status。 */

export function blockedStop(kernel: Kernel, state: RunState): AdvanceStop {
    const nodeId = state.gate.node ?? state.focus ?? Object.keys(state.nodes)[0] ?? "-";
    return {
      status: "blocked",
      nodeId,
      reason: state.lastRejectReason || "停机：等待人工介入（重跑超 maxRounds / 等待超 awaitTimeoutMs / 源文件缺失）",
    };
  }

  /** R7（OS-02A）：某门累计驳回是否已达 `policy.maxRounds`（未声明 = 不封顶，保留旧行为）。 */

export function rejectCapped(kernel: Kernel, state: RunState, gateId: string): boolean {
    const max = (state.policy as { maxRounds?: number } | undefined)?.maxRounds;
    if (max === undefined) return false;
    return (state.rejects?.[gateId] ?? 0) >= max;
  }

  /**
   * R7（OS-02A）：等待态超时判定。到点把 run 标 blocked + stalledAt，**只标一次**，绝不自动放行——
   * 静默自动推进（放行/跳过）比停机坏得多。缺省不启用（`policy.awaitTimeoutMs` 未声明即 no-op）。
   */

export function markStalled(kernel: Kernel, state: RunState, projectDir: string): boolean {
    const ms = (state.policy as { awaitTimeoutMs?: number } | undefined)?.awaitTimeoutMs;
    if (ms === undefined) return false;
    if (state.status !== "suspended" && state.status !== "awaiting_input") return false;
    const since = state.gate.at;
    if (!since || Date.now() - Date.parse(since) < ms) return false;
    const secs = Math.round(ms / 1000);
    state.stalledAt = nowIso();
    state.status = "blocked";
    state.lastRejectReason = `等待超时：${state.gate.node ?? state.focus ?? "-"} 悬置超过 ${secs}s（policy.awaitTimeoutMs）——停机等人`;
    journalAppend(kernel, projectDir, state.runId, "warn", {
      nodeId: state.gate.node,
      detail: `await-timeout：悬置超 ${secs}s → run 标 blocked（不自动放行；请裁决 / flow_resume / 调整 awaitTimeoutMs）`,
    });
    saveState(projectDir, state, kernel.fs, kernel.path);
    return true;
  }

  /**
   * R7（OS-02A）：failed / blocked 的恢复 = 重跑「被打回那道门的上游范围」。
   * 方向与 `doRerun`（`order.slice(idx)` = 本节点及其下游）**相反**：驳回的语义是上游不合格，
   * 要重做的是上游，不是门之后。所以此处不复用 doRerun。
   */

export async function recoverRejected(kernel: Kernel,
    projectId: string,
    state: RunState,
    projectDir: string,
    flow: FlowDescriptor,
    raw: FlowDescriptor,
  ): Promise<AdvanceStop> {
    const gateId = state.gate.node;
    const prevStatus = state.status;
    if (!gateId) {
      throw new KernelError(
        "NO_RECOVERY_SCOPE",
        409,
        `状态 ${state.status} 无可指认的失效门（gate.node 为空）——请用 flow_rerun 显式指定重跑节点`,
      );
    }
    // 两种停机必须分开：**被打回**（上游不合格 ⇒ 重跑上游）与**等待超时**（上游无辜 ⇒ 只澄清停机标记）。
    // 把「等太久」也当驳回去清上游 = 白扔已验收的成果——那不是恢复，是破坏。
    const byTimeout = state.status === "blocked" && !!state.stalledAt;
    const scope = byTimeout ? [] : rejectedScope(kernel, state, flow, gateId);
    for (const id of scope) {
      const n = state.nodes[id];
      if (!n) continue;
      if (n.status === "done" || n.status === "awaiting") {
        n.status = "pending";
        n.stale = true;
        n.round += 1;
        n.committed = [];
        journalAppend(kernel, projectDir, state.runId, "stale", {
          nodeId: id,
          detail: `resume 恢复：重跑门 ${gateId} 的上游范围`,
        });
      }
    }
    if (byTimeout) {
      // 人工已介入 ⇒ 等待计时**重起**：否则下一轮 advance 会拿同一个陈旧的 gate.at 立刻再判超时，
      // 变成「resume 无效」的另一种形态。门本身仍等裁决，不计已驳回。
      if (state.gate.verdict === "awaiting") state.gate = { ...state.gate, at: nowIso() };
      journalAppend(kernel, projectDir, state.runId, "note", {
        nodeId: gateId,
        actor: "kernel:resume",
        detail: "等待超时恢复：澄清停机标记、等待计时重起，保留上游成果（门仍在等裁决）",
      });
    } else {
      // 人工已介入的信号：清该门的累计驳回计数（maxRounds 重新起算），journal 留痕
      const prevRejects = state.rejects?.[gateId];
      if (prevRejects !== undefined) {
        journalAppend(kernel, projectDir, state.runId, "note", {
          nodeId: gateId,
          actor: "kernel:resume",
          detail: `人工恢复：清空 ${gateId} 累计驳回计数（原 ${prevRejects} 次）`,
        });
        delete state.rejects![gateId];
      }
      const gn = state.nodes[gateId];
      if (gn) {
        gn.status = "pending";
        gn.stale = true;
        gn.round += 1;
        gn.committed = [];
      }
      state.gate = { verdict: "none" };
    }
    state.stalledAt = undefined;
    state.status = state.gate.verdict === "awaiting" ? "suspended" : "running";
    journalAppend(kernel, projectDir, state.runId, "rerun", {
      nodeId: gateId,
      detail: byTimeout
        ? `flow_resume 从 ${prevStatus} 恢复：等待超时（不重跑上游）`
        : `flow_resume 从 ${prevStatus} 恢复：失效范围 ${scope.length} 节点（重跑门 ${gateId} 的上游）`,
      refs: scope,
    });
    saveState(projectDir, state, kernel.fs, kernel.path);
    return advance(kernel, projectId, state, projectDir, raw);
  }

  /** R7（OS-02A）：被打回门的上游范围。flow@3 走模块表（与 doGate 的 link 分支同一口径）；否则取计划前缀。 */

export function rejectedScope(kernel: Kernel, state: RunState, flow: FlowDescriptor, gateId: string): string[] {
    const order = state.plan?.order ?? Object.keys(state.nodes);
    const r6 = (flow as unknown as {
      r6?: { moduleNodes: Record<string, string[]>; links: Array<{ id: string; fromModule: string }> };
    }).r6;
    const upstream = r6?.links.find((l) => l.id === gateId)?.fromModule;
    const modScope = upstream ? (r6?.moduleNodes[upstream] ?? []) : [];
    if (modScope.length) return modScope.filter((id) => id !== gateId);
    const idx = order.indexOf(gateId);
    return order.slice(0, idx < 0 ? order.length : idx);
  }


export async function flow_gate(kernel: Kernel, projectId: string, req: GateRequest): Promise<{ applied: true; completed?: boolean; failed?: boolean; rollbackScope?: string[]; next?: AdvanceStop }> {
    const lock = kernel.acquireLock(kernel.projectDir(projectId));
    try {
      return await doGate(kernel, projectId, req);
    } finally {
      lock.release();
    }
  }


export async function doGate(kernel: Kernel, projectId: string, req: GateRequest): Promise<{ applied: true; completed?: boolean; failed?: boolean; rollbackScope?: string[]; next?: AdvanceStop }> {
    const { state, projectDir, flow, raw } = kernel.ctx(projectId);
    if (state.gate.verdict !== "awaiting" || state.gate.node !== req.nodeId) {
      throw new KernelError("GATE_NOT_AWAITING", 409, `门不在挂起或节点不符（gate=${state.gate.verdict}@${state.gate.node ?? "-"}）`);
    }
    // 三重凭据：token + nodeId + round（旧轮次迟到裁决拒绝）
    if (req.token && req.token !== state.gate.token) throw new KernelError("STALE_GATE", 409, "gate token 不匹配");
    if (req.round !== undefined && req.round !== state.gate.round) {
      throw new KernelError("STALE_GATE", 409, `轮次过期（判据 round=${state.gate.round}，请求 ${req.round}）`);
    }
    const ns = state.nodes[req.nodeId];
    const gateNode = flow.graph.nodes[req.nodeId];
    if (!ns) throw new KernelError("NO_NODE", 404, `图中无节点 ${req.nodeId}`);

    // R6：连接件裁决（gate_role=link）。两值：pass 放行进入本模块 / reject 重跑整个上游模块。
    if (gateNode?.gate_role === "link") {
      const pass = req.verdict === "pass" || req.verdict === "pass-with-conditions";
      if (!pass && req.verdict !== "reject" && req.verdict !== "send-back") {
        throw new KernelError("INVALID_VERDICT", 400, `连接件裁决只接受 pass/reject: ${req.verdict}`);
      }
      const r6 = (flow as any).r6 as
        | { moduleNodes: Record<string, string[]>; links: Array<{ id: string; fromModule: string }> }
        | undefined;
      const upstream = r6?.links.find((l) => l.id === req.nodeId)?.fromModule;
      const scope = pass ? [] : (r6?.moduleNodes[upstream ?? ""] ?? []).filter((id) => id !== req.nodeId);
      for (const id of scope) {
        const n = state.nodes[id];
        if (!n) continue;
        if (n.status === "done" || n.status === "awaiting") {
          n.status = "pending";
          n.stale = true;
          n.round += 1;
          n.committed = [];
          journalAppend(kernel, projectDir, state.runId, "stale", { nodeId: id, detail: "模块驳回：重跑上游模块" });
        }
      }
      ns.verdict = pass ? "pass" : "reject";
      if (pass) {
        ns.status = "done";
        ns.round += 1;
        ns.stale = false;
        state.gate = { verdict: "pass", node: req.nodeId, at: nowIso(), note: req.comment };
      } else {
        ns.status = "pending";
        state.gate = { verdict: "reject", node: req.nodeId, at: nowIso(), note: req.comment };
        // R7（OS-02A）：累计驳回轮次。此前无上限 ⇒ 「驳回→重跑上游→再撞同一门→再驳回」无限乒乓，
        // 只有人肉盯得住；policy.maxRounds 到顶即停机等人。
        state.rejects = state.rejects ?? {};
        state.rejects[req.nodeId] = (state.rejects[req.nodeId] ?? 0) + 1;
      }
      state.lastRejectReason = pass ? "" : (req.comment ?? `重跑上游模块 ${upstream ?? ""}`);
      state.status = "running";
      metric(kernel, projectDir, state, req.nodeId, gateNode, "link", {
        verdict: pass ? "pass" : "reject", note: req.comment,
      });
      journalAppend(kernel, projectDir, state.runId, "verdict", {
        nodeId: req.nodeId,
        detail: `${pass ? "pass" : "reject"}（R6 连接件：${pass ? "放行" : `重跑上游模块 ${upstream ?? ""}`}）${req.comment ? "：" + req.comment : ""}`,
        refs: scope,
      });
      if (!pass && rejectCapped(kernel, state, req.nodeId)) {
        const cap = (state.policy as { maxRounds?: number } | undefined)?.maxRounds;
        state.status = "blocked";
        state.lastRejectReason = `连接件 ${req.nodeId} 累计驳回 ${state.rejects?.[req.nodeId] ?? 0} 次达 policy.maxRounds=${String(cap)} 上限——停机等人（放行 / 调上游 / 调 maxRounds）`;
        journalAppend(kernel, projectDir, state.runId, "run-end", { nodeId: req.nodeId, detail: state.lastRejectReason });
        saveState(projectDir, state, kernel.fs, kernel.path);
        return { applied: true, rollbackScope: scope, next: blockedStop(kernel, state) };
      }
      saveState(projectDir, state, kernel.fs, kernel.path);
      if (!pass) {
        const next = await advance(kernel, projectId, state, projectDir, raw);
        return { applied: true, rollbackScope: scope, next };
      }
      const next = await advance(kernel, projectId, state, projectDir, raw);
      return { applied: true, next };
    }

    if (req.verdict === "pass" || req.verdict === "pass-with-conditions") {
      ns.status = "done";
      ns.verdict = req.verdict;
      ns.round += 1;
      ns.stale = false;
      state.gate = { verdict: req.verdict, node: req.nodeId, at: nowIso(), note: req.comment };
      metric(kernel, projectDir, state, req.nodeId, gateNode ?? { kind: "gate" }, gateNode?.gate_role === "link" ? "link" : isBoundaryGate(gateNode) ? "boundary" : "gate", {
        verdict: req.verdict, note: req.comment,
      });
      journalAppend(kernel, projectDir, state.runId, "verdict", { nodeId: req.nodeId, detail: `${req.verdict}${req.comment ? "：" + req.comment : ""}` });
      if (gateNode?.kind === "srd") {
        state.status = "completed";
        journalAppend(kernel, projectDir, state.runId, "run-end", { detail: "srd 裁决通过，run 完成" });
        saveState(projectDir, state, kernel.fs, kernel.path);
        try {
          kernel.flowMine(projectId);
          kernel.flowOptimize(projectId, { actor: "auto-completed" });
        } catch {
          /* 负反馈旁路 */
        }
        return { applied: true, completed: true };
      }
      state.status = "running";
      saveState(projectDir, state, kernel.fs, kernel.path);
      const next = await advance(kernel, projectId, state, projectDir, raw);
      return { applied: true, next };
    }

    if (req.verdict === "send-back") {
      // 打回默认只作用于本阶段：回本阶段入口定点重做，失效范围限本阶段。
      // 已 pass 阶段的产物视为定稿；跨阶段回滚 = 用户强行介入（force + rootCauseStage），不是门语义。
      const gateStage = (flow.stages ?? []).find((s) => s.gate === req.nodeId || s.nodes?.includes(req.nodeId));
      const forced = req.force === true && !!req.rootCauseStage;
      const entry = forced ? resolveStageEntry(kernel, flow, req.nodeId, req.rootCauseStage) : resolveStageEntry(kernel, flow, req.nodeId);
      const order = state.plan?.order ?? Object.keys(state.nodes);
      const scope = forced
        ? order.slice(order.indexOf(entry)).filter((id) => id !== req.nodeId)
        : (gateStage?.nodes ?? [entry]).filter((id) => id !== req.nodeId && order.includes(id));
      for (const id of scope) {
        const n = state.nodes[id];
        if (!n) continue;
        if (n.status === "done" || n.status === "awaiting") {
          n.status = "pending";
          n.stale = true;
          n.round += 1; // round 只增不清（v3 纪律）
          n.committed = []; // K6：打回重开实例窗口，提交清单清零
          journalAppend(kernel, projectDir, state.runId, "stale", { nodeId: id, detail: forced ? "强制级联失效，待重算" : "本阶段打回失效，待重算" });
        }
      }
      ns.verdict = "send-back";
      ns.status = "pending";
      if (req.rootCauseStage) ns.rootCauseStage = req.rootCauseStage;
      state.gate = { verdict: "send-back", node: req.nodeId, at: nowIso(), note: req.comment };
      state.lastRejectReason = req.comment ?? req.rootCauseStage ?? "";
      state.status = "running";
      journalAppend(kernel, projectDir, state.runId, "verdict", {
        nodeId: req.nodeId,
        detail: `send-back → ${entry}（${forced ? "强制跨阶段" : "本阶段"}，${scope.length} 节点失效）${req.comment ? "：" + req.comment : ""}`,
        refs: scope,
      });
      saveState(projectDir, state, kernel.fs, kernel.path);
      const next = await advance(kernel, projectId, state, projectDir, raw);
      return { applied: true, rollbackScope: scope, next };
    }

    if (req.verdict === "reject") {
      ns.verdict = "reject";
      state.gate = { verdict: "reject", node: req.nodeId, at: nowIso(), note: req.comment };
      metric(kernel, projectDir, state, req.nodeId, gateNode ?? { kind: "gate" }, gateNode?.gate_role === "link" ? "link" : isBoundaryGate(gateNode) ? "boundary" : "gate", {
        verdict: "reject", note: req.comment,
      });
      state.status = "failed";
      journalAppend(kernel, projectDir, state.runId, "verdict", { nodeId: req.nodeId, detail: `reject${req.comment ? "：" + req.comment : ""}` });
      journalAppend(kernel, projectDir, state.runId, "run-end", { detail: "门裁决 reject，run 终止" });
      saveState(projectDir, state, kernel.fs, kernel.path);
      return { applied: true, failed: true };
    }

    throw new KernelError("INVALID_VERDICT", 400, `未知裁决: ${req.verdict}`);
  }


export async function flow_rerun(kernel: Kernel, projectId: string, req: { nodeId: string; dryRun?: boolean }): Promise<{ scope: string[]; dryRun: boolean; cacheCandidates?: string[]; next?: AdvanceStop }> {
    const lock = kernel.acquireLock(kernel.projectDir(projectId));
    try {
      return await doRerun(kernel, projectId, req);
    } finally {
      lock.release();
    }
  }


export async function doRerun(kernel: Kernel, projectId: string, req: { nodeId: string; dryRun?: boolean }): Promise<{ scope: string[]; dryRun: boolean; cacheCandidates?: string[]; next?: AdvanceStop }> {
    const { state, projectDir, flow, raw } = kernel.ctx(projectId);
    const order = state.plan?.order ?? Object.keys(state.nodes);
    const idx = order.indexOf(req.nodeId);
    if (idx < 0) throw new KernelError("NO_NODE", 404, `节点不在计划内: ${req.nodeId}`);
    const scope = order.slice(idx);
    if (req.dryRun) {
      // 预览：确定性步中输入指纹未变者为缓存候选（创意步与门永远真重做）
      const cacheCandidates = scope.filter((id) => {
        const kind = flow.graph.nodes[id]?.kind;
        if (kind !== "core") return false;
        const entry = lastArtifactEntry(kernel, projectDir, id);
        return !!entry?.inputs && Object.keys(entry.inputs).length > 0 && fingerprintMatches(kernel, projectDir, entry.inputs);
      });
      return { scope, dryRun: true, cacheCandidates };
    }
    for (const id of scope) {
      const n = state.nodes[id];
      if (!n) continue;
      if (n.status === "done" || n.status === "awaiting") {
        n.status = "pending";
        n.stale = true;
        n.round += 1;
        n.committed = []; // K6：iterate 节点本批实例清零，重新逐实例提交
        journalAppend(kernel, projectDir, state.runId, "stale", { nodeId: id, detail: "rerun 级联失效" });
      }
    }
    if (state.gate.verdict === "awaiting") state.gate = { verdict: "none" };
    state.status = "running";
    journalAppend(kernel, projectDir, state.runId, "rerun", { nodeId: req.nodeId, detail: `scope ${scope.length} 节点`, refs: scope });
    saveState(projectDir, state, kernel.fs, kernel.path);
    const next = await advance(kernel, projectId, state, projectDir, raw, req.nodeId);
    return { scope, dryRun: false, next };
  }


export function lastArtifactEntry(kernel: Kernel, projectDir: string, nodeId: string) {
    const arts = listArtifacts(projectDir, { node: nodeId }, kernel.fs, kernel.path);
    return arts.length ? arts[arts.length - 1] : undefined;
  }


export function fingerprintMatches(kernel: Kernel, projectDir: string, fp: Record<string, string | null>): boolean {
    const current = inputFingerprint(projectDir, Object.keys(fp), kernel.fs, kernel.path);
    return Object.entries(fp).every(([p, h]) => current[p] === h);
  }

  // ---------- 调度循环 ----------


export async function advance(kernel: Kernel, projectId: string, state: RunState, projectDir: string, bootstrap: FlowDescriptor, forceNodeId?: string): Promise<AdvanceStop> {
    // R7（OS-02A）：停机态是屏障不是终态——恢复只走 flow_resume，advance 不许自己绕过去。
    if (state.status === "blocked") return blockedStop(kernel, state);
    // R7（OS-02A）：等待超时判定（policy.awaitTimeoutMs 缺省=不启用）。到点只停机，不自动放行。
    if (markStalled(kernel, state, projectDir)) return blockedStop(kernel, state);
    // R5：装载生效编排（bootstrap ⊕ overlay ⊕ 边界派生）。编排被人/优化 agent 改过即重编译计划。
    const eff = kernel.effectiveOf(projectDir, bootstrap, state.preset);
    const flow = eff.flow;
    // 未收口迭代节点数一并注入：`{loop:"pending"}` 由此从"看得见判不动"变成可求值（规范 R4 §5.2）
    const cond = condContextOf({ ...state, pendingInstances: pendingInstancesOf(flow, state) });
    let order = state.plan?.order ?? compilePlan(flow, state.inputs ?? {}, cond);
    const planHash = planHashOf(kernel, order, flow, eff.overlayHash);
    if (state.overlayHash === undefined) {
      // 旧 run 首次接触 R5：认领当前编排指纹。**但只在快照计划与当前生效编排一致时**才静默沿用——
      // 不一致说明编排真的变了（新 clone / 换了 overlay / 迁移来的旧快照），沿用旧计划等于拿旧图跑新编排，
      // 节点凭空消失而状态照打 done（静默断路）。R7（OS-02A）：不一致就重编译，别装没看见。
      state.overlayHash = eff.overlayHash;
      state.policy = eff.policy as Record<string, unknown>;
      state.planHash = planHash;
      const snapshot = state.plan?.order ?? [];
      const recompiled = compilePlan(flow, state.inputs ?? {}, cond);
      const same = recompiled.length === snapshot.length && recompiled.every((id, i) => id === snapshot[i]);
      if (!same) {
        journalAppend(kernel, projectDir, state.runId, "warn", {
          actor: "kernel:overlay",
          detail: `R7 首次装载：快照计划与当前生效编排不一致（${snapshot.length} → ${recompiled.length} 节点）——重编译而非沿用旧计划`,
        });
        order = replan(kernel, state, flow, cond, eff, projectDir);
      } else {
        if (eff.boundaries.length) {
          journalAppend(kernel, projectDir, state.runId, "note", {
            actor: "kernel:overlay",
            detail: `R5 编排已就绪（${eff.boundaries.length} 个 kit 边界验收待生效）。本次沿用快照内计划；如需启用请 flow_overlay --replan。`,
          });
        }
        saveState(projectDir, state, kernel.fs, kernel.path);
      }
    } else if (state.overlayHash !== eff.overlayHash) {
      order = replan(kernel, state, flow, cond, eff, projectDir);
    }
    state.policy = eff.policy as Record<string, unknown>;
    kernel.persistEffective(projectDir, eff, state);
    // 就绪批调度：AND-join——节点就绪 = 全部活跃上游 done；同批认知步一次派发，宿主并行执行。
    // 不在计划内的上游（不可达支线，如批注回流=off 时的 intake）不阻塞就绪判定。
    const inPlan = new Set(order);
    const upMap = activeUpstreams(kernel, flow, cond);
    const isReady = (id: string) => (upMap.get(id) ?? []).every((u) => !inPlan.has(u) || state.nodes[u]?.status === "done");
    const batch: BatchEntry[] = [];
    for (const id of order) {
      const node = flow.graph.nodes[id];
      const ns = state.nodes[id];
      if (!node || !ns) continue;
      if (ns.status === "done") continue;

      // 门/srd：同步屏障。上游未齐不开启（并行分支还在跑时门必须等）
      if (node.kind === "gate" || node.kind === "srd") {
        const gateReady = isReady(id);
        if (!gateReady) continue;
        // R6：模块间连接件（gate_role=link）只有两种模式——auto 自动放行（journal 留痕）/ manual 挂人。
        // 模块内部无门无打回；reject = 重跑整个上游模块（doGate 的 link 分支）。
        if (node.gate_role === "link") {
          const humanEngaged = state.gate.verdict === "awaiting" && state.gate.node === id;
          if (humanEngaged) {
            return {
              status: "suspended",
              nodeId: id,
              gate: { nodeId: id, round: ns.round, token: gateToken(projectId, state.runId, id), title: node.title },
            };
          }
          const mode = node.link_mode ?? "auto";
          if (mode === "auto") {
            ns.status = "done";
            ns.verdict = "pass";
            ns.round += 1;
            ns.stale = false;
            metric(kernel, projectDir, state, id, node, "link", { verdict: "pass", note: "R6 自动批准" });
            journalAppend(kernel, projectDir, state.runId, "verdict", { nodeId: id, detail: "auto-pass（R6 连接件：自动批准）" });
            saveState(projectDir, state, kernel.fs, kernel.path);
            continue;
          }
          const token = gateToken(projectId, state.runId, id);
          state.gate = { verdict: "awaiting", node: id, round: ns.round, token, at: nowIso(), note: node.title };
          ns.status = "awaiting";
          state.status = "suspended";
          journalAppend(kernel, projectDir, state.runId, "gate-open", { nodeId: id, detail: node.title ?? "" });
          saveState(projectDir, state, kernel.fs, kernel.path);
          return { status: "suspended", nodeId: id, gate: { nodeId: id, round: ns.round, token, title: node.title } };
        }
        // R5 门降级（§四）：非 kit 边界的门不再阻塞——域内质量已由规则语料 + 扫描器证据承担。
        // 保留两个例外：policy.gate_mode=manual，或这扇门已被人工接手（awaiting，轮到人裁决）。
        const boundary = isBoundaryGate(node);
        const gateMode = eff.policy.gate_mode ?? "auto";
        const humanEngaged = state.gate.verdict === "awaiting" && state.gate.node === id;
        const autoRegion = node.kind === "gate" && !boundary && gateMode === "auto" && !humanEngaged;
        // (a) 纯汇合点（不产活）→ 直接自动放行，连产物都没有，跳过不损失任何东西
        if (autoRegion && !isWorkGate(node)) {
          ns.status = "done";
          ns.verdict = "pass";
          ns.round += 1;
          ns.stale = false;
          metric(kernel, projectDir, state, id, node, "auto-gate", { verdict: "pass", note: "R5 门降级：纯汇合点无产活，直接放行" });
          journalAppend(kernel, projectDir, state.runId, "verdict", {
            nodeId: id,
            detail: "auto-pass（R5 门降级：纯汇合点无产活；如需人工请置 policy.gate_mode=manual 或用 overlay 裁掉该节点）",
          });
          saveState(projectDir, state, kernel.fs, kernel.path);
          continue;
        }
        // (b) 带产活的门 = 评审步：**照跑**（派发任务包、产物照出），只是裁决自动。
        //     这是「拥抱生成式 flow」的关键一步——评审不再是人的串行屏障，但它该干的活不许被跳过。
        if (autoRegion && isWorkGate(node) && !humanEngaged) {
          const pkg = buildTaskPackage(projectDir, flow, state, id, eff.toolOverrides, eff.policy, kernel.fs, kernel.path);
          batch.push({ nodeId: id, taskPackage: pkg });
          ns.status = "awaiting";
          state.status = "awaiting_input";
          metric(kernel, projectDir, state, id, node, "dispatch", {
            ctx: {
              offered: (pkg.knowledge?.length ?? 0) + pkg.context.length,
              ids: [...(pkg.knowledge ?? []).map((k) => k.id), ...pkg.context.map((c) => c.ref)],
            },
            config: toolConfigSnapshot(kernel, node, eff),
          });
          journalAppend(kernel, projectDir, state.runId, "advance", {
            nodeId: id,
            detail: `评审步派发（R5：评审照跑，裁决自动——域内质量交回规则语料 + 扫描器证据（v5.0 agent-only）；如需人工请置 policy.gate_mode=manual）`,
          });
          continue;
        }
        // R7（OS-02A）：`policy.kit_boundary=auto` → 边界门**留在计划内自动裁决**（可见、可审计、不拦人）。
        // 旧实现靠节点级 when 关掉它，compilePlan 连出入边一起裁 ⇒ 计划在门上截断、run 判 completed。
        // 此处是唯一正确落点：图不动，裁决在 advance 里做，指标照记 boundary 相。
        if (boundary && !humanEngaged && (eff.policy.kit_boundary ?? "auto") === "auto") {
          ns.status = "done";
          ns.verdict = "pass";
          ns.round += 1;
          ns.stale = false;
          state.gate = { verdict: "pass", node: id, at: nowIso(), note: "kit_boundary=auto 自动放行" };
          metric(kernel, projectDir, state, id, node, "boundary", { verdict: "pass", note: "kit_boundary=auto 自动放行" });
          journalAppend(kernel, projectDir, state.runId, "verdict", {
            nodeId: id,
            detail: "auto-pass（边界门：policy.kit_boundary=auto——保留可见与指标，但不拦人；要人验收请置 always）",
          });
          saveState(projectDir, state, kernel.fs, kernel.path);
          continue;
        }
        if (humanEngaged) {
          return {
            status: "suspended",
            nodeId: id,
            gate: { nodeId: id, round: ns.round, token: gateToken(projectId, state.runId, id), title: node.title },
          };
        }
        const token = gateToken(projectId, state.runId, id);
        state.gate = { verdict: "awaiting", node: id, round: ns.round, token, at: nowIso(), note: node.title };
        ns.status = "awaiting";
        state.status = "suspended";
        journalAppend(kernel, projectDir, state.runId, "gate-open", { nodeId: id, detail: node.title ?? "" });
        saveState(projectDir, state, kernel.fs, kernel.path);
        return { status: "suspended", nodeId: id, gate: { nodeId: id, round: ns.round, token, title: node.title } };
      }

      if (ns.status === "awaiting") {
        // 已派发、等待提交的认知步：每轮重组任务包（磁盘真相 > 对话记忆），并入就绪批
        batch.push({ nodeId: id, taskPackage: buildTaskPackage(projectDir, flow, state, id, eff.toolOverrides, eff.policy, kernel.fs, kernel.path) });
        state.status = "awaiting_input";
        continue;
      }

      if (node.kind === "novel-txt") {
        const f = nodeOutput(node);
        if (!f || !kernel.fs.exists(kernel.path.join(projectDir, f))) {
          journalAppend(kernel, projectDir, state.runId, "warn", { nodeId: id, detail: `源文件缺失: ${f}` });
          return { status: "blocked", nodeId: id, reason: `源文件缺失: ${f}` };
        }
        makeArtifact(projectDir, { path: f, node: id, producer: "kernel:novel-txt", inputs: {} }, kernel.fs, kernel.path);
        captureSnapshot(projectDir, id, { [f]: kernel.fs.readText(kernel.path.join(projectDir, f)) }, `src r1·${kernel.path.basename(f)}`, kernel.fs, kernel.path);
        ns.status = "done";
        ns.round += 1;
        ns.stale = false;
        ns.lastArtifact = f;
        journalAppend(kernel, projectDir, state.runId, "advance", { nodeId: id, detail: `源步 ${f}` });
        saveState(projectDir, state, kernel.fs, kernel.path);
        continue;
      }

      if (node.kind === "core") {
        if (!isReady(id)) continue; // 上游分支未齐：本轮不执行，后续 flow_next 再推进
        if (ns.status === "pending" && id !== forceNodeId) {
          // 指纹缓存命中（v3 mtime-skip 的内容寻址版）：send-back/rerun 后若上游重跑产物字节未变，不重算。
          // 只对确定性步生效——认知步被 send-back 时「重做」本身就是目的。
          const entry = lastArtifactEntry(kernel, projectDir, id);
          if (entry?.inputs && Object.keys(entry.inputs).length > 0 && fingerprintMatches(kernel, projectDir, entry.inputs)) {
            ns.status = "done";
            ns.stale = false;
            journalAppend(kernel, projectDir, state.runId, "advance", { nodeId: id, detail: "缓存命中（输入指纹未变，跳过重算）" });
            saveState(projectDir, state, kernel.fs, kernel.path);
            continue;
          }
        }
        // D#14：脚本壳的超时旋钮。此前 `timeoutMs` 只活在契约里（spawn 不带 timeout）⇒ 脚本卡住
        // = 内核永久卡住。现按「节点 config > op/overlay config > 通用默认 60000」解析后交给
        // runCoreNode，由它传给子进程；到时显式失败，不静默挂死。
        const coreOp = resolveNodeOp(node, kernel.repoRoot, undefined, kernel.fs, kernel.path);
        const coreOv = coreOp ? eff.toolOverrides[`${coreOp.kit}.${coreOp.op}`]?.config : undefined;
        const coreCfg = resolveToolConfig(coreOp, (node as { config?: Record<string, unknown> }).config, coreOv).values;
        const r = await runCoreNode(projectDir, flow, state, id, {
          timeoutMs: typeof coreCfg.timeoutMs === "number" ? coreCfg.timeoutMs : undefined,
          budget: resolveBudget(eff.policy).values,
          presetMount: kernel.assertionMount(eff, projectDir),
        }, kernel.fs, kernel.path, kernel.proc);
        if (!r.ok && r.kind === "missing") {
          journalAppend(kernel, projectDir, state.runId, "warn", { nodeId: id, detail: r.reason });
          return { status: "blocked", nodeId: id, reason: r.reason ?? "minitool missing" };
        }
        // AP1 §十：检查节点的门策略摘要写进 state（运行时事实），下游 agent 任务包据此注入。
        // 与 doSubmit 同口径：一律覆盖（本轮没触发条款 = 空串），不留着上轮的旧摘要冒充本轮。
        state.diagnosticSummary = r.diagnosticSummary ?? "";
        state.diagnosticFrom = id;
        if (!r.ok) {
          ns.status = "rejected";
          ns.failCount = (ns.failCount ?? 0) + 1;
          metric(kernel, projectDir, state, id, node, "core", {
            verdict: "block",
            checks: { pass: 0, block: r.problems?.length ?? 1, names: (r.problems ?? []).map((p) => p.name) },
            retries: ns.failCount,
            note: r.reason,
          });
          journalAppend(kernel, projectDir, state.runId, "reject", { nodeId: id, detail: r.reason ?? "完整性检查未过", refs: r.artifacts });
          saveState(projectDir, state, kernel.fs, kernel.path);
          return { status: "blocked", nodeId: id, reason: r.reason ?? "完整性检查未过", problems: r.problems };
        }
        ns.status = "done";
        ns.round += 1;
        ns.stale = false;
        ns.lastArtifact = r.artifacts[0];
        metric(kernel, projectDir, state, id, node, "core", { verdict: "pass" });
        journalAppend(kernel, projectDir, state.runId, "advance", { nodeId: id, detail: r.artifacts.join(","), refs: r.artifacts });
        saveState(projectDir, state, kernel.fs, kernel.path);
        continue;
      }

      if (node.kind === "agent") {
        if (!isReady(id)) continue; // 上游未齐：不派发
        const pkg = buildTaskPackage(projectDir, flow, state, id, eff.toolOverrides, eff.policy, kernel.fs, kernel.path);
        batch.push({ nodeId: id, taskPackage: pkg });
        ns.status = "awaiting";
        state.status = "awaiting_input";
        // R5 指标：派发相记「装载了多少件上下文」——命中率的分母
        metric(kernel, projectDir, state, id, node, "dispatch", {
          ctx: {
            offered: (pkg.knowledge?.length ?? 0) + pkg.context.length,
            ids: [...(pkg.knowledge ?? []).map((k) => k.id), ...pkg.context.map((c) => c.ref)],
          },
          config: toolConfigSnapshot(kernel, node, eff),
        });
        journalAppend(kernel, projectDir, state.runId, "advance", { nodeId: id, detail: `任务包产出（skill=${node.skill ?? "-"}，上下文 ${pkg.context.length} 件）` });
        continue; // 收集同批其余就绪节点，循环结束后一次派发
      }

      journalAppend(kernel, projectDir, state.runId, "warn", { nodeId: id, detail: `未知节点类型 ${node.kind}` });
      return { status: "blocked", nodeId: id, reason: `未知节点类型 ${node.kind}` };
    }

    if (batch[0]) {
      // 同批节点互不依赖（AND-join 就绪集），宿主可并行执行
      const head = batch[0];
      const ids = batch.map((b) => b.nodeId);
      for (const b of batch) b.taskPackage.parallelWith = ids.filter((n) => n !== b.nodeId);
      journalAppend(kernel, projectDir, state.runId, "advance", {
        detail: `就绪批派发 ${batch.length} 项：${ids.join("、")}（并行）`,
      });
      saveState(projectDir, state, kernel.fs, kernel.path);
      return { status: "awaiting_input", nodeId: head.nodeId, taskPackage: head.taskPackage, batch };
    }

    state.status = "completed";
    journalAppend(kernel, projectDir, state.runId, "run-end", { detail: "全部节点 done" });
    saveState(projectDir, state, kernel.fs, kernel.path);
    // W-06 负反馈自动触发：completed 即自动组装挖掘包 + 刷新提案池（内核不做 LLM 判断；提案仍待人批）
    try {
      kernel.flowMine(projectId);
      kernel.flowOptimize(projectId, { actor: "auto-completed" });
    } catch (e) {
      // 负反馈是旁路（不阻塞完成态），但"声明了却静默没跑"正是本仓最反感的模式 ⇒ 留痕
      recordDiag(kernel, projectDir, "feedback", "auto-mine+optimize", e);
    }
    return { status: "completed" };
  }

  // ---------- R5：运行指标与生成式编排 ----------

  /**
   * 指标落盘（旁路）：任何异常都不许阻断流水线——主线事实记账在 journal。
   * **但不许静默**：曾经的裸 `catch {}` 让 N6（contracts/metrics.schema.json 的 phase.enum 漏了 link）
   * 藏了整整一版——436 行 metrics 里 link/boundary 相各 0 条，而指标是唯一调优依据。
   * 现在改为落 `registry/diagnostics.jsonl` + stderr 一次。
   */

export function metric(kernel: Kernel,
    projectDir: string,
    state: RunState,
    nodeId: string,
    node: FlowNode,
    phase: MetricPhase,
    extra: Partial<RunMetric> = {},
  ): void {
    try {
      recordMetric(kernel, projectDir, {
        runId: state.runId,
        nodeId,
        ...(node.kit ? { kit: node.kit } : {}),
        ...(node.op ? { op: node.op } : {}),
        phase,
        round: state.nodes[nodeId]?.round ?? 0,
        ...extra,
      });
    } catch (e) {
      recordDiag(kernel, projectDir, "metric", `${nodeId}/${phase}`, e);
    }
  }

  /** 本步生效的 tool 内容配置快照——指标归因的依据（改了哪个旋钮导致指标变化）。 */

export function toolConfigSnapshot(kernel: Kernel, node: FlowNode, eff: EffectiveFlow): Record<string, unknown> | undefined {
    const op = resolveNodeOp(node, kernel.repoRoot, undefined, kernel.fs, kernel.path);
    if (!op) return node.config;
    const ov = eff.toolOverrides[`${op.kit}.${op.op}`];
    return resolveToolConfig(op, node.config, ov?.config).values;
  }

  /**
   * 重编译计划（生成式编排的落地机制）：
   * 编排被人/优化 agent 改过 → 计划重算；节点状态保留（磁盘真相优先），
   * 受影响的既有节点置 pending+stale（上游或执行体变了，旧产物不再可信）。
   */

export function replan(kernel: Kernel, state: RunState, flow: FlowDescriptor, cond: CondContext, eff: EffectiveFlow, projectDir: string): string[] {
    const before = state.plan?.order ?? [];
    const added: string[] = [];
    const removed: string[] = [];
    for (const id of Object.keys(flow.graph.nodes)) {
      if (!state.nodes[id]) { state.nodes[id] = { status: "none", round: 0 }; added.push(id); }
    }
    for (const id of Object.keys(state.nodes)) {
      if (!flow.graph.nodes[id]) { delete state.nodes[id]; removed.push(id); }
    }
    const after = compilePlan(flow, state.inputs ?? {}, cond);

    const stale: string[] = [];
    const touched = new Set([...added, ...removed]);
    if (touched.size) {
      const seen = new Set<string>(touched);
      const queue = [...touched];
      while (queue.length) {
        const cur = queue.shift()!;
        for (const e of flow.graph.edges) {
          if (e.from !== cur || isBackEdge(e) || seen.has(e.to)) continue;
          seen.add(e.to);
          queue.push(e.to);
          const ns = state.nodes[e.to];
          if (ns && (ns.status === "done" || ns.status === "awaiting")) {
            ns.status = "pending";
            ns.stale = true;
            ns.round += 1;
            ns.committed = [];
            stale.push(e.to);
          }
        }
      }
    }

    state.plan = { order: after };
    state.planHash = planHashOf(kernel, after, flow, eff.overlayHash);
    state.overlayHash = eff.overlayHash;
    state.policy = eff.policy as Record<string, unknown>;
    if (state.gate.verdict === "awaiting" && state.gate.node && !after.includes(state.gate.node)) {
      state.gate = { verdict: "none" };
    }
    state.status = "running";
    journalAppend(kernel, projectDir, state.runId, "note", {
      actor: "kernel:overlay",
      detail: `编排变更 → 重编译计划：${before.length} → ${after.length} 节点；新增 ${added.join("、") || "无"}；裁撤 ${removed.join("、") || "无"}；失效 ${stale.join("、") || "无"}`,
      refs: [...added, ...removed],
    });
    for (const n of eff.notes) journalAppend(kernel, projectDir, state.runId, "note", { actor: "kernel:overlay", detail: n });
    saveState(projectDir, state, kernel.fs, kernel.path);
    return after;
  }

  /** R5 只读面：生效编排 + 指标汇总（前端编排页与优化 agent 的共同事实源）。 */

export function activeUpstreams(kernel: Kernel, flow: FlowDescriptor, cond: CondContext): Map<string, string[]> {
    const inputs = cond.inputs;
    const gnodes = flow.graph.nodes;
    const incoming = new Map<string, string[]>();
    for (const n of Object.keys(gnodes)) incoming.set(n, []);
    const pruned = new Set<string>();
    for (const [inputName, def] of Object.entries(flow.inputs ?? {})) {
      const gateEdge = def.bind?.gate;
      if (!gateEdge) continue;
      const v = inputs[inputName];
      if (v === false || v === "off" || v === undefined || v === null) pruned.add(gateEdge);
    }
    const inactive = (id: string): boolean =>
      gnodes[id]?.when !== undefined && !evalWhen(gnodes[id]?.when, cond).active;
    for (const e of flow.graph.edges) {
      if (isBackEdge(e) || pruned.has(e.id)) continue;
      if (!incoming.has(e.to) || !incoming.has(e.from)) continue;
      if (inactive(e.from) || inactive(e.to)) continue;
      if (!evalWhen(e.when, cond).active) continue;
      incoming.get(e.to)!.push(e.from);
    }
    return incoming;
  }

  // ---------- 阶段/入口解析 ----------


export function resolveStageEntry(kernel: Kernel, flow: FlowDescriptor, gateNodeId: string, rootCauseStage?: string): string {
    const stages = flow.stages ?? [];
    if (rootCauseStage) {
      const s = stages.find((x) => x.id === rootCauseStage);
      if (s) return s.entry;
      if (flow.graph.nodes[rootCauseStage]) return rootCauseStage; // 允许直接指节点
    }
    const s = stages.find((x) => x.gate === gateNodeId || x.nodes?.includes(gateNodeId));
    return s?.entry ?? gateNodeId;
  }

  // ---------- 供 HTTP/可视化用的只读视图 ----------

