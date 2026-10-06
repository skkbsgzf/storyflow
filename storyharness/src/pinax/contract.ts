// Pinax 契约移植件：与 Recoletas/Pinax 上游保持一致，单点镜像。
// 来源：shared/narrativeAgentStreamContract.js（schemaVersion 1）、shared/narrativeAgentContract.js（读工具目录与限额）。
// 规则：适配器发出的 SSE 事件必须能被上游 parseNarrativeAgentSseEvent 原样解析；改这里 = 改上游契约，需两侧同步。

export const NARRATIVE_AGENT_STREAM_SCHEMA_VERSION = 1;

export const NARRATIVE_AGENT_STREAM_EVENT_TYPES = Object.freeze([
  "step.start",
  "tool.input.delta",
  "tool.call",
  "text.delta",
  "step.finish",
  "usage",
  "error",
] as const);

export type NarrativeStreamEventType = (typeof NARRATIVE_AGENT_STREAM_EVENT_TYPES)[number];

const EVENT_TYPE_SET = new Set<string>(NARRATIVE_AGENT_STREAM_EVENT_TYPES);

function text(value: unknown, limit = 240): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function boundedInt(value: unknown, min = 0, max = 100): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

interface UsageShape { inputTokens: number; outputTokens: number; totalTokens: number }

function cleanUsage(value: Record<string, unknown> = {}): UsageShape {
  return {
    inputTokens: boundedInt(value.inputTokens, 0, 10_000_000),
    outputTokens: boundedInt(value.outputTokens, 0, 10_000_000),
    totalTokens: boundedInt(value.totalTokens, 0, 20_000_000),
  };
}

function cleanCallId(value: unknown): string {
  return text(value, 120).replace(/[^a-zA-Z0-9:_-]/g, "_");
}

function cleanInput(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return input as Record<string, unknown>;
}

export interface NarrativeStreamEvent {
  schemaVersion: number;
  type: NarrativeStreamEventType;
  requestId: string;
  seq: number;
  at: number;
  [key: string]: unknown;
}

export function createNarrativeAgentStreamEvent(
  type: NarrativeStreamEventType,
  payload: Record<string, unknown> = {},
  meta: { requestId?: string; seq?: number; at?: number } = {},
): NarrativeStreamEvent {
  if (!EVENT_TYPE_SET.has(type)) throw new Error(`未知叙事 Agent 事件：${type}`);
  const event: NarrativeStreamEvent = {
    schemaVersion: NARRATIVE_AGENT_STREAM_SCHEMA_VERSION,
    type,
    requestId: text(meta.requestId || (payload.requestId as string), 120),
    seq: boundedInt(meta.seq ?? (payload.seq as number), 1, 1_000_000),
    at: boundedInt(meta.at ?? (payload.at as number) ?? Date.now(), 0, Number.MAX_SAFE_INTEGER),
  };

  if (type === "step.start") {
    event.stepIndex = boundedInt(payload.stepIndex, 0, 20);
    event.toolChoice = ["auto", "none", "required"].includes(payload.toolChoice as string)
      ? (payload.toolChoice as string)
      : "auto";
  } else if (type === "tool.input.delta") {
    event.callId = cleanCallId(payload.callId);
    event.toolName = text(payload.toolName, 80);
    event.input = cleanInput(payload.input);
  } else if (type === "tool.call") {
    event.callId = cleanCallId(payload.callId);
    event.toolName = text(payload.toolName, 80);
    event.action = text(payload.action, 80);
  } else if (type === "text.delta") {
    event.content = String(payload.content ?? "").slice(0, 20_000);
  } else if (type === "step.finish") {
    event.stepIndex = boundedInt(payload.stepIndex, 0, 20);
    event.status = ["tool_calls", "final_ready", "error"].includes(payload.status as string)
      ? (payload.status as string)
      : "final_ready";
    event.terminalMode = text(payload.terminalMode, 80);
    event.toolRounds = boundedInt(payload.toolRounds, 0, 20);
    event.totalCalls = boundedInt(payload.totalCalls, 0, 100);
    event.finishReason = text(payload.finishReason, 80);
  } else if (type === "usage") {
    event.usage = cleanUsage((payload.usage || payload) as Record<string, unknown>);
  } else if (type === "error") {
    event.code = text(payload.code, 100);
    event.message = text(payload.message ?? payload.error, 240);
    event.retryable = Boolean(payload.retryable);
  }
  return event;
}

export function serializeNarrativeAgentSseEvent(event: NarrativeStreamEvent | Record<string, unknown>): string {
  const e = event as NarrativeStreamEvent;
  const normalized = createNarrativeAgentStreamEvent(e.type, event as Record<string, unknown>, event as Record<string, unknown>);
  return `event: ${normalized.type}\ndata: ${JSON.stringify(normalized)}\n\n`;
}

export function parseNarrativeAgentSseEvent(raw: string): NarrativeStreamEvent | null {
  const lines = String(raw || "").split(/\r?\n/);
  const data = lines.find((line) => line.startsWith("data:"))?.slice(5).trim();
  if (!data) return null;
  try {
    const parsed = JSON.parse(data);
    if (parsed?.schemaVersion !== NARRATIVE_AGENT_STREAM_SCHEMA_VERSION || !EVENT_TYPE_SET.has(parsed?.type)) return null;
    return parsed;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 读工具目录（上游 narrativeAgentContract.js）：action 枚举与限额是模型可见契约。
// ---------------------------------------------------------------------------

export const NARRATIVE_TOOL_LIMITS = Object.freeze({
  maxItems: 6,
  maxIds: 12,
  maxQueryChars: 500,
  maxItemChars: 520,
  maxGetItemChars: 2800,
  maxResultChars: 4200,
  maxCallsPerRound: 4,
  maxCallsPerTurn: 6,
  maxToolResultRounds: 2,
});

export const NARRATIVE_READ_TOOLS = Object.freeze({
  world_lookup: Object.freeze({
    actions: Object.freeze(["search", "get", "related"]),
    description: "查询当前世界书中的角色、组织、地点设定、物品、规则和普通条目。",
  }),
  geo_lookup: Object.freeze({
    actions: Object.freeze(["current", "get", "nearby", "route"]),
    description: "查询当前地点、地点详情、邻近地点和已有路线约束。",
  }),
  history_lookup: Object.freeze({
    actions: Object.freeze(["search", "get", "trace"]),
    description: "查询并追溯与地点、人物、时间和因果相关的世界历史或玩家历史。",
  }),
  memory_lookup: Object.freeze({
    actions: Object.freeze(["search", "get"]),
    description: "查询当前项目或会话中已经确认的记忆事实。",
  }),
  politics_lookup: Object.freeze({
    actions: Object.freeze(["current", "get", "trace"]),
    description: "查询当前势力关系、人物关系、地点控制和已确认政治事实。必须先核对相关世界书条目。",
  }),
} as const);

export type PinaxToolName = keyof typeof NARRATIVE_READ_TOOLS;
export const PINAX_TOOL_NAMES = Object.freeze(Object.keys(NARRATIVE_READ_TOOLS) as PinaxToolName[]);
