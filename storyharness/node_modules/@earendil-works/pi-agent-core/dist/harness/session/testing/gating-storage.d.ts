import type { Context } from "../../context.ts";
import type { CommitResult, Write } from "../types.ts";
import { StorageDecorator } from "./storage-decorator.ts";
/** Thrown for every commit rejected after simulated storage loss. */
export declare class CommitDiscarded extends Error {
    constructor(message: string);
}
/** Test-only storage decorator that deterministically parks admitted commits. */
export declare class GatingStorage extends StorageDecorator {
    private armed;
    private discarded;
    private readonly queue;
    private readonly waiters;
    /** Fixture setup bypasses gating until explicitly armed. */
    arm(): void;
    pending(): number;
    /** Wait until at least `count` commits are parked. */
    waitPending(count?: number): Promise<void>;
    commit(writes: Write[], context: Context): Promise<CommitResult>;
    /** Release `count` commits in FIFO order and wait until each write lands. */
    next(count?: number): Promise<void>;
    /** Drop parked commits and permanently reject every later commit. */
    discard(): void;
    private notifyWaiters;
}
//# sourceMappingURL=gating-storage.d.ts.map