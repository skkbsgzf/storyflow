import { type RetryPolicy } from "@earendil-works/pi-ai";
import type { CompactionSettings } from "./compaction/compaction.ts";
export declare const DEFAULT_RETRY_POLICY: RetryPolicy;
export declare function validateToolNames(tools: readonly {
    name: string;
}[]): void;
export declare function validateRetryPolicy(policy: RetryPolicy): void;
export declare function validateCompactionSettings(settings: CompactionSettings): void;
//# sourceMappingURL=config.d.ts.map