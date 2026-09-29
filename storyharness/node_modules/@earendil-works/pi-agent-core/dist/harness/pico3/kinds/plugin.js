import { toStored } from "../types.js";
import { taskApi } from "./task-api.js";
const pluginKind = {
    name: "pi.plugin",
    inflight: ["started"],
    phases: {
        async started(task, runtime, ctx) {
            return run(task, runtime, ctx);
        },
    },
    async initial(task, runtime, ctx) {
        await runtime.commit((tx) => tx.checkpoint({ phase: "started" }), ctx);
        return run(task, runtime, ctx);
    },
    async abort() {
        return async () => null;
    },
};
export const plugin = Object.freeze(pluginKind);
async function run(task, runtime, ctx) {
    const handler = runtime.plugins.get(task.input.handler);
    if (handler === undefined) {
        return { done: () => ({ status: "failed", failure: { reason: "missing_handler", detail: task.input.handler } }) };
    }
    try {
        const result = toStored(await handler(task.input.input, taskApi(task, runtime), ctx));
        return { done: () => ({ status: "completed", result }) };
    }
    catch (error) {
        if (ctx.abortSignal?.aborted)
            throw error;
        return { done: () => ({ status: "failed", failure: { reason: "threw", detail: String(error) } }) };
    }
}
//# sourceMappingURL=plugin.js.map