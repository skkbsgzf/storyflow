import type { FlowDescriptor, RunState, NodeState } from "./types.js";
import { writeJsonAtomic, readJson } from "./abstraction/jsonio.js";
import { nodeFs, nodePath } from "./abstraction/defaults.js";
import type { IFileSystem, IFsPath } from "./abstraction/fs.js";
import { assertSchema } from "./schema.js";
import { newId, flowHashOf, gateToken } from "./ids.js";
import { compilePlan } from "./plan.js";

export function statePath(projectDir: string, path: IFsPath = nodePath): string {
  return path.join(projectDir, "state.json");
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

export { gateToken };
