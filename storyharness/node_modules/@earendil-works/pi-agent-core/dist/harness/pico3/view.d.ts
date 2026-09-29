import type { CommitResult, Session } from "./session.ts";
import type { Conversation, ConversationView, Envelope } from "./types.ts";
export declare const WATCH_CAPACITY = 256;
export interface Watch {
    readonly view: ConversationView;
    readonly revision: number;
    readonly closed: boolean;
    start(listener: (envelope: Envelope) => void): void;
    stop(): void;
}
export declare function applyEnvelope(view: ConversationView, envelope: Envelope): ConversationView;
export declare class ViewManager {
    private readonly records;
    private readonly deliveries;
    private readonly session;
    private readonly onReport;
    constructor(session: Session, onReport: (error: unknown) => void);
    watch(conversation: Conversation, entries: EntryList): Watch;
    /** Runs on the Session line after persistence and in-memory indexes update. */
    update(result: CommitResult<unknown>): void;
    /** Runs after the Session line; listeners are synchronous and ordered. */
    deliver(): void;
    close(): void;
    private build;
    private document;
    private config;
    private turn;
    private compaction;
    private tasks;
    private plugins;
}
type EntryList = ConversationView["entries"];
export {};
//# sourceMappingURL=view.d.ts.map