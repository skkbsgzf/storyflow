import { BACKGROUND_CONTEXT } from "../../../context.js";
import { insertEntry, insertUsage } from "../../commit.js";
import { branchTip, setValue } from "../../values.js";
import { STORAGE_BENCHMARK_DATASETS, storageBenchmarkEntryId } from "./datasets.js";
const MESSAGE_TIMESTAMP = 1_650_000_000_000;
const SEED_BATCH_SIZE = 250;
const WRITE_BASELINE_DATASET = STORAGE_BENCHMARK_DATASETS[0];
function createEntry(index, payloadBytes) {
    const id = storageBenchmarkEntryId(index);
    const prefix = `${id}:`;
    return {
        id,
        parentId: index === 0 ? null : storageBenchmarkEntryId(index - 1),
        type: "message",
        message: {
            role: "user",
            content: [{ type: "text", text: prefix + "x".repeat(Math.max(0, payloadBytes - prefix.length)) }],
            timestamp: MESSAGE_TIMESTAMP,
        },
    };
}
function createStorageBenchmarkTransaction(startIndex, entryCount, payloadBytes) {
    return Array.from({ length: entryCount }, (_, offset) => insertEntry(createEntry(startIndex + offset, payloadBytes)));
}
/** Generates deterministic seed transactions without claiming a production data distribution. */
export function* generateStorageBenchmarkSeedTransactions(dataset) {
    for (let startIndex = 0; startIndex < dataset.entryCount; startIndex += SEED_BATCH_SIZE) {
        yield createStorageBenchmarkTransaction(startIndex, Math.min(SEED_BATCH_SIZE, dataset.entryCount - startIndex), dataset.payloadBytes);
    }
}
/** Seeds one deterministic synthetic linear branch. */
export async function seedStorageBenchmark(storage, dataset) {
    for (const transaction of generateStorageBenchmarkSeedTransactions(dataset))
        await storage.commit(transaction, BACKGROUND_CONTEXT);
}
const singleEntryTransaction = createStorageBenchmarkTransaction(0, 1, 256);
const hundredEntryTransaction = createStorageBenchmarkTransaction(0, 100, 256);
const appendedEntryId = storageBenchmarkEntryId(WRITE_BASELINE_DATASET.entryCount);
const mixedAppendTransaction = [
    ...createStorageBenchmarkTransaction(WRITE_BASELINE_DATASET.entryCount, 1, WRITE_BASELINE_DATASET.payloadBytes),
    setValue(branchTip("main"), appendedEntryId),
    insertUsage({
        id: "benchmark-usage",
        entryId: appendedEntryId,
        adjustment: false,
        usage: {
            input: 1_000,
            output: 250,
            cacheRead: 500,
            cacheWrite: 0,
            totalTokens: 1_250,
            cost: { input: 0.001, output: 0.001, cacheRead: 0.0001, cacheWrite: 0, total: 0.0021 },
        },
    }),
];
/** Shared read scenarios. Returning a number ensures each result is consumed. */
export const STORAGE_READ_BENCHMARK_SCENARIOS = [
    {
        name: "get 100 distributed entries",
        expectedResult(dataset) {
            return dataset.lookupIds.length;
        },
        async run(storage, dataset) {
            return (await storage.getEntries([...dataset.lookupIds], BACKGROUND_CONTEXT)).size;
        },
    },
    {
        name: "scan latest 50 entries",
        expectedResult(dataset) {
            return Math.min(50, dataset.entryCount);
        },
        async run(storage) {
            return (await storage.scanEntries({ order: "desc", limit: 50 }, BACKGROUND_CONTEXT)).length;
        },
    },
    {
        name: "scan full branch structure",
        expectedResult(dataset) {
            return dataset.entryCount;
        },
        async run(storage, dataset) {
            return (await storage.scanBranchStructure({ start: dataset.tipId, order: "newestFirst" }, BACKGROUND_CONTEXT))
                .length;
        },
    },
];
/** Shared writes. Every invocation receives equivalent pre-benchmark state. */
export const STORAGE_WRITE_BENCHMARK_SCENARIOS = [
    {
        name: "commit one message entry",
        writeCount: 1,
        async run(storage) {
            return (await storage.commit(singleEntryTransaction, BACKGROUND_CONTEXT)).seqs.length;
        },
    },
    {
        name: "commit 100 message entries",
        writeCount: 100,
        async run(storage) {
            return (await storage.commit(hundredEntryTransaction, BACKGROUND_CONTEXT)).seqs.length;
        },
    },
    {
        name: `commit mixed append (${WRITE_BASELINE_DATASET.name})`,
        writeCount: 3,
        prepare(storage) {
            return seedStorageBenchmark(storage, WRITE_BASELINE_DATASET);
        },
        async run(storage) {
            return (await storage.commit(mixedAppendTransaction, BACKGROUND_CONTEXT)).seqs.length;
        },
    },
];
//# sourceMappingURL=storage.js.map