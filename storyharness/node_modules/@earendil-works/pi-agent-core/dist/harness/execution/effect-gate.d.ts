/** Expected internal control flow when cancellation wins effect admission. */
export declare class AbortRequested extends Error {
    readonly cancellation: Promise<void>;
    constructor(cancellation: Promise<void>);
}
/** Procedure-facing synchronous admission capability for one drive pass. */
export interface Gate {
    readonly signal: AbortSignal;
    admit<T>(invoke: () => T): T;
}
/** Owner-facing lifecycle controls for one drive pass. */
export interface GateControl {
    beginAbort(cancellation: Promise<void>): void;
    signalAbort(): void;
    close(error: Error): void;
}
/** Create separate procedure-facing and owner-facing views of one effect gate. */
export declare function createGate(): {
    gate: Gate;
    control: GateControl;
};
//# sourceMappingURL=effect-gate.d.ts.map