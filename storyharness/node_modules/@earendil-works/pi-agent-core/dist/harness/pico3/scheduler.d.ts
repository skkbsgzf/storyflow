import type { Context } from "@earendil-works/chord";
import type { Session } from "./session.ts";
import { type AnyKind, type Id, type Input, type Invoker, type Runtime, type Task } from "./types.ts";
export interface SchedulerDeps {
    session: Session;
    kinds: ReadonlyMap<string, AnyKind>;
    runtime(task: Task, invoker: Extract<Invoker, {
        type: "task";
    }>, ctx: Context): Runtime;
    onReport(error: unknown): void;
    ctx: Context;
}
export declare class Scheduler {
    private readonly deps;
    private enabled;
    private holds;
    private dirty;
    private draining;
    private readonly invocations;
    private readonly taskWaiters;
    private readonly inputWaiters;
    private readonly idleWaiters;
    constructor(deps: SchedulerDeps);
    resume(): void;
    stop(): void;
    hold(): () => void;
    kick(): void;
    private drain;
    private reserveEligible;
    private dispatch;
    private lease;
    private runPhases;
    /** Mark, revoke, signal, join. The scheduler then reserves the fresh abort on its next drain. */
    abortTask(id: Id, ctx: Context): Promise<"marked" | "terminal">;
    waitForTask(id: Id, ctx: Context): Promise<Task>;
    waitForInput(id: Id, ctx: Context): Promise<Input>;
    private waiter;
    waitForIdle(conversationId: Id | undefined, ctx: Context): Promise<void>;
    private isIdle;
    private checkIdle;
    /** Signal every invocation and wait for them; nothing is written. */
    joinAll(): Promise<void>;
    quiescent(): boolean;
    get liveInvocations(): number;
}
//# sourceMappingURL=scheduler.d.ts.map