import type { Context } from "../../context.ts";
import type { AssistantResponseMetadata, AssistantStreamObserver } from "../../execution/assistant.ts";
import { type AssistantEffectPendingOperation, type DeferredEffectPendingOperation, type OperationError, type OperationState, type SettledAssistantMessage } from "../../session/types.ts";
import type { Lane } from "../lane.ts";
import type { Drive, ProcedureResult } from "../types.ts";
export type AssistantResponseLifecycle = {
    observer: AssistantStreamObserver;
    afterResponse(message: SettledAssistantMessage, metadata: AssistantResponseMetadata, context: Context): Promise<SettledAssistantMessage>;
    close(): Promise<void>;
};
export declare function openAssistantResponse<TContext extends object | undefined>(lane: Lane<TContext>, drive: Drive, responseEntryId: string, recovery?: boolean): AssistantResponseLifecycle;
type ResponseIntent = AssistantEffectPendingOperation | DeferredEffectPendingOperation;
type ConfigurationFailureState = Extract<OperationState, {
    at: "assistant.ready" | "assistant.retry_wait" | "deferred.suspended" | "deferred.effect_pending";
}>;
/** Publish a non-retryable request-configuration failure before reserving response ids. */
export declare function publishConfigurationFailure<TContext extends object | undefined, TState extends ConfigurationFailureState>(lane: Lane<TContext>, drive: Drive, capability: TState, error: OperationError): Promise<ProcedureResult>;
/** Classify and atomically settle one assistant-generation or deferred-poll response. */
export declare function publishResponse<TContext extends object | undefined>(lane: Lane<TContext>, drive: Drive, intent: ResponseIntent, response: SettledAssistantMessage, options?: {
    recovery?: true;
}): Promise<ProcedureResult>;
export {};
//# sourceMappingURL=response.d.ts.map