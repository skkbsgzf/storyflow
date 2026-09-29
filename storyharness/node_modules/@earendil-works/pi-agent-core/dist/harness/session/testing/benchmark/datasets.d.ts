export interface StorageBenchmarkDataset {
    readonly name: string;
    readonly entryCount: number;
    readonly payloadBytes: number;
    readonly lookupIds: readonly string[];
    readonly tipId: string;
}
/** Package-internal deterministic id shared by dataset and transaction generation. */
export declare function storageBenchmarkEntryId(index: number): string;
/** Deterministic synthetic linear branches shared by all storage measurements. */
export declare const STORAGE_BENCHMARK_DATASETS: readonly StorageBenchmarkDataset[];
//# sourceMappingURL=datasets.d.ts.map