import type { Context } from "@earendil-works/chord";
import type { ContextView, Id, Storage } from "./types.ts";
/**
 * pico §1.3, verbatim:
 *   H       = newest fork-visible entry at or before T with a head
 *   from    = H ? H.head : transcript start
 *   range   = fork-visible entries from `from` through T
 *   edits   = per target, newest edit in range wins
 *   entries = H ? [H, ...range without any head entries] : range
 *   model   = concat(entries.map(e => edits[e.id] ? apply : e.model)), then reorder tool results
 *
 * Display-only entries (aborted/error assistants, pi.usage, model-less plugin entries) have no
 * `model` and contribute nothing. Nothing here inspects an error string.
 */
export declare function deriveContext(storage: Storage, conversationId: Id, at: Id | undefined, ctx: Context): Promise<ContextView>;
//# sourceMappingURL=context.d.ts.map