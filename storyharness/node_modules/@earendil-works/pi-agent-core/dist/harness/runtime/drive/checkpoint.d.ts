import { type CheckpointOperation, type StartingOperation } from "../../session/types.ts";
import type { Lane } from "../lane.ts";
import type { Drive, ProcedureResult } from "../types.ts";
/** Consume before_run and commit the initial checkpoint. */
export declare function startRun<TContext extends object | undefined>(lane: Lane<TContext>, drive: Drive, run: StartingOperation): Promise<ProcedureResult>;
/** Advance one durable run boundary with at most one commit. */
export declare function runCheckpoint<TContext extends object | undefined>(lane: Lane<TContext>, drive: Drive, run: CheckpointOperation): Promise<ProcedureResult>;
//# sourceMappingURL=checkpoint.d.ts.map