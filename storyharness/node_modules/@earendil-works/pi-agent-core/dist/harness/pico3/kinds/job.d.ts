import type { Kind, KindConfig, ProcessSpec } from "../types.ts";
export type JobInput = {
    [K in keyof ProcessSpec]: ProcessSpec[K];
} & {
    notify: boolean;
    rerun: boolean;
    every?: number;
    notBefore?: number;
};
export type JobCheckpoint = {
    phase: "waiting";
    untilMs: number;
    occurrence: number;
} | {
    phase: "spawning";
    key: string;
    occurrence: number;
} | {
    phase: "running";
    key: string;
    occurrence: number;
};
export type JobOutput = {
    stdout?: string;
    stderr?: string;
    droppedStdout?: number;
    droppedStderr?: number;
    exitCode?: number;
    occurrence?: number;
};
export type JobResult = {
    exitCode: number;
    occurrences: number;
    stdout: string;
    stderr: string;
};
export type JobFailure = {
    reason: "spawn" | "interrupted";
    detail: string;
};
export declare const job: Readonly<Kind<JobInput, JobCheckpoint, JobResult, JobFailure, {
    killed: boolean;
}, object, KindConfig<import("../types.ts").ConfigShape, import("../types.ts").ConfigShape>, JobOutput, import("../types.ts").TaskTx>>;
//# sourceMappingURL=job.d.ts.map