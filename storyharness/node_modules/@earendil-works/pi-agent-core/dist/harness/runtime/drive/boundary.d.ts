import type { HarnessEvent, LaneQueuedItem } from "../../agent-harness.ts";
import type { AssistantReadyOperation, CheckpointOperation, CommitResult, NewEntry, NormalizedRetryPolicy, OperationScope, SessionReader, SummaryDecidingOperation, SummaryEffectPendingOperation, SummaryReadyOperation, Write } from "../../session/types.ts";
import type { Lane } from "../lane.ts";
import type { Drive, LaneState, ProcedureResult } from "../types.ts";
export interface BoundaryFinishPending {
    kind: "finish_pending";
    entryIds: string[];
}
export interface BoundaryPlacement {
    entries: NewEntry[];
    writes: Write[];
    tipId: string | null;
    inbox: LaneState["inbox"];
    triggerEntryId?: string;
    queues?: LaneQueuedItem[];
}
type FinishBoundaryOperation = CheckpointOperation | SummaryDecidingOperation | SummaryReadyOperation | SummaryEffectPendingOperation;
export declare function normalizedRetryPolicy<TContext extends object | undefined>(lane: Lane<TContext>): NormalizedRetryPolicy;
export declare function assistantReadyAtBoundary<TContext extends object | undefined>(lane: Lane<TContext>, state: LaneState, scope: OperationScope, triggerEntryId: string, overflowRecoveryUsed: boolean): AssistantReadyOperation;
/** Select and materialize one boundary's lane-owned input without committing it. */
export declare function planBoundaryInbox<TContext extends object | undefined>(lane: Lane<TContext>, drive: Drive, state: LaneState, scope: OperationScope, reader: SessionReader, tipId: string | null, followUpWhenNoTrigger: boolean): Promise<BoundaryPlacement>;
export declare function boundaryPlacementEvents(placement: BoundaryPlacement, commit: CommitResult, firstWriteIndex: number, lane: string, runId: string): HarnessEvent[];
/** Replan after before_run_end and commit either renewed work or the terminal run result. */
export declare function finishRunBoundary<TContext extends object | undefined, TState extends FinishBoundaryOperation>(lane: Lane<TContext>, drive: Drive, capability: TState, continuation: Extract<CheckpointOperation["continuation"], {
    kind: "may_finish";
}>, plannedEntryIds: readonly string[], pendingEvents?: HarnessEvent[]): Promise<ProcedureResult>;
export {};
//# sourceMappingURL=boundary.d.ts.map