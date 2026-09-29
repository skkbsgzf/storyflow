import type { Context as AiContext, Api, AssistantMessage, AssistantMessageEvent, AssistantMessageEventStream, Message, Model, SimpleStreamOptions, Tool } from "@earendil-works/pi-ai";
import type { AgentMessage, ThinkingLevel } from "../../types.ts";
import { type Context } from "../context.ts";
import type { SettledAssistantMessage } from "../session/types.ts";
import type { AgentHarnessStreamOptions } from "../types.ts";
/** HTTP response metadata captured before the provider response body is consumed. */
export interface AssistantResponseMetadata {
    status?: number;
    headers?: Record<string, string>;
}
/** Process-local lifecycle observer for one assistant stream. */
export interface AssistantStreamObserver {
    start(message: AssistantMessage, event: Extract<AssistantMessageEvent, {
        type: "start";
    }>, context: Context): void | Promise<void>;
    update(message: AssistantMessage, event: AssistantMessageEvent, context: Context): void | Promise<void>;
    end(message: SettledAssistantMessage, context: Context): void | Promise<void>;
}
/** Executable inputs for one already-approved assistant provider request. */
export interface HarnessAssistantStreamConfig {
    model: Model<Api>;
    systemPrompt: string;
    tools?: Tool[];
    thinkingLevel: ThinkingLevel;
    streamOptions: AgentHarnessStreamOptions;
    transformContext?: (requestContext: {
        messages: AgentMessage[];
        systemPrompt: string;
    }, context: Context) => Promise<{
        messages: AgentMessage[];
        systemPrompt: string;
    }>;
    toProviderMessages: (messages: AgentMessage[], context: Context) => Message[] | Promise<Message[]>;
    beforePayload?: (payload: unknown, model: Model<Api>, context: Context) => unknown | undefined | Promise<unknown | undefined>;
    afterResponse?: (message: SettledAssistantMessage, metadata: AssistantResponseMetadata, context: Context) => Promise<SettledAssistantMessage>;
    request(aiContext: AiContext, options: SimpleStreamOptions, context: Context): AssistantMessageEventStream | Promise<AssistantMessageEventStream>;
    observer: AssistantStreamObserver;
}
export declare function consumeAssistantStream(stream: AssistantMessageEventStream, observer: AssistantStreamObserver, afterResponse: ((message: SettledAssistantMessage, context: Context) => Promise<SettledAssistantMessage>) | undefined, context: Context): Promise<SettledAssistantMessage>;
/** Stream one assistant response without mutating the caller's message list. */
export declare function streamHarnessAssistant(messages: AgentMessage[], config: HarnessAssistantStreamConfig, context: Context): Promise<SettledAssistantMessage>;
//# sourceMappingURL=assistant.d.ts.map