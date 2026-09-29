import type { Entry, ForkOptions } from "./types.ts";
import { type StoredValue } from "./values.ts";
export interface ForkSourceSnapshot {
    entries: Entry[];
    scalarValues: StoredValue<unknown>[];
    /** False when a backend supplied only the requested branch rather than the full tree. */
    entriesComplete?: boolean;
}
export interface ForkDestinationSnapshot {
    entries: Map<string, Entry>;
    scalarValues: StoredValue<unknown>[];
    nextSeq: number;
}
/** Build the complete logical state for a forked destination session. */
export declare function createForkSnapshot(source: ForkSourceSnapshot, options: ForkOptions): ForkDestinationSnapshot;
//# sourceMappingURL=fork.d.ts.map