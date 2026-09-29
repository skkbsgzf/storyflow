import type { AgentMessage } from "../../types.ts";
import type { HarnessEvent, LaneQueuedItem } from "../agent-harness.ts";
import type { Context } from "../context.ts";
import type { CommitResult, Entry, InboxItem, NewEntry, OperationState, SessionReader } from "../session/types.ts";
import type { Lane } from "./lane.ts";
import type { ContinueOperationResult, Drive } from "./types.ts";
export declare function chainEntries<T extends {
    id: string;
}>(parentId: string | null, items: readonly T[]): Array<T & {
    parentId: string | null;
}>;
export declare function entryLifecycleEvents(entry: Entry, lane: string, runId?: string): HarnessEvent[];
export declare function committedEntryEvents(entries: readonly NewEntry[], commit: CommitResult, lane: string, runId?: string, firstWriteIndex?: number): HarnessEvent[];
export declare function readBoundedEntries<TContext extends object | undefined, TState extends OperationState>(lane: Lane<TContext>, drive: Drive, capability: TState): Promise<ContinueOperationResult<Entry[]>>;
export declare function readBoundedContext<TContext extends object | undefined, TState extends OperationState>(lane: Lane<TContext>, drive: Drive, capability: TState): Promise<ContinueOperationResult<AgentMessage[]>>;
export declare function readLaneQueues(reader: SessionReader, inbox: readonly InboxItem[], context: Context): Promise<LaneQueuedItem[]>;
export declare function readPendingMessages(reader: SessionReader, ids: readonly string[], description: string, context: Context): Promise<Array<{
    entryId: string;
    message: AgentMessage;
}>>;
//# sourceMappingURL=transcript.d.ts.map