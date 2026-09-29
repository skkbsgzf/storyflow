import { type Context } from "@earendil-works/chord";
import { type Op, type Tracker } from "@earendil-works/chord/delta";
import { type AnyKind, type Checkpoint, type ContextView, type Conversation, type ConversationSpec, type CoreTx, type DocRef, type Entry, type EntryInput, type EntryKind, type EntryRef, type EntryScan, type Id, type Input, type InputOf, type Invoker, type JsonObject, type JsonValue, type Namespace, type NamespaceRegistration, type NewEntry, type OwnedConversationSpec, type RewindableState, type SendInput, type Seq, type SessionState, type SlotOf, type StickyState, type Storage, type Task, type TaskOf, type TaskRef, type TaskScan, type TaskSpec, type ToolSlot, type ViewEvent, type Write } from "./types.ts";
/** Remove matching elements from a tracked array IN PLACE (never `arr = arr.filter(...)` on a tracked doc). */
export declare function removeWhere<T>(arr: T[], pred: (item: T) => boolean): void;
export declare const isCoreKind: (name: string) => boolean;
/** Declared config defaults, derived from the registered kinds. Nothing is duplicated elsewhere. */
export declare class Defaults {
    readonly rewindable: JsonObject;
    readonly sticky: JsonObject;
    readonly route: Map<string, "rewindable" | "sticky">;
    private readonly owners;
    constructor(kinds: Iterable<AnyKind>);
    register(kind: AnyKind): void;
    unregister(kind: AnyKind): void;
    validate(key: string, value: unknown): value is JsonValue;
    validateSeed(doc: "rewindable" | "sticky", seed: object): JsonObject;
    /** Fill declared keys that are absent (never `??`: a stored null is a value). */
    fill(doc: "rewindable" | "sticky", target: JsonObject): void;
    freshRewindable(over?: Partial<RewindableState>, preservePlugins?: boolean): RewindableState;
    freshSticky(over?: Partial<StickyState>): StickyState;
}
declare class Docs {
    private readonly trackers;
    private readonly storage;
    private readonly defaults;
    /** Bytes of ops written since the last base, per document. Drives rebase+truncate. */
    readonly sinceBase: Map<string, number>;
    constructor(storage: Storage, defaults: Defaults);
    noteOps(ref: DocRef, ops: Op[]): void;
    requestBase(ref: DocRef): void;
    get(ref: DocRef, ctx: Context): Promise<Tracker<object>>;
    evict(ref: DocRef): void;
    peek(ref: DocRef): Tracker<object> | undefined;
    loaded(ref: DocRef): JsonObject | undefined;
    adopt(ref: DocRef, tracker: Tracker<object>): void;
}
export interface CommitChanges {
    entries: Entry[];
    tasks: Task[];
    inputs: Input[];
    conversations: Conversation[];
    docs: {
        ref: DocRef;
        ops: Op[];
    }[];
    events: {
        conversationId: Id;
        event: ViewEvent;
    }[];
}
/** Session-side conversation index: owner/parent graph for subtree checks and ancestry. */
export interface ConversationIndex {
    get(id: Id): Conversation | undefined;
    /** Conversation ids in the subtree rooted at `root` (inclusive), via ownership. */
    subtree(root: Id): Set<Id>;
    /** Conversation ids from the root down to `id` (exclusive of `id`) via ownership. */
    ancestors(id: Id): Id[];
}
declare class TxImpl implements CoreTx {
    private readonly writes;
    private readonly touched;
    private readonly membrane;
    private readonly createdTasks;
    private readonly createdEntries;
    private readonly createdConversations;
    private readonly inputsById;
    private readonly inputsByRequest;
    /**
     * Transaction-local identity cache for heterogeneous namespace façades.
     * Keys are current namespace token objects, validated before lookup; values are
     * merged membrane wrappers. TxImpl owns the map and revoke() invalidates every value.
     */
    private readonly namespaceViews;
    private readonly changedConfig;
    private readonly wroteEntries;
    private wroteTasks;
    private poisoned;
    private surfaceActive;
    /** Set while a terminal closure runs: the invoker's task counts as gone for busy(). */
    closing: boolean;
    readonly changes: CommitChanges;
    readonly invoker: Invoker;
    private readonly storage;
    private readonly docs;
    private readonly defaults;
    private readonly kinds;
    private readonly namespaces;
    private readonly liveTasks;
    private readonly conversations;
    private readonly now;
    private readonly ctx;
    constructor(invoker: Invoker, storage: Storage, docs: Docs, defaults: Defaults, kinds: ReadonlyMap<string, AnyKind>, namespaces: ReadonlyMap<string, NamespaceRegistration>, liveTasks: ReadonlyMap<Id, Task>, conversations: ConversationIndex, now: () => number, ctx: Context);
    callbackSurface(): TxImpl;
    closeSurface(): void;
    private assertSurfaceActive;
    private get core();
    private assertCore;
    private assertNotHost;
    /** A task may touch its own conversation and the subtree it owns. The host and core may touch anything. */
    private inScope;
    private assertScope;
    private assertEntryScope;
    private poison;
    private assertNoEntryWrites;
    private assertNoTaskWrites;
    get poison_(): Error | undefined;
    conversation(id: Id): Promise<Conversation | undefined>;
    entry(id: Id): Promise<Entry | undefined>;
    entry<E extends Entry>(kind: EntryKind<E>, id: Id): Promise<E | undefined>;
    entries(ids: readonly Id[]): Promise<Map<number, Entry>>;
    newestEntry(conversationId: Id, opts?: {
        kind?: string;
        withHead?: boolean;
    }): Promise<Entry | undefined>;
    newestEntry<E extends Entry>(conversationId: Id, kind: EntryKind<E>): Promise<E | undefined>;
    scanEntries(scan: EntryScan): Promise<Entry[]>;
    context(conversationId: Id, at?: Id): Promise<ContextView>;
    task(id: Id): Promise<Task | undefined>;
    task<K extends AnyKind>(ref: TaskRef<K>): Promise<TaskOf<K> | undefined>;
    tasks(scan: TaskScan): Promise<Task<import("@earendil-works/chord").JsonValue, Checkpoint>[]>;
    input(id: Id): Promise<Input | undefined>;
    private inputByRequest;
    rewindableAsOf(conversationId: Id, at: Id): Promise<RewindableState | undefined>;
    snapshot(ref: {
        doc: "rewindable";
        conversationId: Id;
    }): RewindableState;
    snapshot(ref: {
        doc: "sticky";
        conversationId: Id;
    }): StickyState;
    snapshot(ref: {
        doc: "session";
    }): SessionState;
    private doc;
    private view;
    preload(refs: DocRef[]): Promise<void>;
    rewindable(conversationId: Id): RewindableState;
    sticky(conversationId: Id): StickyState;
    session(): SessionState;
    /** Internal, unchecked. */
    private raw;
    plugins<T extends JsonObject>(namespace: Namespace<T>): T;
    emit<T extends JsonObject>(namespace: Namespace<T>, name: string, data: JsonValue): void;
    emit(event: ViewEvent): void;
    private invocationConversationId;
    config(conversationId: Id): {
        get: (key: string) => import("@earendil-works/chord").JsonValue | undefined;
        set: (key: string, value: import("@earendil-works/chord").JsonValue) => void;
        reset: (key: string) => void;
    };
    slot<K extends AnyKind>(ref: TaskRef<K>): SlotOf<K>;
    toolSlot(task: {
        conversationId: Id;
        input: {
            index: number;
        };
    }): ToolSlot;
    appendEntry(conversationId: Id, entry: NewEntry): Id;
    appendEntry<E extends Entry>(conversationId: Id, kind: EntryKind<E>, entry: EntryInput<E>): EntryRef<E>;
    private appendEntryInternal;
    write(conversationId: Id, entry: NewEntry): Promise<Id>;
    write<E extends Entry>(conversationId: Id, kind: EntryKind<E>, entry: EntryInput<E>): Promise<Id>;
    checkpoint<C extends Checkpoint>(value: C): void;
    /** Kernel-internal: replace a task's mutable fields. Persists only what changed. */
    setTask(task: Task): void;
    setTaskInternalForControl(task: Task): void;
    private setTaskInternal;
    createTask(spec: TaskSpec): Id;
    createTask<K extends AnyKind>(kind: K, input: InputOf<K>, opts?: {
        conversationId?: Id;
        background?: true;
        after?: Id[];
    }): TaskRef<K>;
    private createTaskInternal;
    private hasLiveKind;
    createConversation(spec: ConversationSpec): Id;
    createForkConversation(spec: ConversationSpec): Id;
    createOwnedConversation(ownerTaskId: Id, sourceConversationId: Id, spec: OwnedConversationSpec): Promise<Id>;
    private insertConversation;
    private seedDoc;
    markTask(id: Id): void;
    /** Prospective: live turn tasks, minus this transaction's terminals and the closing task, plus this transaction's new turn tasks. */
    busy(conversationId: Id): boolean;
    private putInput;
    send(conversationId: Id, input: SendInput): Promise<Id>;
    private setInput;
    /** Kernel: withdraw a queued input. */
    withdrawInput(id: Id): Promise<"aborted" | "already_placed" | "not_found">;
    resolveInputs(ids: readonly Id[], resolution: {
        status: "done";
        answer: Id;
    } | {
        status: "unanswered";
        reason: NonNullable<Input["reason"]>;
        detail?: string;
    }): Promise<void>;
    /**
     * Boundary placement (pico §9.5). No storage scan: `headBoundary` is the newest head as the
     * caller knows it, and it advances locally as same-batch self-heads are placed.
     */
    boundary(conversationId: Id, at: "postTools" | "final", headBoundary: Id | undefined): Promise<{
        triggers: Id[];
        terminated: boolean;
    }>;
    finish(): Write[];
    /** Every wrapper handed out by this transaction throws from now on. */
    revoke(): void;
    evictTouched(): void;
}
export declare class NestedLineOperation extends Error {
    constructor();
}
export interface CommitResult<T> {
    value: T;
    seq: Seq | undefined;
    changes: CommitChanges;
}
export interface TransactionControl {
    setTask(task: Task): void;
}
export declare class Session {
    readonly storage: Storage;
    readonly kinds: ReadonlyMap<string, AnyKind>;
    readonly namespaces: ReadonlyMap<string, NamespaceRegistration>;
    private tail;
    private closed;
    private fault;
    private readonly now;
    readonly docs: Docs;
    readonly defaults: Defaults;
    readonly liveTasks: Map<number, Task<import("@earendil-works/chord").JsonValue, Checkpoint>>;
    /** Owner/parent graph, loaded at open and maintained on every commit. */
    readonly conversationRecords: Map<number, Conversation>;
    readonly lineListeners: Set<(result: CommitResult<unknown>) => void>;
    readonly listeners: Set<(r: CommitResult<unknown>) => void>;
    /** Errors from listeners and other post-commit work; never surface to the writer. */
    onReport: (error: unknown) => void;
    constructor(storage: Storage, kinds: ReadonlyMap<string, AnyKind>, namespaces: ReadonlyMap<string, NamespaceRegistration>, now?: () => number);
    readonly index: ConversationIndex;
    /** Owner tasks that are terminal but whose conversations still exist (ancestry after reopen). */
    readonly ownerTaskCache: Map<number, Task<import("@earendil-works/chord").JsonValue, Checkpoint>>;
    commit<T>(invoker: Invoker, fn: (tx: TxImpl, ctx: Context, control: TransactionControl) => T | Promise<T>, ctx: Context, opts?: {
        docs?: DocRef[];
        closing?: boolean;
    }): Promise<CommitResult<T>>;
    /** Read-only line operation without a transaction. */
    read<T>(fn: (storage: Storage, ctx: Context) => Promise<T>, ctx: Context): Promise<T>;
    /** Generic line operation (waiter registration and asynchronous lifecycle work). */
    onLine<T>(fn: (ctx: Context) => T | Promise<T>, ctx: Context): Promise<T>;
    static readonly STICKY_BASE_BUDGET: number;
    /** After a task terminalizes: retire its slot; base + truncate when idle or over budget. Truncation runs on the line. */
    retire(task: Task, ctx: Context): Promise<void>;
    fork(parentId: Id, at: Id | "start", spec: Omit<ConversationSpec, "parent">, ctx: Context): Promise<Id>;
    close(ctx: Context): Promise<void>;
    loadedDocument(ref: DocRef): JsonObject | undefined;
    private applyChanges;
    private enter;
    private assertUsable;
}
export type { TxImpl };
//# sourceMappingURL=session.d.ts.map