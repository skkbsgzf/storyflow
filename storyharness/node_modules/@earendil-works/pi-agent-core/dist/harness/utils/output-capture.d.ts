import type { Context } from "../context.ts";
import type { ShellOutputCaptureOptions, ShellOutputUpdate, ShellOutputView } from "../types.ts";
export declare const OUTPUT_MIN_EMIT_INTERVAL_MS = 100;
export declare const OUTPUT_TARGET_BYTES_PER_SECOND: number;
interface OutputCaptureHandlers {
    onUpdate?: (update: ShellOutputUpdate, context: Context) => void;
    onError(error: unknown): void;
}
/**
 * Maintains and publishes one bounded shell-output view.
 *
 * Writes received while publication is rate-limited collapse into the latest
 * view. Small changes remain responsive; complete window turnovers purchase a
 * proportionally longer delay. The first update after idle and an explicit
 * final flush are immediate.
 */
export declare class OutputCapture {
    #private;
    constructor(options: ShellOutputCaptureOptions | undefined, context: Context, handlers: OutputCaptureHandlers);
    get truncated(): boolean;
    push(chunk: string | Uint8Array): void;
    finish(): void;
    setSpillPath(path: string): void;
    snapshot(): ShellOutputView;
    flush(): void;
    dispose(): void;
}
export declare function applyShellOutputUpdate(current: ShellOutputView | undefined, update: ShellOutputUpdate): ShellOutputView;
export declare function sanitizeShellOutput(text: string): string;
export {};
//# sourceMappingURL=output-capture.d.ts.map