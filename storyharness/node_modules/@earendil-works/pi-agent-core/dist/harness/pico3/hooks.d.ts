import type { AnyKind, HookRunner, Id, Namespace } from "./types.ts";
export interface HookRegistration {
    namespace: Namespace;
    kind: AnyKind;
    handlers: object;
    conversationId?: Id;
    subtree?: boolean;
}
export declare function createHookRunners(registrations: () => readonly HookRegistration[], ancestors: (conversationId: Id) => readonly Id[], onReport: (error: unknown) => void): <H extends object>(kind: AnyKind, info: Omit<import("./types.ts").HookApi, "kind">) => HookRunner<H>;
//# sourceMappingURL=hooks.d.ts.map