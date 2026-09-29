import type { DeferredHandle } from "@earendil-works/pi-ai";
import { type Context } from "../../context.ts";
import { type DeferredEffectPendingOperation, type DeferredSuspendedOperation, type SessionReader } from "../../session/types.ts";
import type { Lane } from "../lane.ts";
import type { Drive, ProcedureResult } from "../types.ts";
type DeferredLeaf = DeferredSuspendedOperation | DeferredEffectPendingOperation;
export declare function readDeferredSourceHandle(reader: SessionReader, deferred: DeferredLeaf, context: Context): Promise<DeferredHandle>;
/** Poll one durably suspended deferred response when this pass carries a permit. */
export declare function runDeferredSuspended<TContext extends object | undefined>(lane: Lane<TContext>, drive: Drive, deferred: DeferredSuspendedOperation): Promise<ProcedureResult>;
/** Replace one orphaned unknown-outcome poll under fresh ids when this pass carries a permit. */
export declare function recoverDeferredPoll<TContext extends object | undefined>(lane: Lane<TContext>, drive: Drive, deferred: DeferredEffectPendingOperation): Promise<ProcedureResult>;
/** Advance or report the wait for one deferred run phase. */
export declare function runDeferred<TContext extends object | undefined>(lane: Lane<TContext>, drive: Drive, deferred: DeferredSuspendedOperation | DeferredEffectPendingOperation): Promise<ProcedureResult>;
export {};
//# sourceMappingURL=deferred.d.ts.map