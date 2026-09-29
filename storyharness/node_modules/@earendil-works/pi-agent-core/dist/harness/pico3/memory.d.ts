import type { Context } from "@earendil-works/chord";
import { type Op } from "@earendil-works/chord/delta";
import type { Conversation, DocRef, Entry, EntryScan, Id, Input, JsonObject, Seq, Storage, Task, TaskScan, Write } from "./types.ts";
/**
 * In-memory Storage. The reference backend, and the read path of JsonlStorage.
 *
 * A batch is validated and staged in full before any table changes: one failed
 * batch changes no table, no document, no ID high-water, no sequence. Committed
 * IDs are never reused; IDs minted but never committed may be reused after reopen.
 */
export declare class MemoryStorage implements Storage {
    protected readonly conversationsById: Map<number, Conversation>;
    protected readonly entriesById: Map<number, Entry>;
    protected readonly entriesByConversation: Map<number, Entry[]>;
    protected readonly tasksById: Map<number, Task<import("@earendil-works/chord").JsonValue, import("./types.ts").Checkpoint>>;
    protected readonly inputsById: Map<number, Input>;
    protected readonly inputsByRequest: Map<string, Input>;
    /** Rewindable docs keep their full op history with the seq of each batch, for `docAsOf`. */
    protected readonly rewindableLog: Map<number, {
        seq: number;
        ops: Op[];
    }[]>;
    protected readonly stickyLog: Map<number, Op[][]>;
    protected sessionDoc: JsonObject | undefined;
    protected readonly entrySeq: Map<number, number>;
    protected nextIdValue: number;
    protected seq: Seq;
    private closed;
    mintId(): Id;
    protected setNextId(n: Id): void;
    commit(writes: readonly Write[], _ctx: Context): Promise<Seq>;
    /** Validate the whole batch against the current tables; return a function that applies it. */
    protected stage(writes: readonly Write[], seq: Seq): () => void;
    conversation(id: Id, _ctx?: Context): Promise<Conversation | undefined>;
    conversations(_ctx?: Context): Promise<Conversation[]>;
    entries(ids: readonly Id[], _ctx?: Context): Promise<Map<number, Entry>>;
    /** Newest-first, fork-aware: after this conversation's own entries, the parent's up to the fork point, and so on. */
    scanEntries(scan: EntryScan, _ctx?: Context): Promise<Entry[]>;
    task(id: Id, _ctx?: Context): Promise<Task<import("@earendil-works/chord").JsonValue, import("./types.ts").Checkpoint> | undefined>;
    scanTasks(scan: TaskScan, _ctx?: Context): Promise<Task<import("@earendil-works/chord").JsonValue, import("./types.ts").Checkpoint>[]>;
    input(id: Id, _ctx?: Context): Promise<Input | undefined>;
    inputByRequest(conversationId: Id, requestId: string, _ctx?: Context): Promise<Input | undefined>;
    doc(ref: DocRef, _ctx?: Context): Promise<JsonObject | undefined>;
    /**
     * Commit-granular history: the rewindable state after the atomic commit that contains
     * entry `at`, walking the fork chain for entries owned by ancestors.
     */
    docAsOf(conversationId: Id, at: Id, _ctx?: Context): Promise<JsonObject | undefined>;
    protected fold(log: Op[][]): JsonObject;
    truncate(ref: DocRef, _ctx?: Context): Promise<void>;
    close(_ctx?: Context): Promise<void>;
}
//# sourceMappingURL=memory.d.ts.map