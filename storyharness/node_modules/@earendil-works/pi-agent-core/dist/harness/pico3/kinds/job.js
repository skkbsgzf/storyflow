const failed = (reason, detail) => ({
    status: "failed",
    failure: { reason, detail },
});
const notice = (text, now) => ({
    kind: "pi.notice",
    model: [{ role: "user", content: text, timestamp: now }],
});
const jobKind = {
    name: "pi.job",
    slot: () => ({}),
    describe: (task) => ({
        stage: task.checkpoint?.phase ?? "starting",
        ...(task.slot ?? {}),
    }),
    inflight: ["spawning", "running"],
    phases: {
        async waiting(task, runtime, ctx) {
            await runtime.sleep(task.checkpoint.untilMs, ctx);
            return spawn(task, task.checkpoint.occurrence, runtime, ctx);
        },
        async spawning(task, runtime, ctx) {
            return reconcile(task, task.checkpoint, runtime, ctx);
        },
        async running(task, runtime, ctx) {
            return reconcile(task, task.checkpoint, runtime, ctx);
        },
    },
    async initial(task, runtime, ctx) {
        if (runtime.processHost === undefined)
            return { done: () => failed("spawn", "no process host") };
        const now = runtime.now();
        const untilMs = task.input.notBefore ?? now;
        if (untilMs > now)
            return { next: { phase: "waiting", untilMs, occurrence: 1 } };
        return spawn(task, 1, runtime, ctx);
    },
    async abort(task, runtime, ctx) {
        const checkpoint = task.checkpoint;
        if (checkpoint === undefined || checkpoint.phase === "waiting" || runtime.processHost === undefined)
            return async () => ({ killed: false });
        await runtime.processHost.kill(checkpoint.key, "SIGTERM", ctx);
        await runtime.sleep(runtime.now() + 5000, ctx);
        await runtime.processHost.kill(checkpoint.key, "SIGKILL", ctx);
        return async () => ({ killed: true });
    },
};
export const job = Object.freeze(jobKind);
async function spawn(task, occurrence, runtime, ctx) {
    const key = `${task.id}:${occurrence}`;
    await runtime.commit((tx) => tx.checkpoint({ phase: "spawning", key, occurrence }), ctx);
    try {
        await runtime.processHost.start(key, task.input, ctx);
    }
    catch (error) {
        if (ctx.abortSignal?.aborted)
            throw error;
        return {
            done: async (tx, current) => {
                if (task.input.notify)
                    await tx.write(current.conversationId, notice(`job ${task.id} failed to start: ${String(error)}`, runtime.now()));
                return failed("spawn", String(error));
            },
        };
    }
    await runtime.commit((tx) => tx.checkpoint({ phase: "running", key, occurrence }), ctx);
    return poll(task, key, occurrence, runtime, ctx);
}
async function reconcile(task, checkpoint, runtime, ctx) {
    if (runtime.processHost === undefined)
        return { done: () => failed("interrupted", "no process host after restart") };
    let status;
    try {
        status = await runtime.processHost.status(checkpoint.key, ctx);
    }
    catch (error) {
        return { done: () => failed("interrupted", `host status failed: ${String(error)}`) };
    }
    if (status.status === "unknown") {
        if (!task.input.rerun)
            return { done: () => failed("interrupted", "process outcome unknown") };
        return spawn(task, checkpoint.occurrence, runtime, ctx);
    }
    if (checkpoint.phase === "spawning") {
        await runtime.commit((tx) => tx.checkpoint({ phase: "running", key: checkpoint.key, occurrence: checkpoint.occurrence }), ctx);
    }
    return poll(task, checkpoint.key, checkpoint.occurrence, runtime, ctx);
}
async function poll(task, key, occurrence, runtime, ctx) {
    for (let attempt = 0;; attempt++) {
        let status;
        try {
            status = await runtime.processHost.status(key, ctx);
        }
        catch (error) {
            return { done: () => failed("interrupted", `host status failed: ${String(error)}`) };
        }
        if (status.status === "unknown") {
            if (!task.input.rerun)
                return { done: () => failed("interrupted", "process outcome unknown") };
            return spawn(task, occurrence, runtime, ctx);
        }
        const snapshot = status;
        await runtime.commit((tx, current) => {
            const output = tx.slot({ id: current.id, kind: jobKind });
            output.stdout = snapshot.stdout;
            output.stderr = snapshot.stderr;
            output.droppedStdout = snapshot.droppedStdout;
            output.droppedStderr = snapshot.droppedStderr;
            if (snapshot.status === "exited")
                output.exitCode = snapshot.exitCode;
        }, ctx);
        if (snapshot.status === "exited") {
            const { exitCode, stdout, stderr } = snapshot;
            if (task.input.every === undefined) {
                return {
                    done: async (tx, current) => {
                        if (task.input.notify)
                            await tx.write(current.conversationId, notice(`job ${task.id} exited with code ${exitCode}`, runtime.now()));
                        return { status: "completed", result: { exitCode, occurrences: occurrence, stdout, stderr } };
                    },
                };
            }
            const untilMs = runtime.now() + task.input.every;
            return {
                next: async (tx, current) => {
                    if (task.input.notify)
                        await tx.write(current.conversationId, notice(`job ${task.id} occurrence ${occurrence} exited with code ${exitCode}`, runtime.now()));
                    const output = tx.slot({ id: current.id, kind: jobKind });
                    output.stdout = "";
                    output.stderr = "";
                    output.droppedStdout = 0;
                    output.droppedStderr = 0;
                    delete output.exitCode;
                    output.occurrence = occurrence + 1;
                    return { phase: "waiting", untilMs, occurrence: occurrence + 1 };
                },
            };
        }
        await runtime.sleep(runtime.now() + Math.min(1000, 100 * 2 ** Math.min(attempt, 4)), ctx);
    }
}
//# sourceMappingURL=job.js.map