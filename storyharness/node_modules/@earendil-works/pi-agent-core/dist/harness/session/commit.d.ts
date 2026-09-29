import type { CommitResult, Entry, EntryWrite, NewEntry, UsageRow, UsageWrite, Write } from "./types.ts";
export type CommittedEntryWrite = Entry & {
    kind: "entry";
};
export type CommittedUsageWrite = UsageRow & {
    kind: "usage";
};
export interface CommittedValueSetWrite {
    kind: "value";
    op: "set";
    seq: number;
    namespace: string;
    key: string;
    value: unknown;
}
export interface CommittedValueDeleteWrite {
    kind: "value";
    op: "delete";
    seq: number;
    namespace: string;
    key: string;
}
export interface CommittedListAppendWrite {
    kind: "list";
    op: "append";
    seq: number;
    namespace: string;
    key: string;
    value: unknown;
}
export interface CommittedListDeleteWrite {
    kind: "list";
    op: "delete";
    seq: number;
    namespace: string;
    key: string;
}
export type CommittedWrite = CommittedEntryWrite | CommittedUsageWrite | CommittedValueSetWrite | CommittedValueDeleteWrite | CommittedListAppendWrite | CommittedListDeleteWrite;
export interface PreparedCommit {
    writes: CommittedWrite[];
    result: Omit<CommitResult, "stats">;
}
export interface CommitValidationState {
    hasEntryOrUsageId(id: string): boolean;
    hasEntryId(id: string): boolean;
}
export declare function insertEntry(entry: NewEntry): EntryWrite;
export declare function insertUsage(row: Omit<UsageRow, "seq">): UsageWrite;
export declare function commitWrite(write: Write, seq: number, timestamp: number): CommittedWrite;
export declare function materializeCommittedEntry(entry: NewEntry, seq: number, timestamp: number): Entry;
export declare function prepareStorageCommit(writes: Write[], firstSeq: number, timestamp: number): PreparedCommit;
export declare function validateCommittedWrites(writes: readonly CommittedWrite[], firstSeq: number, state: CommitValidationState): void;
//# sourceMappingURL=commit.d.ts.map