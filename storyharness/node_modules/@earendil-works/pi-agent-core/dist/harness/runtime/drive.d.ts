import type { DriveOutcome } from "../agent-harness.ts";
import type { Lane } from "./lane.ts";
import type { Drive } from "./types.ts";
/** Drive one installed pass through direct durable procedures until settlement or a durable wait. */
export declare function driveOperation<TContext extends object | undefined>(lane: Lane<TContext>, drive: Drive): Promise<DriveOutcome>;
//# sourceMappingURL=drive.d.ts.map