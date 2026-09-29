import type { Context, ContextKey } from "@earendil-works/chord";
import { awaitWithContext, BACKGROUND_CONTEXT, createContextKey, TODO_CONTEXT, withAbortSignal, withCancel, withContextValue, withoutAbortSignal } from "@earendil-works/chord/context";
import { type TelemetryContext } from "@earendil-works/pi-telemetry";
export { awaitWithContext, BACKGROUND_CONTEXT, type Context, type ContextKey, createContextKey, TODO_CONTEXT, withAbortSignal, withCancel, withContextValue, withoutAbortSignal, };
/** Return the telemetry parent attached to a context, or the shared no-op parent. */
export declare function getTelemetryContext(context: Context): TelemetryContext;
/** Derive a context whose telemetry children use the supplied parent or active span. */
export declare function withTelemetryContext(telemetryContext: TelemetryContext, context: Context): Context;
//# sourceMappingURL=context.d.ts.map