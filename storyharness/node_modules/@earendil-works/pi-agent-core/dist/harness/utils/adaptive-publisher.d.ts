export interface AdaptivePublisherOptions<TValue, TUpdate> {
    snapshot(): TValue;
    update(previous: TValue | undefined, current: TValue): TUpdate | undefined;
    measure(update: TUpdate): number;
    publish(update: TUpdate): void;
    onError(error: unknown): void;
    minIntervalMs?: number;
    targetBytesPerSecond?: number;
}
/**
 * Publishes the latest state without queuing intermediate mutations.
 *
 * The first dirty state after idle is immediate. Each publication then buys a
 * delay proportional to its encoded size, with a minimum interval that also
 * bounds event count. A single trailing timer guarantees eventual publication.
 */
export declare class AdaptivePublisher<TValue, TUpdate> {
    #private;
    constructor(options: AdaptivePublisherOptions<TValue, TUpdate>);
    markDirty(): void;
    flush(force?: boolean): void;
    dispose(): void;
}
//# sourceMappingURL=adaptive-publisher.d.ts.map