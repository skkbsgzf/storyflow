import type { Context } from "../context.ts";
import { type ExecutionEnv, type ExecutionError, type Result, type ShellExecOptions } from "../types.ts";
import { sanitizeShellOutput } from "./output-capture.ts";
import { type TruncationResult } from "./truncate.ts";
export interface ShellCaptureProgress {
    output: string;
    truncation: TruncationResult;
    fullOutputPath?: string;
    lastLineBytes: number;
}
export interface ShellCaptureOptions extends Omit<ShellExecOptions, "capture" | "onUpdate"> {
    onChunk?: (chunk: string, getProgress: () => ShellCaptureProgress, context: Context) => void;
    /** Return shell execution failures with captured output instead of as a failed Result. */
    returnExecutionErrors?: boolean;
}
export interface ShellCaptureResult extends ShellCaptureProgress {
    exitCode: number | undefined;
    cancelled: boolean;
    truncated: boolean;
    executionError?: ExecutionError;
}
/**
 * Compatibility collector for callers that need one bounded final view.
 * Source-side capture, adaptive publication, and spilling remain owned by the
 * execution environment.
 */
export declare function executeShellWithCapture(env: ExecutionEnv, command: string, options: ShellCaptureOptions | undefined, context: Context): Promise<Result<ShellCaptureResult, ExecutionError>>;
export { sanitizeShellOutput as sanitizeBinaryOutput };
//# sourceMappingURL=shell-output.d.ts.map