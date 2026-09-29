import type { HarnessEvent, LaneSnapshot, LaneWatchEvent } from "../agent-harness.ts";
export type LaneSnapshotReduction = "rebase" | undefined;
/** Apply one harness event to a mutable lane snapshot. Navigation completion requires a fresh snapshot. */
export declare function reduceLaneSnapshot(snapshot: LaneSnapshot, event: HarnessEvent | LaneWatchEvent): LaneSnapshotReduction;
//# sourceMappingURL=reducer.d.ts.map