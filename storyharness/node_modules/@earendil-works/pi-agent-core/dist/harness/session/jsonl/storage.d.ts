import type { Context } from "../../context.ts";
import type { CommitResult, Entry, EntryScan, EntryStructure, SessionStats, Storage, StorageBranchScan, UsageRow, UsageScan, Write } from "../types.ts";
import type { ListElement, ListReadOptions, StoredValue, Value, ValueList } from "../values.ts";
import { type JsonlStorageHeader, type JsonlStorageOptions } from "./types.ts";
/** JSONL storage backed by an injected filesystem capability. */
export declare class JsonlStorage implements Storage {
    private readonly fileSystem;
    private readonly path;
    private readonly now;
    readonly header: JsonlStorageHeader;
    private backing;
    private readonly storageState;
    private commitQueue;
    private state;
    private closePromise;
    private constructor();
    static create(options: JsonlStorageOptions, header: JsonlStorageHeader, initialWrites: Write[], context: Context): Promise<JsonlStorage>;
    static open(options: JsonlStorageOptions, context: Context): Promise<JsonlStorage>;
    private static openV4;
    private static openLegacyV3;
    private replayCommitted;
    commit(writes: Write[], context: Context): Promise<CommitResult>;
    private applyCommit;
    private upgradeLegacyV3ToV4;
    getEntries(ids: string[], _context: Context): Promise<Map<string, Entry>>;
    getValue<T>(address: Value<T>, _context: Context): Promise<StoredValue<T> | undefined>;
    scanValues<T>(prefix: Value<T>, _context: Context): Promise<StoredValue<T>[]>;
    readList<T>(address: ValueList<T>, options: ListReadOptions | undefined, _context: Context): Promise<ListElement<T>[]>;
    scanBranch(query: StorageBranchScan, _context: Context): Promise<Entry[]>;
    scanBranchStructure(query: StorageBranchScan, _context: Context): Promise<EntryStructure[]>;
    scanEntries(query: EntryScan, _context: Context): Promise<Entry[]>;
    scanUsage(query: UsageScan, _context: Context): Promise<UsageRow[]>;
    getStats(_context: Context): Promise<SessionStats>;
    private withImportedUsage;
    isLegacyV3(): boolean;
    /** Capture the first sequence a later source commit would use. */
    captureForkNextSeq(_context: Context): Promise<number>;
    close(_context: Context): Promise<void>;
}
//# sourceMappingURL=storage.d.ts.map