// kernel-config.ts —— 项目配置视图与写入（viewConfig/writeConfig，从 kernel.ts 拆出，委托见 kernel.ts）。

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
export function viewConfig(kernel: Kernel, projectId: string): { exists: boolean; config?: ProjectConfig; template: Record<string, unknown>; boundWarning?: string } {
    const projectDir = kernel.projectDir(projectId);
    const cfg = (() => {
      try {
        return loadProjectConfig(projectDir);
      } catch (e) {
        // 配置存在但非法：原样带回让前端标红，而不是 500
        return { __invalid: true, message: e instanceof Error ? e.message : String(e) } as unknown as ProjectConfig;
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

export function writeConfig(kernel: Kernel, projectId: string, body: Record<string, unknown>): { saved: boolean; file: string; boundWarning?: string } {
    const projectDir = kernel.projectDir(projectId);
    const merged = { ...body, 项目: projectId }; // 项目名以路径为准，防错位
    try {
      assertSchema("project-config", merged);
    } catch (e) {
      throw new KernelError("INVALID_INPUT", 400, `项目配置非法: ${e instanceof Error ? e.message : String(e)}`);
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

  /**
   * R8-OPS 实时切片（前端 live 化）：页面轮询用。**只给易变部分**。
   *
   * 分工（这是本条的关键设计判断，不是省略）：
   *   · 易变 = 运行状态 / 生效编排 / overlay / 提案 / 指标 / 诊断 / 产物正文 —— 内核每次现读 `registry/*.json` 与 `state.json`；
   *   · 静态 = `DATA.modules` / `toolbox` / `kbTitles` / `flowsIndex` / `skillsIndex` / `deliverables`
   *     —— 由生成器（`tools/project-pages.py`，Python）在构建时算好。**不在这里用 TS 重算一遍**，
   *     否则就是本仓最忌讳的「两套实现 + 漂移」。这些切片只在换 flow / 加模块时变，那时本来就该重生成页面。
   *
   * 于是有一个诚实的边界：**编排结构变了（EFF.overlayHash / planHash 变）→ 页面显示"结构已变，请重生成页面"**，
   * 而不是假装同步。运行状态与产物则实时收敛。
   *
   * `files=true` 才回产物正文（可能上 MB）：页面先用 `filesRevision` 判断要不要来取，避免每轮轮询都搬大包。
   */
