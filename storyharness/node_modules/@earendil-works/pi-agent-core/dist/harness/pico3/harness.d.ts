import type { Context } from "@earendil-works/chord";
import { withAbortSignal } from "@earendil-works/chord/context";
import type { TSchema } from "typebox";
import { collapse } from "./kinds/collapse.ts";
import { generation } from "./kinds/generation.ts";
import { job } from "./kinds/job.ts";
import { plugin } from "./kinds/plugin.ts";
import { postTools } from "./kinds/post-tools.ts";
import { tool } from "./kinds/tool.ts";
import { isCoreKind } from "./session.ts";
import { type SystemSection } from "./system.ts";
import { type AnyKind, type AnyToolDeclaration, type ConfigFacade, type ConfigOfKinds, type ContextView, type ConversationSpec, type DisjointConfig, type Entry, type EntryKind, type EntryScan, type HooksOf, type HostTx, type Id, type Input, type JsonObject, type JsonValue, type Models, type Namespace, type NamespaceDefaults, type NewEntry, type PluginHandler, type ProcessHost, type RewindableState, type SendInput, type StickyState, type Storage, type Task, type ToolDeclaration, type UserInput } from "./types.ts";
import { type Watch } from "./view.ts";
export interface HarnessOptions<Ks extends readonly AnyKind[] = []> {
    models: Models;
    tools?: AnyToolDeclaration[];
    /** Ordinary kinds authored with `defineTask`. Their `config` merges onto `c.config`; keys must be disjoint. */
    taskKinds?: Ks;
    sections?: SystemSection[];
    plugins?: {
        [name: string]: PluginHandler;
    };
    processHost?: ProcessHost;
    /** Clock for durable kernel timestamps and retry scheduling. */
    now?: () => number;
    root?: {
        rewindable?: Partial<RewindableState>;
        sticky?: Partial<StickyState>;
    };
    /** Errors from listeners, hooks, watches, and the scheduler. Never delivered as commit failures. */
    onReport?: (error: unknown) => void;
}
export type BuiltinKinds = readonly [
    typeof generation,
    typeof tool,
    typeof postTools,
    typeof collapse,
    typeof job,
    typeof plugin
];
export type ConfigFor<Ks extends readonly AnyKind[]> = ConfigOfKinds<[...BuiltinKinds, ...Ks]>;
export interface ConversationHandle<Cfg extends object = ConfigFor<[]>> {
    readonly id: Id;
    readonly config: ConfigFacade<Cfg>;
    send(input: SendInput, ctx: Context): Promise<InputHandle>;
    write(entry: NewEntry, ctx: Context): Promise<Id>;
    commit<T>(fn: (tx: HostTx, ctx: Context) => T | Promise<T>, ctx: Context): Promise<T>;
    rewindable(ctx: Context): Promise<RewindableState>;
    sticky(ctx: Context): Promise<StickyState>;
    context(ctx: Context): Promise<ContextView>;
    fork(at: Id | "start", spec: Omit<ConversationSpec, "parent">, ctx: Context): Promise<ConversationHandle<Cfg>>;
    collapse(instructions: string | undefined, ctx: Context): Promise<Id>;
    reset(handoff: string | undefined, ctx: Context): Promise<void>;
    abort(ctx: Context): Promise<void>;
    waitForIdle(ctx: Context): Promise<void>;
    hooks<T extends JsonObject, K extends AnyKind>(namespace: Namespace<T>, kind: K, handlers: Partial<HooksOf<K>>, opts?: {
        subtree?: boolean;
    }): () => void;
    watch(ctx: Context): Promise<Watch>;
}
export interface InputHandle {
    readonly id: Id;
    result(ctx: Context): Promise<Input | undefined>;
    wait(ctx: Context): Promise<Input>;
    abort(ctx: Context): Promise<"aborted" | "already_placed" | "not_found">;
}
export declare class Harness<Ks extends readonly AnyKind[] = []> {
    private readonly session;
    private readonly scheduler;
    private readonly views;
    private readonly kinds;
    private readonly namespaces;
    private readonly tools;
    private readonly sectionMap;
    private readonly entryKinds;
    private readonly revisions;
    private readonly plugins;
    private readonly hookRegistrations;
    private readonly conversationListeners;
    private readonly onReport;
    private readonly now;
    private readonly ctx;
    private readonly options;
    private resumed;
    private suspended;
    static open<Ks extends readonly AnyKind[] = []>(storage: Storage, options: HarnessOptions<Ks> & (DisjointConfig<[...BuiltinKinds, ...Ks]> extends true ? unknown : {
        readonly __error: "config keys collide across kinds";
    }), ctx: Context): Promise<Harness<Ks>>;
    private constructor();
    private notifyConversation;
    private assertInvocation;
    private assertTaskConversationScope;
    private assertOwnedConversation;
    private init;
    resume(): void;
    private reconcileOrphans;
    quiescent(): boolean;
    hold(): () => void;
    /** Cancel and join in-process invocations, clear transient waits, then close without terminalizing tasks. */
    suspend(ctx: Context): Promise<void>;
    registerTaskKind<K extends AnyKind>(kind: K): () => void;
    namespace<T extends JsonObject>(id: string, defaults: NamespaceDefaults<T>, opts?: {
        view?: (slice: Readonly<T>) => JsonValue;
    }): Namespace<T>;
    /** Register a tool. A duplicate name rejects. Unregister removes only this exact declaration; idempotent. */
    registerTool(tool: AnyToolDeclaration, at?: "open" | "runtime"): () => void;
    registerSection(section: SystemSection, at?: "open" | "runtime"): () => void;
    registerEntryKind(kind: EntryKind): () => void;
    /** Register namespace-bound handlers for one kind's hook points, harness-wide. Both tokens must be current. */
    hooks<T extends JsonObject, K extends AnyKind>(namespace: Namespace<T>, kind: K, handlers: Partial<HooksOf<K>>, _opts?: Readonly<Record<string, never>>): () => void;
    private checkKind;
    private checkNamespace;
    private addHooks;
    root(ctx: Context): Promise<ConversationHandle<ConfigFor<Ks>>>;
    onConversation(listener: (conversation: ConversationHandle<ConfigFor<Ks>>) => void): () => void;
    conversation(id: Id, ctx: Context): Promise<ConversationHandle<ConfigFor<Ks>> | undefined>;
    createConversation(spec: ConversationSpec & {
        input?: UserInput;
    }, ctx: Context): Promise<ConversationHandle<ConfigFor<Ks>>>;
    entries(scan: EntryScan, ctx: Context): Promise<Entry[]>;
    getTask(id: Id, ctx: Context): Promise<Task | undefined>;
    abortInput(id: Id, ctx: Context, conversationId?: Id): Promise<"aborted" | "already_placed" | "not_found">;
    abortTask(id: Id, ctx: Context): Promise<"marked" | "terminal">;
    /** Durably mark a task for abort without signalling its invocation; the scheduler aborts it when it next drains. */
    markTask(id: Id, ctx: Context): Promise<"marked" | "terminal">;
    waitForIdle(ctx: Context): Promise<void>;
    waitForTask(id: Id, ctx: Context): Promise<Task>;
    /** Signals every invocation, waits for them, closes storage. Writes nothing. */
    close(ctx: Context): Promise<void>;
    private handle;
    private watch;
    private inputHandle;
}
/**
 * §9: H = newest fork-visible entry with a head. Active transcript = H plus every fork-visible entry
 * with id ≥ H.head, chronological, nothing dropped inside the range; the whole transcript if no head.
 */
export declare function captureActiveTranscript(scan: (s: EntryScan) => Promise<Entry[]>, conversationId: Id): Promise<Entry[]>;
export { withAbortSignal, isCoreKind };
export type { ConversationView, Envelope, ViewEvent } from "./types.ts";
export type { Watch } from "./view.ts";
export { applyEnvelope, WATCH_CAPACITY } from "./view.ts";
/** The built-in kinds, as typed witnesses for `api.task`, `waitForTask`, and `hooks(kind, …)`. */
export declare const kinds: {
    readonly generation: import("./types.ts").CoreKind<import("./kinds/generation.ts").GenerationInput, import("./kinds/generation.ts").GenerationCheckpoint, import("./kinds/generation.ts").GenerationResult, import("./kinds/generation.ts").GenerationFailure, {
        assistant?: number | undefined;
    }, import("./kinds/generation.ts").GenerationHooks, {
        readonly rewindable: {
            readonly model: import("./types.ts").ModelRef | undefined;
            readonly thinkingLevel: import("./types.ts").ThinkingLevel;
            readonly selectedTools: string[];
            readonly profile: string;
        };
        readonly sticky: {
            readonly retry: import("./types.ts").RetryPolicy;
        };
    }>;
    readonly tool: import("./types.ts").CoreKind<import("./kinds/tool.ts").ToolInput, import("./kinds/tool.ts").ToolCheckpoint, import("./kinds/tool.ts").ToolTaskResult, never, {
        entry: number;
    }, import("./kinds/tool.ts").ToolHooks>;
    readonly postTools: import("./types.ts").CoreKind<import("./kinds/post-tools.ts").PostToolsInput, never, import("./kinds/post-tools.ts").PostToolsResult, never, null, import("./kinds/post-tools.ts").PostToolsHooks, {
        readonly sticky: {
            readonly steeringMode: "all" | "one-at-a-time";
            readonly followUpMode: "all" | "one-at-a-time";
        };
    }>;
    readonly collapse: import("./types.ts").CoreKind<import("./kinds/collapse.ts").CollapseInput, import("./kinds/collapse.ts").CollapseCheckpoint, {
        summary: number;
    }, import("./kinds/collapse.ts").CollapseFailure, null, import("./kinds/collapse.ts").CollapseHooks, {
        readonly rewindable: {
            readonly threshold: number;
            readonly keepRecent: number;
        };
    }>;
    readonly job: Readonly<import("./types.ts").Kind<import("./kinds/job.ts").JobInput, import("./kinds/job.ts").JobCheckpoint, import("./kinds/job.ts").JobResult, import("./kinds/job.ts").JobFailure, {
        killed: boolean;
    }, object, import("./types.ts").KindConfig<import("./types.ts").ConfigShape, import("./types.ts").ConfigShape>, import("./kinds/job.ts").JobOutput, import("./types.ts").TaskTx>>;
    readonly plugin: Readonly<import("./types.ts").Kind<import("./kinds/plugin.ts").PluginInput, {
        phase: "started";
    }, import("@earendil-works/chord").JsonValue, {
        reason: "missing_handler" | "threw";
        detail: string;
    }, null, object, import("./types.ts").KindConfig<import("./types.ts").ConfigShape, import("./types.ts").ConfigShape>, JsonObject, import("./types.ts").TaskTx>>;
};
export declare const entries: {
    readonly user: EntryKind<import("./kinds/entries.ts").UserEntry>;
    readonly assistant: EntryKind<import("./kinds/entries.ts").AssistantEntry>;
    readonly toolResult: EntryKind<import("./kinds/entries.ts").ToolResultEntry>;
    readonly system: EntryKind<import("./kinds/entries.ts").SystemEntry>;
    readonly notice: EntryKind<import("./kinds/entries.ts").NoticeEntry>;
    readonly usage: EntryKind<import("./kinds/entries.ts").UsageEntry>;
    readonly summary: EntryKind<import("./kinds/entries.ts").SummaryEntry>;
    readonly handoff: EntryKind<import("./kinds/entries.ts").HandoffEntry>;
    readonly reset: EntryKind<import("./kinds/entries.ts").ResetEntry>;
};
export type { ToolDeclaration, TSchema };
//# sourceMappingURL=harness.d.ts.map