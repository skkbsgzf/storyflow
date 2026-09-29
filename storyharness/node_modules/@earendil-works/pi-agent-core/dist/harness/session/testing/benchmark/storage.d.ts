import type { Storage, Write } from "../../types.ts";
import { type StorageBenchmarkDataset } from "./datasets.ts";
/** Generates deterministic seed transactions without claiming a production data distribution. */
export declare function generateStorageBenchmarkSeedTransactions(dataset: StorageBenchmarkDataset): Generator<Write[]>;
/** Seeds one deterministic synthetic linear branch. */
export declare function seedStorageBenchmark(storage: Storage, dataset: StorageBenchmarkDataset): Promise<void>;
/** A steady-state read operation run against a pre-seeded fixture. */
interface StorageReadBenchmarkScenario {
    readonly name: string;
    expectedResult(dataset: StorageBenchmarkDataset): number;
    run(storage: Storage, dataset: StorageBenchmarkDataset): Promise<number>;
}
/** A write operation run once against each independently prepared fixture. */
interface StorageWriteBenchmarkScenario {
    readonly name: string;
    readonly writeCount: number;
    prepare?(storage: Storage): Promise<void>;
    run(storage: Storage): Promise<number>;
}
/** Shared read scenarios. Returning a number ensures each result is consumed. */
export declare const STORAGE_READ_BENCHMARK_SCENARIOS: readonly StorageReadBenchmarkScenario[];
/** Shared writes. Every invocation receives equivalent pre-benchmark state. */
export declare const STORAGE_WRITE_BENCHMARK_SCENARIOS: readonly StorageWriteBenchmarkScenario[];
export {};
//# sourceMappingURL=storage.d.ts.map