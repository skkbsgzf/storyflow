/**
 * Gate 执行器（策略层）：preset 组合 × Validation[] → 策略后的 Validation[] + 诊断面。
 *
 * 语义（对设计稿的一处裁定：设计里 filterResults 的「warning 也通过过滤」与其注释
 * 「warning 只报告不阻断」自相矛盾，此处取注释口径）：
 *   - warn-only：失败永不阻断（block 一律降级 warn）；
 *   - block-critical：确定性 block 照拦；warn 在 progressive blocking 档（≥ blockThreshold）
 *     升级为 block——重复犯才会从提醒变成闸门；
 *   - strict：任何失败都拦（warn 升级 block）。
 *   - preset 未声明的断言类型：原样透传（preset 只调制它声明的东西）。
 *   - 条件：组 `disabled` 成立 → 整组跳过；断言 `when` 不成立 → 该结果本轮丢弃。
 *     求值失败时 `when` fail-open（保持启用）、`disabled` fail-closed（不禁用）——
 *     两个方向都朝「少拦」倾斜，坏表达式不会把流水线锁死。
 */

import { nodeFs, nodePath } from "../abstraction/defaults.js";
import type { IFileSystem, IFsPath } from "../abstraction/fs.js";
import { classOfPath } from "../asserts.js";
import type { FlowNode } from "../types.js";
import type { Validation } from "../types.js";
import { evalWhenExpr } from "./when.js";
import type {
  AssertionOverride,
  AssertionPresetComposition,
  GateMode,
  GateOutcome,
  ProgressiveLevel,
  StandingMount,
} from "./types.js";

export interface GateEvalContext {
  nodeId: string;
  nodeType?: string;
  relPath?: string;
  /** asserts.classOfPath 的路径类（chapter/topic/…），条件表达式里叫 pathClass */
  pathClass?: string;
  round?: number;
  isChapter?: boolean;
  hasWorldbook?: boolean;
}

/** 从门点现场构造条件求值上下文（字段名即 when 表达式里的标识符）。 */
export function gateContext(
  projectDir: string,
  nodeId: string,
  node: FlowNode,
  relPath: string,
  round?: number,
  fs: IFileSystem = nodeFs,
  path: IFsPath = nodePath,
): GateEvalContext {
  const rel = (relPath ?? "").replaceAll("\\", "/");
  return {
    nodeId,
    nodeType: node.kind,
    relPath: rel,
    pathClass: classOfPath(rel),
    round,
    isChapter: /章节正文|第\d+章|正文|终稿/.test(rel),
    hasWorldbook: fs.exists(path.join(projectDir, "世界书")),
  };
}

/** `disabled` 表达式：求值失败 = 不禁用（fail-closed 到「不禁用」）。 */
function evalDisabled(expr: string | undefined, ctx: GateEvalContext): boolean {
  if (!expr) return false;
  try {
    return Boolean(evalWhenExpr(expr, ctx as unknown as Record<string, unknown>));
  } catch {
    return false;
  }
}

/** `when` 表达式：求值失败 = 启用（fail-open）。 */
function evalEnabled(expr: string | undefined, ctx: GateEvalContext): boolean {
  if (!expr) return true;
  try {
    return Boolean(evalWhenExpr(expr, ctx as unknown as Record<string, unknown>));
  } catch {
    return true;
  }
}

interface ResolvedConfig {
  gateMode: GateMode;
  warnThreshold: number;
  blockThreshold: number;
  hintTemplate?: string;
  /** AP1 §七：disable-assertion 覆盖落地的结果（true = 免拦人，但证据照出） */
  disabled?: boolean;
}

function resolveConfig(mount: StandingMount, type: string, ctx: GateEvalContext): ResolvedConfig | undefined {
  for (const group of mount.composition.groups) {
    if (evalDisabled(group.disabled, ctx)) continue;
    const a = group.assertions.find((x) => x.assertionType === type);
    if (!a) continue;
    return {
      gateMode: a.gateMode ?? group.gateMode ?? mount.composition.defaultGateMode,
      warnThreshold: a.warnThreshold ?? 2,
      blockThreshold: a.blockThreshold ?? 5,
      ...(a.hintTemplate ? { hintTemplate: a.hintTemplate } : {}),
      ...(a.disabled ? { disabled: true } : {}),
    };
  }
  return undefined;
}

function bumpProgressive(mount: StandingMount, assertionType: string): number {
  const now = Date.now();
  const prev = mount.progressiveState.get(assertionType);
  const resetMs = mount.composition.progressiveResetMs;
  if (!prev || (resetMs > 0 && now - prev.firstAt > resetMs)) {
    mount.progressiveState.set(assertionType, { count: 1, firstAt: now });
    return 1;
  }
  mount.progressiveState.set(assertionType, { count: prev.count + 1, firstAt: prev.firstAt });
  return prev.count + 1;
}

function levelOf(count: number, warn: number, block: number): ProgressiveLevel {
  if (count >= block) return "blocking";
  if (count >= warn) return "warning";
  return "normal";
}

function finalStatusOf(status: Validation["status"], mode: GateMode, level: ProgressiveLevel): Validation["status"] {
  if (status === "pass") return "pass";
  if (mode === "warn-only") return "warn";
  if (mode === "strict") return "block";
  // block-critical：warn 在 blocking 档升级；block 恒为 block
  if (status === "warn") return level === "blocking" ? "block" : "warn";
  return "block";
}

function hintOf(cfg: ResolvedConfig, type: string, count: number, level: ProgressiveLevel): string {
  if (cfg.hintTemplate) {
    return cfg.hintTemplate.replaceAll("{{count}}", String(count)).replaceAll("{{type}}", type);
  }
  return `「${type}」累计第 ${count} 次未过（${level}档）`;
}

export interface GatePolicyResult {
  /** 策略后的问题集（降级/升级/丢弃已生效；未声明类型原样保留） */
  problems: Validation[];
  /** 逐条门裁决（仅 preset 声明过的断言类型） */
  outcomes: GateOutcome[];
  /** 诊断摘要（diagnosticEnabled=false 时为空串） */
  summary: string;
}

/** 策略应用入口：不改动 progressive 状态以外的任何东西，纯函数式作用于结果集。 */
export function applyGatePreset(
  mount: StandingMount,
  results: Validation[],
  evalCtx: GateEvalContext,
): GatePolicyResult {
  const problems: Validation[] = [];
  const outcomes: GateOutcome[] = [];
  for (const r of results) {
    const cfg = resolveConfig(mount, r.name, evalCtx);
    if (!cfg) {
      problems.push(r);
      continue;
    }
    if (!evalEnabled(resolveWhen(mount, r.name), evalCtx)) continue; // 条件不成立：本轮丢弃
    const failed = r.status !== "pass";
    // AP1 §七 disable-assertion：免拦人**不免检查**——证据原样留（含 detail），status 降级为 warn，
    // progressive 不计数（免掉的条款不该在换回预设后背着历史欠账）。
    if (cfg.disabled) {
      const status: Validation["status"] = failed ? "warn" : "pass";
      outcomes.push({
        assertionType: r.name, failed, finalStatus: status, gateMode: "warn-only",
        progressiveLevel: "normal", triggerCount: mount.progressiveState.get(r.name)?.count ?? 0,
        diagnostic: failed ? `该断言已被覆盖禁用（只记证据不拦）${r.detail ? `｜证据：${r.detail.trim()}` : ""}` : "",
      });
      problems.push({ ...r, status });
      continue;
    }
    const count = failed ? bumpProgressive(mount, r.name) : (mount.progressiveState.get(r.name)?.count ?? 0);
    const level = levelOf(count, cfg.warnThreshold, cfg.blockThreshold);
    const finalStatus = finalStatusOf(r.status, cfg.gateMode, level);
    const evid = (r.detail ?? "").trim();
    const hint = failed && mount.composition.diagnosticEnabled ? hintOf(cfg, r.name, count, level) : "";
    outcomes.push({
      assertionType: r.name,
      failed,
      finalStatus,
      gateMode: cfg.gateMode,
      progressiveLevel: level,
      triggerCount: count,
      // 摘要面：策略提示 + 现场证据。§十 的用途是「下游不必重新踩同一个坑」，
      // 只报条款名（哪条没过、升到几档）不报现场，接手的人照样不知道该改什么。
      diagnostic: hint ? (evid ? `${hint}｜证据：${evid}` : hint) : "",
    });
    problems.push({
      ...r,
      status: finalStatus,
      // 问题面：现场在前、策略在后（既有拼接口径不变，detail 仍是产物侧的原始记录）。
      ...(hint ? { detail: evid ? `${evid}；${hint}` : hint } : {}),
    });
  }
  const failedOutcomes = outcomes.filter((o) => o.failed);
  const summary = mount.composition.diagnosticEnabled
    ? failedOutcomes
        .map((o) => `${o.assertionType}[${o.gateMode}/${o.progressiveLevel}×${o.triggerCount}] ${o.diagnostic}`)
        .join("；")
    : "";
  return { problems, outcomes, summary };
}

/** 找到声明该类型的断言配置里的 when（组 disabled 已在 resolveConfig 处理）。 */
function resolveWhen(mount: StandingMount, type: string): string | undefined {
  for (const group of mount.composition.groups) {
    for (const a of group.assertions) {
      if (a.assertionType === type) return a.when;
    }
  }
  return undefined;
}

/** preset 声明过的全部 AE-* 类型（供 check_* 节点驱动注册表执行）。 */
export function declaredAestheticTypes(mount: StandingMount): string[] {
  const out = new Set<string>();
  for (const group of mount.composition.groups) {
    for (const a of group.assertions) {
      // 被覆盖禁用的 AE-* 连执行都免（integrity 面不走这里，见 applyGatePreset 的 disabled 分支）
      if (a.assertionType.startsWith("AE-") && !a.disabled) out.add(a.assertionType);
    }
  }
  return [...out];
}

/**
 * AP1 §七：把 overlay 的断言覆盖合成到挂载上，得到**派生挂载**。
 *
 * 三条纪律：
 * 1. **派生不改原挂载**——`MountCache` 里的站立挂载按 stamp 共享，覆盖是项目/预设层的，
 *    写回原挂载会让别的项目吃到（跨项目污染）。这里只复制 composition 与 groups。
 * 2. **progressive 状态与原挂载共享同一个 Map**——计数按断言类型而非按挂载来源；
 *    同一轮里改阈值不该让人「清零重来」（同工单 R2 §执行器的裁定）。
 * 3. **引用不到就回显，不静默**：presetId 对不上、组不存在、目标断言该预设没声明——
 *    一律进 `ignored` 并由调用方记诊断（照 R7「声明了就得有人读」的口径）。
 */
export interface OverrideReceipt {
  /** 派生后的挂载（overrides 为空时原样返回入参挂载，不多造一层） */
  mount: StandingMount;
  /** 生效条目的可读回显（进 notes / 前端覆盖面板） */
  applied: string[];
  /** 未生效条目的可读回显（含原因），调用方须记诊断 */
  ignored: string[];
}

export function applyAssertionOverrides(mount: StandingMount, overrides: AssertionOverride[]): OverrideReceipt {
  if (!overrides.length) return { mount, applied: [], ignored: [] };

  const composition: AssertionPresetComposition = {
    ...mount.composition,
    groups: mount.composition.groups.map((g) => ({ ...g, assertions: g.assertions.map((a) => ({ ...a })) })),
  };
  const find = (type: string) => {
    for (const g of composition.groups) {
      const a = g.assertions.find((x) => x.assertionType === type);
      if (a) return a;
    }
    return undefined;
  };

  const applied: string[] = [];
  const ignored: string[] = [];
  for (const o of overrides) {
    if (o.presetId && o.presetId !== mount.presetId) {
      ignored.push(`${o.kind}${"assertion" in o ? `:${o.assertion}` : ""} 指向预设 ${o.presetId}，当前挂载是 ${mount.presetId} ⇒ 整条不生效`);
      continue;
    }
    if (o.kind === "set-assertion-preset") {
      for (const type of o.assertions) {
        const a = find(type);
        if (!a) {
          ignored.push(`set-assertion-preset:${type}（预设 ${mount.presetId} 未声明该断言；要新增走 insert-assertion）`);
          continue;
        }
        Object.assign(a, o.patch);
        applied.push(`set-assertion-preset ${type} ${JSON.stringify(o.patch)}`);
      }
    } else if (o.kind === "disable-assertion") {
      const a = find(o.assertion);
      if (!a) {
        ignored.push(`disable-assertion:${o.assertion}（预设 ${mount.presetId} 未声明该断言）`);
        continue;
      }
      a.disabled = true;
      applied.push(`disable-assertion ${o.assertion}`);
    } else {
      const group = composition.groups.find((g) => g.id === o.group);
      if (!group) {
        ignored.push(`insert-assertion:${o.group}/${o.assertion}（预设 ${mount.presetId} 无此断言组）`);
        continue;
      }
      if (group.assertions.some((a) => a.assertionType === o.assertion)) {
        ignored.push(`insert-assertion:${o.group}/${o.assertion}（该组已声明此断言；要改配置走 set-assertion-preset）`);
        continue;
      }
      group.assertions.push({ assertionType: o.assertion, ...(o.patch ?? {}) });
      applied.push(`insert-assertion ${o.group}/${o.assertion}`);
    }
  }

  if (!applied.length) return { mount, applied, ignored };
  return {
    mount: { presetId: mount.presetId, composition, progressiveState: mount.progressiveState, stamp: mount.stamp },
    applied,
    ignored,
  };
}
