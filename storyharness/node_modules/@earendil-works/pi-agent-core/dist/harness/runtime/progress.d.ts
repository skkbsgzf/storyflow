import type { AssistantMessageFrame } from "@earendil-works/pi-ai";
import type { AgentToolResult } from "../../types.ts";
import type { Context } from "../context.ts";
import type { SessionReader } from "../session/types.ts";
import type { Lane } from "./lane.ts";
import type { Drive } from "./types.ts";
export interface ProgressChannel<T> {
    write(item: T): void;
    seal(): void;
    drain(): Promise<void>;
}
export declare function readAssistantFrames(reader: SessionReader, operationId: string, responseEntryId: string, context: Context): Promise<AssistantMessageFrame[]>;
export declare function openFrameProgress<TContext extends object | undefined>(lane: Lane<TContext>, drive: Drive, responseEntryId: string): ProgressChannel<AssistantMessageFrame>;
export declare function openToolProgress<TContext extends object | undefined>(lane: Lane<TContext>, drive: Drive, turnId: string, sourceIndex: number, invocationId: string): ProgressChannel<AgentToolResult<unknown>>;
//# sourceMappingURL=progress.d.ts.map