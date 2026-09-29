import type { Context } from "@earendil-works/chord";
import { type CoreKind, type Entry, type HookInfo, type HookResult, type Id, type ModelRef, type RetryPolicy, type ThinkingLevel } from "../types.ts";
export type CollapseInput = {
    reason: "threshold" | "manual" | "overflow";
    through: Id;
    instructions?: string;
};
type Base = {
    expectedHead: Id | null;
    instructions?: string;
    model: ModelRef;
    thinkingLevel: ThinkingLevel;
    retry: RetryPolicy;
    attempt: number;
};
export type CollapseCheckpoint = ({
    phase: "summarizing";
} & Base) | ({
    phase: "retrying";
    untilMs: number;
    lastError: string;
} & Base) | ({
    phase: "prepared";
    summary: string;
} & Base);
export type CollapseFailure = {
    reason: "stale" | "declined" | "provider" | "retries_exhausted" | "no_model";
    detail: string;
};
export interface CollapseHooks {
    beforeCollapse(reason: "threshold" | "manual" | "overflow", through: Id, entries: Entry[], info: HookInfo, ctx: Context): HookResult<{
        decline: true;
    } | {
        instructions?: string;
        summary?: string;
    }>;
}
export declare const collapseConfig: {
    readonly rewindable: {
        readonly threshold: number;
        readonly keepRecent: number;
    };
};
export declare const collapse: CoreKind<CollapseInput, CollapseCheckpoint, {
    summary: Id;
}, CollapseFailure, null, CollapseHooks, typeof collapseConfig>;
export declare function chooseThrough(entries: Entry[], keepRecent: number): Id | undefined;
export {};
//# sourceMappingURL=collapse.d.ts.map