import { defineService, } from "@earendil-works/chord";
import { WATCH_CAPACITY } from "./view.js";
/** Local registration/control plane and remote keyed conversation contract used by Chord facets. */
export const PicoHarnessService = defineService("pi.harness", { local: true });
export const PicoConversationService = defineService("pi.conversation");
export function createPicoConversationService(harness, conversation, view) {
    return {
        view,
        send: (input, ctx) => conversation.send(input, ctx).then((handle) => handle.id),
        write: (entry, ctx) => conversation.write(entry, ctx),
        inputAbort: (id, ctx) => harness.abortInput(id, ctx, conversation.id),
        configSet: (patch, ctx) => conversation.config.set(patch, ctx),
        abort: (ctx) => conversation.abort(ctx),
        reset: (handoff, ctx) => conversation.reset(handoff ?? undefined, ctx),
        collapse: (instructions, ctx) => conversation.collapse(instructions ?? undefined, ctx),
        fork: (at, spec, ctx) => conversation.fork(at, spec, ctx).then((child) => child.id),
        entries: (scan, ctx) => harness.entries({ ...scan, conversationId: conversation.id }, ctx),
    };
}
/**
 * Adapt Pico's commit-granular envelopes to one Chord publication per commit.
 * The raw listener only enqueues. Applying ops and publishing happen together,
 * off the Session line, with no await between them.
 */
export async function attachChordView(conversation, createState, ctx, opts = {}) {
    const watch = await conversation.watch(ctx);
    const view = createState({ ...structuredClone(watch.view), commit: { events: [] } });
    return bridgeWatch(watch, view, ctx, opts);
}
function bridgeWatch(watch, view, ctx, opts) {
    const capacity = opts.capacity ?? WATCH_CAPACITY;
    if (!Number.isSafeInteger(capacity) || capacity < 1)
        throw new RangeError("Chord view queue capacity must be positive");
    const queue = [];
    let scheduled = false;
    let closed = false;
    const fail = (cause) => {
        if (closed)
            return;
        closed = true;
        queue.length = 0;
        watch.stop();
        try {
            opts.onFailure?.(cause instanceof Error ? cause : new Error(String(cause)));
        }
        catch { }
    };
    const drain = () => {
        scheduled = false;
        while (!closed && queue.length > 0) {
            const envelope = queue.shift();
            try {
                view.change(ctx, (draft) => {
                    applyTracked(draft, envelope.ops);
                    draft.commit.events = envelope.events;
                });
            }
            catch (error) {
                fail(error);
            }
        }
    };
    watch.start((envelope) => {
        if (closed)
            return;
        if (queue.length >= capacity) {
            fail(new Error(`Pico-to-Chord view queue exceeded ${capacity} envelopes`));
            return;
        }
        queue.push(envelope);
        if (scheduled)
            return;
        scheduled = true;
        queueMicrotask(drain);
    });
    return {
        view,
        get closed() {
            return closed;
        },
        close() {
            if (closed)
                return;
            closed = true;
            queue.length = 0;
            watch.stop();
        },
    };
}
function applyTracked(root, ops) {
    for (const op of ops) {
        if (op[0] === "r")
            throw new Error("live Pico envelope unexpectedly replaced the view root");
        const path = op[1];
        if (op[0] === "p") {
            const target = resolve(root, path);
            if (!Array.isArray(target))
                throw new Error(`Pico splice path is not an array: ${path.join(".")}`);
            target.splice(op[2], op[3], ...op[4]);
            continue;
        }
        if (op[0] === "m") {
            const target = resolve(root, path);
            if (!Array.isArray(target) || target.length !== op[2].length) {
                throw new Error(`Pico permutation path is not a matching array: ${path.join(".")}`);
            }
            const array = target;
            const previous = array.slice();
            const rank = new Map();
            for (let index = 0; index < op[2].length; index++) {
                const value = previous[op[2][index]];
                if (!rank.has(value))
                    rank.set(value, index);
            }
            array.sort((left, right) => rank.get(left) - rank.get(right));
            continue;
        }
        const parent = resolve(root, path.slice(0, -1));
        if (parent === null || typeof parent !== "object")
            throw new Error(`Pico operation parent is not an object: ${path.join(".")}`);
        const key = path[path.length - 1];
        if (op[0] === "d") {
            if (Array.isArray(parent))
                parent.splice(key, 1);
            else
                delete parent[key];
            continue;
        }
        const record = parent;
        if (op[0] === "s")
            record[key] = op[2];
        else if (op[0] === "a")
            record[key] = `${String(record[key])}${op[2]}`;
        else
            record[key] = String(record[key]).slice(op[2]);
    }
}
function resolve(root, path) {
    let value = root;
    for (const segment of path) {
        if (value === null || typeof value !== "object")
            return undefined;
        value = value[segment];
    }
    return value;
}
//# sourceMappingURL=chord.js.map