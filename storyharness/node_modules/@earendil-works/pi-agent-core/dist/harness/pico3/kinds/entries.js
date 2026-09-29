const coreEntry = (kind) => Object.freeze({ kind, is: (entry) => entry?.kind === kind });
export const entries = {
    user: coreEntry("pi.user"),
    assistant: coreEntry("pi.assistant"),
    toolResult: coreEntry("pi.tool_result"),
    system: coreEntry("pi.system"),
    notice: coreEntry("pi.notice"),
    usage: coreEntry("pi.usage"),
    summary: coreEntry("pi.summary"),
    handoff: coreEntry("pi.handoff"),
    reset: coreEntry("pi.reset"),
};
//# sourceMappingURL=entries.js.map