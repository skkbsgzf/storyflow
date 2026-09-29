/** Package-internal deterministic id shared by dataset and transaction generation. */
export function storageBenchmarkEntryId(index) {
    return `benchmark-entry-${index.toString().padStart(8, "0")}`;
}
function createDataset(scale, entryCount) {
    const lookupCount = Math.min(100, entryCount);
    return {
        name: `synthetic linear branch: ${scale}, 256-byte payloads`,
        entryCount,
        payloadBytes: 256,
        lookupIds: Array.from({ length: lookupCount }, (_, index) => {
            const entryIndex = Math.floor((index * (entryCount - 1)) / Math.max(1, lookupCount - 1));
            return storageBenchmarkEntryId(entryIndex);
        }),
        tipId: storageBenchmarkEntryId(entryCount - 1),
    };
}
/** Deterministic synthetic linear branches shared by all storage measurements. */
export const STORAGE_BENCHMARK_DATASETS = [
    createDataset("1k entries", 1_000),
    createDataset("10k entries", 10_000),
    createDataset("100k entries", 100_000),
];
//# sourceMappingURL=datasets.js.map