import type { BranchPreparation } from "../../compaction/branch-summarization.ts";
import type { CompactionPreparation } from "../../compaction/compaction.ts";
import { type AssistantEffectPendingOperation, type CheckpointOperation, type DurableStructuralPreparation, type NavigationReadyToCommitOperation, type SummaryDecidingOperation, type SummaryEffectPendingOperation, type SummaryReadyOperation, type SummaryRetryWaitOperation } from "../../session/types.ts";
import type { Lane } from "../lane.ts";
import type { ContinueOperationResult, Drive, ProcedureResult } from "../types.ts";
export declare function durableCompactionPreparation(preparation: CompactionPreparation): Extract<DurableStructuralPreparation, {
    kind: "compaction";
}>;
export declare function durableBranchPreparation(preparation: BranchPreparation): Extract<DurableStructuralPreparation, {
    kind: "branch_summary";
}>;
/** Consume one durable structural preparation and decision hook. */
export declare function runStructuralDecision<TContext extends object | undefined>(lane: Lane<TContext>, drive: Drive, deciding: SummaryDecidingOperation): Promise<ProcedureResult>;
/** Execute one ready structural generation attempt. */
export declare function runStructuralGeneration<TContext extends object | undefined>(lane: Lane<TContext>, drive: Drive, ready: SummaryReadyOperation): Promise<ProcedureResult>;
/** Consume one structural retry wait without starting a provider effect. */
export declare function runStructuralRetryWait<TContext extends object | undefined>(lane: Lane<TContext>, drive: Drive, retry: SummaryRetryWaitOperation): Promise<ProcedureResult>;
/** Convert an orphaned structural attempt into a fresh numbered attempt or terminal failure. */
export declare function recoverStructuralGeneration<TContext extends object | undefined>(lane: Lane<TContext>, drive: Drive, effect: SummaryEffectPendingOperation): Promise<ProcedureResult>;
/** Prepare threshold compaction only when no newer compaction already guards this trigger. */
export declare function prepareCompactionThreshold<TContext extends object | undefined>(lane: Lane<TContext>, drive: Drive, checkpoint: CheckpointOperation): Promise<ContinueOperationResult<{
    taskId: string;
    preparation: DurableStructuralPreparation;
} | undefined>>;
/** Prepare one overflow compaction before the response settlement transaction. */
export declare function prepareOverflowCompaction<TContext extends object | undefined>(lane: Lane<TContext>, drive: Drive, generation: AssistantEffectPendingOperation): Promise<{
    taskId: string;
    preparation: DurableStructuralPreparation;
} | undefined>;
/** Atomically move an unsummarized navigation and finish its operation. */
export declare function commitNavigation<TContext extends object | undefined>(lane: Lane<TContext>, drive: Drive, navigation: NavigationReadyToCommitOperation): Promise<ProcedureResult>;
//# sourceMappingURL=structural.d.ts.map