export function createHookRunners(registrations, ancestors, onReport) {
    return (kind, info) => {
        const handlers = () => registrations()
            .filter((registration) => registration.kind === kind)
            .filter((registration) => registration.conversationId === undefined ||
            registration.conversationId === info.conversationId ||
            (registration.subtree === true &&
                ancestors(info.conversationId).includes(registration.conversationId)))
            .map((registration) => ({
            handlers: registration.handlers,
            namespace: registration.namespace,
            api: { ...info, kind: kind.name },
        }));
        return {
            handlers,
            async each(ctx, fn, onValue) {
                for (const binding of handlers()) {
                    try {
                        const v = await fn(binding.handlers, binding.api);
                        if (v !== undefined && onValue?.(v) === true)
                            return;
                    }
                    catch (error) {
                        if (ctx.abortSignal?.aborted)
                            throw error;
                        onReport(error);
                    }
                }
            },
        };
    };
}
//# sourceMappingURL=hooks.js.map