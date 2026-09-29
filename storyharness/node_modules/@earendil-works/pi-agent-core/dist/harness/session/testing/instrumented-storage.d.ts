import type { Context } from "../../context.ts";
import type { CommitResult, Write } from "../types.ts";
import { StorageDecorator } from "./storage-decorator.ts";
/** Test-only transparent Storage decorator that records commit admission. */
export declare class InstrumentedStorage extends StorageDecorator {
    private readonly commitAttempts;
    getCommitAttempts(): readonly Write[][];
    clearCommitAttempts(): void;
    commit(writes: Write[], context: Context): Promise<CommitResult>;
}
//# sourceMappingURL=instrumented-storage.d.ts.map