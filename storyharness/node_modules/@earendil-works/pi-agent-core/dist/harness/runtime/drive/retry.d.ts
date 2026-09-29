import { type RetryPolicy } from "@earendil-works/pi-ai";
export declare function retryNotBefore(policy: Pick<RetryPolicy, "baseDelayMs" | "maxAgentDelayMs">, attempt: number, now?: number): number;
export declare function waitUntil(notBefore: number, signal: AbortSignal): Promise<void>;
//# sourceMappingURL=retry.d.ts.map