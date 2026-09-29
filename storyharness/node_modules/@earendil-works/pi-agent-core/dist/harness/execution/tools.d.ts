import { type ToolResultMessage } from "@earendil-works/pi-ai";
import type { AgentToolCall, AgentToolResult } from "../../types.ts";
import { type Context } from "../context.ts";
import type { JsonValue } from "../session/types.ts";
import type { AgentHarnessTool, AgentHarnessToolInvocation, AgentHarnessToolUpdateCallback } from "../types.ts";
import type { Gate } from "./effect-gate.ts";
/** A tool call whose tool exists and whose prepared arguments passed validation. */
export interface PreparedToolCall<TContext extends object | undefined> {
    toolCall: AgentToolCall;
    tool: AgentHarnessTool<TContext>;
    args: Record<string, JsonValue>;
}
/** Synthetic result produced without crossing the external tool-effect boundary. */
export interface ImmediateToolOutcome {
    kind: "immediate";
    toolCall: AgentToolCall;
    result: AgentToolResult<unknown>;
    isError: true;
    terminate: boolean;
}
/** Aggregated decision from the before-tool hook pipeline. */
export interface BeforeToolDecision {
    args?: Record<string, JsonValue>;
    block?: {
        reason: string;
        terminate?: boolean;
    };
}
/** A prepared call cleared for durable intent publication and execution. */
export interface ClearedToolCall<TContext extends object | undefined> {
    toolCall: AgentToolCall;
    tool: AgentHarnessTool<TContext>;
    args: Record<string, JsonValue>;
}
/** Raw phase-two tool output before after-tool patching. */
export interface ExecutedToolCall {
    result: AgentToolResult<unknown>;
    isError: boolean;
}
/** Aggregated patch from the after-tool hook pipeline. */
export interface AfterToolPatch {
    content?: AgentToolResult<unknown>["content"];
    details?: JsonValue;
    isError?: boolean;
    usage?: AgentToolResult<unknown>["usage"];
    terminate?: boolean;
}
/** Final tool output ready to become a durable tool-result message. */
export interface FinalizedToolCall {
    toolCall: AgentToolCall;
    result: AgentToolResult<unknown>;
    isError: boolean;
    terminate: boolean;
}
/** Resolve a tool, apply its deterministic argument preparation, and validate the result. */
export declare function prepareToolCall<TContext extends object | undefined>(call: AgentToolCall, tools: AgentHarnessTool<TContext>[]): PreparedToolCall<TContext> | ImmediateToolOutcome;
/** Apply an explicit hook decision and revalidate replacement arguments. */
export declare function applyBeforeToolDecision<TContext extends object | undefined>(prepared: PreparedToolCall<TContext>, decision: BeforeToolDecision | undefined): ClearedToolCall<TContext> | ImmediateToolOutcome;
/** Execute one cleared external tool effect, converting expected tool throws to error output. */
export declare function executeToolCall<TContext extends object | undefined>(call: ClearedToolCall<TContext>, gate: Gate, onUpdate: AgentHarnessToolUpdateCallback<unknown>, toolContext: TContext, invocation: AgentHarnessToolInvocation, context: Context): Promise<ExecutedToolCall>;
/** Apply an after-tool patch field by field. */
export declare function finalizeToolCall<TContext extends object | undefined>(call: ClearedToolCall<TContext>, executed: ExecutedToolCall, patch: AfterToolPatch | undefined): FinalizedToolCall;
/** Reconstruct the canonical tool result represented by a staged transcript message. */
export declare function toolResultFromMessage(message: ToolResultMessage, terminate: boolean): AgentToolResult;
/** Convert finalized tool output to the provider-facing transcript message. */
export declare function createToolResultMessage(call: FinalizedToolCall): ToolResultMessage;
//# sourceMappingURL=tools.d.ts.map