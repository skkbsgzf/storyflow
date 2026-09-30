import type { FlowDescriptor, RunState, NodeState, JournalEvent } from "./types.js";
import { writeJsonAtomic, readJson, appendJsonl } from "./abstraction/jsonio.js";
import { nodeFs, nodePath } from "./abstraction/defaults.js";
import type { IFileSystem, IFsPath } from "./abstraction/fs.js";
import { assertSchema } from "./schema.js";
import { newId, nowIso, flowHashOf, gateToken } from "./ids.js";
import { compilePlan } from "./plan.js";

export function statePath(projectDir: string, path: IFsPath = nodePath): string {
  return path.join(projectDir, "state.json");
}
export function legacyStatePath(projectDir: string, path: IFsPath = nodePath): string {
  return path.join(projectDir, "run-state.json");
}
export function journalPath(projectDir: string, path: IFsPath = nodePath): string {
  return path.join(projectDir, "journal.jsonl");
}
export function registryPath(projectDir: string, path: IFsPath = nodePath): string {
  return path.join(projectDir, "registry", "artifacts.json");
}
export function snapshotsDir(projectDir: string, path: IFsPath = nodePath): string {
  return path.join(projectDir, "snapshots");
}

export function freshState(flow: FlowDescriptor, projectId: string, inputs: Record<string, unknown>): RunState {
  const nodes: Record<string, NodeState> = {};
  for (const id of Object.keys(flow.graph.nodes)) nodes[id] = { status: "none", round: 0 };
  const order = compilePlan(flow, inputs);
  return {
    runId: newId("run"),
    projectId,
    flowId: flow.id,
    flowVersion: flow.version,
    flowHash: flowHashOf(flow),
    status: "running",
    plan: { order },
    nodes,
    gate: { verdict: "none" },
    inputs,
    comments: {},
  };
}

/** 恢复不读图：plan/flowHash 已在快照内；此处仅做漂移告警判断。 */
export function planDrifted(state: RunState, flow: FlowDescriptor): boolean {
  return state.flowHash !== undefined && state.flowHash !== flowHashOf(flow);
}

export function focusOf(state: RunState): string | undefined {
  const order = state.plan?.order ?? Object.keys(state.nodes);
  return order.find((id) => (state.nodes[id]?.status ?? "none") !== "done");
}

export function saveState(projectDir: string, state: RunState, fs: IFileSystem = nodeFs, path: IFsPath = nodePath): void {
  state.focus = focusOf(state);
  writeJsonAtomic(statePath(projectDir, path), state, (o) => assertSchema("run-state", o), fs);
}

export function loadState(projectDir: string, fs: IFileSystem = nodeFs, path: IFsPath = nodePath): RunState | undefined {
  return readJson<RunState>(statePath(projectDir, path), fs);
}

// ---------- v1.0.1 迁移器：现网 run-state.json → state.json ----------

const VERDICT_MAP: Record<string, "pass" | "pass-with-conditions" | "send-back" | "reject"> = {
  approved: "pass",
  pass: "pass",
  "pass-with-conditions": "pass-with-conditions",
  "send-back": "send-back",
  rejected: "reject",
  reject: "reject",
};

export interface MigrationResult {
  state: RunState;
  seedEvents: JournalEvent[];
}

/** 现网 run-state.json 无损映射（p-key-soul/p-ts-001 实测形状）。 */
export function migrateRunState(
  projectDir: string,
  projectId: string,
  flow: FlowDescriptor,
  resolvedInputs: Record<string, unknown>,
  fs: IFileSystem = nodeFs,
  path: IFsPath = nodePath,
): MigrationResult {
  const legacy = readJson<Record<string, any>>(legacyStatePath(projectDir, path), fs);
  if (!legacy) throw new Error(`无 run-state.json 可迁移: ${projectDir}`);

  const nodes: Record<string, NodeState> = {};
  for (const id of Object.keys(flow.graph.nodes)) {
    const old = legacy.nodes?.[id] ?? {};
    let status: NodeState["status"] = (["done", "pending", "awaiting", "rejected", "stale", "running", "none"] as const).includes(old.status)
      ? old.status
      : "none";
    if (old.status === "running") status = "pending"; // 半成品宁重跑（v3 纪律）
    const ns: NodeState = { status, round: Number(old.round ?? 0) };
    if (old.note) ns.note = String(old.note);
    if (old.verdict && VERDICT_MAP[old.verdict]) ns.verdict = VERDICT_MAP[old.verdict];
    if (old.root_cause_stage) ns.rootCauseStage = String(old.root_cause_stage);
    if (old.stale) ns.stale = true;
    if (old.failCount) ns.failCount = Number(old.failCount);
    nodes[id] = ns;
  }

  const legacyGateVerdict = String(legacy.gate?.verdict ?? "none");
  const mappedGate = VERDICT_MAP[legacyGateVerdict];
  let gateVerdict: RunState["gate"]["verdict"];
  let status: RunState["status"];
  let awaitingNode: string | undefined;
  if (legacyGateVerdict === "awaiting") {
    // 旧数据 gate-awaiting 可能无节点归属：有节点 → 挂起；无节点 → 转继续推进（journal 留痕）
    const node = legacy.gate?.node && nodes[legacy.gate.node] ? String(legacy.gate.node) : undefined;
    if (node) {
      gateVerdict = "awaiting";
      status = "suspended";
      awaitingNode = node;
    } else {
      gateVerdict = "none";
      status = "running";
    }
  } else {
    gateVerdict = mappedGate ?? "none";
    status = "running";
  }

  const state: RunState = {
    runId: newId("run"),
    projectId,
    flowId: flow.id,
    flowVersion: flow.version,
    flowHash: flowHashOf(flow),
    status,
    plan: { order: compilePlan(flow, resolvedInputs) },
    nodes,
    gate: {
      verdict: gateVerdict,
      ...(awaitingNode ? { node: awaitingNode } : {}),
      at: legacy.gate?.at ? String(legacy.gate.at) : undefined,
      note: legacy.gate?.note ? String(legacy.gate.note) : undefined,
    },
    presets: legacy.presets ?? undefined,
    inputs: { ...resolvedInputs, ...(legacy.inputs ?? {}) },
    comments: legacy.comments ?? {},
    notes: Array.isArray(legacy.notes) ? legacy.notes.map(String) : undefined,
    lastRejectReason: legacy.lastRejectReason ? String(legacy.lastRejectReason) : undefined,
  };

  // notes → journal 种子（事件与快照字段同名同义）
  const seedEvents: JournalEvent[] = (state.notes ?? []).map((note) => ({
    ts: nowIso(),
    runId: state.runId,
    event: "note",
    actor: "kernel:migrate",
    detail: note,
  }));
  if (legacyGateVerdict === "awaiting" && !awaitingNode) {
    seedEvents.push({
      ts: nowIso(),
      runId: state.runId,
      event: "warn",
      actor: "kernel:migrate",
      detail: "旧 gate-awaiting 无节点归属，已转为继续推进（run 起点按节点状态推演）",
    });
  }
  return { state, seedEvents };
}

export function writeJournalSeed(projectDir: string, events: JournalEvent[], fs: IFileSystem = nodeFs, path: IFsPath = nodePath): void {
  for (const e of events) appendSeed(projectDir, e, fs, path);
}
function appendSeed(projectDir: string, e: JournalEvent, fs: IFileSystem, path: IFsPath): void {
  // 直接追加（避免循环依赖 journal.ts）
  appendJsonl(journalPath(projectDir, path), e, fs, path);
}

export { gateToken };
