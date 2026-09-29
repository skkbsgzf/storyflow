import type { Context } from "../../context.ts";
import type { FileSystem } from "../../types.ts";
import type { ForkOptions } from "../types.ts";
import type { LegacyV3Source } from "./legacy-v3.ts";
import { type JsonlStorageHeader } from "./types.ts";
interface JsonlForkSourceMetadata {
    id: string;
    cwd: string;
    path: string;
}
/** Prepared fork input: format-4 file metadata or an already-normalized legacy source. */
export type JsonlForkInput = {
    kind: "open";
    metadata: JsonlForkSourceMetadata;
    nextSeq: number;
} | {
    kind: "closed";
    metadata: JsonlForkSourceMetadata;
} | {
    kind: "legacy-v3";
    normalized: LegacyV3Source;
};
/**
 * Index the source, validate the requested fork, and stream selected entries and current state
 * into an atomically published format-4 destination without modifying the source.
 * Preserve copied sequences and the source's nextSeq while excluding usage and open-operation state.
 * Source files must not be replaced or edited between passes; later append-only writes are excluded
 * by the captured sequence boundary or legacy record count. Does not open the destination Session.
 */
export declare function runJsonlFork(options: {
    input: JsonlForkInput;
    fileSystem: FileSystem;
    destinationPath: string;
    destinationHeader: Omit<JsonlStorageHeader, "nextSeq">;
    fork: ForkOptions;
}, context: Context): Promise<void>;
export {};
//# sourceMappingURL=fork.d.ts.map