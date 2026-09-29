import { type Context, type MutableReplicatedState, type ReplicatedState } from "@earendil-works/chord";
import type { ConversationHandle, Harness } from "./harness.ts";
import type { ConversationSpec, ConversationView, Entry, EntryScan, Id, JsonObject, NewEntry, SendInput, ViewEvent } from "./types.ts";
export type PublishedConversationView = ConversationView & {
    commit: {
        events: ViewEvent[];
    };
};
export interface PicoConversationService {
    readonly view: ReplicatedState<PublishedConversationView>;
    send(input: SendInput, ctx: Context): Promise<Id>;
    write(entry: NewEntry, ctx: Context): Promise<Id>;
    inputAbort(id: Id, ctx: Context): Promise<"aborted" | "already_placed" | "not_found">;
    configSet(patch: JsonObject, ctx: Context): Promise<void>;
    abort(ctx: Context): Promise<void>;
    reset(handoff: string | null, ctx: Context): Promise<void>;
    collapse(instructions: string | null, ctx: Context): Promise<Id>;
    fork(at: Id | "start", spec: Omit<ConversationSpec, "parent">, ctx: Context): Promise<Id>;
    entries(scan: EntryScan, ctx: Context): Promise<Entry[]>;
}
/** Local registration/control plane and remote keyed conversation contract used by Chord facets. */
export declare const PicoHarnessService: import("@earendil-works/chord").Service<Harness<[]>>;
export declare const PicoConversationService: import("@earendil-works/chord").Service<PicoConversationService>;
export declare function createPicoConversationService<Cfg extends object>(harness: Pick<Harness, "abortInput" | "entries">, conversation: ConversationHandle<Cfg>, view: ReplicatedState<PublishedConversationView>): PicoConversationService;
export interface ChordViewBridge {
    readonly view: MutableReplicatedState<PublishedConversationView>;
    readonly closed: boolean;
    close(): void;
}
export interface ChordViewBridgeOptions {
    capacity?: number;
    /** Called after the raw watch is closed. The owner should close and respawn its keyed service instance. */
    onFailure?: (error: Error) => void;
}
/**
 * Adapt Pico's commit-granular envelopes to one Chord publication per commit.
 * The raw listener only enqueues. Applying ops and publishing happen together,
 * off the Session line, with no await between them.
 */
export declare function attachChordView(conversation: Pick<ConversationHandle, "watch">, createState: (initial: PublishedConversationView) => MutableReplicatedState<PublishedConversationView>, ctx: Context, opts?: ChordViewBridgeOptions): Promise<ChordViewBridge>;
//# sourceMappingURL=chord.d.ts.map