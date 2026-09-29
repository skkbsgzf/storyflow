import type { HookHandler, HookInvocation, HookMap, HookName, Hooks } from "./agent-harness.ts";
import { type Context } from "./context.ts";
import type { Gate } from "./execution/effect-gate.ts";
import type { AgentHarnessStreamOptions, AgentHarnessStreamOptionsPatch } from "./types.ts";
type HookErrorReporter = (error: Error, hook: HookName, lane: string, context: Context) => void | Promise<void>;
/** Ordered harness hook registry and aggregate runner. */
export declare class HookRegistry implements Hooks {
    private readonly registrations;
    private readonly reportError;
    private closedError;
    constructor(reportError: HookErrorReporter);
    on<TName extends HookName>(name: TName, handler: HookHandler<TName>, options?: {
        id?: string;
    }): () => void;
    has(name: HookName): boolean;
    /** Invoke one accepted-operation aggregate after synchronously passing its effect gate. */
    runWithGate<TName extends HookName>(name: TName, event: HookInvocation<TName>, gate: Gate, context: Context): Promise<HookMap[TName]["result"]>;
    /** Invoke a tool-hook aggregate with one telemetry span per registered handler. */
    runToolWithGate<TName extends "before_tool" | "after_tool">(name: TName, event: HookInvocation<TName>, gate: Gate, context: Context): Promise<HookMap[TName]["result"]>;
    close(error: Error): void;
    private runAdmitted;
    private aggregate;
    private beforeRun;
    private beforeTool;
    private transformContext;
    private beforeRequest;
    private beforePayload;
    private afterResponse;
    private afterTool;
    private firstStructural;
    private invokeToolRegistration;
    private registrationsFor;
    private invokeAllFailClosed;
    private invokeAll;
}
export declare function applyStreamOptionsPatch(base: AgentHarnessStreamOptions, patch: AgentHarnessStreamOptionsPatch): AgentHarnessStreamOptions;
export {};
//# sourceMappingURL=hooks.d.ts.map