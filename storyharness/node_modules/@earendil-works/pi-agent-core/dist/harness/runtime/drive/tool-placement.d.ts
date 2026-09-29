import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { AgentToolCall } from "../../../types.ts";
import { type ToolBatch, type ToolCall, type ToolsOperation } from "../../session/types.ts";
import type { Lane } from "../lane.ts";
import type { Drive } from "../types.ts";
export type ToolBatchSource = {
    assistant: AssistantMessage;
    calls: Map<number, AgentToolCall>;
};
export declare function readToolBatchSource<TContext extends object | undefined>(lane: Lane<TContext>, drive: Drive, batch: ToolBatch): Promise<ToolBatchSource>;
export declare function toolCallFor(sources: ToolBatchSource, call: ToolCall): AgentToolCall;
export declare function withToolBatch(run: ToolsOperation, batch: ToolBatch): ToolsOperation;
export declare function materializeReady<TContext extends object | undefined>(lane: Lane<TContext>, drive: Drive, capability: ToolsOperation, sources: ToolBatchSource, recovery: boolean): Promise<void>;
//# sourceMappingURL=tool-placement.d.ts.map