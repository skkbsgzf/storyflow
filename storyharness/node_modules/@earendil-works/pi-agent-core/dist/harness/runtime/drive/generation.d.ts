import { type AssistantReadyOperation, type AssistantRetryWaitOperation } from "../../session/types.ts";
import type { Lane } from "../lane.ts";
import type { Drive, ProcedureResult } from "../types.ts";
/** Advance one durable assistant retry wait according to this pass's local wait policy. */
export declare function runRetryWait<TContext extends object | undefined>(lane: Lane<TContext>, drive: Drive, generation: AssistantRetryWaitOperation): Promise<ProcedureResult>;
/** Execute one ready assistant generation or advance its durable retry wait. */
export declare function runGeneration<TContext extends object | undefined>(lane: Lane<TContext>, drive: Drive, generation: AssistantReadyOperation | AssistantRetryWaitOperation): Promise<ProcedureResult>;
//# sourceMappingURL=generation.d.ts.map