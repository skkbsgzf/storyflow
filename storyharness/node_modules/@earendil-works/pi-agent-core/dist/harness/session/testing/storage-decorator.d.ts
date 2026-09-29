import type { Context } from "../../context.ts";
import type { CommitResult, Entry, EntryScan, EntryStructure, SessionStats, Storage, StorageBranchScan, UsageRow, UsageScan, Write } from "../types.ts";
import type { ListElement, ListReadOptions, StoredValue, Value, ValueList } from "../values.ts";
/** Test-only forwarding base for decorators that alter one part of Storage behavior. */
export declare class StorageDecorator implements Storage {
    protected readonly delegate: Storage;
    constructor(delegate: Storage);
    commit(writes: Write[], context: Context): Promise<CommitResult>;
    getEntries(ids: string[], context: Context): Promise<Map<string, Entry>>;
    getValue<T>(address: Value<T>, context: Context): Promise<StoredValue<T> | undefined>;
    scanValues<T>(prefix: Value<T>, context: Context): Promise<StoredValue<T>[]>;
    readList<T>(address: ValueList<T>, options: ListReadOptions | undefined, context: Context): Promise<ListElement<T>[]>;
    scanBranch(query: StorageBranchScan, context: Context): Promise<Entry[]>;
    scanBranchStructure(query: StorageBranchScan, context: Context): Promise<EntryStructure[]>;
    scanEntries(query: EntryScan, context: Context): Promise<Entry[]>;
    scanUsage(query: UsageScan, context: Context): Promise<UsageRow[]>;
    getStats(context: Context): Promise<SessionStats>;
    close(context: Context): Promise<void>;
}
//# sourceMappingURL=storage-decorator.d.ts.map