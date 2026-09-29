import type { AssistantEffectPendingOperation, DeferredEffectPendingOperation } from "../../session/types.ts";
import type { Lane } from "../lane.ts";
import type { Drive, ProcedureResult } from "../types.ts";
/** Settle an orphaned assistant request from its bounded committed frame prefix without another provider call. */
export declare function recoverAssistantGeneration<TContext extends object | undefined>(lane: Lane<TContext>, drive: Drive, generation: AssistantEffectPendingOperation): Promise<ProcedureResult>;
/** Synthetically settle one cancelled orphaned assistant or deferred effect under its reserved ids. */
export declare function recoverCancelledAssistantEffect<TContext extends object | undefined>(lane: Lane<TContext>, drive: Drive, effect: AssistantEffectPendingOperation | DeferredEffectPendingOperation): Promise<ProcedureResult>;
//# sourceMappingURL=recovery.d.ts.map