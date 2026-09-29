import { type Api, type ImageContent, type Model, type Models, type Usage } from "@earendil-works/pi-ai";
import type { AgentMessage, ThinkingLevel } from "../../types.ts";
import type { AbortRequestResult, AbortResult, AgentLane, CancelQueuedResult, CompactionResult, DriveOptions, DriveResult, HarnessEvent, LaneExecutionInfo, LaneSnapshot, ModelIdentity, NavigationResult, OperationAdmissionResult, OperationRequest, QueueResult, RecordUsageResult, ResumeResult, RunResult, WatchHandle } from "../agent-harness.ts";
import { type Context } from "../context.ts";
import type { HookRegistry } from "../hooks.ts";
import { OperationMismatch } from "../result.ts";
import type { BranchScan, Entry, JsonValue, OperationMeta, OperationResultRecord, OperationState, Session, SessionReader } from "../session/types.ts";
import { type Config, type ContinueOperationResult, Drive, type LaneCommand, type LaneState, type OperationCommand } from "./types.ts";
type EmitBatch = (events: readonly HarnessEvent[], context: Context) => Promise<void>;
type WatchHandler = <T>(snapshot: T, filter: (event: HarnessEvent) => boolean, context: Context, resnapshot: (context: Context, markBoundary: () => void) => Promise<T>) => WatchHandle<T>;
type FaultHandler = (cause: unknown, context: Context) => Error;
/** Runtime implementation of one configured lane. */
export declare class Lane<TContext extends object | undefined> implements AgentLane {
    readonly name: string;
    readonly session: Session;
    readonly models: Models;
    readonly hooks: HookRegistry;
    readonly emitBatch: EmitBatch;
    private readonly onFault;
    private readonly installWatch;
    private readonly config;
    private stateChange;
    private resolveStateChange;
    private idleOwner;
    /** Package-internal drive owner. Public only because deterministic procedure tests install exact owners directly. */
    activeDrive: Drive | undefined;
    /** Authoritative live control projection while this harness owns the Session. */
    state: LaneState;
    closedError: Error | undefined;
    constructor(name: string, session: Session, models: Models, hooks: HookRegistry, state: LaneState, onFault: FaultHandler, emitBatch: EmitBatch, installWatch: WatchHandler, readConfig: () => Config<TContext>);
    getTipId(_context: Context): Promise<string | null>;
    getResult(operationId: string, context: Context): Promise<OperationResultRecord | undefined>;
    readConfig(): Config<TContext>;
    mismatch(expected: string, currentOperationId: string | null, lastOperationId: string | null): OperationMismatch;
    private readLane;
    command<TResult>(plan: (state: LaneState, reader: SessionReader) => LaneCommand<TResult> | Promise<LaneCommand<TResult>>, context: Context): Promise<TResult>;
    /**
     * Run a command against the current operation even after cancellation is requested. Use this to settle admitted
     * effects, finish the operation, or update concurrent child state. The capability narrows the planner's state type;
     * the Drive continuation remains the sole top-level state writer.
     */
    settleOperation<TState extends OperationState, TResult>(_capability: TState, plan: (state: LaneState, current: TState, meta: OperationMeta, reader: SessionReader) => OperationCommand<TResult> | Promise<OperationCommand<TResult>>, context: Context): Promise<TResult>;
    /**
     * Run an ordinary operation command only while durable control is running. Use this before starting new hooks,
     * effects, or forward progress. Returns `cancel_requested` without invoking the planner once cancellation is requested.
     */
    continueOperation<TState extends OperationState, TResult>(capability: TState, plan: (state: LaneState, current: TState, meta: OperationMeta, reader: SessionReader) => OperationCommand<TResult> | Promise<OperationCommand<TResult>>, context: Context): Promise<ContinueOperationResult<TResult>>;
    accept(request: OperationRequest, context: Context): Promise<OperationAdmissionResult>;
    private acceptRun;
    private acceptCompaction;
    private acceptNavigation;
    drive(options: DriveOptions, context: Context): Promise<DriveResult>;
    /** Package-private durable cancellation primitive. Public exposure remains guarded until M8. */
    requestOperationAbort(operationId: string, context: Context): Promise<AbortRequestResult>;
    requestAbort(operationId: string, context: Context): Promise<AbortRequestResult>;
    inspectExecution(context: Context): Promise<LaneExecutionInfo>;
    prompt(...args: [text: string, images: ImageContent[] | undefined, context: Context] | [message: AgentMessage | AgentMessage[], context: Context]): Promise<RunResult>;
    skill(name: string, additionalInstructions: string | undefined, context: Context): Promise<RunResult>;
    promptFromTemplate(name: string, args: string[] | undefined, context: Context): Promise<RunResult>;
    private driveRunRequest;
    compact(options: {
        customInstructions?: string;
    } | undefined, context: Context): Promise<CompactionResult>;
    navigateTree(targetId: string | null, options: Extract<OperationRequest, {
        kind: "navigation";
    }>["options"], context: Context): Promise<NavigationResult>;
    private driveStructuralAdmission;
    private continueAfterStructural;
    resume(context: Context): Promise<ResumeResult>;
    abort(context: Context): Promise<AbortResult>;
    steer(message: string | AgentMessage, images: ImageContent[] | undefined, context: Context): Promise<QueueResult>;
    followUp(message: string | AgentMessage, images: ImageContent[] | undefined, context: Context): Promise<QueueResult>;
    nextRun(message: string | AgentMessage, images: ImageContent[] | undefined, context: Context): Promise<QueueResult>;
    private enqueue;
    cancelQueued(entryId: string, context: Context): Promise<CancelQueuedResult>;
    recordUsage(usage: Usage, options: {
        entryId?: string;
        details?: JsonValue;
    } | undefined, context: Context): Promise<RecordUsageResult>;
    waitForIdle(context: Context): Promise<void>;
    runWhenIdle(callback: (context: Context) => void | Promise<void>, context: Context): Promise<void>;
    getModel(_context: Context): Promise<Model<Api> | undefined>;
    setModel(model: ModelIdentity, context: Context): Promise<void>;
    getThinkingLevel(_context: Context): Promise<ThinkingLevel>;
    setThinkingLevel(thinkingLevel: ThinkingLevel, context: Context): Promise<void>;
    getActiveTools(_context: Context): Promise<string[]>;
    setActiveTools(activeToolNames: string[], context: Context): Promise<void>;
    watch(context: Context): Promise<WatchHandle<LaneSnapshot>>;
    private captureLaneSnapshot;
    private setConfiguration;
    findEntries(query: BranchScan | undefined, context: Context): Promise<Entry[]>;
    findEntry(query: BranchScan | undefined, context: Context): Promise<Entry | undefined>;
    appendMessage(message: AgentMessage, context: Context): Promise<string>;
    appendCustomEntry(customType: string, data: JsonValue | undefined, context: Context): Promise<string>;
    private append;
    seal(error: Error): Promise<void>;
    private signalStateChange;
    assertOpen(): void;
}
export {};
//# sourceMappingURL=lane.d.ts.map