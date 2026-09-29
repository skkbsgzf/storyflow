/** Coerce an in-memory value (e.g. a pi-ai message) to its stored representation. */
export const toStored = (value) => JSON.parse(JSON.stringify(value));
export function defineEntry(kind) {
    if (kind.startsWith("pi."))
        throw new Error(`entry kind names beginning with "pi." are reserved: ${kind}`);
    return Object.freeze({ kind, is: (entry) => entry?.kind === kind });
}
/** First writer wins, including when the stored winner is null. */
export function memoOnce(slot, key, candidate) {
    if (!Object.hasOwn(slot, "memos"))
        slot.memos = {};
    const memos = slot.memos;
    if (Object.hasOwn(memos, key))
        return memos[key];
    memos[key] = candidate;
    return candidate;
}
/** Author an ordinary kind. Names may not begin with `pi.`. */
export function defineTask(definition) {
    if (definition.name.startsWith("pi."))
        throw new Error(`task kind names beginning with "pi." are reserved: ${definition.name}`);
    return Object.freeze({ ...definition });
}
/** Thrown when a scan-shaped read follows a same-batch write to its domain. Poisons the transaction. */
export class ReadAfterWrite extends Error {
    constructor(read, write) {
        super(`${read} after ${write} in the same transaction: the answer would not include the buffered write`);
        this.name = "ReadAfterWrite";
    }
}
// ---------------------------------------------------------------------------
// Invocation tokens and invokers
// ---------------------------------------------------------------------------
/** An unforgeable capability: only the scheduler creates these, one per invocation. */
export class InvocationToken {
    #alive = true;
    taskId;
    mode;
    constructor(taskId, mode) {
        this.taskId = taskId;
        this.mode = mode;
    }
    get alive() {
        return this.#alive;
    }
    /** Called by the scheduler when the invocation returns. */
    revoke() {
        this.#alive = false;
    }
}
// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------
export class Forbidden extends Error {
    constructor(what) {
        super(`forbidden: ${what}`);
        this.name = "Forbidden";
    }
}
export class ConversationBusy extends Error {
    constructor(id) {
        super(`conversation ${id} is busy`);
        this.name = "ConversationBusy";
    }
}
export class GenerationInProgress extends Error {
    constructor(id) {
        super(`conversation ${id} already has a live generation`);
        this.name = "GenerationInProgress";
    }
}
export class CollapseInProgress extends Error {
    constructor(id) {
        super(`conversation ${id} already has a live collapse`);
        this.name = "CollapseInProgress";
    }
}
export class Faulted extends Error {
    constructor(cause) {
        super(`Session faulted: ${String(cause)}`);
        this.name = "Faulted";
    }
}
export class Closed extends Error {
    constructor() {
        super("Session is closed");
        this.name = "Closed";
    }
}
export class TaskContractFault extends Error {
    constructor(kind, what) {
        super(`kind ${kind} broke its contract: ${what}`);
        this.name = "TaskContractFault";
    }
}
//# sourceMappingURL=types.js.map