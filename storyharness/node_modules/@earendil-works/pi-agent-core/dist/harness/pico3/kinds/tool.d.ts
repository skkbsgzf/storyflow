import type { Context } from "@earendil-works/chord";
import type { ToolCall } from "@earendil-works/pi-ai";
import { type AnyToolDeclaration, type BeforeToolApi, type CoreKind, type HookInfo, type HookResult, type Id, type Step, type Stored, type ToolControl, type ToolResult } from "../types.ts";
export type StoredToolCall = Stored<ToolCall>;
export type ToolInput = {
    assistant: Id;
    call: StoredToolCall;
    offered: string[];
    index: number;
};
export type ToolCheckpoint = {
    phase: "started";
    replay: "safe" | "unsafe";
    call: StoredToolCall;
};
export type ToolTaskResult = {
    entry: Id;
    control?: ToolControl;
};
/** Hook points this kind calls. Register with `h.hooks(namespace, kinds.tool, { … })`. */
export interface ToolHooks {
    /** Before invocation, before `started`. Chain on `call`; `{ block }` stops it. A throw blocks. */
    beforeTool(call: StoredToolCall, api: BeforeToolApi, ctx: Context): HookResult<{
        call?: StoredToolCall;
        block?: string;
    }>;
    /** After the tool returns; may replace the result. Chain. */
    afterTool(call: StoredToolCall, result: ToolResult, api: HookInfo & {
        readonly callId: string;
    }, ctx: Context): HookResult<ToolResult>;
}
/** Validate arguments with the tool's real schema (TypeBox 1.x). */
export declare function invalid(declaration: AnyToolDeclaration, call: StoredToolCall): string | undefined;
export declare const tool: CoreKind<ToolInput, ToolCheckpoint, ToolTaskResult, never, {
    entry: Id;
}, ToolHooks>;
export declare const DEFAULT_BOUNDS: {
    maxBytes: number;
    maxLines: number;
    retain: "head";
};
export type { Step };
//# sourceMappingURL=tool.d.ts.map