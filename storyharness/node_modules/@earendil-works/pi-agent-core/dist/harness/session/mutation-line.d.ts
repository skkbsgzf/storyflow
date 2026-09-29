/** Serializes complete read-modify-write jobs for one Session. */
export declare class MutationLine {
    private tail;
    private sealedError;
    run<T>(operation: () => T | Promise<T>): Promise<T>;
    seal(error: Error): Promise<void>;
}
//# sourceMappingURL=mutation-line.d.ts.map