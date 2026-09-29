import type { Context } from "@earendil-works/chord";
import { MemoryStorage } from "./memory.ts";
import type { DocRef, Seq, Storage, Write } from "./types.ts";
/**
 * Files in a session directory:
 *   main.jsonl                   conversations, entries, inputs, rewindable/session doc ops, each task's
 *                                CREATE and TERMINAL records, and one marker per commit. Append-only, never rewritten.
 *   sticky-<conversation>.jsonl  sticky doc ops; rewritten from its last base by `truncate` (on the Session line)
 *   task-<id>.jsonl              a live task's intermediate patches (running, checkpoints); unlinked after its
 *                                terminal record is published in main
 *
 * Publication (§10): one commit `Seq`; sidecar records are appended first, then exactly one main
 * record, last, listing the sidecar refs it expects — the publication point. Replay applies a sidecar
 * record only when main has the marker for that seq naming that file; unconfirmed sidecar tails are
 * ignored. Every record carries the committed-ID high-water. Bytes after the last newline of any file
 * are a torn write and are truncated before the file is opened for append. There is no compaction.
 *
 * With `fsync: false`, recovery covers process termination while the OS and filesystem remain alive.
 * It does not promise that an acknowledged commit survives power loss, kernel/host failure,
 * storage-cache loss, or a filesystem that loses/reorders completed writes. An acknowledged tail may
 * roll back, or a surviving main marker may reference a missing sidecar and make open fail rather
 * than expose partial state. A lost pre-effect checkpoint can cause an external effect to be attempted
 * again; external idempotency remains required.
 *
 * With `fsync: true`, each sidecar is flushed before the main publication marker is flushed. This
 * strengthens file-data durability and ordering across machine failure. It is not a complete database
 * guarantee: newly created files, renames, and unlinks are not followed by a parent-directory fsync,
 * and storage hardware/filesystems may provide weaker guarantees.
 *
 * One process owns a directory at a time; a second process is unsupported.
 */
export declare class JsonlStorage extends MemoryStorage implements Storage {
    private mainFd;
    private readonly sidecars;
    private readonly taskSidecars;
    private readonly dir;
    readonly fsync: boolean;
    private closedOnce;
    private constructor();
    static open(dir: string, opts?: {
        fsync?: boolean;
    }): Promise<JsonlStorage>;
    /** For tests and tooling: sizes of every file in the directory. */
    sizes(): {
        [file: string]: number;
    };
    private replay;
    commit(writes: readonly Write[], ctx: Context): Promise<Seq>;
    private nextIdAfter;
    private append;
    private sidecar;
    private taskSidecar;
    private retireTaskSidecar;
    /** Rewrite the sticky sidecar from its last base: temp file, optional fsync, rename. Called on the Session line. */
    truncate(ref: DocRef, _ctx?: Context): Promise<void>;
    close(_ctx?: Context): Promise<void>;
}
//# sourceMappingURL=jsonl.d.ts.map