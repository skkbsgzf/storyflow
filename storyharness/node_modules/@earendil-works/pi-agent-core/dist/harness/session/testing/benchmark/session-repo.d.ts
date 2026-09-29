import type { SessionMetadata, SessionRepo } from "../../types.ts";
import { type StorageBenchmarkDataset } from "./datasets.ts";
export interface SessionRepoCatalogBenchmarkDataset {
    readonly name: string;
    readonly sessionCount: number;
}
interface SessionRepoCatalogReadBenchmarkScenario {
    readonly name: string;
    expectedResult(dataset: SessionRepoCatalogBenchmarkDataset): number;
    run(repo: SessionRepo): Promise<number>;
}
interface SessionRepoCatalogWriteBenchmarkOperation {
    run(): Promise<number>;
}
interface SessionRepoCatalogWriteBenchmarkScenario {
    readonly name: string;
    readonly expectedResult: number;
    prepare(repo: SessionRepo): Promise<SessionRepoCatalogWriteBenchmarkOperation>;
}
interface SessionRepoForkWriteBenchmarkScenario {
    readonly name: string;
    expectedResult(dataset: StorageBenchmarkDataset): number;
    run(repo: SessionRepo, source: SessionMetadata, dataset: StorageBenchmarkDataset): Promise<number>;
}
/** Package-internal deterministic session id shared by repository benchmark workloads. */
export declare function sessionRepoBenchmarkSessionId(index: number): string;
/** Deterministic closed-session catalogs shared by repository measurements. */
export declare const SESSION_REPO_CATALOG_BENCHMARK_DATASETS: readonly SessionRepoCatalogBenchmarkDataset[];
/** Seeds one deterministic catalog and returns its durable metadata in creation order. */
export declare function seedSessionRepoCatalogBenchmark(repo: SessionRepo, dataset: SessionRepoCatalogBenchmarkDataset): Promise<SessionMetadata[]>;
/** Shared catalog reads. Returning a number ensures each result is consumed. */
export declare const SESSION_REPO_CATALOG_READ_BENCHMARK_SCENARIOS: readonly SessionRepoCatalogReadBenchmarkScenario[];
/** Shared catalog writes. Every invocation receives an equivalent independently prepared repository. */
export declare const SESSION_REPO_CATALOG_WRITE_BENCHMARK_SCENARIOS: readonly SessionRepoCatalogWriteBenchmarkScenario[];
/** Initial fork timing uses a bounded source because each iteration owns an equivalent seeded repository. */
export declare const SESSION_REPO_FORK_BENCHMARK_DATASETS: readonly StorageBenchmarkDataset[];
/** Seeds one deterministic open source session with a linear main branch. */
export declare function seedSessionRepoForkBenchmark(repo: SessionRepo, dataset: StorageBenchmarkDataset): Promise<SessionMetadata>;
/** Shared fork writes. Every invocation receives an equivalent source repository. */
export declare const SESSION_REPO_FORK_WRITE_BENCHMARK_SCENARIOS: readonly SessionRepoForkWriteBenchmarkScenario[];
export {};
//# sourceMappingURL=session-repo.d.ts.map