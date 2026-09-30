import type { FlowDescriptor, RunState, TaskPackage, Validation } from "./types.js";
import { assertSchema, rootOf } from "./schema.js";
import { LockDir } from "./abstraction/jsonio.js";
import { nodeFs, nodePath, nodeProc } from "./abstraction/defaults.js";
import type { IFileSystem, IFsPath } from "./abstraction/fs.js";
import type { IProcessLauncher } from "./abstraction/proc.js";
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

import { KernelError } from "./kernel-base.js";
export { KernelError } from "./kernel-base.js";
import { flow_list, flow_run, flow_next, flow_submit, flow_resume, flow_gate, flow_rerun, flow_chain } from "./kernel-run.js";
import { viewEffect, flowOptimize, flowMine, flowOverlay } from "./kernel-optimize.js";
import {
  viewProjects, viewArtifacts, viewArtifactContent, viewJournal, viewSnapshots, viewLive,
  worldbookSearch, viewWorkbenchPayload, viewDiagnostics,
} from "./kernel-view.js";
import { viewConfig, writeConfig } from "./kernel-config.js";
import { AssertionPresets, DEFAULT_PRESET_ID, defaultPresetRoots } from "./assertion-preset/index.js";
import { applyAssertionOverrides } from "./assertion-preset/executor.js";
import type { StandingMount } from "./assertion-preset/types.js";
import { listProductionPresets, loadPresetOverlay, suggestProductionPreset, type ProductionPreset } from "./production-preset.js";

/**
 * W-项目管理 · 灵感提炼命名：从流程输入里提炼可读项目名。
 * 优先级 direction > 灵感 > 需求 > 点子 > title > 题材；取首个标点前的首段，
 * 清理文件系统非法字符，限 16 字。提炼不出返回 ""（调用方回落时间戳 id）。
 */
export function deriveProjectName(inputs: Record<string, unknown>): string {
  for (const k of ["direction", "灵感", "需求", "点子", "title", "题材"]) {
    const v = inputs[k];
    if (typeof v === "string" && v.trim().length >= 4) {
      const first = v.trim().split(/[，。；：,.;:\n！？!?]/)[0]?.trim() || v.trim();
      const clean = first.replace(/[/\\:*?"<>|｜「」『』（）()\s]/g, "").slice(0, 16);
      if (clean.length >= 4) return clean;
    }
  }
  return "";
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
  /** 仓库根（modules/ knowledge/ flows/）——缺省 = 代码仓库根 */
  repoRoot?: string;
  flowsDir?: string;
  /** 活跃断言预设 id（缺省 novel-fanqie；预设不可用时门控特性静默不激活） */
  assertionPreset?: string;
  /** FS1 §四.1 构造注入：盘 / 路径 / 子进程三件套，缺省 = Node 适配器（真实文件系统）。 */
  fs?: IFileSystem;
  path?: IFsPath;
  proc?: IProcessLauncher;
}

export class Kernel {
  /** 数据根：projects/ 所在处（每个测试/宿主可有自己的数据根）。 */
  readonly root: string;
  /**
   * 仓库根：modules/ knowledge/ flows/ contracts/ 所在处。
   * 必须与数据根分开——此前两者混用 this.root，导致临时数据根下
   * kit 注册表解析为空、「55 个 tool 的配置项」与知识装载一起静默失效（不报错，只是什么都没有）。
   */
  readonly repoRoot: string;
  readonly flowsDir: string;
  /**
   * 断言预设服务（Assertion Preset v1）：system 根 = repoRoot/assertion-presets，user 根 = 数据根/assertion-presets。
   * mountFor() 是门点的静默入口——预设缺失/损坏返回 undefined，门控退化为透传。
   */
  readonly assertionPresets: AssertionPresets;
  /**
   * 宿主显式指定的预设 id（AP1 §九 优先级链的最高一格）。
   * 只记「宿主有没有点名」这件事：没点名 = undefined，让位给 flow.policy.defaultPreset；
   * 点名了 = 编排层的 defaultPreset 不许越过它（宿主是运行时所有者，不是可被图表单覆盖的缺省值）。
   */
  private readonly hostPreset?: string;
  /**
   * FS1 注入面（R3）：内核的一切盘操作经这三件，构造期定死、运行期不换。
   * 缺省 = Node 适配器（现网行为逐字节不变）；测试注 MockFs、R7 浏览器宿主注 Virtual。
   */
  readonly fs: IFileSystem;
  readonly path: IFsPath;
  readonly proc: IProcessLauncher;

  constructor(opts: KernelOptions = {}) {
    this.fs = opts.fs ?? nodeFs;
    this.path = opts.path ?? nodePath;
    this.proc = opts.proc ?? nodeProc;
    this.root = opts.root ?? rootOf();
    this.repoRoot = opts.repoRoot ?? rootOf();
    this.flowsDir = opts.flowsDir ?? this.path.join(this.repoRoot, "flows");
    this.hostPreset = opts.assertionPreset;
    this.assertionPresets = new AssertionPresets(
      defaultPresetRoots(this.repoRoot, this.root, this.path),
      opts.assertionPreset ?? DEFAULT_PRESET_ID,
      this.fs,
      this.path,
    );
  }

  // ---------- 路径与装载 ----------

  projectDir(projectId: string): string {
    return this.path.join(this.root, "projects", projectId);
  }

  loadFlow(flowId: string): FlowDescriptor {
    const file = this.path.join(this.flowsDir, flowId, "flow.json");
    if (!this.fs.exists(file)) throw new KernelError("UNKNOWN_FLOW", 404, `flow 不存在: ${flowId}`);
    return JSON.parse(this.fs.readText(file)) as FlowDescriptor;
  }

  listFlows(): { id: string; title: string; version: string; status?: string }[] {
    if (!this.fs.exists(this.flowsDir)) return [];
    return this.fs
      .readDir(this.flowsDir)
      .filter((d) => this.fs.exists(this.path.join(this.flowsDir, d, "flow.json")))
      .map((d) => {
        const f = this.loadFlow(d);
        return { id: f.id, title: f.title, version: f.version, status: f.status };
      });
  }

  /**
   * 生效编排装载（R5 §一）：flow.json ⊕ 出厂 overlay ⊕ 预设 overlay（PP1，可选）⊕ 项目 overlay ⊕ kit 边界派生。
   * 内核一切判断（计划/就绪/上下文/门）都必须基于它——否则「人改的编排」与「跑的编排」会分家。
   * presetId = 生产线预设（presets/<id>/，flow_run(opts.preset) 选定后随 state.preset 持久）。
   */
  effectiveOf(projectDir: string, flow: FlowDescriptor, presetId?: string): EffectiveFlow {
    try {
      // OS-02 阶段 C：`项目配置.json` 的「阈值预算」是阈值面的**实例层**。
      // 合成优先级：flow.policy.budget（模板层） < 本层（实例层） < 项目 overlay（运行时调整层）。
      // 实现方式 = 造一个派生 overlay 夹在出厂层与项目层之间：一个派生层、一个插入点，
      // **不新增任何优先级规则**（applyOverlay 本来就有序叠加）。本层不落盘（每次由配置派生）。
      const cfgB = ((): Record<string, number> | undefined => {
        try {
          return configBudget(loadProjectConfig(projectDir, this.fs, this.path));
        } catch (e) {
          // 配置非法绝不静默降级（否则「面板填的阈值没生效」会变成最难查的一类问题）。
          // 错误码/文案沿用既有约定（`flow_run` 侧同一句话），不新造第二套口径。
          throw new KernelError("INVALID_INPUT", 400, `项目配置非法: ${e instanceof Error ? e.message : String(e)}`);
        }
      })();
      const cfgBudgetLayer: FlowOverlay | undefined = cfgB
        ? {
            format: "flow-overlay@1",
            flowId: flow.id,
            origin: "kernel",
            reason: "项目配置.json 的「阈值预算」（初始化面板）",
            patches: [{
              kind: "set-policy",
              key: "budget",
              value: cfgB,
              reason: `项目配置.json 阈值预算：${Object.keys(cfgB).sort().join("、")}`,
            }],
          }
        : undefined;
      if (flow.format === "flow@3") {
        // R6：flow@3 = 模块序列。overlay 作用于模块实例，随后 expandFlow3 派生节点与边
        // （派生只算一次，persistEffective 落 effective@2）。
        // R7（2026-09-20）：toolOverrides / inputs 此前被硬编码成 `{}` ⇒ `set-tool`（唯一能改
        // op.config / model_tier / knowledge 的通道）与 `set-input` 在 flow@3 结构性不可达，
        // 而 overlay.json 里却记着 `status:"applied"`。现由 effectiveFlow3 计算后透传。
        const overlays = [
          readOverlay(factoryOverlayPath(this.repoRoot, flow.id, this.path), this.fs),
          // PP1 生产线预设层：出厂的可选变体（裁剪/追加模块工具），夹在出厂层与项目层之间——
          // 项目 overlay 仍能在它之上继续调，不新增任何优先级规则。
          presetId ? loadPresetOverlay(this.repoRoot, presetId, flow.id, this.fs, this.path) : undefined,
          cfgBudgetLayer,
          readOverlay(projectOverlayPath(projectDir, this.path), this.fs),
        ].filter(Boolean) as FlowOverlay[];
        const r = effectiveFlow3(this.repoRoot, flow as never, { projectDir, overlays }, this.fs, this.path);
        return {
          flow: r.flow,
          policy: r.policy as FlowPolicy,
          inputs: r.inputs,
          toolOverrides: r.toolOverrides,
          assertionOverrides: r.assertionOverrides,
          boundaries: [],
          links: r.links,
          r6: { modules: r.modules, links: r.links, moduleNodes: r.moduleNodes, dirs: r.dirs },
          notes: r.notes,
          unsupported: r.unsupported,
          overlayHash: r.overlayHash,
          appliedCount: r.appliedCount,
        };
      }
      return effectiveFlow(this.repoRoot, flow, { projectDir, overlays: cfgBudgetLayer ? [cfgBudgetLayer] : [] }, this.fs, this.path);
    } catch (e) {
      if (e instanceof KernelError) throw e; // 已分类的错误原样上抛，不被 BAD_OVERLAY 掩盖
      throw new KernelError("BAD_OVERLAY", 409, `overlay 非法（拒绝静默降级为 bootstrap 编排）: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /**
   * AP1 §七 + §九 的**门点唯一取挂载入口**（两处门点：doSubmit 提交链、check_* 内建节点）。
   *
   * 预设选择优先级（§九）：
   *   KernelOptions.assertionPreset（宿主/测试显式指定，已在构造期成为 AssertionPresets 的缺省 id）
   *     > flow.policy.defaultPreset ⊕ set-policy:defaultPreset（编排层，随生效编排走）
   *     > novel-fanqie（仓库出厂缺省）
   * 覆盖叠加（§七）：`eff.assertionOverrides` 叠在挂载上得到派生挂载（progressive 计数与原共享）。
   * 静默纪律照旧：预设不可用 → undefined = 特性不激活，门点透传，不拦流水线；
   * 但**没生效的覆盖条目必须留痕**（ignored 清单进诊断通道），否则「面板填了阈值不生效」又是隐形故障。
   */
  assertionMount(eff: EffectiveFlow, projectDir?: string): StandingMount | undefined {
    const fromFlow = typeof eff.policy?.defaultPreset === "string" && eff.policy.defaultPreset.trim()
      ? eff.policy.defaultPreset
      : undefined;
    // §九 优先级：宿主点名 > 编排层 defaultPreset > AssertionPresets 缺省（novel-fanqie）。
    // 宿主没点名时 hostPreset 是 undefined，正好让位；两者都没有时 wanted=undefined，
    // mountFor 回落到构造期注入的缺省 id——三级链只在这一处判定，门点不各自实现。
    const wanted = this.hostPreset ?? fromFlow;
    const base = this.assertionPresets.mountFor(wanted);
    if (!base) return undefined;
    const overrides = eff.assertionOverrides ?? [];
    if (!overrides.length) return base;
    const r = applyAssertionOverrides(base, overrides);
    if (r.ignored.length && projectDir) {
      recordDiag(this, projectDir, "assert", "assertionOverride", `覆盖未生效：${r.ignored.join("；")}`);
    }
    return r.mount;
  }

  /** @internal —— kernel-*.ts 拆分面跨文件访问；模块外勿调用 */
  ctx(projectId: string): { state: RunState; projectDir: string; flow: FlowDescriptor; eff: EffectiveFlow; raw: FlowDescriptor } {
    const projectDir = this.projectDir(projectId);
    const state = loadState(projectDir, this.fs, this.path);
    if (!state) throw new KernelError("NO_RUN", 404, `项目无 state.json（先 flow_run 或迁移）: ${projectId}`);
    const raw = this.loadFlow(state.flowId);
    const eff = this.effectiveOf(projectDir, raw, state.preset);
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
  /** @internal —— kernel-*.ts 拆分面跨文件访问；模块外勿调用 */
  persistEffective(projectDir: string, eff: EffectiveFlow, state?: RunState): void {
    try {
      // OS-04 余量：模板清单也只在内核派生一次（页面纯消费，不自己扫盘——否则「页面看到的模板」
      // 与「套用时的真相」会漂移）。数据根与仓库根分开传：自存模板在 root，官方示例在 repoRoot。
      this.persistConfigTemplates(projectDir, eff.flow.id);
      if ((eff as any).r6 || eff.flow.format === "flow@3-derived") {
        // R6 生效编排读模型（effective@2）：links 取代 boundaries，composition 按模块实例
        const nodeConfig: Record<string, unknown> = {};
        for (const [id, n] of Object.entries(eff.flow.graph.nodes)) {
          const op = resolveNodeOp(n, this.repoRoot, undefined, this.fs, this.path);
          nodeConfig[id] = {
            module: n.module,
            gateRole: n.gate_role,
            output: artifactPathOf(eff.flow, id),
            skill: n.skill,
            minitool: n.minitool,
            nodeConfig: n.config ?? {},
          };
        }
        const view = {
          format: "effective@2",
          flowId: eff.flow.id,
          flowVersion: eff.flow.version,
          policy: {
            link_default: (eff.policy as any).link_default ?? "auto",
            adapt: (eff.policy as any).adapt ?? "propose",
          },
          /**
           * OS-02 阶段 C：阈值预算面**只在内核派生一次**（`budget.ts::resolveBudget`），
           * 页面生成器纯消费本块渲染「阈值预算区」——绝不在 python 侧再实现一遍合并/校验。
           * 含 defs（旋钮声明：区间/单位/人话说明）+ values（生效值）+ sources（factory|policy）
           * + issues（未知键/越界/交叉校验告警）+ overridden。
           */
          budget: resolveBudget(eff.policy),
          overlayHash: eff.overlayHash,
          planHash: state?.planHash,
          links: (eff as any).links ?? [],
          composition: (eff as any).r6?.modules ?? [],
          moduleDirs: (eff as any).r6?.dirs ?? {},
          nodes: eff.flow.graph.nodes,
          edges: eff.flow.graph.edges,
          nodeConfig,
        };
        this.fs.writeTextAtomic(this.path.join(projectDir, "registry", "effective.json"), JSON.stringify(view, null, 2) + "\n");
        return;
      }
      const nodeConfig: Record<string, unknown> = {};
      for (const [id, n] of Object.entries(eff.flow.graph.nodes)) {
        const op = resolveNodeOp(n, this.repoRoot, undefined, this.fs, this.path);
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
        /** OS-02 阶段 C：阈值预算面同 effective@2，只在内核派生一次（页面纯消费） */
        budget: resolveBudget(eff.policy),
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
      this.fs.writeTextAtomic(this.path.join(projectDir, "registry", "effective.json"), JSON.stringify(view, null, 2) + "\n");
    } catch {
      /* 读模型是旁路：写不出来不许阻断流水线（页面会退化为 bootstrap 视图并显式标注） */
    }
  }

  /**
   * OS-04 余量 · 项目配置模板清单读模型（registry/config-templates.json）。
   * 与 effective/metrics 同理：扫描面（自存模板在 `root`、官方示例在 `repoRoot`）只允许定义一次。
   * 旁路失败写诊断，不阻断流水线（页面会显式退化为「模板库暂不可用」）。
   */
  private persistConfigTemplates(projectDir: string, flowId: string): void {
    try {
      const { entries, skipped } = listConfigTemplates({ dataRoot: this.root, repoRoot: this.repoRoot, flowId }, this.fs, this.path);
      this.fs.writeTextAtomic(
        this.path.join(projectDir, "registry", "config-templates.json"),
        JSON.stringify({ format: "config-templates@1", flowId, entries, skipped }, null, 2) + "\n",
      );
    } catch (e) {
      // 诊断 kind 复用既有枚举里的 `io`（这就是一次读模型落盘失败）；`where` 已经说清是哪个子系统，
      // 不为一条旁路新增契约枚举——契约枚举是台账，加一项要连着文档/schema/消费方一起动。
      recordDiag(this, this.repoRoot, "io", "persistConfigTemplates:registry/config-templates.json", e);
    }
  }

  /**
   * R5 指标汇总读模型（registry/metrics-summary.json）。
   * 与 persistEffective 同理：聚合口径（哪些 phase 算 submits、成本怎么算、命中率分母是谁）
   * 只允许内核定义一次，页面/优化 agent 都消费同一份结果。
   */
  /** @internal —— kernel-*.ts 拆分面跨文件访问；模块外勿调用 */
  persistMetricsSummary(projectDir: string, state: RunState, eff: EffectiveFlow): void {
    try {
      const events = readMetrics(this, projectDir);
      const pathToNode: Record<string, string> = {};
      for (const id of Object.keys(eff.flow.graph.nodes)) {
        const p = artifactPathOf(eff.flow, id);
        if (p) pathToNode[p] = id;
      }
      const summary = summarizeMetrics(events, { pathToNode, budget: resolveBudget(eff.policy).values });
      const view = { format: "metrics-summary@1", runId: state.runId, ...summary };
      this.fs.writeTextAtomic(this.path.join(projectDir, "registry", "metrics-summary.json"), JSON.stringify(view, null, 2) + "\n");
      this.persistModuleReports(projectDir, state, eff);
    } catch {
      /* 旁路 */
    }
  }

  /** 计划指纹：生效编排的拓扑序 + 关键字段，用于检测「编排被人/优化 agent 改过」。 */
  flow_list() { return flow_list(this); }
  async flow_run(flowId: string, projectId: string, inputs: Record<string, unknown> = {}, opts: { preset?: string } = {}) {
    return flow_run(this, flowId, projectId, inputs, opts);
  }

  /**
   * PP1 Phase 2：跨流水线级联——源项目产物确定性搬运到新项目素材目录（00-素材/），
   * 以显式输入开跑目标流水线；双边 journal 接力留痕（chain-out / chain-in）。
   */
  async flow_chain(
    fromProjectId: string,
    toFlowId: string,
    opts: { projectId?: string; preset?: string; inputs?: Record<string, unknown>; copyArtifacts?: string[]; materialDir?: string } = {},
  ) {
    return flow_chain(this, fromProjectId, toFlowId, opts);
  }

  /** PP1：列出生产线预设（presets/<id>/，含 broken 标注）——宿主面板的「生产线」下拉数据源。 */
  listPresets(): ProductionPreset[] {
    return listProductionPresets(this.repoRoot);
  }

  /**
   * R8：Auto 预设路由预览（规则式 v1）——不开跑就能看「这组输入会被路由到哪条生产线」。
   * flow_run(preset:"auto") 内部走的是同一份规则；命中给 {preset, why}，未命中给 undefined（缺省流水线）。
   */
  suggestPreset(flowId: string, inputs: Record<string, unknown>): { preset: string; why: string } | undefined {
    return suggestProductionPreset(flowId, inputs);
  }
  async flow_next(
    projectId: string,
    opts: { spawnPrompt?: boolean } = {},
  ) { return flow_next(this, projectId, opts); }
  /** @internal —— kernel-*.ts 拆分面跨文件访问；模块外勿调用 */
  acquireLock(projectDir: string): LockDir {
    const lock = new LockDir(this.path.join(projectDir, "state.json"), 30000, this.fs, this.path);
    if (!lock.acquire()) throw new KernelError("LOCK_BUSY", 409, "同一项目另有提交/裁决在进行中，请稍后重试");
    return lock;
  }

  async flow_submit(
    projectId: string,
    nodeId: string,
    output: { content?: string; file?: string; notes?: string; seal?: boolean },
  ) { return flow_submit(this, projectId, nodeId, output); }
  async flow_resume(projectId: string) { return flow_resume(this, projectId); }
  async flow_gate(projectId: string, req: GateRequest) { return flow_gate(this, projectId, req); }
  async flow_rerun(projectId: string, req: { nodeId: string; dryRun?: boolean }) { return flow_rerun(this, projectId, req); }
  viewEffect(projectId: string) { return viewEffect(this, projectId); }
  flowOptimize(projectId: string, opts: { apply?: boolean; actor?: string } = {}) { return flowOptimize(this, projectId, opts); }
  private persistModuleReports(projectDir: string, state: RunState, eff: EffectiveFlow): void {
    const nodes = eff.flow.graph.nodes;
    const outputs = eff.flow.outputs ?? [];
    const byModule = new Map<string, string[]>();
    for (const [id, n] of Object.entries(nodes)) {
      const mid = (n as { module?: string }).module ?? n.stage ?? "m0";
      if (!byModule.has(mid)) byModule.set(mid, []);
      byModule.get(mid)!.push(id);
    }
    const events = readMetrics(this, projectDir);
    for (const [mid, ids] of byModule) {
      const doneIds = ids.filter((id) => state.nodes[id]?.status === "done");
      if (doneIds.length === 0) continue; // 未收口模块不产报告
      const artifacts: { node: string; op?: string; path: string; role: "deliverable" | "process" }[] = [];
      const acceptance: { node: string; check: string; status: string; detail?: string }[] = [];
      let submits = 0, retries = 0, tokensIn = 0, tokensOut = 0, latencyMs = 0, ctxOffered = 0, ctxUsed = 0;
      const moduleDeclared = outputs.some((o) => o.module === mid || (o.node && ids.includes(o.node)));
      let deliverableAssigned = false;
      for (const id of ids) {
        const n = nodes[id];
        const ns = state.nodes[id];
        const output = (n as { output?: string }).output;
        // 交付件认定：模块被 outputs 声明时，模块内**最后一个有产物的 done 节点**是交付件，其余为过程件
        const isDeliverable =
          moduleDeclared && !!output && ns?.status === "done" &&
          (() => {
            if (deliverableAssigned) return false;
            const later = ids.slice(ids.indexOf(id) + 1).filter((x) => (nodes[x] as { output?: string }).output && state.nodes[x]?.status === "done");
            if (later.length === 0) { deliverableAssigned = true; return true; }
            return false;
          })();
        if (output && ns?.status === "done") {
          artifacts.push({ node: id, op: (n as { op?: string }).op, path: output, role: isDeliverable ? "deliverable" : "process" });
        }
        // v5.0（断言协议退役）：验收台账 = 提交链真跑的确定性完整性检查（存在性/残渣/头部/词汇表），
        // 记于注册产物的 validations——不再读节点断言声明（runDeclaredAsserts 已下架）。
        const latest = [...listArtifacts(projectDir, { node: id, latest: true }, this.fs, this.path)].find((a) => a.path === output);
        for (const v of latest?.validations ?? []) {
          acceptance.push({ node: id, check: v.name, status: v.status, detail: v.detail });
        }
        if (ns?.status === "done") submits += 1;
        for (const e of events.filter((x) => x.nodeId === id)) {
          if (e.phase === "submit" || e.phase === "core") {
            ctxUsed += e.ctx?.used ?? 0;
            retries = Math.max(retries, e.retries ?? 0);
          }
          if (e.phase === "dispatch") ctxOffered += e.ctx?.offered ?? e.ctx?.ids?.length ?? 0;
          tokensIn += e.tokensIn ?? 0;
          tokensOut += e.tokensOut ?? 0;
          latencyMs += e.latencyMs ?? 0;
        }
      }
      const lastTs = events
        .filter((e) => ids.includes(e.nodeId))
        .map((e) => e.ts)
        .sort()
        .at(-1);
      const deliverablePath = artifacts.find((a) => a.role === "deliverable")?.path;
      const report = {
        format: "module-report@1" as const,
        projectId: this.path.basename(projectDir),
        flowId: eff.flow.id,
        moduleId: mid,
        moduleName: mid,
        title: ids.map((id) => nodes[id]?.title).filter(Boolean).slice(0, 3).join(" / "),
        closedAt: lastTs ?? nowIso(),
        io: {
          input: Object.keys(state.inputs ?? {}).filter((k) => !["project"].includes(k)),
          output: deliverablePath ?? "",
        },
        artifacts,
        acceptance,
        metrics: {
          submits, retries, tokensIn, tokensOut, latencyMs, ctxOffered, ctxUsed,
          hitRate: ctxOffered > 0 ? ctxUsed / ctxOffered : 0,
        },
        feedback: {
          annotations: Object.keys((state.comments as Record<string, unknown>) ?? {}).filter((k) => ids.some((id) => k.includes(id))).length,
          proposals: 0,
        },
      };
      try {
        assertSchema("module-report", report);
      } catch (e) {
        journalAppend(this, projectDir, state.runId, "warn", { detail: `module-report ${mid} schema 校验失败（跳过落盘）: ${String(e).slice(0, 120)}` });
        continue;
      }
      this.fs.writeTextAtomic(this.path.join(projectDir, "registry", `module-report-${mid}.json`), JSON.stringify(report, null, 2) + "\n");
    }
  }

  /**
   * R5 §六 质性通道（编排挖掘师）：组装事后挖掘任务包。
   * 挖掘师（通用 Skill orchestration-miner）消费本包 → 写 registry/miner-findings.json（findings@1）
   * → flow_optimize 自动并入提案。内核不做任何 LLM 判断，只负责把证据摆上桌。
   */
  flowMine(projectId: string) { return flowMine(this, projectId); }
  async flowOverlay(
    projectId: string,
    req: { patches?: OverlayPatch[]; approve?: string[]; actor?: string; reason?: string; replan?: boolean },
  ) { return flowOverlay(this, projectId, req); }
  viewProjects() { return viewProjects(this); }
  viewArtifacts(projectId: string, opts: { node?: string; latest?: boolean }) { return viewArtifacts(this, projectId, opts); }
  viewArtifactContent(projectId: string, relPath: string) { return viewArtifactContent(this, projectId, relPath); }
  viewJournal(projectId: string, q: { since?: string; limit?: number; node?: string }) { return viewJournal(this, projectId, q); }
  viewSnapshots(projectId: string, node: string) { return viewSnapshots(this, projectId, node); }
  viewConfig(projectId: string) { return viewConfig(this, projectId); }
  writeConfig(projectId: string, body: Record<string, unknown>) { return writeConfig(this, projectId, body); }
  viewLive(projectId: string, opts: { files?: boolean } = {}) { return viewLive(this, projectId, opts); }
  worldbookSearch(projectId: string, opts: { q: string; cat?: string; k?: number }) { return worldbookSearch(this, projectId, opts); }
  viewWorkbenchPayload(projectId: string) { return viewWorkbenchPayload(this, projectId); }
  viewDiagnostics(projectId?: string) { return viewDiagnostics(this, projectId); }
}

