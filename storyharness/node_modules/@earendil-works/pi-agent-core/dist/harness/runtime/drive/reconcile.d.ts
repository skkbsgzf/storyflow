import type { Lane } from "../lane.ts";
import type { Drive, ProcedureResult } from "../types.ts";
/** Advance one cancelled durable leaf without starting new ordinary work. */
export declare function reconcileOperation<TContext extends object | undefined>(lane: Lane<TContext>, drive: Drive): Promise<ProcedureResult>;
//# sourceMappingURL=reconcile.d.ts.map