import type { Context } from "../context.ts";
import type { CommitResult, Entry, EntryScan, EntryStructure, ForkOptions, Session, SessionCreateOptions, SessionMetadata, SessionRepo, SessionStats, Storage, StorageBranchScan, UsageRow, UsageScan, Write } from "./types.ts";
import type { ListElement, ListReadOptions, StoredValue, Value, ValueList } from "./values.ts";
export interface MemoryStorageOptions {
    now?: () => number;
}
export interface MemorySessionRepoOptions {
    now?: () => number;
}
export declare class MemoryStorage implements Storage {
    private readonly now;
    private storageState;
    private commitQueue;
    private state;
    private closePromise;
    constructor(options?: MemoryStorageOptions);
    commit(writes: Write[], _context: Context): Promise<CommitResult>;
    getEntries(ids: string[], _context: Context): Promise<Map<string, Entry>>;
    getValue<T>(address: Value<T>, _context: Context): Promise<StoredValue<T> | undefined>;
    scanValues<T>(prefix: Value<T>, _context: Context): Promise<StoredValue<T>[]>;
    readList<T>(address: ValueList<T>, options: ListReadOptions | undefined, _context: Context): Promise<ListElement<T>[]>;
    scanBranch(query: StorageBranchScan, _context: Context): Promise<Entry[]>;
    scanBranchStructure(query: StorageBranchScan, _context: Context): Promise<EntryStructure[]>;
    scanEntries(query: EntryScan, _context: Context): Promise<Entry[]>;
    scanUsage(query: UsageScan, _context: Context): Promise<UsageRow[]>;
    getStats(_context: Context): Promise<SessionStats>;
    /** Construct a destination storage at one serialized boundary between source commits. */
    fork(options: ForkOptions): Promise<MemoryStorage>;
    close(_context: Context): Promise<void>;
}
export declare class MemorySessionRepo implements SessionRepo {
    private readonly now;
    private readonly sessions;
    private readonly pendingIds;
    private closed;
    private closePromise;
    constructor(options?: MemorySessionRepoOptions);
    create(options: SessionCreateOptions, context: Context): Promise<Session>;
    open(metadata: SessionMetadata, _context: Context): Promise<Session>;
    list(_options: undefined, _context: Context): Promise<SessionMetadata[]>;
    delete(metadata: SessionMetadata, context: Context): Promise<void>;
    fork(source: SessionMetadata, options: ForkOptions, _context: Context): Promise<Session>;
    close(context: Context): Promise<void>;
    private openRecord;
    private reserveId;
    private assertOpen;
}
//# sourceMappingURL=memory.d.ts.map