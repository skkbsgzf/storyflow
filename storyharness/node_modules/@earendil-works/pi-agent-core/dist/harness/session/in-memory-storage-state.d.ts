import { type CommittedWrite, type PreparedCommit } from "./commit.ts";
export type { CommittedEntryWrite, CommittedListAppendWrite, CommittedListDeleteWrite, CommittedUsageWrite, CommittedValueDeleteWrite, CommittedValueSetWrite, CommittedWrite, PreparedCommit, } from "./commit.ts";
import type { Entry, EntryScan, EntryStructure, ForkOptions, SessionStats, StorageBranchScan, UsageRow, UsageScan, Write } from "./types.ts";
import { type ListElement, type ListReadOptions, type StoredValue, type Value, type ValueList } from "./values.ts";
/**
 * Complete materialized session state for MemoryStorage and JsonlStorage.
 *
 * This is intentionally unsuitable for database backends and long-running sessions that may not fit in memory.
 * Those backends should query indexed durable state and update durable aggregates within each commit transaction.
 */
export declare class InMemoryStorageState {
    private readonly entries;
    private readonly entriesBySeq;
    private readonly scalarValues;
    private readonly listValues;
    private readonly usage;
    private stats;
    private nextSeq;
    constructor();
    prepareCommit(writes: Write[], timestamp: number): PreparedCommit;
    validateCommitted(writes: readonly CommittedWrite[]): void;
    /** Apply writes already accepted by validateCommitted() and return the post-apply totals. */
    applyValidated(writes: readonly CommittedWrite[]): SessionStats;
    createFork(options: ForkOptions): InMemoryStorageState;
    private selectForkPlan;
    private applyValueSetOrListAppend;
    advanceNextSeq(nextSeq: number): void;
    getEntries(ids: readonly string[]): Map<string, Entry>;
    getValue<T>(address: Value<T>): StoredValue<T> | undefined;
    scanValues<T>(prefix: Value<T>): StoredValue<T>[];
    readList<T>(address: ValueList<T>, options?: ListReadOptions): ListElement<T>[];
    scanBranch(query: StorageBranchScan): Entry[];
    scanBranchStructure(query: StorageBranchScan): EntryStructure[];
    scanEntries(query: EntryScan): Entry[];
    scanUsage(query: UsageScan): UsageRow[];
    getStats(): SessionStats;
    getNextSeq(): number;
}
//# sourceMappingURL=in-memory-storage-state.d.ts.map