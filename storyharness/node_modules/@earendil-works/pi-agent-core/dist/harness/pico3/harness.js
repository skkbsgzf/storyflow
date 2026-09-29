import { withAbortSignal } from "@earendil-works/chord/context";
import { createHookRunners } from "./hooks.js";
import { chooseThrough, collapse } from "./kinds/collapse.js";
import { entries as builtinEntries } from "./kinds/entries.js";
import { generation } from "./kinds/generation.js";
import { job } from "./kinds/job.js";
import { plugin } from "./kinds/plugin.js";
import { postTools } from "./kinds/post-tools.js";
import { tool } from "./kinds/tool.js";
import { Scheduler } from "./scheduler.js";
import { isCoreKind, Session } from "./session.js";
import { systemSections } from "./system.js";
import { Forbidden, } from "./types.js";
import { ViewManager } from "./view.js";
const KERNEL = { type: "kernel" };
export class Harness {
    session;
    scheduler;
    views;
    kinds;
    namespaces = new Map();
    tools = new Map();
    sectionMap = new Map();
    entryKinds = new Map();
    revisions = { sections: 0, tools: 0 };
    plugins;
    hookRegistrations = [];
    conversationListeners = new Set();
    onReport;
    now;
    ctx;
    options;
    resumed = false;
    suspended = false;
    static async open(storage, options, ctx) {
        const h = new Harness(storage, options, ctx);
        await h.init();
        return h;
    }
    constructor(storage, options, ctx) {
        this.ctx = ctx;
        this.options = options;
        this.now = options.now ?? Date.now;
        this.onReport = (error) => {
            try {
                options.onReport?.(error);
            }
            catch { }
        };
        // Fixed core, installed internally. User kinds may not replace or shadow a built-in.
        const builtins = [generation, tool, postTools, collapse, job, plugin];
        this.kinds = new Map(builtins.map((k) => [k.name, k]));
        for (const k of options.taskKinds ?? []) {
            if (k.name.startsWith("pi."))
                throw new Error(`task kind "${k.name}": names beginning with "pi." are reserved`);
            if (this.kinds.has(k.name))
                throw new Error(`task kind "${k.name}" registered twice`);
            this.kinds.set(k.name, k);
        }
        for (const t of options.tools ?? [])
            this.registerTool(t, "open");
        for (const s of Object.values(systemSections))
            this.sectionMap.set(s.key, s);
        for (const s of options.sections ?? [])
            this.registerSection(s, "open");
        for (const e of Object.values(builtinEntries))
            this.entryKinds.set(e.kind, e);
        this.plugins = new Map(Object.entries(options.plugins ?? {}));
        this.session = new Session(storage, this.kinds, this.namespaces, this.now); // throws if the Storage already has an owner; validates config disjointness
        this.session.onReport = this.onReport;
        this.views = new ViewManager(this.session, this.onReport);
        this.session.lineListeners.add((result) => this.views.update(result));
        this.session.listeners.add((result) => {
            this.views.deliver();
            for (const conversation of result.changes.conversations)
                this.notifyConversation(conversation);
        });
        const self = this;
        const hooksFor = createHookRunners(() => this.hookRegistrations, (c) => this.session.index.ancestors(c), this.onReport);
        this.scheduler = new Scheduler({
            session: this.session,
            kinds: this.kinds,
            onReport: this.onReport,
            ctx,
            runtime(task, invoker, _ictx) {
                return {
                    taskId: task.id,
                    conversationId: task.conversationId,
                    kind: invoker.kind,
                    commit: (fn, c) => {
                        const owns = self.session.liveTasks.get(task.id)?.owns ?? [];
                        const docs = owns.flatMap((id) => [
                            { doc: "rewindable", conversationId: id },
                            { doc: "sticky", conversationId: id },
                        ]);
                        return self.session
                            .commit(invoker, (tx, lineCtx) => fn(tx, self.session.liveTasks.get(task.id), lineCtx), c, {
                            docs,
                        })
                            .then((r) => r.value);
                    },
                    hooks: hooksFor(invoker.kind, { taskId: task.id, conversationId: task.conversationId }),
                    models: options.models,
                    tools: self.tools,
                    registries: {
                        sections: {
                            map: self.sectionMap,
                            get revision() {
                                return self.revisions.sections;
                            },
                        },
                        tools: {
                            map: self.tools,
                            get revision() {
                                return self.revisions.tools;
                            },
                        },
                    },
                    kinds: self.kinds,
                    processHost: options.processHost,
                    plugins: self.plugins,
                    now: self.now,
                    sleep: (untilMs, c) => new Promise((resolve, reject) => {
                        const ms = Math.max(0, untilMs - Date.now());
                        const t = setTimeout(() => {
                            c.abortSignal?.removeEventListener("abort", onAbort);
                            resolve();
                        }, ms);
                        const onAbort = () => {
                            clearTimeout(t);
                            reject(c.abortSignal?.reason ?? new Error("aborted"));
                        };
                        c.abortSignal?.addEventListener("abort", onAbort, { once: true });
                    }),
                    waitForInput: (id, c) => self.scheduler.waitForInput(id, c),
                    waitForTask: (id, c) => self.scheduler.waitForTask(id, c),
                    abortTask: async (id, c) => {
                        await self.session.onLine(async (lineCtx) => {
                            self.assertInvocation(invoker);
                            const target = self.session.liveTasks.get(id) ?? (await self.session.storage.task(id, lineCtx));
                            if (target === undefined)
                                throw new Error(`task ${id} not found`);
                            self.assertTaskConversationScope(task.id, target.conversationId);
                        }, c);
                        return self.scheduler.abortTask(id, c);
                    },
                    abortConversation: async (id, c) => {
                        await self.session.onLine(() => {
                            self.assertInvocation(invoker);
                            self.assertOwnedConversation(task.id, id);
                        }, c);
                        const h = await self.conversation(id, c);
                        if (h)
                            await h.abort(c);
                    },
                    createOwnedConversation: (spec, c) => self.session
                        .commit(KERNEL, (tx) => {
                        self.assertInvocation(invoker);
                        return tx.createOwnedConversation(task.id, task.conversationId, spec);
                    }, c)
                        .then((result) => result.value),
                    sendOwned: (id, input, c) => self.session
                        .commit(KERNEL, (tx) => {
                        self.assertInvocation(invoker);
                        self.assertOwnedConversation(task.id, id);
                        return tx.send(id, input);
                    }, c, {
                        docs: [
                            { doc: "rewindable", conversationId: id },
                            { doc: "sticky", conversationId: id },
                        ],
                    })
                        .then((r) => r.value),
                    context: (c, at, cx) => self.session.commit(invoker, (tx) => tx.context(c, at), cx).then((r) => r.value),
                    newestEntry: (c, opts, cx) => self.session.commit(invoker, (tx) => tx.newestEntry(c, opts), cx).then((r) => r.value),
                    rewindable: (c, cx) => self.session
                        .commit(invoker, (tx) => tx.snapshot({ doc: "rewindable", conversationId: c }), cx, {
                        docs: [{ doc: "rewindable", conversationId: c }],
                    })
                        .then((r) => r.value),
                    sticky: (c, cx) => self.session
                        .commit(invoker, (tx) => tx.snapshot({ doc: "sticky", conversationId: c }), cx, {
                        docs: [{ doc: "sticky", conversationId: c }],
                    })
                        .then((r) => r.value),
                    rewindableAsOf: (c, at, cx) => self.session.commit(invoker, (tx) => tx.rewindableAsOf(c, at), cx).then((r) => r.value),
                };
            },
        });
    }
    notifyConversation(conversation) {
        if (this.conversationListeners.size === 0)
            return;
        const handle = this.handle(conversation);
        for (const listener of [...this.conversationListeners]) {
            try {
                listener(handle);
            }
            catch (error) {
                this.onReport(error);
            }
        }
    }
    assertInvocation(invoker) {
        if (!invoker.token.alive)
            throw new Forbidden("operation from a finished invocation");
        const live = this.session.liveTasks.get(invoker.id);
        if (live === undefined)
            throw new Forbidden("operation from a task that is not live");
        if (invoker.mode === "run" && live.abort === true)
            throw new Forbidden("operation from a marked run invocation");
    }
    assertTaskConversationScope(taskId, conversationId) {
        const task = this.session.liveTasks.get(taskId);
        if (task?.conversationId === conversationId)
            return;
        if (task?.owns.some((root) => this.session.index.subtree(root).has(conversationId)))
            return;
        throw new Forbidden(`conversation ${conversationId} is outside task ${taskId}'s subtree`);
    }
    assertOwnedConversation(taskId, conversationId) {
        const task = this.session.liveTasks.get(taskId);
        if (task === undefined || !task.owns.some((root) => this.session.index.subtree(root).has(conversationId))) {
            throw new Forbidden(`conversation ${conversationId} is not owned by task ${taskId}`);
        }
    }
    async init() {
        const { session } = this;
        const convs = await session.read((s, ctx) => s.conversations(ctx), this.ctx);
        for (const c of convs)
            session.conversationRecords.set(c.id, c);
        const live = await session.read((s, ctx) => s.scanTasks({ status: ["pending", "running"] }, ctx), this.ctx);
        for (const task of live)
            session.liveTasks.set(task.id, task);
        // Owner tasks that are terminal but still own existing conversations: needed for ancestry.
        const owners = new Set(convs.map((c) => c.owner).filter((o) => o !== undefined));
        for (const id of owners)
            if (!session.liveTasks.has(id)) {
                const t = await session.read((s, ctx) => s.task(id, ctx), this.ctx);
                if (t)
                    session.ownerTaskCache.set(id, t);
            }
        if (convs.length === 0) {
            await session.commit(KERNEL, (tx) => tx.createConversation({ rewindable: this.options.root?.rewindable, sticky: this.options.root?.sticky }), this.ctx);
        }
    }
    resume() {
        if (this.suspended)
            throw new Error("cannot resume a suspended harness; reopen storage with a new harness");
        if (this.resumed)
            return;
        this.resumed = true;
        void this.reconcileOrphans()
            .then(() => {
            if (!this.suspended)
                this.scheduler.resume();
        })
            .catch((error) => this.onReport(error));
    }
    async reconcileOrphans() {
        const orphaned = [...this.session.liveTasks.values()].filter((task) => !this.kinds.has(task.kind));
        if (orphaned.length === 0)
            return;
        const docs = [...new Set(orphaned.map((task) => task.conversationId))].map((conversationId) => ({ doc: "sticky", conversationId }));
        await this.session.commit(KERNEL, (tx) => {
            for (const task of orphaned)
                tx.setTask({ ...task, status: "terminal", outcome: { status: "orphaned" } });
        }, this.ctx, { docs });
    }
    quiescent() {
        return this.scheduler.quiescent();
    }
    hold() {
        if (!this.scheduler.quiescent())
            throw new Error("cannot hold a non-quiescent harness; suspend it instead");
        return this.scheduler.hold();
    }
    /** Cancel and join in-process invocations, clear transient waits, then close without terminalizing tasks. */
    async suspend(ctx) {
        if (this.suspended)
            return;
        this.suspended = true;
        await this.scheduler.joinAll();
        const tools = [...this.session.liveTasks.values()].filter((task) => task.kind === "pi.tool");
        if (tools.length > 0) {
            const docs = [...new Set(tools.map((task) => task.conversationId))].map((conversationId) => ({ doc: "sticky", conversationId }));
            await this.session.commit(KERNEL, (tx) => {
                for (const task of tools) {
                    const index = task.input.index;
                    const slot = tx.sticky(task.conversationId).turn.tools[index];
                    if (slot?.waitingOn !== undefined)
                        delete slot.waitingOn;
                }
            }, ctx, { docs });
        }
        this.views.close();
        await this.session.close(ctx);
    }
    // --- registries --------------------------------------------------------------
    registerTaskKind(kind) {
        if (kind.name.startsWith("pi."))
            throw new Error(`task kind "${kind.name}": names beginning with "pi." are reserved`);
        if (this.kinds.has(kind.name))
            throw new Error(`task kind "${kind.name}" already registered`);
        this.session.defaults.register(kind);
        this.kinds.set(kind.name, kind);
        this.scheduler.kick();
        return () => {
            if (this.kinds.get(kind.name) !== kind)
                return;
            this.kinds.delete(kind.name);
            this.session.defaults.unregister(kind);
        };
    }
    namespace(id, defaults, opts = {}) {
        if (!/^[a-z][a-z0-9_.-]*$/i.test(id) || id.startsWith("pi."))
            throw new Error(`invalid namespace "${id}"`);
        if (this.namespaces.has(id))
            throw new Error(`namespace "${id}" already registered`);
        const stored = JSON.parse(JSON.stringify(defaults));
        const routes = new Map();
        for (const doc of ["rewindable", "sticky", "session"]) {
            for (const key of Object.keys(stored[doc] ?? {})) {
                if (routes.has(key))
                    throw new Error(`namespace "${id}" key "${key}" is declared in more than one document`);
                routes.set(key, doc);
            }
        }
        let token;
        token = {
            id,
            unregister: () => {
                if (this.namespaces.get(id)?.token !== token)
                    return;
                this.namespaces.delete(id);
                for (let index = this.hookRegistrations.length - 1; index >= 0; index--) {
                    if (this.hookRegistrations[index].namespace === token)
                        this.hookRegistrations.splice(index, 1);
                }
            },
        };
        const registration = {
            token,
            defaults: {
                rewindable: stored.rewindable ?? {},
                sticky: stored.sticky ?? {},
                session: stored.session ?? {},
            },
            routes,
            project: opts.view === undefined ? undefined : (slice) => opts.view(slice),
        };
        this.namespaces.set(id, registration);
        return token;
    }
    /** Register a tool. A duplicate name rejects. Unregister removes only this exact declaration; idempotent. */
    registerTool(tool, at = "runtime") {
        if (this.tools.has(tool.name))
            throw new Error(`tool "${tool.name}" already registered`);
        this.tools.set(tool.name, tool);
        this.revisions.tools++;
        void at;
        return () => {
            if (this.tools.get(tool.name) === tool) {
                this.tools.delete(tool.name);
                this.revisions.tools++;
            }
        };
    }
    registerSection(section, at = "runtime") {
        if (this.sectionMap.has(section.key))
            throw new Error(`section "${section.key}" already registered`);
        this.sectionMap.set(section.key, section);
        this.revisions.sections++;
        void at;
        return () => {
            if (this.sectionMap.get(section.key) === section) {
                this.sectionMap.delete(section.key);
                this.revisions.sections++;
            }
        };
    }
    registerEntryKind(kind) {
        if (kind.kind.startsWith("pi."))
            throw new Error(`entry kind "${kind.kind}": names beginning with "pi." are reserved`);
        if (this.entryKinds.has(kind.kind))
            throw new Error(`entry kind "${kind.kind}" already registered`);
        this.entryKinds.set(kind.kind, kind);
        return () => {
            if (this.entryKinds.get(kind.kind) === kind)
                this.entryKinds.delete(kind.kind);
        };
    }
    /** Register namespace-bound handlers for one kind's hook points, harness-wide. Both tokens must be current. */
    hooks(namespace, kind, handlers, _opts) {
        return this.addHooks({ namespace: this.checkNamespace(namespace), kind: this.checkKind(kind), handlers });
    }
    checkKind(kind) {
        if (this.kinds.get(kind.name) !== kind)
            throw new Error(`kind "${kind.name}" is not the registered token`);
        return kind;
    }
    checkNamespace(namespace) {
        if (this.namespaces.get(namespace.id)?.token !== namespace)
            throw new Forbidden(`namespace "${namespace.id}" is stale`);
        return namespace;
    }
    addHooks(reg) {
        this.hookRegistrations.push(reg);
        let done = false;
        return () => {
            if (done)
                return;
            done = true;
            const index = this.hookRegistrations.indexOf(reg);
            if (index >= 0)
                this.hookRegistrations.splice(index, 1);
        };
    }
    // --- conversations -------------------------------------------------------------
    async root(ctx) {
        return this.conversation(1, ctx).then((c) => c);
    }
    onConversation(listener) {
        this.conversationListeners.add(listener);
        for (const conversation of this.session.conversationRecords.values()) {
            try {
                listener(this.handle(conversation));
            }
            catch (error) {
                this.onReport(error);
            }
        }
        return () => this.conversationListeners.delete(listener);
    }
    async conversation(id, ctx) {
        const c = await this.session.read((s, lineCtx) => s.conversation(id, lineCtx), ctx);
        return c === undefined ? undefined : this.handle(c);
    }
    async createConversation(spec, ctx) {
        const { input, ...rest } = spec;
        const id = await this.session
            .commit(KERNEL, async (tx) => {
            const id = tx.createConversation(rest);
            if (input !== undefined)
                await tx.send(id, { content: input });
            return id;
        }, ctx)
            .then((r) => r.value);
        return (await this.conversation(id, ctx));
    }
    entries(scan, ctx) {
        return this.session.read((s, lineCtx) => s.scanEntries(scan, lineCtx), ctx);
    }
    getTask(id, ctx) {
        return this.session.read((s, lineCtx) => s.task(id, lineCtx), ctx);
    }
    async abortInput(id, ctx, conversationId) {
        if (conversationId !== undefined) {
            const input = await this.session.read((storage, lineCtx) => storage.input(id, lineCtx), ctx);
            if (input !== undefined && input.conversationId !== conversationId)
                throw new Forbidden(`input ${id} is outside conversation ${conversationId}`);
        }
        return this.inputHandle(id).abort(ctx);
    }
    abortTask(id, ctx) {
        return this.scheduler.abortTask(id, ctx);
    }
    /** Durably mark a task for abort without signalling its invocation; the scheduler aborts it when it next drains. */
    markTask(id, ctx) {
        return this.session
            .commit(KERNEL, async (tx) => {
            const t = await tx.task(id);
            if (t === undefined)
                throw new Error(`task ${id} not found`);
            if (t.status === "terminal")
                return "terminal";
            tx.markTask(id);
            return "marked";
        }, ctx)
            .then((r) => r.value);
    }
    waitForIdle(ctx) {
        return this.scheduler.waitForIdle(undefined, ctx);
    }
    waitForTask(id, ctx) {
        return this.scheduler.waitForTask(id, ctx);
    }
    /** Signals every invocation, waits for them, closes storage. Writes nothing. */
    async close(ctx) {
        await this.suspend(ctx);
    }
    handle(c) {
        const self = this;
        const docs = [
            { doc: "rewindable", conversationId: c.id },
            { doc: "sticky", conversationId: c.id },
        ];
        const hostInvoker = { type: "host", conversationId: c.id };
        const kernelInvoker = { type: "kernel", conversationId: c.id };
        const host = (fn, ctx) => self.session.commit(hostInvoker, (tx, lineCtx) => fn(tx, lineCtx), ctx, { docs }).then((r) => r.value);
        const kernel = (fn, ctx) => self.session.commit(kernelInvoker, fn, ctx, { docs }).then((r) => r.value);
        const config = {
            get: (ctx) => host((tx) => {
                const cfg = tx.config(c.id);
                const out = {};
                for (const key of self.session.defaults.route.keys())
                    out[key] = cfg.get(key);
                return out;
            }, ctx),
            set: (patch, ctx) => host((tx) => {
                const cfg = tx.config(c.id);
                for (const [key, value] of Object.entries(patch)) {
                    if (value === undefined)
                        throw new Error(`config.set(${key}): use config.reset()`);
                    cfg.set(key, value);
                }
            }, ctx),
            reset: (keys, ctx) => host((tx) => {
                const cfg = tx.config(c.id);
                for (const key of keys)
                    cfg.reset(String(key));
            }, ctx),
        };
        return {
            id: c.id,
            config,
            async send(input, ctx) {
                const id = await kernel((tx) => tx.send(c.id, input), ctx);
                return self.inputHandle(id);
            },
            write: (entry, ctx) => host((tx) => tx.write(c.id, entry), ctx),
            commit: host,
            rewindable: (ctx) => host((tx) => tx.snapshot({ doc: "rewindable", conversationId: c.id }), ctx),
            sticky: (ctx) => host((tx) => tx.snapshot({ doc: "sticky", conversationId: c.id }), ctx),
            context: (ctx) => host((tx) => tx.context(c.id), ctx),
            async fork(at, spec, ctx) {
                const id = await self.session.fork(c.id, at, spec, ctx);
                return (await self.conversation(id, ctx));
            },
            collapse: (instructions, ctx) => kernel(async (tx) => {
                const { entries } = await tx.context(c.id);
                const state = tx.rewindable(c.id);
                const through = chooseThrough(entries, state.keepRecent);
                if (through === undefined)
                    throw new Error("nothing to collapse");
                return tx.createTask({
                    kind: "pi.collapse",
                    conversationId: c.id,
                    background: true,
                    input: { reason: "manual", through, ...(instructions === undefined ? {} : { instructions }) },
                });
            }, ctx),
            reset: async (handoff, ctx) => {
                await kernel((tx) => tx.write(c.id, handoff === undefined
                    ? { kind: "pi.reset", head: "self" }
                    : {
                        kind: "pi.handoff",
                        head: "self",
                        model: [{ role: "user", content: handoff, timestamp: self.now() }],
                    }), ctx);
            },
            async abort(ctx) {
                const owned = [];
                const marked = await kernel(async (tx) => {
                    const s = tx.sticky(c.id);
                    const withdrawn = s.inbox.filter((q) => q.mode !== "write").map((q) => q.id);
                    for (let i = s.inbox.length - 1; i >= 0; i--)
                        if (s.inbox[i].mode !== "write")
                            s.inbox.splice(i, 1);
                    await tx.resolveInputs(withdrawn, { status: "unanswered", reason: "aborted" });
                    for (const input of withdrawn)
                        tx.emit({ type: "input.aborted", input });
                    const ids = [];
                    for (const t of [...self.session.liveTasks.values()]) {
                        if (t.conversationId !== c.id || t.background)
                            continue;
                        for (const o of t.owns)
                            owned.push(o);
                        if (t.abort !== true)
                            tx.markTask(t.id);
                        ids.push(t.id);
                    }
                    return ids;
                }, ctx);
                for (const id of marked)
                    await self.scheduler.abortTask(id, ctx);
                await self.scheduler.waitForIdle(c.id, ctx);
                await Promise.all(owned.map((o) => self.scheduler.waitForIdle(o, ctx)));
            },
            waitForIdle: (ctx) => self.scheduler.waitForIdle(c.id, ctx),
            hooks: (namespace, kind, handlers, opts) => self.addHooks({
                namespace: self.checkNamespace(namespace),
                kind: self.checkKind(kind),
                handlers,
                conversationId: c.id,
                subtree: opts?.subtree,
            }),
            watch: (ctx) => self.watch(c, ctx),
        };
    }
    /** Capture and subscribe in one line operation. */
    async watch(conversation, ctx) {
        return this.session
            .commit({ type: "host", conversationId: conversation.id }, async (tx) => {
            const entries = await captureActiveTranscript((scan) => tx.scanEntries(scan), conversation.id);
            return this.views.watch(conversation, entries);
        }, ctx, {
            docs: [
                { doc: "rewindable", conversationId: conversation.id },
                { doc: "sticky", conversationId: conversation.id },
            ],
        })
            .then((result) => result.value);
    }
    inputHandle(id) {
        return {
            id,
            result: (ctx) => this.session.read((s, lineCtx) => s.input(id, lineCtx), ctx),
            wait: (ctx) => this.scheduler.waitForInput(id, ctx),
            abort: (ctx) => this.session.commit(KERNEL, (tx) => tx.withdrawInput(id), ctx, { docs: [] }).then((r) => r.value),
        };
    }
}
/**
 * §9: H = newest fork-visible entry with a head. Active transcript = H plus every fork-visible entry
 * with id ≥ H.head, chronological, nothing dropped inside the range; the whole transcript if no head.
 */
export async function captureActiveTranscript(scan, conversationId) {
    const [h] = await scan({ conversationId, withHead: true, limit: 1 });
    const from = h?.head;
    const out = [];
    let before;
    for (;;) {
        const page = await scan({ conversationId, ...(before === undefined ? {} : { before }), limit: 256 });
        let done = page.length < 256;
        for (const e of page) {
            if (from !== undefined && e.id < from) {
                done = true;
                break;
            }
            out.push(e);
        }
        if (done)
            break;
        before = page[page.length - 1].id;
    }
    return out.reverse();
}
export { withAbortSignal, isCoreKind };
export { applyEnvelope, WATCH_CAPACITY } from "./view.js";
/** The built-in kinds, as typed witnesses for `api.task`, `waitForTask`, and `hooks(kind, …)`. */
export const kinds = { generation, tool, postTools, collapse, job, plugin };
export const entries = builtinEntries;
//# sourceMappingURL=harness.js.map