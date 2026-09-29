import { estimateContextTokens } from "@earendil-works/pi-ai/utils/estimate";
import { effectiveTools } from "../system.js";
import { toStored, } from "../types.js";
import { retryDecision } from "./generation.js";
const estimate = (messages) => estimateContextTokens(messages.filter((message) => message.role !== "system")).tokens;
export const collapseConfig = { rewindable: { threshold: 0, keepRecent: 20_000 } };
const failed = (reason, detail) => ({
    status: "failed",
    failure: { reason, detail },
});
const baseOf = (checkpoint) => {
    const { phase: _phase, ...rest } = checkpoint;
    const { untilMs: _untilMs, lastError: _lastError, summary: _summary, ...base } = rest;
    return base;
};
export const collapse = {
    name: "pi.collapse",
    config: collapseConfig,
    inflight: ["summarizing"],
    async initial(task, runtime, ctx) {
        const state = await runtime.rewindable(task.conversationId, ctx);
        if (state.model === undefined)
            return { done: () => failed("no_model", "no model configured") };
        const sticky = await runtime.sticky(task.conversationId, ctx);
        const head = await runtime.newestEntry(task.conversationId, { withHead: true }, ctx);
        const { entries } = await runtime.context(task.conversationId, task.input.through, ctx);
        let decision = {};
        await runtime.hooks.each(ctx, (hook, api) => hook.beforeCollapse?.(task.input.reason, task.input.through, entries, api, ctx), (value) => {
            if (value === undefined)
                return;
            decision = value;
            return true;
        });
        if ("decline" in decision)
            return { done: () => failed("declined", "declined by beforeCollapse") };
        const choice = decision;
        const base = {
            expectedHead: head?.id ?? null,
            ...((choice.instructions ?? task.input.instructions)
                ? { instructions: choice.instructions ?? task.input.instructions }
                : {}),
            model: state.model,
            thinkingLevel: state.thinkingLevel,
            retry: sticky.retry,
            attempt: 1,
        };
        if (choice.summary !== undefined) {
            return {
                next: async (tx, current) => (await headMoved(tx, current.conversationId, base))
                    ? failed("stale", "head moved during beforeCollapse")
                    : { phase: "prepared", summary: choice.summary, ...base },
            };
        }
        return summarizeNow(task, base, runtime, ctx, "check head");
    },
    phases: {
        async summarizing(task, runtime) {
            return afterFailure(baseOf(task.checkpoint), null, "interrupted", runtime);
        },
        async retrying(task, runtime, ctx) {
            await runtime.sleep(task.checkpoint.untilMs, ctx);
            return summarizeNow(task, { ...baseOf(task.checkpoint), attempt: task.checkpoint.attempt + 1 }, runtime, ctx);
        },
        async prepared(task, runtime) {
            const { summary } = task.checkpoint;
            const base = baseOf(task.checkpoint);
            return {
                done: async (tx, current) => {
                    const { head, entries } = await tx.context(current.conversationId);
                    if ((head?.id ?? null) !== base.expectedHead)
                        return failed("stale", "head moved during collapse");
                    const retained = entries.find((entry) => entry.id > task.input.through);
                    const id = tx.appendEntry(current.conversationId, {
                        kind: "pi.summary",
                        data: { through: task.input.through },
                        model: [{ role: "user", content: summary, timestamp: runtime.now() }],
                        head: retained?.id ?? "self",
                    });
                    return { status: "completed", result: { summary: id } };
                },
            };
        },
    },
    async abort() {
        return async () => null;
    },
};
const headMoved = async (tx, conversationId, base) => ((await tx.newestEntry(conversationId, { withHead: true }))?.id ?? null) !== base.expectedHead;
async function summarizeNow(task, base, runtime, ctx, check) {
    const stale = await runtime.commit(async (tx, current) => {
        if (check && (await headMoved(tx, current.conversationId, base)))
            return true;
        tx.checkpoint({ phase: "summarizing", ...base });
        return false;
    }, ctx);
    if (stale)
        return { done: () => failed("stale", "head moved during beforeCollapse") };
    const model = runtime.models.resolve(base.model);
    if (model === undefined)
        return { done: () => failed("no_model", "model unavailable") };
    const { messages } = await runtime.context(task.conversationId, task.input.through, ctx);
    const tools = effectiveTools(messages);
    const request = [
        ...messages,
        ...(tools.length > 0
            ? [toStored({ role: "system", content: "", toolsRemoved: tools, timestamp: runtime.now() })]
            : []),
        {
            role: "user",
            content: `${base.instructions ?? "Summarize the conversation so far for continuation."}\n\nRespond with the summary only.`,
            timestamp: runtime.now(),
        },
    ];
    let message;
    try {
        for await (const event of runtime.models.stream(model, { messages: request, thinkingLevel: base.thinkingLevel }, ctx)) {
            if (event.type === "done") {
                message = event.message;
                break;
            }
            if (event.type === "error") {
                message = event.error;
                break;
            }
        }
    }
    catch (error) {
        if (ctx.abortSignal?.aborted)
            throw error;
        return afterFailure(base, null, String(error), runtime);
    }
    if (message === undefined)
        return afterFailure(base, null, "no message", runtime);
    if (message.content.some((content) => content.type === "toolCall")) {
        return afterFailure(base, { ...message, stopReason: "error" }, "summarizer returned tool calls", runtime);
    }
    if (message.stopReason === "error")
        return afterFailure(base, message, message.errorMessage ?? "provider error", runtime);
    const summary = message.content
        .filter((content) => content.type === "text")
        .map((content) => content.text)
        .join("");
    return { next: { phase: "prepared", summary, ...base } };
}
function afterFailure(base, message, detail, runtime) {
    const decision = retryDecision(base, message, runtime.now());
    if (decision.kind === "fail")
        return { done: () => failed(decision.reason, detail) };
    return {
        next: (tx, current) => {
            tx.emit({
                type: "compaction.retrying",
                taskId: current.id,
                attempt: base.attempt,
                retryAt: decision.untilMs,
                error: detail,
            });
            return { phase: "retrying", ...base, untilMs: decision.untilMs, lastError: detail };
        },
    };
}
export function chooseThrough(entries, keepRecent) {
    const exchanges = [];
    let open;
    for (const entry of entries) {
        const role = entry.model?.[0]?.role;
        const tokens = estimate((entry.model ?? []));
        if (role === "assistant") {
            open = { last: entry.id, tokens };
            exchanges.push(open);
        }
        else if (role === "toolResult" && open) {
            open.last = entry.id;
            open.tokens += tokens;
        }
        else {
            open = undefined;
            exchanges.push({ last: entry.id, tokens });
        }
    }
    let retained = 0;
    let index = exchanges.length - 1;
    while (index >= 0 && retained + exchanges[index].tokens <= keepRecent)
        retained += exchanges[index--].tokens;
    if (index < 0)
        return undefined;
    if (index === exchanges.length - 1)
        return exchanges[index - 1]?.last;
    return exchanges[index].last;
}
//# sourceMappingURL=collapse.js.map