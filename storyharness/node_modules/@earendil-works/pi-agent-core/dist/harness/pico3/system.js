export function defineSystemSection(definition) {
    return Object.freeze(definition);
}
export const systemSections = {
    identity: defineSystemSection({ key: "identity", render: (v) => v }),
    environment: defineSystemSection({
        key: "environment",
        render: (v) => `Working directory: ${v.cwd}`,
    }),
    skills: defineSystemSection({
        key: "skills",
        render: (v) => v.map((s) => `- ${s.name}: ${s.description}`).join("\n"),
    }),
};
export const sectionSeed = (section, value) => ({
    key: section.key,
    value,
});
export const removeSection = (key) => ({ key, remove: true });
export async function foldCanonical(reads, conversationId) {
    const managed = [];
    let before;
    let baseline = null;
    scan: for (;;) {
        const page = await reads.scanEntries({
            conversationId,
            kind: "pi.system",
            limit: 64,
            ...(before === undefined ? {} : { before }),
        });
        for (const e of page) {
            managed.push(e);
            if (e.data.baseline) {
                baseline = e.id;
                break scan;
            }
        }
        if (page.length < 64)
            break;
        before = page[page.length - 1].id;
    }
    managed.reverse();
    const canonical = new Map();
    for (const e of managed)
        for (const r of e.data.sections)
            r.action === "remove"
                ? canonical.delete(r.key)
                : canonical.set(r.key, { value: r.value, rendered: r.rendered });
    return { canonical, newestManaged: managed[managed.length - 1]?.id ?? null, newestBaseline: baseline };
}
class Draft {
    values = new Map();
    wrappers = new Map();
    touched = new Set();
    constructor(seed) {
        for (const [k, s] of seed)
            this.values.set(k, s.value);
    }
    get(section) {
        const v = this.values.get(section.key);
        return v === undefined ? undefined : structuredClone(v);
    }
    set(section, value) {
        this.values.set(section.key, value);
        this.touched.add(section.key);
    }
    delete(section) {
        this.values.delete(section.key);
        this.wrappers.delete(section.key);
        this.touched.add(section.key);
    }
    wrap(section, transform) {
        (this.wrappers.get(section.key) ?? this.wrappers.set(section.key, []).get(section.key)).push(transform);
        this.touched.add(section.key);
    }
    snapshot() {
        return {
            values: new Map(this.values),
            wrappers: new Map([...this.wrappers].map(([k, v]) => [k, [...v]])),
            touched: new Set(this.touched),
        };
    }
    restore(s) {
        this.values = s.values;
        this.wrappers = s.wrappers;
        this.touched = s.touched;
    }
}
/** Render touched sections (wrappers apply after rendering, in registration order); untouched keep their stored text. */
function freeze(draft, canonical, registry) {
    const desired = new Map();
    for (const [key, value] of draft.values) {
        if (!draft.touched.has(key)) {
            const prev = canonical.get(key);
            if (prev)
                desired.set(key, prev);
            continue;
        }
        const def = registry.get(key);
        if (def === undefined)
            continue; // unregistered: cannot re-render; treated as removed
        let rendered = def.render(value);
        for (const w of draft.wrappers.get(key) ?? [])
            rendered = w(rendered);
        desired.set(key, { value, rendered });
    }
    return desired;
}
export const sameSnapshot = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export async function takeSnapshot(tx, conversationId, sections, tools) {
    const { canonical, newestManaged, newestBaseline } = await foldCanonical(tx, conversationId);
    const head = await tx.newestEntry(conversationId, { withHead: true });
    const r = tx.snapshot({ doc: "rewindable", conversationId }); // a plain copy: the snapshot outlives this transaction
    const conv = await tx.conversation(conversationId);
    return {
        snapshot: {
            newestManaged,
            newestBaseline,
            newestHead: head?.id ?? null,
            settings: {
                ...(r.model === undefined ? {} : { model: r.model }),
                thinkingLevel: r.thinkingLevel,
                selectedTools: [...r.selectedTools],
                profile: r.profile,
            },
            sectionsRev: sections.revision,
            toolsRev: tools.revision,
        },
        canonical,
        seed: newestManaged === null ? conv?.sections : undefined, // §8.1: the seed applies while there is no local managed entry
    };
}
/** Off the line: seed the draft, run handlers, freeze. */
export async function prepareDraft(rt, sections, canonical, seed, settings, onReport, ctx) {
    const draft = new Draft(canonical);
    for (const s of seed ?? [])
        "remove" in s ? draft.delete({ key: s.key }) : draft.set({ key: s.key, render: () => "" }, s.value);
    const defaultTools = [];
    for (const name of settings.selectedTools) {
        const t = rt.tools.get(name);
        t ? defaultTools.push(t) : onReport(`selected tool ${name} is not registered`);
    }
    let tools = defaultTools;
    for (const binding of rt.hooks.handlers()) {
        const before = draft.snapshot();
        try {
            const out = await binding.handlers.systemInstructions?.({ sections: draft, config: settings, tools: defaultTools }, binding.api, ctx);
            if (out?.tools)
                tools = out.tools;
        }
        catch (error) {
            if (ctx.abortSignal?.aborted)
                throw error;
            draft.restore(before); // collect / skip: this handler's edits are rolled back
            onReport(String(error));
        }
    }
    return { desired: freeze(draft, canonical, sections.map), tools };
}
/** On the line, in the `prepared` commit: diff desired against canonical; baseline if a head intervened. */
export async function planManagedEntry(tx, conversationId, snapshot, canonical, desired, tools, now) {
    // §12.4: no managed history at all → first preparation appends a full baseline; and a usable
    // baseline must follow the newest head.
    const needBaseline = snapshot.newestManaged === null ||
        (snapshot.newestHead !== null &&
            (snapshot.newestBaseline === null || snapshot.newestHead > snapshot.newestBaseline));
    const toolOf = (t) => ({
        name: t.name,
        description: t.description,
        parameters: structuredClone(t.parameters),
    });
    // Previous effective tools: those declared by the newest managed entry chain (we recompute from canonical's owner: the tail message).
    const { messages } = await tx.context(conversationId);
    const previous = new Map();
    for (const m of messages)
        if (m.role === "system") {
            for (const t of m.toolsRemoved ?? [])
                previous.delete(t.name);
            for (const t of m.toolsAdded ?? [])
                previous.set(t.name, t);
        }
    if (needBaseline) {
        const sections = [...desired].map(([key, s]) => ({
            key,
            action: "set",
            value: s.value,
            rendered: s.rendered,
        }));
        const content = sections.map((s) => (s.action === "set" ? `## ${s.key}\n${s.rendered}` : "")).join("\n\n");
        const { entries } = await tx.context(conversationId);
        const edits = entries
            .filter((e) => e.kind === "pi.system" && e.id > (snapshot.newestHead ?? 0))
            .map((e) => ({ target: e.id, action: "omit" }));
        const message = {
            role: "system",
            content,
            toolsAdded: tools.map(toolOf),
            timestamp: now,
        };
        return { data: { baseline: true, sections }, model: [message], ...(edits.length ? { edits } : {}) };
    }
    const changed = [];
    for (const [key, s] of desired) {
        const prev = canonical.get(key);
        if (!prev || prev.rendered !== s.rendered || JSON.stringify(prev.value) !== JSON.stringify(s.value))
            changed.push({ key, action: "set", value: s.value, rendered: s.rendered });
    }
    for (const key of canonical.keys())
        if (!desired.has(key))
            changed.push({ key, action: "remove" });
    const added = tools.filter((t) => !previous.has(t.name));
    const removed = [...previous.values()].filter((p) => !tools.some((t) => t.name === p.name));
    if (changed.length === 0 && added.length === 0 && removed.length === 0)
        return undefined;
    const renderChanged = changed.some((s) => s.action === "remove" || canonical.get(s.key)?.rendered !== s.rendered);
    if (!renderChanged && added.length === 0 && removed.length === 0)
        return { data: { sections: changed }, model: [] }; // metadata-only delta
    const content = changed
        .map((s) => s.action === "set"
        ? `The ${s.key} section now reads:\n${s.rendered}`
        : `The ${s.key} section no longer applies.`)
        .join("\n\n");
    const message = {
        role: "system",
        content,
        ...(added.length ? { toolsAdded: added.map(toolOf) } : {}),
        ...(removed.length ? { toolsRemoved: removed } : {}),
        timestamp: now,
    };
    return { data: { sections: changed }, model: [message] };
}
/** Tools effective in a projected request: fold toolsAdded/toolsRemoved across its SystemMessages. */
export function effectiveTools(messages) {
    const tools = new Map();
    for (const m of messages)
        if (m.role === "system") {
            for (const t of m.toolsRemoved ?? [])
                tools.delete(t.name);
            for (const t of m.toolsAdded ?? [])
                tools.set(t.name, t);
        }
    return [...tools.values()];
}
//# sourceMappingURL=system.js.map