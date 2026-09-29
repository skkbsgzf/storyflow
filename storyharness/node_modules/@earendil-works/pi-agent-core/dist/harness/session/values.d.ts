import type { AssistantMessageFrame } from "@earendil-works/pi-ai";
import type { AgentToolResult } from "../../types.ts";
import type { DurableStructuralPreparation, JsonValue, LaneConfiguration, LaneState, OperationMeta, OperationResultRecord, OperationState, PendingEntry } from "./types.ts";
declare const storedValueType: unique symbol;
export interface StoredAddressBase {
    readonly namespace: string;
    readonly key: string;
    readonly kind: "value" | "list";
}
export interface Value<T> extends StoredAddressBase {
    readonly kind: "value";
    readonly [storedValueType]?: (value: T) => T;
}
export interface ValueList<T> extends StoredAddressBase {
    readonly kind: "list";
    readonly [storedValueType]?: (value: T) => T;
}
export interface StoredValue<T> {
    address: Value<T>;
    value: T;
    seq: number;
}
export interface ListElement<T> {
    seq: number;
    value: T;
}
export interface ListCursor {
    seq: number;
}
export interface ListReadOptions {
    cursor?: ListCursor;
    order?: "asc" | "desc";
    limit?: number;
}
export interface ResolvedListReadOptions {
    cursor?: ListCursor;
    order: "asc" | "desc";
    limit: number;
}
export interface ValueSetWrite {
    kind: "value";
    op: "set";
    namespace: string;
    key: string;
    value: unknown;
}
export interface ValueDeleteWrite {
    kind: "value";
    op: "delete";
    namespace: string;
    key: string;
}
export interface ListAppendWrite {
    kind: "list";
    op: "append";
    namespace: string;
    key: string;
    value: unknown;
}
export interface ListDeleteWrite {
    kind: "list";
    op: "delete";
    namespace: string;
    key: string;
}
export type ValueWrite = ValueSetWrite | ValueDeleteWrite;
export type ListWrite = ListAppendWrite | ListDeleteWrite;
export declare function value<T>(namespace: string, key?: string): Value<T>;
export declare function list<T>(namespace: string, key?: string): ValueList<T>;
export declare function setValue<T>(address: Value<T>, next: NoInfer<T>): ValueSetWrite;
export declare function deleteValue<T>(address: Value<T>): ValueDeleteWrite;
export declare function appendList<T>(address: ValueList<T>, element: NoInfer<T>): ListAppendWrite;
export declare function deleteList<T>(address: ValueList<T>): ListDeleteWrite;
export declare function resolveListReadOptions(options?: ListReadOptions): ResolvedListReadOptions;
export declare const branchTip: (branch: string) => Value<string | null>;
export declare const branchTipInventoryPrefix: () => Value<string | null>;
export declare const laneConfig: (lane: string) => Value<LaneConfiguration>;
export declare const laneState: (lane: string) => Value<LaneState>;
export declare const operationResult: (operationId: string) => Value<OperationResultRecord>;
export declare const operationMeta: (operationId: string) => Value<OperationMeta>;
export declare const operationState: (operationId: string) => Value<OperationState>;
export declare const operationToolArgs: (operationId: string, stepId: string, sourceIndex: number) => Value<Record<string, JsonValue>>;
export declare const operationToolMemo: (operationId: string, invocationId: string, name: string) => Value<JsonValue>;
export declare const operationPreparation: (operationId: string, taskId: string) => Value<DurableStructuralPreparation>;
export declare const operationToolArgsPrefix: (operationId: string, stepId?: string | undefined) => Value<Record<string, JsonValue>>;
export declare const operationToolMemoPrefix: (operationId: string, invocationId?: string | undefined) => Value<JsonValue>;
export declare const operationPreparationPrefix: (operationId: string) => Value<DurableStructuralPreparation>;
export declare const pendingEntry: (entryId: string) => Value<PendingEntry>;
export declare const pendingToolOutput: (operationId: string, invocationId: string) => Value<AgentToolResult<unknown>>;
export declare const pendingAssistantFrames: (operationId: string, responseEntryId: string) => ValueList<AssistantMessageFrame>;
export declare const pendingToolOutputPrefix: (operationId: string) => Value<AgentToolResult<unknown>>;
export declare const sessionName: Value<string>;
export declare const entryLabel: (entryId: string) => Value<string>;
export {};
//# sourceMappingURL=values.d.ts.map