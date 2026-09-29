import type { AgentMessage } from "../../types.ts";
import type { Context } from "../context.ts";
import { MutationLine } from "./mutation-line.ts";
import type { Branch, Entry, EntryQuery, IdGenerator, JsonValue, Session, SessionMetadata, SessionMutation, SessionMutationCallback, SessionStats, Storage, StorageBranchScan } from "./types.ts";
import { type ListElement, type ListReadOptions, type StoredValue, type Value, type ValueList } from "./values.ts";
export interface StorageBackedSessionOptions {
    mutationLine?: MutationLine;
    idGenerator?: IdGenerator;
    onClose?: () => void;
}
/** Durable session state is internally inconsistent and cannot be safely advanced. */
export declare class SessionInvariantError extends Error {
    constructor(message: string);
}
/** A requested Branch name is invalid. */
export declare class SessionInvalidBranchError extends Error {
    readonly branch: string;
    readonly reason: string;
    constructor(branch: string, reason: string);
}
/** A requested branch already exists. */
export declare class SessionBranchExistsError extends Error {
    readonly branch: string;
    constructor(branch: string);
}
/** A pending assistant message cannot be persisted as a session entry. */
export declare class SessionPendingAssistantMessageError extends Error {
    constructor();
}
/** A requested session entry target does not exist. */
export declare class SessionUnknownTargetError extends Error {
    readonly targetId: string;
    constructor(targetId: string);
}
/** Package-internal typed boundary shared by concrete session repositories. */
export declare class StorageBackedSession<TMetadata extends SessionMetadata = SessionMetadata> implements Session<TMetadata> {
    readonly metadata: TMetadata;
    readonly idGenerator: IdGenerator;
    private readonly storage;
    private readonly mutationLine;
    private readonly onClose;
    private readonly branches;
    private readonly closedError;
    private state;
    private closePromise;
    constructor(metadata: TMetadata, storage: Storage, options?: StorageBackedSessionOptions);
    beginMutation(_context: Context): Promise<SessionMutation>;
    mutate<T>(mutation: SessionMutationCallback<T>, context: Context): Promise<T>;
    getEntries(ids: string[], context: Context): Promise<Map<string, Entry>>;
    getEntry(id: string, context: Context): Promise<Entry | undefined>;
    getValue<T>(address: Value<T>, context: Context): Promise<StoredValue<T> | undefined>;
    scanValues<T>(prefix: Value<T>, context: Context): Promise<StoredValue<T>[]>;
    readList<T>(address: ValueList<T>, options: ListReadOptions | undefined, context: Context): Promise<ListElement<T>[]>;
    scanBranch(query: StorageBranchScan, context: Context): Promise<Entry[]>;
    getStats(context: Context): Promise<SessionStats>;
    getName(context: Context): Promise<string | undefined>;
    getLabel(targetId: string, context: Context): Promise<string | undefined>;
    findEntries(query: EntryQuery | undefined, context: Context): Promise<Entry[]>;
    findEntry(query: EntryQuery | undefined, context: Context): Promise<Entry | undefined>;
    branch(name: string, context: Context): Promise<Branch | undefined>;
    createBranch(name: string, at: string | null, context: Context): Promise<Branch>;
    setValue<T>(address: Value<T>, next: NoInfer<T>, context: Context): Promise<void>;
    deleteValue<T>(address: Value<T>, context: Context): Promise<void>;
    appendList<T>(address: ValueList<T>, element: NoInfer<T>, context: Context): Promise<void>;
    deleteList<T>(address: ValueList<T>, context: Context): Promise<void>;
    setName(name: string | undefined, context: Context): Promise<void>;
    setLabel(targetId: string, label: string | undefined, context: Context): Promise<void>;
    close(context: Context): Promise<void>;
    getBranchTip(name: string, context: Context): Promise<string | null>;
    appendToBranch(name: string, entry: {
        type: "message";
        message: AgentMessage;
    } | {
        type: "custom";
        customType: string;
        data?: JsonValue;
    }, context: Context): Promise<string>;
    private getOrCreateBranchObject;
    private assertValidBranchName;
    private assertOpen;
}
//# sourceMappingURL=session.d.ts.map