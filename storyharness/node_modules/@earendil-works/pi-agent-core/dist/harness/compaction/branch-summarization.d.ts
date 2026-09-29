import { type Api, type Model, type Models, type RetryCallbacks, type RetryPolicy, type Usage } from "@earendil-works/pi-ai";
import type { AgentMessage } from "../../types.ts";
import type { Context } from "../context.ts";
import type { Branch, Entry, Session } from "../session/index.ts";
import { BranchSummaryError, type Result } from "../types.ts";
import { type SummaryRequest } from "./compaction.ts";
import { type FileOperations } from "./utils.ts";
/** Generated branch summary data ready to be persisted as a branch-summary entry. */
export interface BranchSummaryResult {
    summary: string;
    usage?: Usage;
    readFiles: string[];
    modifiedFiles: string[];
}
/** File-operation details stored on generated branch summary entries. */
export interface BranchSummaryDetails {
    /** Files read while exploring the summarized branch. */
    readFiles: string[];
    /** Files modified while exploring the summarized branch. */
    modifiedFiles: string[];
}
export type { FileOperations } from "./utils.ts";
/** Prepared branch content for summarization. */
export interface BranchPreparation {
    /** Messages selected for the branch summary. */
    messages: AgentMessage[];
    /** File operations extracted from the branch. */
    fileOps: FileOperations;
    /** Estimated token count for selected messages. */
    totalTokens: number;
}
/** Entries selected for branch summarization. */
export interface CollectEntriesResult {
    /** Entries to summarize in chronological order. */
    entries: Entry[];
    /** Deepest common ancestor between the previous tip and target entry. */
    commonAncestorId: string | null;
}
/** Options for generating a branch summary. */
export interface GenerateBranchSummaryOptions {
    /** Provider collection the summarization request goes through; owns auth resolution. */
    models: Models;
    /** Model used for summarization. */
    model: Model<Api>;
    /** Optional instructions appended to or replacing the default prompt. */
    customInstructions?: string;
    /** Replace the default prompt with custom instructions instead of appending them. */
    replaceInstructions?: boolean;
    /** Tokens reserved for prompt and model output. Defaults to 16384. */
    reserveTokens?: number;
    /** Optional retry policy for transient summarization errors. */
    retry?: RetryPolicy;
    /** Optional callbacks for retry reporting. */
    callbacks?: RetryCallbacks;
}
/** Collect entries that should be summarized before navigating to a different session tree entry. */
export declare function collectEntriesForBranchSummary(branch: Pick<Branch, "findEntries">, session: Pick<Session, "getEntry">, oldTipId: string | null, targetId: string, context: Context): Promise<CollectEntriesResult>;
/** Prepare branch entries for summarization within an optional token budget. */
export declare function prepareBranchEntries(entries: Entry[], tokenBudget?: number): BranchPreparation;
/** Generate a summary for abandoned branch entries. */
export declare function generateBranchSummary(entries: Entry[], options: GenerateBranchSummaryOptions, context: Context): Promise<Result<BranchSummaryResult, BranchSummaryError>>;
export interface PreparedBranchSummaryOptions {
    customInstructions?: string;
    replaceInstructions?: boolean;
}
/** Generate a prepared branch summary through a caller-owned one-request boundary. */
export declare function generateBranchSummaryWithRequest(preparation: BranchPreparation, options: PreparedBranchSummaryOptions, request: SummaryRequest, context: Context): Promise<Result<BranchSummaryResult, BranchSummaryError>>;
//# sourceMappingURL=branch-summarization.d.ts.map