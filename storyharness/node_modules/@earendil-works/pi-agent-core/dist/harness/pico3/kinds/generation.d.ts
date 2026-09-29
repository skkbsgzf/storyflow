import type { Context } from "@earendil-works/chord";
import type { AssistantMessage, DeferredHandle } from "@earendil-works/pi-ai";
import { type SystemInstructionsHooks } from "../system.ts";
import { type CoreKind, type HookInfo, type HookResult, type Id, type ModelRef, type RequestMessage, type RetryPolicy, type Stored, type ThinkingLevel } from "../types.ts";
export type GenerationInput = {
    inputs: Id[];
};
/** Captured once at `prepared`; carried unchanged except `attempt`. */
type Prep = {
    cutoff: Id;
    system: Id | null;
    model: ModelRef;
    thinkingLevel: ThinkingLevel;
    tools: string[];
    retry: RetryPolicy;
    attempt: number;
};
export type GenerationCheckpoint = ({
    phase: "prepared";
} & Prep) | ({
    phase: "requesting";
} & Prep) | ({
    phase: "retrying";
    untilMs: number;
    lastError: string;
} & Prep) | ({
    phase: "deferred";
    handle: Stored<DeferredHandle>;
    pollAt: number;
} & Prep);
export type GenerationResult = {
    assistant: Id;
    tools: Id[];
    postTools?: Id;
    successor?: Id;
};
export type GenerationFailure = {
    reason: "provider" | "overflow" | "retries_exhausted" | "no_model";
    detail: string;
    assistant?: Id;
};
/** Display-only assistant entries (provider error, aborted partial) carry the message here, never in `model`. */
export type DisplayAssistantData = {
    attempt: number;
    display: Stored<AssistantMessage>;
    reason: "error" | "aborted";
};
/** Hook points this kind calls. Register with `h.hooks(namespace, kinds.generation, { … })`. */
export interface GenerationHooks extends SystemInstructionsHooks {
    /** Before every request (also on retry and recovery). Chain. */
    beforeRequest(request: {
        messages: RequestMessage[];
    }, info: HookInfo & {
        cutoff: Id;
    }, ctx: Context): HookResult<{
        messages: RequestMessage[];
    }>;
    /** Every terminal provider message, before classification. Observer. */
    afterResponse(message: AssistantMessage, info: HookInfo & {
        attempt: number;
    }, ctx: Context): void | Promise<void>;
    /** On a final answer with nothing queued. First `{ continue }` wins and starts a continuation. */
    onYield(answer: AssistantMessage, info: HookInfo, ctx: Context): HookResult<{
        continue: string;
    }>;
}
/** Configuration this kind reads, with defaults. `model` has none: absent → failed/no_model. */
export declare const generationConfig: {
    readonly rewindable: {
        readonly model: ModelRef | undefined;
        readonly thinkingLevel: ThinkingLevel;
        readonly selectedTools: string[];
        readonly profile: string;
    };
    readonly sticky: {
        readonly retry: RetryPolicy;
    };
};
export declare const generation: CoreKind<GenerationInput, GenerationCheckpoint, GenerationResult, GenerationFailure, {
    assistant?: Id;
}, GenerationHooks, typeof generationConfig>;
type RetryDecision = {
    kind: "retry";
    untilMs: number;
} | {
    kind: "fail";
    reason: "provider" | "retries_exhausted";
};
export declare function retryDecision(cp: {
    retry: RetryPolicy;
    attempt: number;
}, message: AssistantMessage | null, now: number): RetryDecision;
export {};
//# sourceMappingURL=generation.d.ts.map