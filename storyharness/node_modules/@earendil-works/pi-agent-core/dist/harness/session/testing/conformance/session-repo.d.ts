import type { SessionMetadata, SessionRepo } from "../../types.ts";
import type { ConformanceCase } from "../types.ts";
/** Creates lifecycle cases for repositories that support creation, discovery, open, and deletion. */
export declare function createSessionRepoLifecycleConformance<TMetadata extends SessionMetadata>(backendFactory: () => Promise<Pick<SessionRepo<TMetadata>, "create" | "open" | "list" | "delete">>, onClose?: () => void | Promise<void>): readonly ConformanceCase[];
/** Creates exclusive-open cases for repositories that own active session handles. */
export declare function createSessionRepoOwnershipConformance<TMetadata extends SessionMetadata>(backendFactory: () => Promise<Pick<SessionRepo<TMetadata>, "create" | "open">>, onClose?: () => void | Promise<void>): readonly ConformanceCase[];
/** Creates message cases for repositories that support session creation. */
export declare function createSessionRepoMessageConformance<TMetadata extends SessionMetadata>(backendFactory: () => Promise<Pick<SessionRepo<TMetadata>, "create">>, onClose?: () => void | Promise<void>): readonly ConformanceCase[];
/** Creates fork-content cases that do not require concurrent repository coordination. */
export declare function createSessionRepoForkBehaviorConformance<TMetadata extends SessionMetadata>(backendFactory: () => Promise<Pick<SessionRepo<TMetadata>, "create" | "list" | "fork">>, onClose?: () => void | Promise<void>): readonly ConformanceCase[];
/** WP08 cases enabled for Memory and JSONL while SQLite's streaming fork implementation is pending. */
export declare function createSessionRepoStreamingForkConformance<TMetadata extends SessionMetadata>(backendFactory: () => Promise<Pick<SessionRepo<TMetadata>, "create" | "fork">>, onClose?: () => void | Promise<void>): readonly ConformanceCase[];
/** Creates fork cases that require destination reservation across create and fork. */
export declare function createSessionRepoForkDestinationReservationConformance<TMetadata extends SessionMetadata>(backendFactory: () => Promise<Pick<SessionRepo<TMetadata>, "create" | "fork">>, onClose?: () => void | Promise<void>): readonly ConformanceCase[];
/** Creates fork cases that require a snapshot boundary on an active source storage queue. */
export declare function createSessionRepoForkSourceSnapshotConformance<TMetadata extends SessionMetadata>(backendFactory: () => Promise<Pick<SessionRepo<TMetadata>, "create" | "fork">>, onClose?: () => void | Promise<void>): readonly ConformanceCase[];
/** Creates every fork coordination case. */
export declare function createSessionRepoForkCoordinationConformance<TMetadata extends SessionMetadata>(backendFactory: () => Promise<Pick<SessionRepo<TMetadata>, "create" | "fork">>, onClose?: () => void | Promise<void>): readonly ConformanceCase[];
/** Creates every fork conformance case. */
export declare function createSessionRepoForkConformance<TMetadata extends SessionMetadata>(backendFactory: () => Promise<Pick<SessionRepo<TMetadata>, "create" | "list" | "fork">>, onClose?: () => void | Promise<void>): readonly ConformanceCase[];
/** Creates every SessionRepo conformance case. */
export declare function createSessionRepoConformance<TMetadata extends SessionMetadata>(factory: () => Promise<SessionRepo<TMetadata>>, onClose?: () => void | Promise<void>): readonly ConformanceCase[];
//# sourceMappingURL=session-repo.d.ts.map