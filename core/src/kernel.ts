import fs from "node:fs";
import path from "node:path";
import type { FlowDescriptor, RunState, TaskPackage, Validation } from "./types.js";
import { ROOT, assertSchema } from "./schema.js";
import { atomicWriteText, LockDir } from "./fsio.js";
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
import { runIntegrityAsserts, runHeaderAsserts, blocked, checkGlossary, runDeclaredAsserts, dedupeValidations } from "./asserts.js";
import { runAestheticAsserts } from "./aesthetic.js";
import { runCoreNode, artifactPathOf, nodeOutput, outputPathOf, nodeAsserts } from "./minitools.js";
import { buildTaskPackage, effectiveUpstreams, resolveNodeOp } from "./assembler.js";
import { renderSpawnPrompt } from "./spawn.js";
import { loadProjectConfig, configToInputs, type ProjectConfig } from "./project-config.js";
import type { BatchEntry, FlowNode, MetricPhase, RunMetric } from "./types.js";
import {
  effectiveFlow, isBoundaryGate, isWorkGate, projectOverlayPath, readOverlay, writeProjectOverlay,
  type EffectiveFlow, type FlowOverlay, type OverlayPatch,
} from "./overlay.js";
import { recordMetric, readMetrics, summarizeMetrics, extractCtxUsage } from "./metrics.js";
import { proposeFromMetrics, buildReport, overlayFromProposals, readMinerFindings, minerToProposals } from "./optimize.js";
import { resolveToolConfig } from "./kits.js";
import { fnv1a, stableStringify } from "./ids.js";

export class KernelError extends Error {
  constructor(public code: string, public http: number, message: string) {
    super(message);
  }
}

/**
 * 断言指标的真口径（R5 §五）。
 * 旧写法 `pass: problems.length, block: 0` 是错报——把全部裁决算成通过、打回次数恒 0，
 * 直接污染优化器的成本口径（costOf 里的 assertBlock 溢价）与「这一步到底守住没」的判断。
 */
function assertCounts(
  problems: Validation[],
  declared: string[],
  unverified: string[],
): { pass: number; block: number; warn: number; names: string[]; declared: number; unverified: string[] } {
  return {
    pass: problems.filter((p) => p.status === "pass").length,
    block: problems.filter((p) => p.status === "block").length,
    warn: problems.filter((p) => p.status === "warn").length,
    names: [...new Set(problems.map((p) => p.name))],
    declared: declared.length,
    unverified,
  };
}

export type AdvanceStop =
  | { status: "completed" }
  | { status: "failed" }
  | { status: "awaiting_input"; nodeId: string; taskPackage: TaskPackage; batch?: BatchEntry[] }
  | { status: "suspended"; nodeId: string; gate: { nodeId: string; round: number; token: string; title?: string } }
  | { status: "blocked"; nodeId: string; reason: string; problems?: Validation[] };

export interface GateRequest {
  nodeId: string;
  verdict: "pass" | "pass-with-conditions" | "send-back" | "reject";
  comment?: string;
  rootCauseStage?: string;
  /** 强行介入：仅 force=true 时 rootCauseStage 才生效（跨阶段回滚 = 已验收阶段返工，人工操作而非门语义） */
  force?: boolean;
  round?: number;
  token?: string;
}

export interface KernelOptions {
  /** 数据根（projects/） */
  root?: string;
  /** 仓库根（kits/ knowledge/ flows/）——缺省 = 代码仓库根 */
  repoRoot?: string;
  flowsDir?: string;
}

export class Kernel {
  /** 数据根：projects/ 所在处（每个测试/宿主可有自己的数据根）。 */
  readonly root: string;
  /**
   * 仓库根：kits/ knowledge/ flows/ contracts/ 所在处。
   * 必须与数据根分开——此前两者混用 this.root，导致临时数据根下
   * kit 注册表解析为空、「55 个 tool 的配置项」与知识装载一起静默失效（不报错，只是什么都没有）。
   */
  readonly repoRoot: string;
  readonly flowsDir: string;

  constructor(opts: KernelOptions = {}) {
    this.root = opts.root ?? ROOT;
    this.repoRoot = opts.repoRoot ?? ROOT;
    this.flowsDir = opts.flowsDir ?? path.join(this.repoRoot, "flows");
  }

  // ---------- 路径与装载 ----------

  projectDir(projectId: string): string {
    return path.join(this.root, "projects", projectId);
  }

  loadFlow(flowId: string): FlowDescriptor {
    const file = path.join(this.flowsDir, flowId, "flow.json");
    if (!fs.existsSync(file)) throw new KernelError("UNKNOWN_FLOW", 404, `flow 不存在: ${flowId}`);
    return JSON.parse(fs.readFileSync(file, "utf-8")) as FlowDescriptor;
  }

  listFlows(): { id: string; title: string; version: string; status?: string }[] {
    if (!fs.existsSync(this.flowsDir)) return [];
    return fs
      .readdirSync(this.flowsDir)
      .filter((d) => fs.existsSync(path.join(this.flowsDir, d, "flow.json")))
      .map((d) => {
        const f = this.loadFlow(d);
        return { id: f.id, title: f.title, version: f.version, status: f.status };
      });
  }

  /**
   * 生效编排装载（R5 §一）：flow.json ⊕ 出厂 overlay ⊕ 项目 overlay ⊕ kit 边界派生。
   * 内核一切判断（计划/就绪/上下文/门）都必须基于它——否则「人改的编排」与「跑的编排」会分家。
   */
  effectiveOf(projectDir: string, flow: FlowDescriptor): EffectiveFlow {
    try {
      return effectiveFlow(this.repoRoot, flow, { projectDir });
    } catch (e) {
      throw new KernelError("BAD_OVERLAY", 409, `overlay 非法（拒绝静默降级为 bootstrap 编排）: ${(e as Error).message}`);
    }
  }

  private ctx(projectId: string): { state: RunState; projectDir: string; flow: FlowDescriptor; eff: EffectiveFlow; raw: FlowDescriptor } {
    const projectDir = this.projectDir(projectId);
    const state = loadState(projectDir);
    if (!state) throw new KernelError("NO_RUN", 404, `项目无 state.json（先 flow_run 或迁移）: ${projectId}`);
    const raw = this.loadFlow(state.flowId);
    const eff = this.effectiveOf(projectDir, raw);
    this.persistEffective(projectDir, eff, state);
    this.persistMetricsSummary(projectDir, state, eff);
    return { state, projectDir, flow: eff.flow, eff, raw };
  }

  /**
   * R5 生效编排读模型落盘（registry/effective.json）。
   *
   * 为什么必须落盘：编排派生（overlay 叠加 + kit 边界注入 + 逐节点配置合成）只允许有**一处**实现。
   * 页面生成器是纯 stdlib python，若在那边再实现一遍 domainMap/applyOverlay，两边必然漂移——
   * 于是内核把自己算出来的生效面写成只读模型，页面纯消费。这是「编排只有一个事实源」的落地方式。
   */
  private persistEffective(projectDir: string, eff: EffectiveFlow, state?: RunState): void {
    try {
      const nodeConfig: Record<string, unknown> = {};
      for (const [id, n] of Object.entries(eff.flow.graph.nodes)) {
        const op = resolveNodeOp(n, this.repoRoot);
        const ov = op ? eff.toolOverrides[`${op.kit}.${op.op}`] : undefined;
        const cfg = op ? resolveToolConfig(op, n.config, ov?.config) : undefined;
        nodeConfig[id] = {
          boundary: isBoundaryGate(n),
          gateRole: n.gate_role,
          output: artifactPathOf(eff.flow, id),
          kit: n.kit,
          op: n.op,
          nodeConfig: n.config ?? {},
          toolOverride: ov ?? null,
          resolved: cfg
            ? { values: cfg.values, defs: cfg.defs, sources: cfg.sources, unknownKeys: cfg.unknownKeys, genericOnly: cfg.genericOnly }
            : null,
        };
      }
      const view = {
        format: "effective@1",
        flowId: eff.flow.id,
        flowVersion: eff.flow.version,
        policy: eff.policy,
        overlayHash: eff.overlayHash,
        planHash: state?.planHash,
        boundaries: eff.boundaries,
        composition: eff.notes,
        applied: eff.appliedCount,
        toolOverrides: eff.toolOverrides,
        /** 生效编排全量：页面主图直接用它——边界验收节点只有这里有，bootstrap flow.json 里没有 */
        flow: eff.flow,
        /** 逐节点配置解析结果（值 + 逐键来源 + 未识别键），页面「配置」页的数据源 */
        nodeConfig,
      };
      fs.mkdirSync(path.join(projectDir, "registry"), { recursive: true });
      atomicWriteText(path.join(projectDir, "registry", "effective.json"), JSON.stringify(view, null, 2) + "\n");
    } catch {
      /* 读模型是旁路：写不出来不许阻断流水线（页面会退化为 bootstrap 视图并显式标注） */
    }
  }

  /**
   * R5 指标汇总读模型（registry/metrics-summary.json）。
   * 与 persistEffective 同理：聚合口径（哪些 phase 算 submits、成本怎么算、命中率分母是谁）
   * 只允许内核定义一次，页面/优化 agent 都消费同一份结果。
   */
  private persistMetricsSummary(projectDir: string, state: RunState, eff: EffectiveFlow): void {
    try {
      const events = readMetrics(projectDir);
      const pathToNode: Record<string, string> = {};
      for (const id of Object.keys(eff.flow.graph.nodes)) {
        const p = artifactPathOf(eff.flow, id);
        if (p) pathToNode[p] = id;
      }
      const summary = summarizeMetrics(events, { pathToNode });
      const view = { format: "metrics-summary@1", runId: state.runId, ...summary };
      fs.mkdirSync(path.join(projectDir, "registry"), { recursive: true });
      atomicWriteText(path.join(projectDir, "registry", "metrics-summary.json"), JSON.stringify(view, null, 2) + "\n");
    } catch {
      /* 旁路 */
    }
  }

  /** 计划指纹：生效编排的拓扑序 + 关键字段，用于检测「编排被人/优化 agent 改过」。 */
  private planHashOf(order: string[], effective: FlowDescriptor, overlayHash: string): string {
    const shape = order.map((id) => {
      const n = effective.graph.nodes[id];
      return `${id}:${n?.kind}:${n?.kit ?? ""}.${n?.op ?? n?.minitool ?? ""}:${fnv1a(stableStringify(n?.config ?? {}))}`;
    });
    return fnv1a(stableStringify({ order: shape, overlayHash }));
  }

  // ---------- 七动词 ----------

  flow_list() {
    return this.listFlows();
  }

  async flow_run(flowId: string, projectId: string, inputs: Record<string, unknown> = {}): Promise<AdvanceStop> {
    const bootstrap = this.loadFlow(flowId);
    const projectDir = this.projectDir(projectId);
    if (loadState(projectDir)) throw new KernelError("RUN_EXISTS", 409, `项目已有 state.json: ${projectId}`);
    // R5：运行编排 = bootstrap ⊕ overlay ⊕ kit 边界派生（项目级 overlay 在此生效）
    const eff = this.effectiveOf(projectDir, bootstrap);
    const flow = eff.flow;
    // K1.5 项目初始化配置：合并序 = 显式入参 > 项目配置.json > flow 默认（配置非法开跑前大声失败）
    const cfg = this.readProjectConfig(projectDir);
    const cfgInputs = cfg ? configToInputs(cfg, flow) : {};

    // 现网 run-state.json 自动迁移（幂等入口）
    if (fs.existsSync(legacyStatePath(projectDir))) {
      const resolved = resolveInputs(flow, { ...cfgInputs, ...inputs }, { project: projectId });
      const { state, seedEvents } = migrateRunState(projectDir, projectId, flow, resolved);
      if (cfg?.presets) state.presets = { ...state.presets, ...cfg.presets };
      saveState(projectDir, state);
      writeJournalSeed(projectDir, seedEvents);
      journalAppend(projectDir, state.runId, "run-start", {
        actor: "kernel:migrate",
        detail: `迁移自 run-state.json（${flow.id}@${flow.version}），gate=${state.gate.verdict}`,
      });
      this.noteConfig(projectDir, state.runId, cfg);
      state.status = state.gate.verdict === "awaiting" ? "suspended" : "running";
      state.overlayHash = eff.overlayHash;
      state.policy = eff.policy as Record<string, unknown>;
      state.planHash = this.planHashOf(state.plan?.order ?? [], flow, eff.overlayHash);
      saveState(projectDir, state);
      return this.advance(projectId, state, projectDir, bootstrap);
    }

    let resolved: Record<string, unknown>;
    try {
      resolved = resolveInputs(flow, { ...cfgInputs, ...eff.inputs, ...inputs }, { project: projectId }); // type:"project" 的输入由内核注入
    } catch (e) {
      throw new KernelError("INVALID_INPUT", 400, (e as Error).message);
    }
    fs.mkdirSync(projectDir, { recursive: true });
    const state = freshState(flow, projectId, resolved);
    if (cfg?.presets) state.presets = { ...state.presets, ...cfg.presets };
    state.overlayHash = eff.overlayHash;
    state.policy = eff.policy as Record<string, unknown>;
    state.planHash = this.planHashOf(state.plan?.order ?? [], flow, eff.overlayHash);
    journalAppend(projectDir, state.runId, "run-start", { detail: `${flow.id}@${flow.version} 计划 ${state.plan?.order.length ?? 0} 节点` });
    if (eff.notes.length) {
      journalAppend(projectDir, state.runId, "note", { actor: "kernel:overlay", detail: `生效编排合成：${eff.notes.join(" ｜ ")}` });
    }
    this.noteConfig(projectDir, state.runId, cfg);
    saveState(projectDir, state);
    return this.advance(projectId, state, projectDir, bootstrap);
  }

  /** 项目初始化配置装载（不存在=undefined；非法=开跑前大声失败）。 */
  private readProjectConfig(projectDir: string): ProjectConfig | undefined {
    try {
      return loadProjectConfig(projectDir);
    } catch (e) {
      throw new KernelError("INVALID_INPUT", 400, `项目配置非法: ${(e as Error).message}`);
    }
  }

  private noteConfig(projectDir: string, runId: string, cfg: ProjectConfig | undefined): void {
    if (!cfg) return;
    const bits = [
      cfg.严肃性 ? `严肃性=${cfg.严肃性}` : "",
      cfg.风格 ? `风格=${cfg.风格}` : "",
      cfg.AB测试 !== undefined ? `AB=${cfg.AB测试 ? "on" : "off"}` : "",
    ].filter(Boolean);
    journalAppend(projectDir, runId, "note", { actor: "kernel:config", detail: `初始化配置装载：${bits.join(" ")}` });
  }

  /** 调度推进：core 步就地执行，认知步产出任务包，门挂起。幂等。 */
  async flow_next(
    projectId: string,
    opts: { spawnPrompt?: boolean } = {},
  ): Promise<AdvanceStop & { spawnPrompt?: string; batch?: Array<BatchEntry & { spawnPrompt?: string }> }> {
    const lock = this.acquireLock(this.projectDir(projectId));
    try {
      const { state, projectDir, flow } = this.ctx(projectId);
      if (state.status === "completed" || state.status === "failed") return { status: state.status };
      const stop = await this.advance(projectId, state, projectDir, flow);
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
  private acquireLock(projectDir: string): LockDir {
    const lock = new LockDir(path.join(projectDir, "state.json"));
    if (!lock.acquire()) throw new KernelError("LOCK_BUSY", 409, "同一项目另有提交/裁决在进行中，请稍后重试");
    return lock;
  }

  async flow_submit(
    projectId: string,
    nodeId: string,
    output: { content?: string; file?: string; notes?: string; seal?: boolean },
  ): Promise<{ status: "accepted" | "rejected"; problems?: Validation[]; committed?: string[]; sealed?: boolean; next?: AdvanceStop }> {
    const lock = this.acquireLock(this.projectDir(projectId));
    try {
      return await this.doSubmit(projectId, nodeId, output, lock);
    } finally {
      lock.release();
    }
  }

  private async doSubmit(
    projectId: string,
    nodeId: string,
    output: { content?: string; file?: string; notes?: string; seal?: boolean },
    _lock: LockDir,
  ): Promise<{ status: "accepted" | "rejected"; problems?: Validation[]; committed?: string[]; sealed?: boolean; next?: AdvanceStop }> {
    const { state, projectDir, flow, eff } = this.ctx(projectId);
    const node = flow.graph.nodes[nodeId];
    const ns = state.nodes[nodeId];
    if (!node || !ns) throw new KernelError("NO_NODE", 404, `图中无节点 ${nodeId}`);
    // R5：带产活的门是评审步，走与 agent 步同一条交卷路径（否则它的产物永远没人收，节点却照判 done）
    const workGate = isWorkGate(node) && !isBoundaryGate(node);
    if (node.kind !== "agent" && !workGate) {
      throw new KernelError("NOT_AGENT_NODE", 409, `节点 ${nodeId} 不是可交卷的步（kind=${node.kind}${isBoundaryGate(node) ? "，kit 边界验收门只接受 flow_gate 裁决" : ""}）`);
    }
    if (ns.status !== "awaiting") throw new KernelError("NODE_NOT_AWAITING", 409, `节点 ${nodeId} 不在等待提交（status=${ns.status}）`);

    const contractFile = artifactPathOf(flow, nodeId);
    const rel = output.file ?? contractFile;
    if (!rel) throw new KernelError("NO_OUTPUT_CONTRACT", 400, `节点 ${nodeId} 未声明产物路径`);
    const abs = path.resolve(projectDir, rel);
    if (!abs.startsWith(path.resolve(projectDir) + path.sep)) {
      throw new KernelError("PATH_ESCAPE", 400, `产物路径越界: ${rel}`);
    }
    if (output.content !== undefined) {
      atomicWriteText(abs, output.content);
    } else if (!fs.existsSync(abs)) {
      throw new KernelError("FILE_MISSING", 404, `产物文件不存在且未提供 content: ${rel}`);
    }

    const problems = runIntegrityAsserts(projectDir, rel);
    // 过程交付件头部（规范 R4 §二）：版本/上游/审核背景的唯一真相，正文不得复述
    problems.push(
      ...runHeaderAsserts(projectDir, rel, {
        node: nodeId,
        round: (ns.round ?? 0) + 1,
        by: node.kit && node.op ? `kit/${node.kit}.${node.op}` : node.minitool ? `core/${node.minitool}` : undefined,
        rootInputs: Object.entries(flow.graph.nodes)
          .filter(([, n]) => n.kind === "novel-txt")
          .map(([, n]) => nodeOutput(n))
          .filter((p): p is string => !!p),
      }),
    );
    const glossary = checkGlossary(this.root, projectDir, rel);
    if (glossary) problems.push(glossary);
    const opRef = resolveNodeOp(node, this.repoRoot, eff.toolOverrides);
    // R5 §四：节点 + op 声明的断言必须真跑（声明即契约，不是任务包上的一行字）。
    // op 侧带上 overlay 的 set-tool（add_asserts）——加过的断言从这一刻起就是硬的。
    const declared = [...new Set([...nodeAsserts(node), ...(opRef?.asserts ?? [])])];
    const declaredOutcome = runDeclaredAsserts(projectDir, rel, declared);
    problems.push(...declaredOutcome.results);
    if (rel.replaceAll("\\", "/").startsWith("对外交付/")) {
      // 客户交付件：引擎全量（交付出口的兜底体检，与声明无关也照跑）
      problems.push(...runAestheticAsserts(projectDir, rel));
    }
    const finalProblems = dedupeValidations(problems);
    const blocks = blocked(finalProblems);
    if (blocks.length) {
      ns.failCount = (ns.failCount ?? 0) + 1;
      // 打回的断言必须落指标——否则 R5 的成本口径（assertBlock 溢价）永远是 0，优化器看不到打回
      this.metric(projectDir, state, nodeId, node, "submit", {
        asserts: assertCounts(finalProblems, declared, declaredOutcome.unverified),
        retries: ns.failCount,
        verdict: "rejected",
        note: `打回：${blocks.map((b) => b.name).join("、")}`,
      });
      journalAppend(projectDir, state.runId, "reject", {
        nodeId,
        detail: blocks.map((b) => `${b.name}: ${b.detail}`).join("; "),
        refs: [rel],
      });
      saveState(projectDir, state);
      return { status: "rejected", problems: finalProblems };
    }
    if (declaredOutcome.unverified.length) {
      journalAppend(projectDir, state.runId, "warn", {
        nodeId,
        detail: `声明断言无机器校验器（未执行，归评审/红方剖面）：${declaredOutcome.unverified.join("、")}`,
        refs: [rel],
      });
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
      inputs: inputFingerprint(projectDir, upstreamFiles),
      validations: finalProblems,
    });
    captureSnapshot(projectDir, nodeId, { [rel]: fs.readFileSync(abs, "utf-8") }, `submit r${Math.max(ns.round, 1)}·${path.basename(rel)}`);
    // R5 指标：命中率 = 注入的标尺卡/上游件中，产物真正引用过的比例（信号取自 artifact@1 头部 upstream 与正文）
    try {
      const injected = [...(opRef?.knowledge ?? []), ...upstreamFiles];
      const usage = extractCtxUsage(fs.readFileSync(abs, "utf-8"), injected);
      this.metric(projectDir, state, nodeId, node, "submit", {
        ctx: usage,
        asserts: assertCounts(finalProblems, declared, declaredOutcome.unverified),
        retries: ns.failCount ?? 0,
        verdict: ns.verdict,
      });
    } catch {
      /* 指标是旁路 */
    }
    journalAppend(projectDir, state.runId, "submit", { nodeId, detail: rel, refs: [rel] });
    journalAppend(projectDir, state.runId, "snapshot", { nodeId, detail: `r${ns.round}·${path.basename(rel)}`, refs: [rel] });
    // R5：评审步交卷即自动裁决（不再等人开门）。域内质量由该 tool 的 asserts/config 承担；
    // 要人接手的唯一入口是 kit 边界验收门，或 policy.gate_mode=manual。
    if (workGate && (eff.policy.gate_mode ?? "auto") === "auto") {
      ns.verdict = "pass";
      state.gate = { verdict: "pass", node: nodeId, at: nowIso(), note: "R5 自动裁决：域内评审步，交卷断言全过即过" };
      this.metric(projectDir, state, nodeId, node, "auto-gate", { verdict: "pass", note: "R5 评审步自动裁决" });
      journalAppend(projectDir, state.runId, "verdict", {
        nodeId,
        detail: "auto-pass（R5：域内评审步自动裁决；要人接手请置 policy.gate_mode=manual，或由优化器按指标裁掉该步）",
      });
    }
    state.status = "running";
    saveState(projectDir, state);
    if (batchable && !output.seal) {
      return { status: "accepted", committed: ns.committed, sealed: false };
    }
    const next = await this.advance(projectId, state, projectDir, flow);
    return { status: "accepted", committed: ns.committed, sealed: true, next };
  }

  async flow_resume(projectId: string): Promise<AdvanceStop> {
    const { state, projectDir, flow } = this.ctx(projectId);
    if (state.status === "completed" || state.status === "failed") return { status: state.status };
    // 恢复纪律：running 的半成品宁重跑；awaiting（等提交）保留
    for (const ns of Object.values(state.nodes)) {
      if (ns.status === "running") ns.status = "none";
    }
    if (planDrifted(state, flow)) {
      journalAppend(projectDir, state.runId, "warn", { detail: "flow 指纹与快照不一致——沿用快照内计划（恢复不读图）" });
    }
    state.status = state.gate.verdict === "awaiting" ? "suspended" : "running";
    saveState(projectDir, state);
    return this.advance(projectId, state, projectDir, flow);
  }

  async flow_gate(projectId: string, req: GateRequest): Promise<{ applied: true; completed?: boolean; failed?: boolean; rollbackScope?: string[]; next?: AdvanceStop }> {
    const lock = this.acquireLock(this.projectDir(projectId));
    try {
      return await this.doGate(projectId, req);
    } finally {
      lock.release();
    }
  }

  private async doGate(projectId: string, req: GateRequest): Promise<{ applied: true; completed?: boolean; failed?: boolean; rollbackScope?: string[]; next?: AdvanceStop }> {
    const { state, projectDir, flow } = this.ctx(projectId);
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

    if (req.verdict === "pass" || req.verdict === "pass-with-conditions") {
      ns.status = "done";
      ns.verdict = req.verdict;
      ns.round += 1;
      ns.stale = false;
      state.gate = { verdict: req.verdict, node: req.nodeId, at: nowIso(), note: req.comment };
      this.metric(projectDir, state, req.nodeId, gateNode ?? { kind: "gate" }, isBoundaryGate(gateNode) ? "boundary" : "gate", {
        verdict: req.verdict, note: req.comment,
      });
      journalAppend(projectDir, state.runId, "verdict", { nodeId: req.nodeId, detail: `${req.verdict}${req.comment ? "：" + req.comment : ""}` });
      if (gateNode?.kind === "srd") {
        state.status = "completed";
        journalAppend(projectDir, state.runId, "run-end", { detail: "srd 裁决通过，run 完成" });
        saveState(projectDir, state);
        return { applied: true, completed: true };
      }
      state.status = "running";
      saveState(projectDir, state);
      const next = await this.advance(projectId, state, projectDir, flow);
      return { applied: true, next };
    }

    if (req.verdict === "send-back") {
      // 打回默认只作用于本阶段：回本阶段入口定点重做，失效范围限本阶段。
      // 已 pass 阶段的产物视为定稿；跨阶段回滚 = 用户强行介入（force + rootCauseStage），不是门语义。
      const gateStage = (flow.stages ?? []).find((s) => s.gate === req.nodeId || s.nodes?.includes(req.nodeId));
      const forced = req.force === true && !!req.rootCauseStage;
      const entry = forced ? this.resolveStageEntry(flow, req.nodeId, req.rootCauseStage) : this.resolveStageEntry(flow, req.nodeId);
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
          journalAppend(projectDir, state.runId, "stale", { nodeId: id, detail: forced ? "强制级联失效，待重算" : "本阶段打回失效，待重算" });
        }
      }
      ns.verdict = "send-back";
      ns.status = "pending";
      if (req.rootCauseStage) ns.rootCauseStage = req.rootCauseStage;
      state.gate = { verdict: "send-back", node: req.nodeId, at: nowIso(), note: req.comment };
      state.lastRejectReason = req.comment ?? req.rootCauseStage ?? "";
      state.status = "running";
      journalAppend(projectDir, state.runId, "verdict", {
        nodeId: req.nodeId,
        detail: `send-back → ${entry}（${forced ? "强制跨阶段" : "本阶段"}，${scope.length} 节点失效）${req.comment ? "：" + req.comment : ""}`,
        refs: scope,
      });
      saveState(projectDir, state);
      const next = await this.advance(projectId, state, projectDir, flow);
      return { applied: true, rollbackScope: scope, next };
    }

    if (req.verdict === "reject") {
      ns.verdict = "reject";
      state.gate = { verdict: "reject", node: req.nodeId, at: nowIso(), note: req.comment };
      this.metric(projectDir, state, req.nodeId, gateNode ?? { kind: "gate" }, isBoundaryGate(gateNode) ? "boundary" : "gate", {
        verdict: "reject", note: req.comment,
      });
      state.status = "failed";
      journalAppend(projectDir, state.runId, "verdict", { nodeId: req.nodeId, detail: `reject${req.comment ? "：" + req.comment : ""}` });
      journalAppend(projectDir, state.runId, "run-end", { detail: "门裁决 reject，run 终止" });
      saveState(projectDir, state);
      return { applied: true, failed: true };
    }

    throw new KernelError("INVALID_VERDICT", 400, `未知裁决: ${req.verdict}`);
  }

  async flow_rerun(projectId: string, req: { nodeId: string; dryRun?: boolean }): Promise<{ scope: string[]; dryRun: boolean; cacheCandidates?: string[]; next?: AdvanceStop }> {
    const lock = this.acquireLock(this.projectDir(projectId));
    try {
      return await this.doRerun(projectId, req);
    } finally {
      lock.release();
    }
  }

  private async doRerun(projectId: string, req: { nodeId: string; dryRun?: boolean }): Promise<{ scope: string[]; dryRun: boolean; cacheCandidates?: string[]; next?: AdvanceStop }> {
    const { state, projectDir, flow } = this.ctx(projectId);
    const order = state.plan?.order ?? Object.keys(state.nodes);
    const idx = order.indexOf(req.nodeId);
    if (idx < 0) throw new KernelError("NO_NODE", 404, `节点不在计划内: ${req.nodeId}`);
    const scope = order.slice(idx);
    if (req.dryRun) {
      // 预览：确定性步中输入指纹未变者为缓存候选（创意步与门永远真重做）
      const cacheCandidates = scope.filter((id) => {
        const kind = flow.graph.nodes[id]?.kind;
        if (kind !== "core") return false;
        const entry = this.lastArtifactEntry(projectDir, id);
        return !!entry?.inputs && Object.keys(entry.inputs).length > 0 && this.fingerprintMatches(projectDir, entry.inputs);
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
        journalAppend(projectDir, state.runId, "stale", { nodeId: id, detail: "rerun 级联失效" });
      }
    }
    if (state.gate.verdict === "awaiting") state.gate = { verdict: "none" };
    state.status = "running";
    journalAppend(projectDir, state.runId, "rerun", { nodeId: req.nodeId, detail: `scope ${scope.length} 节点`, refs: scope });
    saveState(projectDir, state);
    const next = await this.advance(projectId, state, projectDir, flow, req.nodeId);
    return { scope, dryRun: false, next };
  }

  private lastArtifactEntry(projectDir: string, nodeId: string) {
    const arts = listArtifacts(projectDir, { node: nodeId });
    return arts.length ? arts[arts.length - 1] : undefined;
  }

  private fingerprintMatches(projectDir: string, fp: Record<string, string | null>): boolean {
    const current = inputFingerprint(projectDir, Object.keys(fp));
    return Object.entries(fp).every(([p, h]) => current[p] === h);
  }

  // ---------- 调度循环 ----------

  private async advance(projectId: string, state: RunState, projectDir: string, bootstrap: FlowDescriptor, forceNodeId?: string): Promise<AdvanceStop> {
    // R5：装载生效编排（bootstrap ⊕ overlay ⊕ 边界派生）。编排被人/优化 agent 改过即重编译计划。
    const eff = this.effectiveOf(projectDir, bootstrap);
    const flow = eff.flow;
    // 未收口迭代节点数一并注入：`{loop:"pending"}` 由此从"看得见判不动"变成可求值（规范 R4 §5.2）
    const cond = condContextOf({ ...state, pendingInstances: pendingInstancesOf(flow, state) });
    let order = state.plan?.order ?? compilePlan(flow, state.inputs ?? {}, cond);
    const planHash = this.planHashOf(order, flow, eff.overlayHash);
    if (state.overlayHash === undefined) {
      // 旧 run 首次接触 R5：认领当前编排指纹但不重编译——在跑的 run 不因版本升级被打断
      state.overlayHash = eff.overlayHash;
      state.policy = eff.policy as Record<string, unknown>;
      state.planHash = planHash;
      if (eff.boundaries.length) {
        journalAppend(projectDir, state.runId, "note", {
          actor: "kernel:overlay",
          detail: `R5 编排已就绪（${eff.boundaries.length} 个 kit 边界验收待生效）。本次沿用快照内计划；如需启用请 flow_overlay --replan。`,
        });
      }
      saveState(projectDir, state);
    } else if (state.overlayHash !== eff.overlayHash) {
      order = this.replan(state, flow, cond, eff, projectDir);
    }
    state.policy = eff.policy as Record<string, unknown>;
    this.persistEffective(projectDir, eff, state);
    // 就绪批调度：AND-join——节点就绪 = 全部活跃上游 done；同批认知步一次派发，宿主并行执行。
    // 不在计划内的上游（不可达支线，如批注回流=off 时的 intake）不阻塞就绪判定。
    const inPlan = new Set(order);
    const upMap = this.activeUpstreams(flow, cond);
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
        // R5 门降级（§四）：非 kit 边界的门不再阻塞——域内质量已由该 tool 的 asserts/config 承担。
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
          this.metric(projectDir, state, id, node, "auto-gate", { verdict: "pass", note: "R5 门降级：纯汇合点无产活，直接放行" });
          journalAppend(projectDir, state.runId, "verdict", {
            nodeId: id,
            detail: "auto-pass（R5 门降级：纯汇合点无产活；如需人工请置 policy.gate_mode=manual 或用 overlay 裁掉该节点）",
          });
          saveState(projectDir, state);
          continue;
        }
        // (b) 带产活的门 = 评审步：**照跑**（派发任务包、产物照出），只是裁决自动。
        //     这是「拥抱生成式 flow」的关键一步——评审不再是人的串行屏障，但它该干的活不许被跳过。
        if (autoRegion && isWorkGate(node) && !humanEngaged) {
          const pkg = buildTaskPackage(projectDir, flow, state, id, eff.toolOverrides);
          batch.push({ nodeId: id, taskPackage: pkg });
          ns.status = "awaiting";
          state.status = "awaiting_input";
          this.metric(projectDir, state, id, node, "dispatch", {
            ctx: {
              offered: (pkg.knowledge?.length ?? 0) + pkg.context.length,
              ids: [...(pkg.knowledge ?? []).map((k) => k.id), ...pkg.context.map((c) => c.ref)],
            },
            config: this.toolConfigSnapshot(node, eff),
          });
          journalAppend(projectDir, state.runId, "advance", {
            nodeId: id,
            detail: `评审步派发（R5：评审照跑，裁决自动——域内质量交回该 tool 的 asserts/config；如需人工请置 policy.gate_mode=manual）`,
          });
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
        journalAppend(projectDir, state.runId, "gate-open", { nodeId: id, detail: node.title ?? "" });
        saveState(projectDir, state);
        return { status: "suspended", nodeId: id, gate: { nodeId: id, round: ns.round, token, title: node.title } };
      }

      if (ns.status === "awaiting") {
        // 已派发、等待提交的认知步：每轮重组任务包（磁盘真相 > 对话记忆），并入就绪批
        batch.push({ nodeId: id, taskPackage: buildTaskPackage(projectDir, flow, state, id, eff.toolOverrides) });
        state.status = "awaiting_input";
        continue;
      }

      if (node.kind === "novel-txt") {
        const f = nodeOutput(node);
        if (!f || !fs.existsSync(path.join(projectDir, f))) {
          journalAppend(projectDir, state.runId, "warn", { nodeId: id, detail: `源文件缺失: ${f}` });
          return { status: "blocked", nodeId: id, reason: `源文件缺失: ${f}` };
        }
        makeArtifact(projectDir, { path: f, node: id, producer: "kernel:novel-txt", inputs: {} });
        captureSnapshot(projectDir, id, { [f]: fs.readFileSync(path.join(projectDir, f), "utf-8") }, `src r1·${path.basename(f)}`);
        ns.status = "done";
        ns.round += 1;
        ns.stale = false;
        ns.lastArtifact = f;
        journalAppend(projectDir, state.runId, "advance", { nodeId: id, detail: `源步 ${f}` });
        saveState(projectDir, state);
        continue;
      }

      if (node.kind === "core") {
        if (!isReady(id)) continue; // 上游分支未齐：本轮不执行，后续 flow_next 再推进
        if (ns.status === "pending" && id !== forceNodeId) {
          // 指纹缓存命中（v3 mtime-skip 的内容寻址版）：send-back/rerun 后若上游重跑产物字节未变，不重算。
          // 只对确定性步生效——认知步被 send-back 时「重做」本身就是目的。
          const entry = this.lastArtifactEntry(projectDir, id);
          if (entry?.inputs && Object.keys(entry.inputs).length > 0 && this.fingerprintMatches(projectDir, entry.inputs)) {
            ns.status = "done";
            ns.stale = false;
            journalAppend(projectDir, state.runId, "advance", { nodeId: id, detail: "缓存命中（输入指纹未变，跳过重算）" });
            saveState(projectDir, state);
            continue;
          }
        }
        const r = await runCoreNode(projectDir, flow, state, id);
        if (!r.ok && r.kind === "missing") {
          journalAppend(projectDir, state.runId, "warn", { nodeId: id, detail: r.reason });
          return { status: "blocked", nodeId: id, reason: r.reason ?? "minitool missing" };
        }
        if (!r.ok) {
          ns.status = "rejected";
          ns.failCount = (ns.failCount ?? 0) + 1;
          this.metric(projectDir, state, id, node, "core", {
            verdict: "block",
            asserts: { pass: 0, block: r.problems?.length ?? 1, names: (r.problems ?? []).map((p) => p.name) },
            retries: ns.failCount,
            note: r.reason,
          });
          journalAppend(projectDir, state.runId, "reject", { nodeId: id, detail: r.reason ?? "断言未过", refs: r.artifacts });
          saveState(projectDir, state);
          return { status: "blocked", nodeId: id, reason: r.reason ?? "断言未过", problems: r.problems };
        }
        ns.status = "done";
        ns.round += 1;
        ns.stale = false;
        ns.lastArtifact = r.artifacts[0];
        this.metric(projectDir, state, id, node, "core", { verdict: "pass" });
        journalAppend(projectDir, state.runId, "advance", { nodeId: id, detail: r.artifacts.join(","), refs: r.artifacts });
        saveState(projectDir, state);
        continue;
      }

      if (node.kind === "agent") {
        if (!isReady(id)) continue; // 上游未齐：不派发
        const pkg = buildTaskPackage(projectDir, flow, state, id, eff.toolOverrides);
        batch.push({ nodeId: id, taskPackage: pkg });
        ns.status = "awaiting";
        state.status = "awaiting_input";
        // R5 指标：派发相记「装载了多少件上下文」——命中率的分母
        this.metric(projectDir, state, id, node, "dispatch", {
          ctx: {
            offered: (pkg.knowledge?.length ?? 0) + pkg.context.length,
            ids: [...(pkg.knowledge ?? []).map((k) => k.id), ...pkg.context.map((c) => c.ref)],
          },
          config: this.toolConfigSnapshot(node, eff),
        });
        journalAppend(projectDir, state.runId, "advance", { nodeId: id, detail: `任务包产出（skill=${node.skill ?? "-"}，上下文 ${pkg.context.length} 件）` });
        continue; // 收集同批其余就绪节点，循环结束后一次派发
      }

      journalAppend(projectDir, state.runId, "warn", { nodeId: id, detail: `未知节点类型 ${node.kind}` });
      return { status: "blocked", nodeId: id, reason: `未知节点类型 ${node.kind}` };
    }

    if (batch.length) {
      // 同批节点互不依赖（AND-join 就绪集），宿主可并行执行
      const ids = batch.map((b) => b.nodeId);
      for (const b of batch) b.taskPackage.parallelWith = ids.filter((n) => n !== b.nodeId);
      journalAppend(projectDir, state.runId, "advance", {
        detail: `就绪批派发 ${batch.length} 项：${ids.join("、")}（并行）`,
      });
      saveState(projectDir, state);
      return { status: "awaiting_input", nodeId: ids[0], taskPackage: batch[0].taskPackage, batch };
    }

    state.status = "completed";
    journalAppend(projectDir, state.runId, "run-end", { detail: "全部节点 done" });
    saveState(projectDir, state);
    return { status: "completed" };
  }

  // ---------- R5：运行指标与生成式编排 ----------

  /** 指标落盘（旁路）：任何异常都不许阻断流水线——主线事实记账在 journal。 */
  private metric(
    projectDir: string,
    state: RunState,
    nodeId: string,
    node: FlowNode,
    phase: MetricPhase,
    extra: Partial<RunMetric> = {},
  ): void {
    try {
      recordMetric(projectDir, {
        runId: state.runId,
        nodeId,
        ...(node.kit ? { kit: node.kit } : {}),
        ...(node.op ? { op: node.op } : {}),
        phase,
        round: state.nodes[nodeId]?.round ?? 0,
        ...extra,
      });
    } catch {
      /* 指标是旁路 */
    }
  }

  /** 本步生效的 tool 内容配置快照——指标归因的依据（改了哪个旋钮导致指标变化）。 */
  private toolConfigSnapshot(node: FlowNode, eff: EffectiveFlow): Record<string, unknown> | undefined {
    const op = resolveNodeOp(node, this.repoRoot);
    if (!op) return node.config;
    const ov = eff.toolOverrides[`${op.kit}.${op.op}`];
    return resolveToolConfig(op, node.config, ov?.config).values;
  }

  /**
   * 重编译计划（生成式编排的落地机制）：
   * 编排被人/优化 agent 改过 → 计划重算；节点状态保留（磁盘真相优先），
   * 受影响的既有节点置 pending+stale（上游或执行体变了，旧产物不再可信）。
   */
  private replan(state: RunState, flow: FlowDescriptor, cond: CondContext, eff: EffectiveFlow, projectDir: string): string[] {
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
    state.planHash = this.planHashOf(after, flow, eff.overlayHash);
    state.overlayHash = eff.overlayHash;
    state.policy = eff.policy as Record<string, unknown>;
    if (state.gate.verdict === "awaiting" && state.gate.node && !after.includes(state.gate.node)) {
      state.gate = { verdict: "none" };
    }
    state.status = "running";
    journalAppend(projectDir, state.runId, "note", {
      actor: "kernel:overlay",
      detail: `编排变更 → 重编译计划：${before.length} → ${after.length} 节点；新增 ${added.join("、") || "无"}；裁撤 ${removed.join("、") || "无"}；失效 ${stale.join("、") || "无"}`,
      refs: [...added, ...removed],
    });
    for (const n of eff.notes) journalAppend(projectDir, state.runId, "note", { actor: "kernel:overlay", detail: n });
    saveState(projectDir, state);
    return after;
  }

  /** R5 只读面：生效编排 + 指标汇总（前端编排页与优化 agent 的共同事实源）。 */
  viewEffect(projectId: string) {
    const projectDir = this.projectDir(projectId);
    const state = loadState(projectDir);
    if (!state) throw new KernelError("NO_RUN", 404, `项目无 state.json: ${projectId}`);
    const raw = this.loadFlow(state.flowId);
    const eff = this.effectiveOf(projectDir, raw);
    this.persistEffective(projectDir, eff, state);
    this.persistMetricsSummary(projectDir, state, eff);
    const events = readMetrics(projectDir);
    const pathToNode: Record<string, string> = {};
    for (const id of Object.keys(eff.flow.graph.nodes)) {
      const p = artifactPathOf(eff.flow, id);
      if (p) pathToNode[p] = id;
    }
    const summary = summarizeMetrics(events, { pathToNode });
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
      mine,
    };
  }

  /** R5 优化：由指标产出提案（写 registry/optimize.json）；`--apply` 落成 overlay（低风险自动，其余待批）。
   *  WO-挖掘：registry/miner-findings.json（编排挖掘师产物，flow_mine → Skill → findings@1）存在时并入：
   *  非结构类 finding → M@ 提案（risk 恒 medium，人批才落地）；结构类 → report.mineStructural 拍板清单。 */
  flowOptimize(projectId: string, opts: { apply?: boolean; actor?: string } = {}) {
    const projectDir = this.projectDir(projectId);
    const state = loadState(projectDir);
    if (!state) throw new KernelError("NO_RUN", 404, `项目无 state.json: ${projectId}`);
    const raw = this.loadFlow(state.flowId);
    const eff = this.effectiveOf(projectDir, raw);
    const pathToNode: Record<string, string> = {};
    for (const id of Object.keys(eff.flow.graph.nodes)) {
      const p = artifactPathOf(eff.flow, id);
      if (p) pathToNode[p] = id;
    }
    const summary = summarizeMetrics(readMetrics(projectDir), { pathToNode });
    const proposals = proposeFromMetrics(eff.flow, summary, { root: this.repoRoot, policy: eff.policy });
    let sources: ("metrics" | "miner")[] = ["metrics"];
    let mineStructural: ReturnType<typeof minerToProposals>["structural"] = [];
    const mine = readMinerFindings(this.repoRoot, eff.flow.id) ?? readMinerFindings(projectDir, eff.flow.id);
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
    const report = buildReport(eff.flow, summary, eff.policy, proposals, { sources, mineStructural });
    fs.mkdirSync(path.join(projectDir, "registry"), { recursive: true });
    atomicWriteText(path.join(projectDir, "registry", "optimize.json"), JSON.stringify(report, null, 2) + "\n");
    let written: string | undefined;
    if (opts.apply && proposals.length) {
      const ov = overlayFromProposals(proposals, { flowId: eff.flow.id, adapt: eff.policy.adapt });
      written = writeProjectOverlay(projectDir, ov, opts.actor ?? "optimizer", state.overlayHash, undefined);
      journalAppend(projectDir, state.runId, "note", {
        actor: opts.actor ?? "optimizer",
        detail: `优化提案落地 ${ov.patches.filter((p) => p.status === "applied").length} 条（adapt=${eff.policy.adapt ?? "propose"}），其余 ${ov.patches.filter((p) => p.status === "proposed").length} 条待批；来源 ${sources.join("+")}；挖掘师结构类拍板项 ${mineStructural.length} 条未入 overlay`,
      });
    }
    return { report, written, adapt: eff.policy.adapt ?? "propose", mineStructural };
  }

  /**
   * R5 §六 质性通道（编排挖掘师）：组装事后挖掘任务包。
   * 挖掘师（通用 Skill orchestration-miner）消费本包 → 写 registry/miner-findings.json（findings@1）
   * → flow_optimize 自动并入提案。内核不做任何 LLM 判断，只负责把证据摆上桌。
   */
  flowMine(projectId: string) {
    const projectDir = this.projectDir(projectId);
    const state = loadState(projectDir);
    if (!state) throw new KernelError("NO_RUN", 404, `项目无 state.json: ${projectId}`);
    const raw = this.loadFlow(state.flowId);
    const eff = this.effectiveOf(projectDir, raw);
    this.persistEffective(projectDir, eff, state);
    this.persistMetricsSummary(projectDir, state, eff);

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

    // 证据文件清单：中间文件（内部/对外交付/世界书）+ 断言报告 + 批注（都给相对路径，挖掘师自行取阅）
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
    for (const extra of ["梗卡.md", "选题素材.md", "项目配置.json", "registry/metrics-summary.json", "registry/effective.json", "registry/optimize.json"]) {
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
        assertReports: evidence.filter((e) => e.includes("断言报告")),
        comments: (state.comments ? Object.keys(state.comments).length : 0),
      },
      goals: ["上下文命中率（标尺被产物真正引用）", "规则覆盖率（注册表断言有 op 覆盖、机器可验）", "编排结构（并行化/冷 tool/重复劳动）", "产物质量（反复重写/批注聚集/纯净度）", "成本（档位/深度/耗时）"],
      rules: [
        "每条 finding 必须带 evidence（journal 行/文件路径 + ≤120 字引文），无证据不立案",
        "patch 只允许非结构类（set-tool/set-node config/knowledge/asserts/policy）；结构类写 structural 字段进拍板清单",
        "语义层断言不许被『补』成机器校验器（不引 LLM 当机器校验器）；规则覆盖建议指向真实可文本查的维度",
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
  async flowOverlay(
    projectId: string,
    req: { patches?: OverlayPatch[]; approve?: string[]; actor?: string; reason?: string; replan?: boolean },
  ): Promise<{ file?: string; applied: number; proposed: number; stop?: AdvanceStop }> {
    const projectDir = this.projectDir(projectId);
    const state = loadState(projectDir);
    if (!state) throw new KernelError("NO_RUN", 404, `项目无 state.json: ${projectId}`);
    const raw = this.loadFlow(state.flowId);
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
      const eff0 = this.effectiveOf(projectDir, raw);
      this.persistEffective(projectDir, eff0, state);
      this.persistMetricsSummary(projectDir, state, eff0);
      return { file, applied, proposed };
    }
    const eff = this.effectiveOf(projectDir, raw);
    this.persistEffective(projectDir, eff, state);
    state.overlayHash = "force-replan"; // 触发 replan 分支（真实哈希由 replan 写回）
    state.status = "running";
    const lock = this.acquireLock(projectDir);
    try {
      const stop = await this.advance(projectId, state, projectDir, raw);
      void eff;
      return { file, applied, proposed, stop };
    } finally {
      lock.release();
    }
  }

  /** 活跃前向边视角的上游表（与 compilePlan 同一过滤：loop 剔除、gate 绑定裁剪、when 裁剪、节点级 when）。 */
  private activeUpstreams(flow: FlowDescriptor, cond: CondContext): Map<string, string[]> {
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

  private resolveStageEntry(flow: FlowDescriptor, gateNodeId: string, rootCauseStage?: string): string {
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

  viewProjects() {
    const projectsDir = path.join(this.root, "projects");
    if (!fs.existsSync(projectsDir)) return [];
    const out: Array<Record<string, unknown>> = [];
    for (const d of fs.readdirSync(projectsDir).sort()) {
      const dir = this.projectDir(d);
      if (!fs.statSync(dir).isFile?.() && !fs.statSync(dir).isDirectory()) continue;
      const state = loadState(dir);
      const legacy = state ? undefined : (() => {
        try { return JSON.parse(fs.readFileSync(legacyStatePath(dir), "utf-8")); } catch { return undefined; }
      })();
      const raw: RunState | undefined = state ?? legacy;
      const nodes = raw?.nodes ?? {};
      const order = raw?.plan?.order ?? Object.keys(nodes);
      const pending = order.filter((id) => (nodes[id]?.status ?? "none") !== "done");
      const focus = order.find((id) => (nodes[id]?.status ?? "none") !== "done") ?? null;
      out.push({
        projectId: d,
        flowId: raw?.flowId ?? null,
        status: raw?.status ?? "none",
        focus: state ? focus : focus,
        gateAwaiting: raw?.gate?.verdict === "awaiting",
        pendingCount: pending.length,
        migrated: Boolean(state),
      });
    }
    return out;
  }

  viewArtifacts(projectId: string, opts: { node?: string; latest?: boolean }) {
    return listArtifacts(this.projectDir(projectId), opts);
  }

  viewArtifactContent(projectId: string, relPath: string): string | undefined {
    return readRegisteredText(this.projectDir(projectId), relPath);
  }

  viewJournal(projectId: string, q: { since?: string; limit?: number; node?: string }) {
    return journalQuery(this.projectDir(projectId), q);
  }

  viewSnapshots(projectId: string, node: string) {
    return readSnapshots(this.projectDir(projectId), node);
  }

  /** 初始化配置读取：无文件时返回模板（前端表单直接绑定中键字段）。 */
  viewConfig(projectId: string): { exists: boolean; config?: ProjectConfig; template: Record<string, unknown>; boundWarning?: string } {
    const projectDir = this.projectDir(projectId);
    const cfg = (() => {
      try {
        return loadProjectConfig(projectDir);
      } catch (e) {
        // 配置存在但非法：原样带回让前端标红，而不是 500
        return { __invalid: true, message: (e as Error).message } as unknown as ProjectConfig;
      }
    })();
    const template = {
      项目: projectId,
      题材: "",
      需求: "",
      灵感: "",
      严肃性: "标准",
      风格: "爽",
      AB测试: false,
      市场预估: "",
      presets: {},
    };
    const exists = !!cfg && !(cfg as { __invalid?: boolean }).__invalid;
    const out: ReturnType<Kernel["viewConfig"]> = { exists, template };
    if (cfg) out.config = cfg;
    if (loadState(projectDir)) {
      out.boundWarning =
        "当前 run 已绑定 route/direction 等输入；本次修改对已绑定字段在本 run 内不生效，将在重跑或下一次 flow_run 时生效";
    }
    return out;
  }

  /** 初始化配置写入（schema 校验 + 项目名一致性），供前端表单保存。 */
  writeConfig(projectId: string, body: Record<string, unknown>): { saved: boolean; file: string; boundWarning?: string } {
    const projectDir = this.projectDir(projectId);
    const merged = { ...body, 项目: projectId }; // 项目名以路径为准，防错位
    try {
      assertSchema("project-config", merged);
    } catch (e) {
      throw new KernelError("INVALID_INPUT", 400, `项目配置非法: ${(e as Error).message}`);
    }
    fs.mkdirSync(projectDir, { recursive: true });
    atomicWriteText(path.join(projectDir, "项目配置.json"), JSON.stringify(merged, null, 2) + "\n");
    const out: { saved: boolean; file: string; boundWarning?: string } = {
      saved: true,
      file: path.join(projectDir, "项目配置.json"),
    };
    if (loadState(projectDir)) out.boundWarning = "当前 run 已绑定部分输入；修改在重跑或下一次 flow_run 时生效";
    return out;
  }

  /** 兼容桥：旧 workflow.html 的 DATA payload 同构形状。 */
  viewWorkbenchPayload(projectId: string) {
    const projectDir = this.projectDir(projectId);
    const state = loadState(projectDir);
    let flowId: string | undefined = state?.flowId;
    if (!flowId) {
      // 旧 run-state 项目：按 whereami 同款重叠度匹配
      for (const d of fs.existsSync(this.flowsDir) ? fs.readdirSync(this.flowsDir) : []) {
        try {
          const f = this.loadFlow(d);
          if (Object.keys(f.graph.nodes).length) { flowId = d; break; }
        } catch { /* skip */ }
      }
    }
    const flow = flowId ? this.loadFlow(flowId) : undefined;
    const files: Record<string, string> = {};
    let total = 0;
    const wanted = new Set<string>(
      (flow?.outputs ?? []).map((o) => (flow ? outputPathOf(flow, o) : undefined)).filter((p): p is string => !!p),
    );
    for (const a of listArtifacts(projectDir, { latest: true })) wanted.add(a.path); // 注册产物并入（旧页面 extra+glob 语义）
    for (const rel of wanted) {
      const abs = path.join(projectDir, rel);
      if (!fs.existsSync(abs)) continue;
      if (fs.statSync(abs).size > 512 * 1024) continue;
      files[rel] = fs.readFileSync(abs, "utf-8");
      total += files[rel].length;
      if (total > 2_000_000) break;
    }
    const snapshots: Record<string, unknown[]> = {};
    for (const nodeId of Object.keys(flow?.graph.nodes ?? {})) {
      const snaps = readSnapshots(projectDir, nodeId);
      if (snaps.length) snapshots[nodeId] = snaps;
    }
    return {
      flow,
      files,
      runstate: state ?? (() => { try { return JSON.parse(fs.readFileSync(legacyStatePath(projectDir), "utf-8")); } catch { return {}; } })(),
      project: projectId,
      snapshots,
    };
  }
}

// 供 viewJournal 的惰性 require（ESM 下编译为 createRequire）
const require = (await import("node:module")).createRequire(import.meta.url);
