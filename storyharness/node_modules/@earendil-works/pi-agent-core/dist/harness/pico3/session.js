import { isJsonValue } from "@earendil-works/chord";
import { createContextKey, withContextValue, withoutAbortSignal } from "@earendil-works/chord/context";
import { isBase, track } from "@earendil-works/chord/delta";
import { deriveContext } from "./context.js";
import { Membrane } from "./membrane.js";
import { Closed, CollapseInProgress, ConversationBusy, Faulted, Forbidden, GenerationInProgress, ReadAfterWrite, } from "./types.js";
// ---------------------------------------------------------------------------
// Document cache and defaults
// ---------------------------------------------------------------------------
const docKey = (ref) => (ref.doc === "session" ? "session" : `${ref.doc}:${ref.conversationId}`);
/** Remove matching elements from a tracked array IN PLACE (never `arr = arr.filter(...)` on a tracked doc). */
export function removeWhere(arr, pred) {
    for (let i = arr.length - 1; i >= 0; i--)
        if (pred(arr[i]))
            arr.splice(i, 1);
}
const CORE_KINDS = new Set(["pi.generation", "pi.tool", "pi.post_tools", "pi.collapse"]);
const CORE_CONFIG_VALIDATORS = {
    model: (value) => exactObject(value, ["provider", "modelId"]) && value.provider !== "" && value.modelId !== "",
    thinkingLevel: (value) => typeof value === "string" && ["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(value),
    selectedTools: (value) => Array.isArray(value) && value.every((name) => typeof name === "string"),
    profile: (value) => typeof value === "string",
    retry: (value) => exactObject(value, ["enabled", "maxRetries", "baseDelayMs"], ["maxAgentDelayMs"]) &&
        typeof value.enabled === "boolean" &&
        typeof value.maxRetries === "number" &&
        Number.isSafeInteger(value.maxRetries) &&
        value.maxRetries >= 0 &&
        finiteNonnegative(value.baseDelayMs) &&
        (value.maxAgentDelayMs === undefined || finiteNonnegative(value.maxAgentDelayMs)),
    threshold: (value) => typeof value === "number" && Number.isFinite(value),
    keepRecent: finiteNonnegative,
    steeringMode: (value) => value === "all" || value === "one-at-a-time",
    followUpMode: (value) => value === "all" || value === "one-at-a-time",
};
function finiteNonnegative(value) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
function exactObject(value, required, optional = []) {
    if (value === null || typeof value !== "object" || Array.isArray(value))
        return false;
    const keys = Object.keys(value);
    return (required.every((key) => Object.hasOwn(value, key)) &&
        keys.every((key) => required.includes(key) || optional.includes(key)));
}
export const isCoreKind = (name) => CORE_KINDS.has(name);
/** Declared config defaults, derived from the registered kinds. Nothing is duplicated elsewhere. */
export class Defaults {
    rewindable = {};
    sticky = {};
    route = new Map();
    owners = new Map();
    constructor(kinds) {
        for (const kind of kinds)
            this.register(kind);
    }
    register(kind) {
        const declarations = ["rewindable", "sticky"].flatMap((doc) => Object.entries(kind.config?.[doc] ?? {}).map(([key, value]) => ({ doc, key, value })));
        const local = new Set();
        for (const { key } of declarations) {
            if (local.has(key) || this.route.has(key))
                throw new Error(`config key "${key}" declared by more than one kind`);
            local.add(key);
        }
        for (const { doc, key, value } of declarations) {
            this.route.set(key, doc);
            this.owners.set(key, kind);
            if (value !== undefined)
                this[doc][key] = structuredClone(value);
        }
    }
    unregister(kind) {
        for (const [key, owner] of this.owners) {
            if (owner !== kind)
                continue;
            this.owners.delete(key);
            const doc = this.route.get(key);
            this.route.delete(key);
            if (doc !== undefined)
                delete this[doc][key];
        }
    }
    validate(key, value) {
        if (!isJsonValue(value))
            return false;
        const core = CORE_CONFIG_VALIDATORS[key];
        if (core !== undefined)
            return core(value);
        return this.route.has(key);
    }
    validateSeed(doc, seed) {
        const out = {};
        for (const [key, value] of Object.entries(seed)) {
            if (value === undefined)
                continue;
            if (this.route.get(key) !== doc || !this.validate(key, value))
                throw new TypeError(`invalid ${doc} config value for "${key}"`);
            out[key] = structuredClone(value);
        }
        return out;
    }
    /** Fill declared keys that are absent (never `??`: a stored null is a value). */
    fill(doc, target) {
        for (const [key, value] of Object.entries(this[doc]))
            if (!(key in target))
                target[key] = structuredClone(value);
    }
    freshRewindable(over = {}, preservePlugins = false) {
        const base = { plugins: {} };
        this.fill("rewindable", base);
        const { plugins, ...raw } = over;
        const rest = preservePlugins ? raw : this.validateSeed("rewindable", raw);
        return {
            ...base,
            ...rest,
            ...(preservePlugins && plugins !== undefined ? { plugins: structuredClone(plugins) } : {}),
        };
    }
    freshSticky(over = {}) {
        const base = { inbox: [], turn: { tools: [] }, tasks: {}, plugins: {} };
        this.fill("sticky", base);
        const { inbox: _inbox, turn: _turn, tasks: _tasks, plugins: _plugins, ...raw } = over;
        return { ...base, ...this.validateSeed("sticky", raw) };
    }
}
class Docs {
    trackers = new Map();
    storage;
    defaults;
    /** Bytes of ops written since the last base, per document. Drives rebase+truncate. */
    sinceBase = new Map();
    constructor(storage, defaults) {
        this.storage = storage;
        this.defaults = defaults;
    }
    noteOps(ref, ops) {
        const key = docKey(ref);
        this.sinceBase.set(key, isBase(ops) ? 0 : (this.sinceBase.get(key) ?? 0) + JSON.stringify(ops).length);
    }
    requestBase(ref) {
        this.trackers.get(docKey(ref))?.rebase();
    }
    async get(ref, ctx) {
        const key = docKey(ref);
        const cached = this.trackers.get(key);
        if (cached !== undefined)
            return cached;
        const stored = await this.storage.doc(ref, ctx);
        if (stored === undefined)
            throw new Error(`document ${key} does not exist`);
        if (ref.doc !== "session")
            this.defaults.fill(ref.doc, stored); // declared defaults are visible without being persisted
        const t = track(stored);
        t.flush(); // consume the synthetic first flush; never persisted
        this.trackers.set(key, t);
        return t;
    }
    evict(ref) {
        this.trackers.delete(docKey(ref));
    }
    peek(ref) {
        return this.trackers.get(docKey(ref));
    }
    loaded(ref) {
        return this.trackers.get(docKey(ref))?.target;
    }
    adopt(ref, tracker) {
        this.trackers.set(docKey(ref), tracker);
    }
}
const HOST_TX_METHODS = [
    "conversation",
    "entry",
    "entries",
    "newestEntry",
    "scanEntries",
    "context",
    "task",
    "tasks",
    "input",
    "rewindableAsOf",
    "snapshot",
    "plugins",
    "emit",
    "config",
    "write",
    "createTask",
    "createConversation",
];
const TASK_TX_METHODS = ["checkpoint", "slot"];
const CORE_TX_METHODS = [
    "rewindable",
    "sticky",
    "session",
    "toolSlot",
    "appendEntry",
    "send",
    "resolveInputs",
    "boundary",
    "markTask",
    "setTask",
    "withdrawInput",
    "createOwnedConversation",
    "createForkConversation",
];
const CALLBACK_TX_METHODS = new Set([...HOST_TX_METHODS, ...TASK_TX_METHODS, ...CORE_TX_METHODS]);
class TxImpl {
    writes = [];
    touched = new Map();
    membrane = new Membrane("tx");
    // Overlays for direct reads: complete for the tables a closure reads after writing.
    createdTasks = new Map();
    createdEntries = new Map();
    createdConversations = new Map();
    inputsById = new Map();
    inputsByRequest = new Map();
    /**
     * Transaction-local identity cache for heterogeneous namespace façades.
     * Keys are current namespace token objects, validated before lookup; values are
     * merged membrane wrappers. TxImpl owns the map and revoke() invalidates every value.
     */
    namespaceViews = new Map();
    changedConfig = new Map();
    // Domains written: scans over them reject.
    wroteEntries = new Set();
    wroteTasks = false;
    poisoned;
    surfaceActive = true;
    /** Set while a terminal closure runs: the invoker's task counts as gone for busy(). */
    closing = false;
    changes = { entries: [], tasks: [], inputs: [], conversations: [], docs: [], events: [] };
    invoker;
    storage;
    docs;
    defaults;
    kinds;
    namespaces;
    liveTasks;
    conversations;
    now;
    ctx;
    constructor(invoker, storage, docs, defaults, kinds, namespaces, liveTasks, conversations, now, ctx) {
        this.invoker = invoker;
        this.storage = storage;
        this.docs = docs;
        this.defaults = defaults;
        this.kinds = kinds;
        this.namespaces = namespaces;
        this.liveTasks = liveTasks;
        this.conversations = conversations;
        this.now = now;
        this.ctx = ctx;
    }
    callbackSurface() {
        const implementation = this;
        const methods = new Map();
        const target = Object.freeze(Object.create(null));
        return new Proxy(target, {
            get: (_target, key) => {
                if (typeof key !== "string" || !CALLBACK_TX_METHODS.has(key))
                    return undefined;
                const cached = methods.get(key);
                if (cached !== undefined)
                    return cached;
                const method = implementation[key];
                if (typeof method !== "function")
                    throw new Error(`transaction method ${key} is missing`);
                const bound = (...args) => {
                    this.assertSurfaceActive();
                    return Reflect.apply(method, this, args);
                };
                methods.set(key, bound);
                return bound;
            },
        });
    }
    closeSurface() {
        this.surfaceActive = false;
    }
    assertSurfaceActive() {
        if (!this.surfaceActive)
            throw new TypeError("transaction used outside its callback");
    }
    // --- capability & scope -------------------------------------------------
    get core() {
        return this.invoker.type === "kernel" || (this.invoker.type === "task" && this.invoker.core);
    }
    assertCore(what) {
        if (!this.core)
            throw new Forbidden(`${what}: core turn machinery only`);
    }
    assertNotHost(what) {
        if (this.invoker.type !== "task")
            throw new Forbidden(`${what} outside a task`);
    }
    /** A task may touch its own conversation and the subtree it owns. The host and core may touch anything. */
    inScope(conversationId) {
        if (this.invoker.type !== "task" || this.invoker.core)
            return true;
        if (conversationId === this.invoker.conversationId || this.createdConversations.has(conversationId))
            return true;
        const task = this.createdTasks.get(this.invoker.id) ?? this.liveTasks.get(this.invoker.id);
        for (const root of task?.owns ?? [])
            if (this.conversations.subtree(root).has(conversationId))
                return true;
        return false;
    }
    assertScope(conversationId, what) {
        if (!this.inScope(conversationId))
            throw new Forbidden(`${what}: conversation ${conversationId} is outside this task's subtree`);
    }
    assertEntryScope(entry, what) {
        if (this.inScope(entry.conversationId))
            return;
        if (this.invoker.type !== "task" || this.invoker.core)
            throw new Forbidden(`${what}: entry ${entry.id} is outside this task's subtree`);
        const candidates = new Set([this.invoker.conversationId, ...this.createdConversations.keys()]);
        const task = this.createdTasks.get(this.invoker.id) ?? this.liveTasks.get(this.invoker.id);
        for (const root of task?.owns ?? [])
            for (const id of this.conversations.subtree(root))
                candidates.add(id);
        for (const candidate of candidates) {
            let conversation = this.createdConversations.get(candidate) ?? this.conversations.get(candidate);
            while (conversation?.parent !== undefined) {
                if (conversation.parent.conversationId === entry.conversationId && entry.id <= conversation.parent.at)
                    return;
                conversation = this.conversations.get(conversation.parent.conversationId);
            }
        }
        throw new Forbidden(`${what}: entry ${entry.id} is not visible from this task's subtree`);
    }
    poison(error) {
        this.poisoned ??= error;
        throw error;
    }
    assertNoEntryWrites(conversationId, read) {
        if (this.wroteEntries.has(conversationId))
            this.poison(new ReadAfterWrite(read, "entry append"));
    }
    assertNoTaskWrites(read) {
        if (this.wroteTasks)
            this.poison(new ReadAfterWrite(read, "task write"));
    }
    get poison_() {
        return this.poisoned;
    }
    // --- reads (direct reads see this transaction's writes) -------------------
    async conversation(id) {
        this.assertScope(id, "conversation");
        return this.createdConversations.get(id) ?? (await this.storage.conversation(id, this.ctx));
    }
    async entry(a, b) {
        const id = typeof a === "number" ? a : b;
        const e = this.createdEntries.get(id) ?? (await this.storage.entries([id], this.ctx)).get(id);
        if (e !== undefined)
            this.assertEntryScope(e, "entry");
        return typeof a === "number" || a.is(e) ? e : undefined;
    }
    async entries(ids) {
        const out = await this.storage.entries(ids.filter((id) => !this.createdEntries.has(id)), this.ctx);
        for (const id of ids) {
            const c = this.createdEntries.get(id);
            if (c)
                out.set(id, c);
        }
        for (const entry of out.values())
            this.assertEntryScope(entry, "entries");
        return out;
    }
    async newestEntry(conversationId, opts = {}) {
        this.assertScope(conversationId, "newestEntry");
        this.assertNoEntryWrites(conversationId, "newestEntry");
        const scan = "is" in opts ? { kind: opts.kind } : opts;
        const [e] = await this.storage.scanEntries({ conversationId, ...scan, limit: 1 }, this.ctx);
        return e;
    }
    scanEntries(scan) {
        this.assertScope(scan.conversationId, "scanEntries");
        this.assertNoEntryWrites(scan.conversationId, "scanEntries");
        return this.storage.scanEntries(scan, this.ctx);
    }
    async context(conversationId, at) {
        this.assertScope(conversationId, "context");
        this.assertNoEntryWrites(conversationId, "context");
        return deriveContext(this.storage, conversationId, at, this.ctx);
    }
    async task(a) {
        const id = typeof a === "number" ? a : a.id;
        const task = this.createdTasks.get(id) ?? this.liveTasks.get(id) ?? (await this.storage.task(id, this.ctx));
        if (task !== undefined)
            this.assertScope(task.conversationId, "task");
        return task;
    }
    async tasks(scan) {
        this.assertNoTaskWrites("tasks");
        if (scan.conversationId !== undefined)
            this.assertScope(scan.conversationId, "tasks");
        const rows = await this.storage.scanTasks(scan, this.ctx);
        const seen = new Set(rows.map((t) => t.id));
        for (const t of this.liveTasks.values())
            if (!seen.has(t.id) &&
                (scan.conversationId === undefined || t.conversationId === scan.conversationId) &&
                (scan.kind === undefined || t.kind === scan.kind))
                rows.push(t);
        return rows.filter((t) => scan.status === undefined || scan.status.includes(t.status));
    }
    async input(id) {
        const input = this.inputsById.get(id) ?? (await this.storage.input(id, this.ctx));
        if (input !== undefined)
            this.assertScope(input.conversationId, "input");
        return input;
    }
    async inputByRequest(conversationId, requestId) {
        this.assertScope(conversationId, "inputByRequest");
        return (this.inputsByRequest.get(`${conversationId}:${requestId}`) ??
            (await this.storage.inputByRequest(conversationId, requestId, this.ctx)));
    }
    async rewindableAsOf(conversationId, at) {
        this.assertScope(conversationId, "rewindableAsOf");
        return this.storage.docAsOf(conversationId, at, this.ctx);
    }
    snapshot(ref) {
        if (ref.doc !== "session")
            this.assertScope(ref.conversationId, "snapshot");
        const value = structuredClone(this.doc(ref).target);
        if (ref.doc !== "session") {
            this.defaults.fill(ref.doc, value);
            if (this.invoker.type === "task") {
                for (const [key, fallback] of Object.entries(this.invoker.kind.config?.[ref.doc] ?? {})) {
                    if (!(key in value) && fallback !== undefined)
                        value[key] = structuredClone(fallback);
                }
            }
        }
        return value;
    }
    // --- documents ----------------------------------------------------------
    doc(ref) {
        const key = docKey(ref);
        const hit = this.touched.get(key);
        if (hit !== undefined)
            return hit.tracker;
        const cached = this.docs.peek(ref);
        if (cached !== undefined) {
            this.touched.set(key, { ref, tracker: cached });
            return cached;
        }
        throw new Error(`document ${key} not loaded; pass it in commit({ docs })`);
    }
    view(ref) {
        return this.membrane.wrap(this.doc(ref).state);
    }
    async preload(refs) {
        for (const ref of refs) {
            const key = docKey(ref);
            if (this.touched.has(key))
                continue;
            this.touched.set(key, { ref, tracker: await this.docs.get(ref, this.ctx) });
        }
    }
    rewindable(conversationId) {
        this.assertCore("rewindable document");
        return this.view({ doc: "rewindable", conversationId });
    }
    sticky(conversationId) {
        this.assertCore("sticky document");
        return this.view({ doc: "sticky", conversationId });
    }
    session() {
        this.assertCore("session document");
        return this.view({ doc: "session" });
    }
    /** Internal, unchecked. */
    raw(ref) {
        return this.view(ref);
    }
    plugins(namespace) {
        const registration = this.namespaces.get(namespace.id);
        if (registration?.token !== namespace)
            throw new Forbidden(`namespace "${namespace.id}" is stale`);
        const cached = this.namespaceViews.get(namespace);
        if (cached !== undefined)
            return cached;
        const conversationId = this.invocationConversationId(`plugins(${namespace.id})`);
        const target = {};
        for (const [key, doc] of registration.routes) {
            const ref = doc === "session" ? { doc } : { doc, conversationId };
            const document = this.raw(ref);
            if (!Object.hasOwn(document.plugins, namespace.id))
                document.plugins[namespace.id] = {};
            const slice = document.plugins[namespace.id];
            const defaultValue = registration.defaults[doc][key];
            if (!(key in slice) && defaultValue !== undefined)
                slice[key] = plain(defaultValue);
            Object.defineProperty(target, key, {
                enumerable: true,
                get: () => slice[key],
                set: (value) => {
                    slice[key] = value;
                },
            });
        }
        Object.preventExtensions(target);
        const view = this.membrane.wrap(target);
        this.namespaceViews.set(namespace, view);
        return view;
    }
    emit(namespaceOrEvent, name, data) {
        const conversationId = this.invocationConversationId("emit");
        if ("id" in namespaceOrEvent && "unregister" in namespaceOrEvent) {
            if (this.namespaces.get(namespaceOrEvent.id)?.token !== namespaceOrEvent)
                throw new Forbidden(`namespace "${namespaceOrEvent.id}" is stale`);
            if (name === undefined || data === undefined || !/^[a-z][a-z0-9_.-]*$/i.test(name))
                throw new Error("invalid plugin event");
            this.changes.events.push({
                conversationId,
                event: { type: `plugin.${namespaceOrEvent.id}.${name}`, data: plain(data) },
            });
            return;
        }
        this.assertCore("core event");
        this.changes.events.push({ conversationId, event: plain(namespaceOrEvent) });
    }
    invocationConversationId(what) {
        const conversationId = this.invoker.conversationId;
        if (conversationId === undefined)
            throw new Forbidden(`${what}: no conversation is bound to this transaction`);
        this.assertScope(conversationId, what);
        return conversationId;
    }
    config(conversationId) {
        this.assertScope(conversationId, "config");
        const definition = (key) => {
            if (this.invoker.type === "task") {
                for (const doc of ["rewindable", "sticky"]) {
                    const declared = this.invoker.kind.config?.[doc];
                    if (declared !== undefined && Object.hasOwn(declared, key))
                        return { doc, fallback: declared[key] };
                }
            }
            const doc = this.defaults.route.get(key);
            if (doc === undefined)
                throw new Error(`unknown config key "${key}"`);
            return { doc, fallback: this.defaults[doc][key] };
        };
        const assertWritable = (key) => {
            if (this.invoker.type === "task" && !this.invoker.core)
                throw new Forbidden(`config(${key}): ordinary tasks cannot write config`);
        };
        return {
            get: (key) => {
                this.assertSurfaceActive();
                const { doc, fallback } = definition(key);
                const document = this.doc({ doc, conversationId }).target;
                return key in document ? structuredClone(document[key]) : structuredClone(fallback);
            },
            set: (key, value) => {
                this.assertSurfaceActive();
                assertWritable(key);
                const { doc } = definition(key);
                if (!this.defaults.validate(key, value))
                    throw new TypeError(`invalid config value for "${key}"`);
                this.raw({ doc, conversationId })[key] = structuredClone(value);
                const keys = this.changedConfig.get(conversationId) ?? new Set();
                keys.add(key);
                this.changedConfig.set(conversationId, keys);
            },
            reset: (key) => {
                this.assertSurfaceActive();
                assertWritable(key);
                const { doc } = definition(key);
                delete this.raw({ doc, conversationId })[key];
                const keys = this.changedConfig.get(conversationId) ?? new Set();
                keys.add(key);
                this.changedConfig.set(conversationId, keys);
            },
        };
    }
    slot(ref) {
        this.assertNotHost("slot");
        const inv = this.invoker;
        const task = this.liveTasks.get(ref.id) ?? this.createdTasks.get(ref.id);
        if (task === undefined)
            throw new Error(`task ${ref.id} is not live`);
        if (!inv.core && ref.id !== inv.id)
            throw new Forbidden("slot: another task's slot");
        const s = this.raw({ doc: "sticky", conversationId: task.conversationId });
        if (!(String(ref.id) in s.tasks))
            s.tasks[ref.id] = (ref.kind.slot ?? (() => ({})))(task.input);
        return s.tasks[ref.id];
    }
    toolSlot(task) {
        this.assertCore("toolSlot");
        const slot = this.raw({ doc: "sticky", conversationId: task.conversationId }).turn.tools[task.input.index];
        if (slot === undefined)
            throw new Error(`no tool slot at index ${task.input.index}`);
        return slot;
    }
    appendEntry(conversationId, a, b) {
        this.assertCore("appendEntry");
        if ("is" in a)
            return {
                id: this.appendEntryInternal(conversationId, { ...b, kind: a.kind }),
                kind: a,
            };
        return this.appendEntryInternal(conversationId, a);
    }
    appendEntryInternal(conversationId, entry) {
        if (this.invoker.type === "task" && !this.liveTasks.has(this.invoker.id) && !this.closing)
            throw new Forbidden("appendEntry from a task that is not live");
        const id = this.storage.mintId();
        const head = entry.head === "self" ? id : entry.head;
        const { head: _h, ...rest } = entry;
        const record = plain({
            ...rest,
            id,
            conversationId,
            ...(head === undefined ? {} : { head }),
            ...(this.invoker.type === "task" ? { byTaskId: this.invoker.id } : {}),
        });
        validateEntry(record);
        this.writes.push({ type: "entry", entry: record });
        this.changes.entries.push(record);
        if (record.head !== undefined)
            this.changes.events.push({ conversationId, event: { type: "head.moved", entry: record } });
        this.changes.events.push({ conversationId, event: { type: "entry.added", entry: record } });
        this.createdEntries.set(id, record);
        this.wroteEntries.add(conversationId);
        return id;
    }
    async write(conversationId, a, b) {
        this.assertScope(conversationId, "write");
        const entry = "is" in a ? { ...b, kind: a.kind } : a;
        if (!this.core) {
            if (entry.head !== undefined)
                throw new Forbidden("write: head entries are core only");
            if (entry.edits !== undefined)
                throw new Forbidden("write: edits are core only");
            if (entry.kind.startsWith("pi.") && entry.kind !== "pi.notice")
                throw new Forbidden(`write: kind ${entry.kind} is reserved`);
            if (entry.kind === "pi.notice" && (entry.model?.length !== 1 || entry.model[0]?.role !== "user")) {
                throw new Forbidden("write: pi.notice requires exactly one user model message");
            }
        }
        if (this.busy(conversationId)) {
            const id = this.storage.mintId();
            this.raw({ doc: "sticky", conversationId }).inbox.push({
                id,
                mode: "write",
                entry: structuredClone(entry),
            });
            this.putInput({ id, conversationId, status: "queued" });
            this.changes.events.push({ conversationId, event: { type: "input.queued", input: id, mode: "write" } });
            return id;
        }
        const id = this.storage.mintId();
        const e = this.appendEntryInternal(conversationId, entry);
        this.putInput({ id, conversationId, status: "done", entry: e });
        return id;
    }
    checkpoint(value) {
        this.assertNotHost("checkpoint");
        const inv = this.invoker;
        if (inv.mode === "abort")
            throw new Forbidden("checkpoint from an abort invocation");
        const current = this.createdTasks.get(inv.id) ?? this.liveTasks.get(inv.id);
        if (current === undefined)
            throw new Error("task not live");
        this.setTaskInternal({ ...current, checkpoint: plain(value) });
    }
    /** Kernel-internal: replace a task's mutable fields. Persists only what changed. */
    setTask(task) {
        this.assertCore("setTask");
        this.setTaskInternal(task);
    }
    setTaskInternalForControl(task) {
        this.setTaskInternal(task);
    }
    setTaskInternal(task) {
        task = plain(task);
        const prev = this.createdTasks.get(task.id) ?? this.liveTasks.get(task.id);
        const patch = { id: task.id };
        for (const key of ["status", "checkpoint", "abort", "outcome", "owns"]) {
            if (JSON.stringify(prev?.[key]) === JSON.stringify(task[key]))
                continue;
            patch[key] = key === "checkpoint" && task.checkpoint === undefined ? null : task[key];
        }
        if (task.status === "terminal") {
            patch.status = "terminal";
            patch.checkpoint = null;
            patch.owns = task.owns;
            patch.outcome = task.outcome;
            if (task.abort === true)
                patch.abort = true;
            task = { ...task };
            delete task.checkpoint;
        }
        if (Object.keys(patch).length === 1)
            return;
        if (task.status === "terminal")
            delete this.raw({ doc: "sticky", conversationId: task.conversationId }).tasks[task.id];
        this.writes.push({ type: "task.patch", patch: patch });
        this.changes.tasks.push(task);
        if (task.status === "terminal" && prev?.status !== "terminal") {
            const kind = this.kinds.get(task.kind);
            if (task.kind === "pi.collapse") {
                if (task.outcome?.status === "completed") {
                    const result = task.outcome.result;
                    this.changes.events.push({
                        conversationId: task.conversationId,
                        event: { type: "compaction.finished", taskId: task.id, summary: result.summary },
                    });
                }
                else if (task.outcome?.status === "failed") {
                    const failure = task.outcome.failure;
                    this.changes.events.push({
                        conversationId: task.conversationId,
                        event: { type: "compaction.failed", taskId: task.id, reason: failure.reason, detail: failure.detail },
                    });
                }
            }
            else if ((kind === undefined || kind.turn !== true) && task.outcome !== undefined) {
                this.changes.events.push({
                    conversationId: task.conversationId,
                    event: { type: "task.ended", taskId: task.id, kind: task.kind, outcome: task.outcome.status },
                });
            }
        }
        this.createdTasks.set(task.id, task); // overlay: later direct reads see the patch
        this.wroteTasks = true;
    }
    createTask(a, input, opts = {}) {
        if ("initial" in a) {
            const registered = this.kinds.get(a.name);
            if (registered !== a)
                throw new Forbidden(`createTask: kind "${a.name}" is not the registered token`);
            return { id: this.createTaskInternal({ kind: a.name, input: input, ...opts }), kind: a };
        }
        this.assertCore("createTask by name");
        return this.createTaskInternal(a);
    }
    createTaskInternal(spec) {
        const kind = this.kinds.get(spec.kind);
        if (kind === undefined)
            throw new Error(`unknown task kind ${spec.kind}`);
        if (isCoreKind(spec.kind) && !this.core)
            throw new Forbidden(`create core task ${spec.kind}`);
        const conversationId = spec.conversationId ?? (this.invoker.type === "task" ? this.invoker.conversationId : undefined);
        if (conversationId === undefined)
            throw new Error("createTask: conversationId required");
        this.assertScope(conversationId, "createTask");
        if (spec.kind === "pi.generation" && this.hasLiveKind(conversationId, spec.kind))
            throw new GenerationInProgress(conversationId);
        if (spec.kind === "pi.collapse" && this.hasLiveKind(conversationId, spec.kind))
            throw new CollapseInProgress(conversationId);
        const id = this.storage.mintId();
        const task = {
            id,
            conversationId,
            kind: spec.kind,
            input: plain(spec.input),
            status: "pending",
            after: [...(spec.after ?? [])],
            owns: [],
            ...(spec.background ? { background: true } : {}),
        };
        this.writes.push({ type: "task", task });
        this.changes.tasks.push(task);
        if (spec.kind === "pi.collapse") {
            const input = spec.input;
            this.changes.events.push({
                conversationId,
                event: { type: "compaction.started", taskId: id, reason: input.reason, through: input.through },
            });
        }
        else if (kind.turn !== true) {
            this.changes.events.push({
                conversationId,
                event: {
                    type: "task.started",
                    taskId: id,
                    kind: task.kind,
                    ...(task.background ? { background: true } : {}),
                },
            });
        }
        this.createdTasks.set(id, task);
        this.wroteTasks = true;
        return id;
    }
    hasLiveKind(conversationId, kind) {
        for (const task of this.liveTasks.values()) {
            if (task.conversationId !== conversationId || task.kind !== kind)
                continue;
            const current = this.createdTasks.get(task.id) ?? task;
            if (current.status === "terminal")
                continue;
            if (this.closing && this.invoker.type === "task" && this.invoker.id === task.id)
                continue;
            return true;
        }
        for (const task of this.createdTasks.values()) {
            if (task.conversationId === conversationId &&
                task.kind === kind &&
                task.status !== "terminal" &&
                !this.liveTasks.has(task.id))
                return true;
        }
        return false;
    }
    createConversation(spec) {
        const owner = this.invoker.type === "task" ? this.invoker.id : undefined;
        if (spec.parent !== undefined)
            this.assertScope(spec.parent.conversationId, "createConversation: parent");
        return this.insertConversation(spec, owner, false);
    }
    createForkConversation(spec) {
        this.assertCore("createForkConversation");
        return this.insertConversation(spec, undefined, true);
    }
    async createOwnedConversation(ownerTaskId, sourceConversationId, spec) {
        this.assertCore("createOwnedConversation");
        const owner = this.liveTasks.get(ownerTaskId) ?? this.createdTasks.get(ownerTaskId);
        if (owner === undefined || owner.status === "terminal" || owner.conversationId !== sourceConversationId)
            throw new Forbidden(`task ${ownerTaskId} cannot create an owned conversation`);
        const tip = spec.inherit ? await this.newestEntry(sourceConversationId) : undefined;
        const inherited = tip === undefined ? undefined : await this.rewindableAsOf(sourceConversationId, tip.id);
        const rawOverrides = structuredClone(spec.rewindable ?? {});
        delete rawOverrides.plugins;
        const overrides = this.defaults.validateSeed("rewindable", rawOverrides);
        const rewindable = inherited === undefined
            ? overrides
            : { ...inherited, ...overrides, plugins: structuredClone(inherited.plugins) };
        return this.insertConversation({
            ...(tip === undefined ? {} : { parent: { conversationId: sourceConversationId, at: tip.id } }),
            rewindable,
            sticky: spec.sticky,
        }, ownerTaskId, inherited !== undefined);
    }
    insertConversation(spec, owner, preservePlugins) {
        const id = this.storage.mintId();
        const parent = spec.parent === undefined || spec.parent.at === "start"
            ? undefined
            : { conversationId: spec.parent.conversationId, at: spec.parent.at };
        const conversation = {
            id,
            ...(parent ? { parent } : {}),
            ...(owner === undefined ? {} : { owner }),
            ...(spec.sections?.length ? { sections: spec.sections } : {}),
        };
        this.writes.push({ type: "conversation", conversation });
        this.changes.conversations.push(conversation);
        this.createdConversations.set(id, conversation);
        this.seedDoc({ doc: "rewindable", conversationId: id }, this.defaults.freshRewindable(spec.rewindable, preservePlugins));
        this.seedDoc({ doc: "sticky", conversationId: id }, this.defaults.freshSticky(spec.sticky));
        if (owner !== undefined) {
            const task = this.liveTasks.get(owner) ?? this.createdTasks.get(owner);
            if (task !== undefined)
                this.setTaskInternal({ ...task, owns: [...task.owns, id] });
        }
        return id;
    }
    seedDoc(ref, value) {
        const tracker = track(value);
        tracker.rebase();
        const base = tracker.flush();
        this.writes.push({ type: "doc", ref, ops: base });
        this.changes.docs.push({ ref, ops: base });
        this.docs.adopt(ref, tracker);
        this.touched.set(docKey(ref), { ref, tracker });
    }
    markTask(id) {
        this.assertCore("markTask");
        const task = this.createdTasks.get(id) ?? this.liveTasks.get(id);
        if (task === undefined)
            throw new Error(`task ${id} not live`);
        if (task.abort !== true)
            this.setTaskInternal({ ...task, abort: true });
    }
    // --- admission ----------------------------------------------------------
    /** Prospective: live turn tasks, minus this transaction's terminals and the closing task, plus this transaction's new turn tasks. */
    busy(conversationId) {
        const isTurn = (t) => this.kinds.get(t.kind)?.turn === true && t.background !== true;
        for (const t of this.liveTasks.values()) {
            if (t.conversationId !== conversationId || !isTurn(t))
                continue;
            const overlay = this.createdTasks.get(t.id);
            if (overlay?.status === "terminal")
                continue;
            if (this.closing && this.invoker.type === "task" && t.id === this.invoker.id)
                continue;
            return true;
        }
        for (const t of this.createdTasks.values())
            if (t.conversationId === conversationId && isTurn(t) && t.status !== "terminal" && !this.liveTasks.has(t.id))
                return true;
        return false;
    }
    putInput(input) {
        input = plain(input);
        this.writes.push({ type: "input", input });
        this.changes.inputs.push(input);
        this.inputsById.set(input.id, input);
        if (input.requestId !== undefined)
            this.inputsByRequest.set(`${input.conversationId}:${input.requestId}`, input);
    }
    async send(conversationId, input) {
        this.assertCore("send");
        if (input.requestId !== undefined) {
            const existing = await this.inputByRequest(conversationId, input.requestId); // before any write
            if (existing !== undefined)
                return existing.id;
        }
        if (this.busy(conversationId)) {
            const mode = input.whenBusy ?? "followUp";
            if (mode === "reject")
                throw new ConversationBusy(conversationId);
            const id = this.storage.mintId();
            this.raw({ doc: "sticky", conversationId }).inbox.push({
                id,
                mode,
                input: structuredClone(input.content),
            });
            this.putInput({
                id,
                conversationId,
                status: "queued",
                ...(input.requestId ? { requestId: input.requestId } : {}),
            });
            this.changes.events.push({ conversationId, event: { type: "input.queued", input: id, mode } });
            return id;
        }
        // Idle: read the head before the first append, place older queued items, then this one.
        const head = await this.newestEntry(conversationId, { withHead: true });
        const { triggers } = await this.boundary(conversationId, "final", head?.id);
        const id = this.storage.mintId();
        const eventStart = this.changes.events.length;
        const entry = this.appendEntryInternal(conversationId, {
            kind: "pi.user",
            model: [{ role: "user", content: input.content, timestamp: this.now() }],
        });
        const entryEvents = this.changes.events.splice(eventStart);
        this.putInput({
            id,
            conversationId,
            status: "placed",
            entry,
            ...(input.requestId ? { requestId: input.requestId } : {}),
        });
        this.changes.events.push({ conversationId, event: { type: "input.placed", input: id, entry } }, ...entryEvents);
        const inputs = [...triggers, id];
        this.createTaskInternal({ kind: "pi.generation", conversationId, input: { inputs } });
        this.changes.events.push({ conversationId, event: { type: "turn.started", inputs } });
        return id;
    }
    async setInput(id, patch) {
        const current = await this.input(id);
        if (current === undefined)
            throw new Error(`input ${id} not found`);
        this.putInput({ ...current, ...patch });
    }
    /** Kernel: withdraw a queued input. */
    async withdrawInput(id) {
        this.assertCore("withdrawInput");
        const i = await this.input(id);
        if (i === undefined)
            return "not_found";
        if (i.status !== "queued")
            return "already_placed";
        await this.preload([{ doc: "sticky", conversationId: i.conversationId }]);
        removeWhere(this.raw({ doc: "sticky", conversationId: i.conversationId }).inbox, (q) => q.id === id);
        await this.setInput(id, { status: "unanswered", reason: "aborted" });
        this.changes.events.push({ conversationId: i.conversationId, event: { type: "input.aborted", input: id } });
        return "aborted";
    }
    async resolveInputs(ids, resolution) {
        this.assertCore("resolveInputs");
        for (const id of ids)
            await this.setInput(id, resolution);
    }
    /**
     * Boundary placement (pico §9.5). No storage scan: `headBoundary` is the newest head as the
     * caller knows it, and it advances locally as same-batch self-heads are placed.
     */
    async boundary(conversationId, at, headBoundary) {
        this.assertCore("boundary");
        const s = this.raw({ doc: "sticky", conversationId });
        const inbox = [...s.inbox].sort((a, b) => a.id - b.id);
        let cut;
        for (const q of inbox)
            if (q.mode === "write" && q.entry.head === "self")
                cut = q.id;
        const stale = cut === undefined ? [] : inbox.filter((q) => q.mode !== "write" && q.id < cut).map((q) => q.id);
        for (const id of stale) {
            await this.setInput(id, { status: "unanswered", reason: "stale" });
            this.changes.events.push({ conversationId, event: { type: "input.aborted", input: id } });
        }
        const survivors = inbox.filter((q) => !stale.includes(q.id));
        const pick = (mode, policy) => {
            const items = survivors.filter((q) => q.mode === mode);
            return policy === "all" ? items : items.slice(0, 1);
        };
        const selected = new Set(stale);
        for (const q of survivors)
            if (q.mode === "write")
                selected.add(q.id);
        for (const q of pick("steer", s.steeringMode))
            selected.add(q.id);
        if (at === "final")
            for (const q of pick("followUp", s.followUpMode))
                selected.add(q.id);
        let head = headBoundary;
        const triggers = [];
        for (const q of survivors) {
            if (!selected.has(q.id))
                continue;
            if (q.mode === "write") {
                if (q.entry.head !== undefined && q.entry.head !== "self" && head !== undefined && q.entry.head < head) {
                    await this.setInput(q.id, { status: "unanswered", reason: "stale" });
                    this.changes.events.push({ conversationId, event: { type: "input.aborted", input: q.id } });
                    continue;
                }
                const eventStart = this.changes.events.length;
                const entry = this.appendEntryInternal(conversationId, q.entry);
                const entryEvents = this.changes.events.splice(eventStart);
                if (q.entry.head !== undefined)
                    head = q.entry.head === "self" ? entry : q.entry.head;
                await this.setInput(q.id, { status: "done", entry });
                this.changes.events.push({ conversationId, event: { type: "input.placed", input: q.id, entry } }, ...entryEvents);
            }
            else {
                const eventStart = this.changes.events.length;
                const entry = this.appendEntryInternal(conversationId, {
                    kind: "pi.user",
                    model: [{ role: "user", content: q.input, timestamp: this.now() }],
                });
                const entryEvents = this.changes.events.splice(eventStart);
                await this.setInput(q.id, { status: "placed", entry });
                this.changes.events.push({ conversationId, event: { type: "input.placed", input: q.id, entry } }, ...entryEvents);
                triggers.push(q.id);
            }
        }
        removeWhere(s.inbox, (q) => selected.has(q.id));
        return { triggers, terminated: cut !== undefined };
    }
    // --- finish -------------------------------------------------------------
    finish() {
        if (this.poisoned !== undefined)
            throw this.poisoned;
        for (const [conversationId, keys] of this.changedConfig) {
            this.changes.events.push({ conversationId, event: { type: "config.changed", keys: [...keys] } });
        }
        for (const { ref, tracker } of this.touched.values()) {
            const ops = tracker.flush();
            if (ops.length === 0)
                continue;
            this.writes.push({ type: "doc", ref, ops });
            this.changes.docs.push({ ref, ops });
            this.docs.noteOps(ref, ops);
        }
        return this.writes;
    }
    /** Every wrapper handed out by this transaction throws from now on. */
    revoke() {
        this.membrane.revoke();
    }
    evictTouched() {
        for (const { ref } of this.touched.values())
            this.docs.evict(ref);
    }
}
/** A plain JSON copy: no document proxy, no live reference, strict JSON (throws on cycles/BigInt). */
const plain = (v) => JSON.parse(JSON.stringify(v));
function validateEntry(e) {
    if (e.head !== undefined && e.head > e.id)
        throw new Error(`entry ${e.id}: head ${e.head} is in the future`);
    if (e.model !== undefined)
        for (const m of e.model)
            if (typeof m !== "object" || m === null || typeof m.role !== "string")
                throw new Error(`entry ${e.id}: malformed model message`);
    JSON.stringify(e); // strict JSON: throws on BigInt/cycles; undefined is dropped by construction
}
// ---------------------------------------------------------------------------
// Session: the line.
// ---------------------------------------------------------------------------
const LINE_KEY = createContextKey("pico3.session.line");
const owners = new WeakMap();
export class NestedLineOperation extends Error {
    constructor() {
        super("nested line operation");
        this.name = "NestedLineOperation";
    }
}
export class Session {
    storage;
    kinds;
    namespaces;
    tail = Promise.resolve();
    closed = false;
    fault;
    now;
    docs;
    defaults;
    liveTasks = new Map();
    /** Owner/parent graph, loaded at open and maintained on every commit. */
    conversationRecords = new Map();
    lineListeners = new Set();
    listeners = new Set();
    /** Errors from listeners and other post-commit work; never surface to the writer. */
    onReport = () => { };
    constructor(storage, kinds, namespaces, now = Date.now) {
        this.storage = storage;
        this.now = now;
        this.kinds = kinds;
        this.namespaces = namespaces;
        if (owners.has(storage))
            throw new Error("this Storage already has an owning Session");
        this.defaults = new Defaults(kinds.values());
        this.docs = new Docs(storage, this.defaults);
        owners.set(storage, this);
    }
    index = {
        get: (id) => this.conversationRecords.get(id),
        subtree: (root) => {
            const out = new Set([root]);
            let grew = true;
            while (grew) {
                grew = false;
                for (const c of this.conversationRecords.values()) {
                    if (out.has(c.id) || c.owner === undefined)
                        continue;
                    const ownerTask = this.liveTasks.get(c.owner) ?? this.ownerTaskCache.get(c.owner);
                    if (ownerTask && out.has(ownerTask.conversationId)) {
                        out.add(c.id);
                        grew = true;
                    }
                }
            }
            return out;
        },
        ancestors: (id) => {
            const chain = [];
            let c = this.conversationRecords.get(id);
            while (c?.owner !== undefined) {
                const t = this.liveTasks.get(c.owner) ?? this.ownerTaskCache.get(c.owner);
                if (t === undefined)
                    break;
                chain.unshift(t.conversationId);
                c = this.conversationRecords.get(t.conversationId);
            }
            return chain;
        },
    };
    /** Owner tasks that are terminal but whose conversations still exist (ancestry after reopen). */
    ownerTaskCache = new Map();
    async commit(invoker, fn, ctx, opts = {}) {
        ctx.abortSignal?.throwIfAborted();
        const authority = Object.freeze({ ...invoker });
        const result = await this.enter(ctx, async (lineCtx) => {
            this.assertUsable();
            lineCtx.abortSignal?.throwIfAborted();
            if (authority.type === "task") {
                // A captured runtime cannot write after its invocation returned, after terminalization, or after a mark (run mode).
                if (!authority.token.alive)
                    throw new Forbidden("commit from a finished invocation");
                const live = this.liveTasks.get(authority.id);
                if (live === undefined)
                    throw new Forbidden("commit from a task that is not live");
                if (authority.mode === "run" && live.abort === true)
                    throw new Forbidden("commit from a marked run invocation");
            }
            const tx = new TxImpl(authority, this.storage, this.docs, this.defaults, this.kinds, this.namespaces, this.liveTasks, this.index, this.now, lineCtx);
            tx.closing = opts.closing === true;
            const refs = [{ doc: "session" }, ...(opts.docs ?? [])];
            if (authority.type === "task")
                refs.push({ doc: "rewindable", conversationId: authority.conversationId }, { doc: "sticky", conversationId: authority.conversationId });
            let persisted = false;
            try {
                await tx.preload(refs);
                let value;
                try {
                    value = await fn(tx.callbackSurface(), lineCtx, {
                        setTask: (task) => tx.setTaskInternalForControl(task),
                    });
                }
                finally {
                    tx.closeSurface();
                }
                await tx.preload([...new Set(tx.changes.tasks.map((task) => task.conversationId))].map((conversationId) => ({
                    doc: "sticky",
                    conversationId,
                })));
                const writes = tx.finish();
                let seq;
                if (writes.length > 0 || tx.changes.events.length > 0) {
                    persisted = true;
                    try {
                        seq = await this.storage.commit(writes, withoutAbortSignal(lineCtx));
                    }
                    catch (error) {
                        this.fault = new Faulted(error);
                        try {
                            await this.storage.close(withoutAbortSignal(lineCtx));
                            owners.delete(this.storage);
                        }
                        catch { }
                        throw this.fault;
                    }
                    this.applyChanges(tx.changes);
                }
                const result = { value, seq, changes: tx.changes };
                if (seq !== undefined) {
                    for (const listener of this.lineListeners) {
                        try {
                            listener(result);
                        }
                        catch (error) {
                            try {
                                this.onReport(error);
                            }
                            catch { }
                        }
                    }
                }
                return result;
            }
            catch (error) {
                if (!persisted)
                    tx.evictTouched();
                throw error;
            }
            finally {
                tx.revoke();
            }
        });
        if (result.seq !== undefined)
            for (const l of this.listeners) {
                try {
                    l(result);
                }
                catch (error) {
                    this.onReport(error);
                }
            }
        return result;
    }
    /** Read-only line operation without a transaction. */
    read(fn, ctx) {
        return this.enter(ctx, (lineCtx) => {
            this.assertUsable();
            return fn(this.storage, lineCtx);
        });
    }
    /** Generic line operation (waiter registration and asynchronous lifecycle work). */
    onLine(fn, ctx) {
        return this.enter(ctx, (lineCtx) => {
            this.assertUsable();
            return fn(lineCtx);
        });
    }
    static STICKY_BASE_BUDGET = 256 * 1024;
    /** After a task terminalizes: retire its slot; base + truncate when idle or over budget. Truncation runs on the line. */
    async retire(task, ctx) {
        const ref = { doc: "sticky", conversationId: task.conversationId };
        const idle = ![...this.liveTasks.values()].some((t) => t.conversationId === task.conversationId);
        const over = (this.docs.sinceBase.get(docKey(ref)) ?? 0) > Session.STICKY_BASE_BUDGET;
        await this.commit({ type: "kernel" }, (tx) => {
            delete tx.sticky(task.conversationId).tasks[task.id];
            if (idle || over)
                this.docs.requestBase(ref);
        }, ctx, { docs: [ref] });
        if (idle || over)
            await this.enter(ctx, (lineCtx) => this.storage.truncate(ref, withoutAbortSignal(lineCtx)));
    }
    async fork(parentId, at, spec, ctx) {
        const inherited = at === "start"
            ? undefined
            : await this.read(async (storage, lineCtx) => {
                const [entry] = await storage.scanEntries({ conversationId: parentId, before: at + 1, limit: 1 }, lineCtx);
                if (entry?.id !== at)
                    throw new Error(`entry ${at} is not visible from conversation ${parentId}`);
                return storage.docAsOf(parentId, at, lineCtx);
            }, ctx);
        const rawOverrides = structuredClone(spec.rewindable ?? {});
        delete rawOverrides.plugins;
        const overrides = this.defaults.validateSeed("rewindable", rawOverrides);
        const rewindable = inherited === undefined
            ? overrides
            : { ...inherited, ...overrides, plugins: structuredClone(inherited.plugins) };
        const r = await this.commit({ type: "kernel" }, (tx) => tx.createForkConversation({
            parent: { conversationId: parentId, at },
            rewindable,
            sticky: spec.sticky,
            sections: spec.sections,
        }), ctx);
        return r.value;
    }
    async close(ctx) {
        await this.enter(ctx, async (lineCtx) => {
            if (this.closed)
                return;
            await this.storage.close(withoutAbortSignal(lineCtx));
            this.closed = true;
            owners.delete(this.storage);
        });
    }
    loadedDocument(ref) {
        return this.docs.loaded(ref);
    }
    applyChanges(e) {
        for (const t of e.tasks) {
            if (t.status === "terminal") {
                this.liveTasks.delete(t.id);
                if (t.owns.length)
                    this.ownerTaskCache.set(t.id, t);
            }
            else
                this.liveTasks.set(t.id, t);
        }
        for (const c of e.conversations)
            this.conversationRecords.set(c.id, c);
    }
    enter(ctx, op) {
        if (ctx.value(LINE_KEY) === true)
            return Promise.reject(new NestedLineOperation());
        const previous = this.tail;
        let release;
        this.tail = new Promise((resolve) => {
            release = resolve;
        });
        return (async () => {
            await previous;
            try {
                return await op(withContextValue(LINE_KEY, true, ctx));
            }
            finally {
                release();
            }
        })();
    }
    assertUsable() {
        if (this.fault !== undefined)
            throw this.fault;
        if (this.closed)
            throw new Closed();
    }
}
//# sourceMappingURL=session.js.map