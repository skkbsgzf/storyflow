import type { EventListener, Events, HarnessEvent, HarnessEventType, WatchHandle } from "./agent-harness.ts";
import type { Context } from "./context.ts";
type ResnapshotCapture<T> = (context: Context, markBoundary: () => void) => Promise<T>;
/** Passive harness event bus with isolated handler failures. */
export declare class HarnessEventBus implements Events {
    private readonly listeners;
    private readonly watchListeners;
    private deliveryTail;
    private closedError;
    on<TType extends HarnessEventType>(type: TType, listener: EventListener<Extract<HarnessEvent, {
        type: TType;
    }>>): () => void;
    emit(event: HarnessEvent, context: Context): Promise<void>;
    /** Bind current recipients and append one contiguous batch to the global delivery tail. */
    emitBatch(events: readonly HarnessEvent[], context: Context): Promise<void>;
    watch<T>(snapshot: T, filter: (event: HarnessEvent) => boolean, _context: Context, resnapshot?: ResnapshotCapture<T>): WatchHandle<T>;
    watchFromSnapshot<T>(capture: (context: Context) => Promise<T>, filter: (event: HarnessEvent) => boolean, context: Context): Promise<WatchHandle<T>>;
    close(error: Error): void;
    private installWatcher;
    private enqueueBarrier;
    private snapshotRecipients;
    private deliver;
}
export {};
//# sourceMappingURL=events.d.ts.map