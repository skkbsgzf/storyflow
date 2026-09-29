import type { RetryPolicy } from "@earendil-works/pi-ai";
import type { QueueMode } from "../../types.ts";
import type { AgentHarnessOptions, DriveOptions, DriveOutcome, HarnessEvent, Resources } from "../agent-harness.ts";
import type { CompactionSettings } from "../compaction/compaction.ts";
import { type Context } from "../context.ts";
import { type Gate } from "../execution/effect-gate.ts";
import type { CommitResult, InboxItem, LaneConfiguration, Operation, OperationResultRecord, OperationState, Write } from "../session/types.ts";
import type { AgentHarnessStreamOptions, AgentHarnessTool } from "../types.ts";
export declare class SliceNotImplemented extends Error {
    constructor(operation: string);
}
/** Current process-local harness configuration. */
export interface Config<TContext extends object | undefined> {
    readonly tools: AgentHarnessTool<TContext>[];
    readonly resources: Resources;
    readonly streamOptions: AgentHarnessStreamOptions;
    readonly retryPolicy: RetryPolicy;
    readonly compaction: CompactionSettings;
    readonly steeringMode: QueueMode;
    readonly followUpMode: QueueMode;
    readonly toolExecution: "sequential" | "parallel";
    readonly toolContext: AgentHarnessOptions<TContext>["toolContext"];
    readonly systemPrompt: AgentHarnessOptions<TContext>["systemPrompt"];
    readonly toProviderMessages: NonNullable<AgentHarnessOptions<TContext>["toProviderMessages"]>;
    readonly entryProjectors: Readonly<NonNullable<AgentHarnessOptions<TContext>["entryProjectors"]>>;
}
/** The current durable state owned by one lane. */
export interface LaneState {
    readonly tipId: string | null;
    readonly configuration: LaneConfiguration;
    readonly inbox: InboxItem[];
    readonly lastOperationId: string | null;
    readonly operation: Operation | null;
}
type Synchronous<TResult> = TResult extends PromiseLike<unknown> ? never : TResult;
interface CommitDecision<TResult> {
    kind: "commit";
    writes: Write[];
    materialize(commit: CommitResult): Synchronous<TResult>;
    events?(commit: CommitResult): HarnessEvent[];
}
/** One effect-free decision made on a lane's serialized mutation line. */
export type LaneCommand<TResult> = (CommitDecision<TResult> & {
    next: LaneState;
}) | {
    kind: "return";
    result: TResult;
} | {
    kind: "reject";
    error: Error;
};
export type ContinueOperationResult<TResult> = {
    kind: "cancel_requested";
} | {
    kind: "result";
    value: TResult;
};
/** A durable operation transition. The Lane pairs the state write with projection publication. */
type LanePatch = Partial<Pick<LaneState, "tipId" | "configuration" | "inbox">>;
interface FinishDecision<TResult> {
    kind: "finish";
    writes: Write[];
    record: OperationResultRecord;
    lane?: LanePatch;
    materialize(commit: CommitResult): Synchronous<TResult>;
    events?(commit: CommitResult): HarnessEvent[];
}
export type OperationCommand<TResult> = (CommitDecision<TResult> & {
    operationState: OperationState;
    lane?: LanePatch;
}) | FinishDecision<TResult> | {
    kind: "return";
    result: TResult;
};
/** One installed process-local drive pass. */
export declare class Drive {
    readonly operationId: string;
    readonly completion: Promise<DriveOutcome>;
    readonly gate: Gate;
    readonly context: Context;
    readonly waitForRetry: boolean;
    readonly closeSignal: AbortSignal;
    deferredPermits: number;
    private readonly control;
    private readonly closeController;
    private readonly resolveCompletion;
    private readonly rejectCompletion;
    constructor(options: DriveOptions, context: Context);
    settle(outcome: DriveOutcome): void;
    fail(error: unknown): void;
    beginAbort(cancellation: Promise<void>): void;
    signalAbort(): void;
    closeGate(error: Error): void;
}
export type ProcedureResult = {
    kind: "continue";
} | {
    kind: "waiting";
    outcome: DriveOutcome;
} | {
    kind: "settled";
    outcome: OperationResultRecord;
};
export {};
//# sourceMappingURL=types.d.ts.map