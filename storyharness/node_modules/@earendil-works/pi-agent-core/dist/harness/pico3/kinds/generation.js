import { AssistantMessageFrameEncoder, isRetryableAssistantError } from "@earendil-works/pi-ai";
import { estimateContextTokens } from "@earendil-works/pi-ai/utils/estimate";
import { planManagedEntry, prepareDraft, sameSnapshot, takeSnapshot } from "../system.js";
import { toStored, } from "../types.js";
import { chooseThrough } from "./collapse.js";
import { applyFrame } from "./frames.js";
/** Configuration this kind reads, with defaults. `model` has none: absent → failed/no_model. */
export const generationConfig = {
    rewindable: {
        model: undefined,
        thinkingLevel: "off",
        selectedTools: [],
        profile: "default",
    },
    sticky: { retry: { enabled: true, maxRetries: 3, baseDelayMs: 2000, maxAgentDelayMs: 60_000 } },
};
const fail = (reason, detail, assistant) => ({
    status: "failed",
    failure: { reason, detail, ...(assistant === undefined ? {} : { assistant }) },
});
/** Every terminal generation failure settles its group and admits queued triggers at the final boundary. */
const failStep = (task, reason, detail) => ({
    done: async (tx, current) => {
        const head = await tx.newestEntry(current.conversationId, { withHead: true });
        tx.emit({ type: "generation.failed", taskId: current.id, reason, detail });
        await settleFailedTurn(tx, current, task.input.inputs, detail, head?.id);
        return fail(reason, detail);
    },
});
/** pi-ai drops system messages and aborted/error assistant messages before sending; estimate what is sent. */
const estimate = (messages) => estimateContextTokens(messages.filter((m) => m.role !== "system" &&
    !(m.role === "assistant" && (m.stopReason === "aborted" || m.stopReason === "error")))).tokens;
const emptyUsage = () => ({
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
});
// ---------------------------------------------------------------------------
// The kind
// ---------------------------------------------------------------------------
export const generation = {
    name: "pi.generation",
    turn: true,
    config: generationConfig,
    inflight: ["requesting"],
    // Step 1 (§12.5): snapshot S on the line; systemInstructions off the line; then in one
    // commit re-take S′, retry if it moved, else append the managed entry and checkpoint
    // `prepared` with the cutoff. Runs once per generation; never on recovery.
    async initial(task, rt, ctx) {
        const { snapshot, canonical, seed } = await rt.commit((tx, current) => takeSnapshot(tx, current.conversationId, rt.registries.sections, rt.registries.tools), ctx);
        if (snapshot.settings.model === undefined)
            return failStep(task, "no_model", "no model configured");
        const retry = (await rt.sticky(task.conversationId, ctx)).retry;
        const warnings = [];
        const { desired, tools } = await prepareDraft(rt, rt.registries.sections, canonical, seed, snapshot.settings, (message) => warnings.push(message), ctx);
        const model = snapshot.settings.model;
        const thinkingLevel = snapshot.settings.thinkingLevel;
        return {
            next: async (tx, current) => {
                const c = current.conversationId;
                const again = await takeSnapshot(tx, c, rt.registries.sections, rt.registries.tools);
                if (!sameSnapshot(again.snapshot, snapshot))
                    return "retry";
                const plan = await planManagedEntry(tx, c, snapshot, canonical, desired, tools, rt.now());
                for (const message of warnings)
                    tx.emit({ type: "warning", source: "generation", message });
                const system = plan === undefined ? null : tx.appendEntry(c, { kind: "pi.system", ...plan });
                const cutoff = system ?? (await tx.newestEntry(c)).id;
                tx.sticky(c).turn = { tools: [] }; // a new generation starts a fresh turn view
                return {
                    phase: "prepared",
                    cutoff,
                    system,
                    model,
                    thinkingLevel,
                    tools: tools.map((t) => t.name),
                    retry,
                    attempt: 0,
                };
            },
        };
    },
    phases: {
        // Step 2: derive the request from the cutoff (hooks rerun), overflow check, write the
        // in-flight checkpoint, call the provider. Reached fresh from `initial`/`retrying`,
        // and again on recovery of `prepared` (step 1 never reruns).
        async prepared(task, rt, ctx) {
            const cp = task.checkpoint;
            const model = rt.models.resolve(cp.model);
            if (model === undefined)
                return failStep(task, "no_model", `model ${cp.model.provider}/${cp.model.modelId} unavailable`);
            const derived = await derive(task, cp, rt, ctx);
            if (estimate(derived.messages) > model.contextWindow - model.maxTokens)
                return overflow(task, rt);
            const attempt = cp.attempt + 1;
            await rt.commit((tx) => {
                tx.checkpoint({ ...cp, phase: "requesting", attempt });
                tx.emit({ type: "generation.started", taskId: task.id, attempt });
            }, ctx); // before the effect
            const { terminal, deferred } = await stream(cp, model, derived.messages, rt, ctx);
            if (deferred !== undefined) {
                const pollAt = rt.now() + (deferred.pollAfterMs ?? 5000);
                return {
                    next: (tx) => {
                        tx.emit({ type: "generation.deferred", taskId: task.id, pollAt });
                        return { ...cp, phase: "deferred", attempt, handle: toStored(deferred), pollAt };
                    },
                };
            }
            return classify(task, { ...cp, attempt }, terminal, rt, ctx);
        },
        // Only reached by the scheduler after a crash: the call may have happened and there
        // is no result lookup. Count it as a failed attempt and retry per policy.
        async requesting(task, rt) {
            const cp = task.checkpoint;
            const decision = retryDecision(cp, null, rt.now());
            if (decision.kind === "fail")
                return failStep(task, decision.reason, "interrupted");
            return {
                next: (tx, current) => {
                    tx.appendEntry(current.conversationId, {
                        kind: "pi.usage",
                        data: { attempt: cp.attempt, error: "interrupted" },
                    });
                    tx.emit({
                        type: "generation.retrying",
                        taskId: current.id,
                        attempt: cp.attempt,
                        retryAt: decision.untilMs,
                        error: "interrupted",
                    });
                    return { ...cp, phase: "retrying", untilMs: decision.untilMs, lastError: "interrupted" };
                },
            };
        },
        // Durable backoff, then back to step 2. Resets the streaming view.
        async retrying(task, rt, ctx) {
            const cp = task.checkpoint;
            await rt.sleep(cp.untilMs, ctx);
            const { untilMs: _u, lastError: _e, ...prep } = cp;
            return {
                next: (tx, current) => {
                    tx.sticky(current.conversationId).turn.message = undefined;
                    return { ...prep, phase: "prepared" };
                },
            };
        },
        // Provider-side async. Poll; not the retry backoff. Same after a crash: the handle is durable.
        async deferred(task, rt, ctx) {
            const cp = task.checkpoint;
            const model = rt.models.resolve(cp.model);
            if (model === undefined)
                return failStep(task, "no_model", "model disappeared");
            await rt.sleep(cp.pollAt, ctx);
            const result = await rt.models.fetchDeferred(model, cp.handle, ctx);
            if ("deferred" in result && result.deferred !== undefined) {
                const pollAt = rt.now() + (result.deferred.pollAfterMs ?? 5000);
                return {
                    next: (tx) => {
                        tx.emit({ type: "generation.deferred", taskId: task.id, pollAt });
                        return { ...cp, handle: toStored(result.deferred), pollAt };
                    },
                };
            }
            const message = result;
            await rt.commit((tx, current) => {
                tx.sticky(current.conversationId).turn.message = toStored(message);
            }, ctx);
            const { handle: _handle, pollAt: _pollAt, ...prep } = cp;
            return classify(task, prep, message, rt, ctx);
        },
    },
    async abort(task, rt, ctx) {
        const cp = task.checkpoint;
        if (cp?.phase === "deferred") {
            const model = rt.models.resolve(cp.model);
            if (model)
                await rt.models.cancelDeferred(model, cp.handle, ctx).catch(() => { });
        }
        return async (tx, current) => {
            const partial = tx.sticky(current.conversationId).turn.message;
            let assistant;
            // Display-only: the partial goes in `data`, never in `model`, so it cannot enter a request.
            if (partial && partial.content.length > 0)
                assistant = tx.appendEntry(current.conversationId, {
                    kind: "pi.assistant",
                    data: {
                        attempt: cp?.attempt ?? 0,
                        display: { ...toStored(partial), stopReason: "aborted" },
                        reason: "aborted",
                    },
                });
            tx.sticky(current.conversationId).turn = { tools: [] };
            await tx.resolveInputs(task.input.inputs, { status: "unanswered", reason: "aborted" });
            tx.emit({ type: "turn.ended", inputs: task.input.inputs, status: "unanswered", reason: "aborted" });
            return assistant === undefined ? {} : { assistant };
        };
    },
};
// ---------------------------------------------------------------------------
// Request derivation and streaming
// ---------------------------------------------------------------------------
async function derive(task, cp, rt, ctx) {
    const { messages } = await rt.context(task.conversationId, cp.cutoff, ctx);
    let request = { messages };
    await rt.hooks.each(ctx, (h, api) => h.beforeRequest?.(request, { ...api, cutoff: cp.cutoff }, ctx), (value) => {
        if (value !== undefined)
            request = value;
    });
    return request;
}
/** Stream, coalescing frames into the turn view. Flush on size or time. */
async function stream(cp, model, messages, rt, ctx) {
    const encoder = new AssistantMessageFrameEncoder();
    let pending = [];
    let pendingBytes = 0;
    let lastFlush = rt.now();
    let terminal;
    let deferred;
    let flushedContent = false;
    const flush = async () => {
        const batch = pending;
        if (batch.length === 0)
            return;
        pending = [];
        pendingBytes = 0;
        lastFlush = rt.now();
        if (batch.some((frame) => "delta" in frame))
            flushedContent = true;
        await rt.commit((tx, current) => {
            const turn = tx.sticky(current.conversationId).turn;
            for (const f of batch)
                applyFrame(turn, f);
        }, ctx);
    };
    try {
        const iterator = rt.models
            .stream(model, { messages, thinkingLevel: cp.thinkingLevel }, ctx)[Symbol.asyncIterator]();
        let pull = iterator.next();
        for (;;) {
            const selected = pending.length === 0
                ? { kind: "event", result: await pull }
                : await Promise.race([
                    pull.then((result) => ({ kind: "event", result })),
                    rt.sleep(lastFlush + 100, ctx).then(() => ({ kind: "flush" })),
                ]);
            if (selected.kind === "flush") {
                await flush();
                continue;
            }
            if (selected.result.done)
                break;
            const event = selected.result.value;
            if (event.type === "done") {
                encoder.encode(event);
                if (event.reason === "deferred" && event.message.deferred !== undefined)
                    deferred = event.message.deferred;
                else
                    terminal = event.message;
                break;
            }
            if (event.type === "error") {
                encoder.encode(event);
                terminal = event.error;
                break;
            }
            const frame = encoder.encode(event);
            pull = iterator.next();
            if (frame === undefined)
                continue;
            pending.push(frame);
            pendingBytes += "delta" in frame ? frame.delta.length : 64;
            if (pendingBytes >= 256 || (!flushedContent && "delta" in frame))
                await flush();
        }
    }
    catch (error) {
        if (ctx.abortSignal?.aborted)
            throw error;
        terminal = {
            role: "assistant",
            content: [],
            api: model.api,
            provider: model.provider,
            model: model.id,
            usage: emptyUsage(),
            stopReason: "error",
            errorMessage: String(error),
            timestamp: rt.now(),
        };
    }
    if (pending.length > 0)
        await flush();
    if (terminal === undefined && deferred === undefined)
        throw new Error("stream ended without a terminal message");
    return { terminal, deferred };
}
// ---------------------------------------------------------------------------
// Steps 3–5: classify the terminal message.
// ---------------------------------------------------------------------------
async function classify(task, cp, message, rt, ctx) {
    await rt.hooks.each(ctx, (h, api) => h.afterResponse?.(message, { ...api, attempt: cp.attempt }, ctx));
    if (message.stopReason === "error") {
        const decision = retryDecision(cp, message, rt.now());
        if (decision.kind === "retry") {
            return {
                next: (tx, current) => {
                    tx.appendEntry(current.conversationId, {
                        kind: "pi.usage",
                        data: {
                            attempt: cp.attempt,
                            usage: toStored(message.usage),
                            error: message.errorMessage ?? "provider error",
                        },
                    });
                    tx.emit({
                        type: "generation.retrying",
                        taskId: current.id,
                        attempt: cp.attempt,
                        retryAt: decision.untilMs,
                        error: message.errorMessage ?? "provider error",
                    });
                    return {
                        ...cp,
                        phase: "retrying",
                        untilMs: decision.untilMs,
                        lastError: message.errorMessage ?? "provider error",
                    };
                },
            };
        }
        return { done: terminalError(task, cp, message, decision.reason) };
    }
    if (message.stopReason === "aborted")
        return { done: terminalError(task, cp, message, "provider") };
    const calls = message.content.filter((c) => c.type === "toolCall");
    const stored = toStored(message);
    if (calls.length > 0) {
        return {
            done: async (tx, current) => {
                const c = current.conversationId;
                const collapseThrough = await thresholdCollapseThrough(tx, c, message); // read BEFORE the append
                const assistant = tx.appendEntry(c, {
                    kind: "pi.assistant",
                    model: [stored],
                    data: { attempt: cp.attempt },
                });
                const turn = tx.sticky(c).turn;
                turn.message = undefined;
                turn.tools = calls.map((call) => ({
                    callId: call.id,
                    name: call.name,
                    args: toStored(call.arguments),
                    status: "pending",
                }));
                const tools = calls.map((call, index) => tx.createTask({ kind: "pi.tool", input: { assistant, call: toStored(call), offered: cp.tools, index } }));
                const postTools = tx.createTask({
                    kind: "pi.post_tools",
                    after: tools,
                    input: { inputs: task.input.inputs, assistant, tools },
                });
                if (collapseThrough !== undefined)
                    tx.createTask({ kind: "pi.collapse", input: { reason: "threshold", through: collapseThrough } });
                tx.emit({ type: "generation.completed", taskId: current.id, entry: assistant, toolCalls: calls.length });
                return { status: "completed", result: { assistant, tools, postTools } };
            },
        };
    }
    let continueText;
    await rt.hooks.each(ctx, (h, api) => h.onYield?.(message, api, ctx), (value) => {
        if (value === undefined)
            return;
        continueText = value.continue;
        return true;
    });
    return {
        done: async (tx, current) => {
            const c = current.conversationId;
            const collapseThrough = await thresholdCollapseThrough(tx, c, message); // read BEFORE the append
            const head = await tx.newestEntry(c, { withHead: true });
            const assistant = tx.appendEntry(c, { kind: "pi.assistant", model: [stored], data: { attempt: cp.attempt } });
            tx.emit({ type: "generation.completed", taskId: current.id, entry: assistant, toolCalls: 0 });
            tx.sticky(c).turn = { tools: [] };
            if (collapseThrough !== undefined)
                tx.createTask({ kind: "pi.collapse", input: { reason: "threshold", through: collapseThrough } });
            const { triggers, terminated } = await tx.boundary(c, "final", head?.id);
            if (continueText !== undefined && triggers.length === 0 && !terminated) {
                tx.appendEntry(c, {
                    kind: "pi.user",
                    model: [{ role: "user", content: continueText, timestamp: rt.now() }],
                    data: { continuation: true, from: assistant },
                });
                const successor = tx.createTask({ kind: "pi.generation", input: { inputs: task.input.inputs } });
                return { status: "completed", result: { assistant, tools: [], successor } };
            }
            await tx.resolveInputs(task.input.inputs, { status: "done", answer: assistant });
            tx.emit({ type: "turn.ended", inputs: task.input.inputs, status: "done", answer: assistant });
            if (triggers.length > 0) {
                const successor = tx.createTask({ kind: "pi.generation", input: { inputs: triggers } });
                tx.emit({ type: "turn.started", inputs: triggers });
                return { status: "completed", result: { assistant, tools: [], successor } };
            }
            return { status: "completed", result: { assistant, tools: [] } };
        },
    };
}
/** Provider error / aborted stop: a display-only assistant entry (no `model`), inputs unanswered. */
function terminalError(task, cp, message, reason) {
    return async (tx, current) => {
        const head = await tx.newestEntry(current.conversationId, { withHead: true });
        const assistant = tx.appendEntry(current.conversationId, {
            kind: "pi.assistant",
            data: {
                attempt: cp.attempt,
                display: toStored(message),
                reason: message.stopReason === "aborted" ? "aborted" : "error",
            },
        });
        tx.emit({
            type: "generation.failed",
            taskId: current.id,
            reason,
            detail: message.errorMessage ?? "provider error",
            entry: assistant,
        });
        await settleFailedTurn(tx, current, task.input.inputs, message.errorMessage ?? "provider error", head?.id);
        return fail(reason, message.errorMessage ?? "provider error", assistant);
    };
}
async function settleFailedTurn(tx, current, inputs, detail, headBoundary) {
    tx.sticky(current.conversationId).turn = { tools: [] };
    await tx.resolveInputs(inputs, { status: "unanswered", reason: "failed", detail });
    tx.emit({ type: "turn.ended", inputs: [...inputs], status: "unanswered", reason: "failed", detail });
    const { triggers } = await tx.boundary(current.conversationId, "final", headBoundary);
    if (triggers.length > 0) {
        tx.createTask({ kind: "pi.generation", conversationId: current.conversationId, input: { inputs: triggers } });
        tx.emit({ type: "turn.started", inputs: triggers });
    }
}
export function retryDecision(cp, message, now) {
    if (message !== null && !isRetryableAssistantError(message))
        return { kind: "fail", reason: "provider" };
    if (!cp.retry.enabled)
        return { kind: "fail", reason: "provider" };
    if (cp.attempt > cp.retry.maxRetries)
        return { kind: "fail", reason: "retries_exhausted" };
    const delay = cp.retry.baseDelayMs * 2 ** Math.max(0, cp.attempt - 1);
    const safeDelay = Number.isSafeInteger(delay) ? delay : Number.MAX_SAFE_INTEGER;
    return { kind: "retry", untilMs: now + Math.min(safeDelay, cp.retry.maxAgentDelayMs ?? 60_000) };
}
// ---------------------------------------------------------------------------
// Collapse triggers
// ---------------------------------------------------------------------------
/** Read-side of threshold collapse: computed before the assistant is appended, applied after. */
async function thresholdCollapseThrough(tx, conversationId, message) {
    if ((await tx.tasks({ conversationId, kind: "pi.collapse", status: ["pending", "running"] })).length > 0)
        return undefined;
    const state = tx.rewindable(conversationId);
    if (state.threshold <= 0)
        return undefined;
    const { entries, messages } = await tx.context(conversationId);
    const used = Math.max((message.usage?.input ?? 0) + (message.usage?.output ?? 0), estimate([...messages, toStored(message)]));
    if (used <= state.threshold)
        return undefined;
    return chooseThrough(entries, state.keepRecent);
}
function overflow(task, rt) {
    return {
        done: async (tx, current) => {
            const c = current.conversationId;
            const state = tx.rewindable(c);
            const { entries, head } = await tx.context(c);
            const through = chooseThrough(entries, state.keepRecent);
            tx.sticky(c).turn = { tools: [] };
            if (through === undefined) {
                await tx.write(c, {
                    kind: "pi.notice",
                    model: [{ role: "user", content: "Context too large; nothing to compact.", timestamp: rt.now() }],
                });
                tx.emit({
                    type: "generation.failed",
                    taskId: current.id,
                    reason: "overflow",
                    detail: "request exceeds context window and nothing is collapsible",
                });
                await settleFailedTurn(tx, current, task.input.inputs, "overflow", head?.id);
                return fail("overflow", "request exceeds context window and nothing is collapsible");
            }
            const collapse = tx.createTask({ kind: "pi.collapse", input: { reason: "overflow", through } });
            tx.createTask({ kind: "pi.generation", after: [collapse], input: { inputs: task.input.inputs } });
            tx.emit({
                type: "generation.failed",
                taskId: current.id,
                reason: "overflow",
                detail: `collapsing through ${through}`,
            });
            return fail("overflow", `collapsing through ${through}`);
        },
    };
}
//# sourceMappingURL=generation.js.map