export function taskApi(task, runtime) {
    const isKind = (value) => typeof value === "object" && value !== null && "name" in value && "initial" in value;
    return {
        taskId: task.id,
        conversationId: task.conversationId,
        callId: "",
        stream: () => {
            throw new Error("stream is only available to tools");
        },
        progress: () => {
            throw new Error("progress is only available to tools");
        },
        memo: (() => Promise.reject(new Error("memo is only available to tools"))),
        async conversation(spec, ctx) {
            const id = await runtime.createOwnedConversation(spec, ctx);
            return {
                id,
                send: async (input, childContext) => {
                    const inputId = await runtime.sendOwned(id, input, childContext);
                    return {
                        id: inputId,
                        wait: (waitContext) => runtime.waitForInput(inputId, waitContext),
                        result: (resultContext) => runtime.commit((tx) => tx.input(inputId), resultContext),
                    };
                },
                abort: (childContext) => runtime.abortConversation(id, childContext),
            };
        },
        task: ((kind, input, opts, ctx) => {
            if (!isKind(kind))
                throw new Error("task(): pass a kind token");
            return runtime.commit((tx) => tx.createTask(kind, input, opts), ctx);
        }),
        getTask: async (ref, ctx) => (await runtime.commit((tx) => tx.task(ref.id), ctx)),
        waitForTask: (ref, ctx) => runtime.waitForTask(ref.id, ctx),
        slot: (ref, ctx) => runtime.commit(async (tx) => {
            const storedTask = await tx.task(ref.id);
            if (storedTask === undefined)
                return undefined;
            return (tx.snapshot({ doc: "sticky", conversationId: storedTask.conversationId }).tasks[ref.id] ??
                undefined);
        }, ctx),
    };
}
//# sourceMappingURL=task-api.js.map