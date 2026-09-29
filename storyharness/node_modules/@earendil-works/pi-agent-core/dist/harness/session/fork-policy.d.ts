import type { CommittedListAppendWrite, CommittedValueSetWrite } from "./commit.ts";
import type { ForkOptions } from "./types.ts";
export type ForkCurrentStatePlan = {
    scope: "branch";
    branch: string;
    destinationTip: string | null;
} | {
    scope: "tree";
};
export declare function selectBranchFork(options: Extract<ForkOptions, {
    scope: "branch";
}>, source: {
    tip: string | null | undefined;
    getParent: (entryId: string) => string | null | undefined;
    selectEntry: (entryId: string) => void;
}): Extract<ForkCurrentStatePlan, {
    scope: "branch";
}>;
/** Project one current scalar row or surviving list element into destination state. */
export declare function projectForkCurrentStateWrite(write: CommittedValueSetWrite | CommittedListAppendWrite, plan: ForkCurrentStatePlan, isEntryCopied: (entryId: string) => boolean): CommittedValueSetWrite | CommittedListAppendWrite | undefined;
//# sourceMappingURL=fork-policy.d.ts.map