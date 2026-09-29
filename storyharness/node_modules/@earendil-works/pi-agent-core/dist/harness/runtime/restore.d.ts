import type { Context } from "../context.ts";
import type { LaneState as DurableLaneState, LaneConfiguration, Session, SessionReader } from "../session/types.ts";
import { type StoredValue } from "../session/values.ts";
import type { LaneState } from "./types.ts";
export type ClassifiedLaneStorage = {
    kind: "absent";
} | {
    kind: "branch";
    tip: StoredValue<string | null>;
} | {
    kind: "lane";
    tip: StoredValue<string | null>;
    configuration: StoredValue<LaneConfiguration>;
    laneState: StoredValue<DurableLaneState>;
};
export declare function readLaneStorage(reader: SessionReader, lane: string, context: Context): Promise<ClassifiedLaneStorage>;
/** Restore every complete configured AgentLane in one coherent Session read. */
export declare function restoreSession(session: Session, context: Context): Promise<Map<string, LaneState>>;
/** Restore one configured lane without starting work or interpreting its state. */
export declare function restoreLane(session: Session, lane: string, context: Context): Promise<LaneState>;
export declare function restoreLaneState(reader: SessionReader, lane: string, stored: Extract<ClassifiedLaneStorage, {
    kind: "lane";
}>, context: Context): Promise<LaneState>;
//# sourceMappingURL=restore.d.ts.map