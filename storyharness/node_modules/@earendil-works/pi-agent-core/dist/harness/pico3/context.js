/**
 * pico §1.3, verbatim:
 *   H       = newest fork-visible entry at or before T with a head
 *   from    = H ? H.head : transcript start
 *   range   = fork-visible entries from `from` through T
 *   edits   = per target, newest edit in range wins
 *   entries = H ? [H, ...range without any head entries] : range
 *   model   = concat(entries.map(e => edits[e.id] ? apply : e.model)), then reorder tool results
 *
 * Display-only entries (aborted/error assistants, pi.usage, model-less plugin entries) have no
 * `model` and contribute nothing. Nothing here inspects an error string.
 */
export async function deriveContext(storage, conversationId, at, ctx) {
    const [head] = await storage.scanEntries({ conversationId, withHead: true, ...(at === undefined ? {} : { before: at + 1 }), limit: 1 }, ctx);
    const from = head?.head;
    // Walk newest-first until we pass `from`.
    const range = [];
    let before = at === undefined ? undefined : at + 1;
    for (;;) {
        const page = await storage.scanEntries({ conversationId, ...(before === undefined ? {} : { before }), limit: 256 }, ctx);
        let done = page.length < 256;
        for (const e of page) {
            if (from !== undefined && e.id < from) {
                done = true;
                break;
            }
            range.push(e);
        }
        if (done)
            break;
        before = page[page.length - 1].id;
    }
    range.reverse();
    const edits = new Map();
    for (const e of range)
        for (const edit of e.edits ?? [])
            edits.set(edit.target, edit); // later wins by iteration order
    const entries = head === undefined ? range : [head, ...range.filter((e) => e.head === undefined)];
    const messages = [];
    for (const e of entries) {
        const edit = edits.get(e.id);
        if (edit?.action === "omit")
            continue;
        if (edit?.action === "replace") {
            messages.push(...(edit.messages ?? []));
            continue;
        }
        if (e.model)
            messages.push(...e.model);
    }
    return { head, entries, messages: reorderToolResults(messages) };
}
function reorderToolResults(messages) {
    const out = [];
    for (let i = 0; i < messages.length; i++) {
        const m = messages[i];
        out.push(m);
        if (m.role !== "assistant")
            continue;
        const calls = m.content.filter((c) => c.type === "toolCall");
        if (calls.length === 0)
            continue;
        const results = new Map();
        let j = i + 1;
        while (j < messages.length && messages[j].role === "toolResult") {
            const r = messages[j];
            results.set(r.toolCallId, r);
            j++;
        }
        for (const call of calls) {
            out.push(results.get(call.id) ??
                {
                    role: "toolResult",
                    toolCallId: call.id,
                    toolName: call.name,
                    content: [
                        { type: "text", text: "Tool result unavailable: history ends before this call completed." },
                    ],
                    isError: true,
                    details: { reason: "missing_after_fork" },
                    timestamp: m.timestamp,
                });
        }
        i = j - 1;
    }
    return out;
}
//# sourceMappingURL=context.js.map