import type { Usage } from "@earendil-works/pi-ai";
import type { Context } from "../../context.ts";
import type { FileSystem } from "../../types.ts";
import type { CommittedEntryWrite, CommittedValueSetWrite } from "../commit.ts";
import { type LegacyV3SessionHeader } from "./codec.ts";
import { type JsonlSessionMetadata, type JsonlStorageHeader } from "./types.ts";
type JsonlSessionMetadataBase = Omit<JsonlSessionMetadata, "path" | "modifiedAt">;
export declare function metadataFromLegacyV3Header(fileSystem: FileSystem, header: LegacyV3SessionHeader, context: Context): Promise<JsonlSessionMetadataBase>;
export declare function normalizeLegacyV3Header(fileSystem: FileSystem, header: LegacyV3SessionHeader, context: Context): Promise<JsonlStorageHeader>;
/**
 * A captured legacy file exposed as repeatable logical v4 writes.
 * Each pass reopens the path; callers must not replace or edit the source between passes.
 * Structural indexes, label/configuration metadata, and derived current values survive between scans.
 */
export declare class LegacyV3Source {
    readonly header: JsonlStorageHeader;
    readonly importedUsage: Usage;
    readonly nextSeq: number;
    readonly values: readonly CommittedValueSetWrite[];
    private readonly fileSystem;
    private readonly path;
    private readonly entries;
    private readonly resolveLegacyId;
    private constructor();
    /**
     * Scan complete v3 records without modifying the file, ignoring an unterminated final line.
     * Build parent mappings, assign IDs stable for this source instance, and derive current values
     * and imported usage. Retain metadata, not conversation payloads or an open reader. writes()
     * reopens the path to materialize captured records and resolve their payload-specific references.
     */
    static read(fileSystem: FileSystem, path: string, context: Context): Promise<LegacyV3Source>;
    entryStructures(): Iterable<Pick<CommittedEntryWrite, "id" | "parentId" | "seq">>;
    translateForkEntryId(legacyId: string): string;
    private collectRequiredTailMessageIds;
    /**
     * Stream normalized v4 entries, optionally filtered by reminted ID, followed by derived current values.
     * Each pass owns its reader and message cache, sharing only the captured IDs and metadata.
     */
    writes(context: Context, isEntrySelected?: (id: string) => boolean): AsyncIterable<CommittedEntryWrite | CommittedValueSetWrite>;
    private readCapturedEntries;
}
export {};
//# sourceMappingURL=legacy-v3.d.ts.map