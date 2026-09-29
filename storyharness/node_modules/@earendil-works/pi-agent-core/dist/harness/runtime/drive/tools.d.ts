import type { ToolsOperation } from "../../session/types.ts";
import type { Lane } from "../lane.ts";
import type { Drive, ProcedureResult } from "../types.ts";
/** Execute, recover, stage, and source-order one complete durable tool batch. */
export declare function runTools<TContext extends object | undefined>(lane: Lane<TContext>, drive: Drive, run: ToolsOperation): Promise<ProcedureResult>;
//# sourceMappingURL=tools.d.ts.map