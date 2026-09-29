import { type JsonValue, type Kind } from "../types.ts";
export type PluginInput = {
    handler: string;
    input: JsonValue;
};
type PluginCheckpoint = {
    phase: "started";
};
type PluginFailure = {
    reason: "missing_handler" | "threw";
    detail: string;
};
export declare const plugin: Readonly<Kind<PluginInput, PluginCheckpoint, import("@earendil-works/chord").JsonValue, PluginFailure, null, object, import("../types.ts").KindConfig<import("../types.ts").ConfigShape, import("../types.ts").ConfigShape>, import("../types.ts").JsonObject, import("../types.ts").TaskTx>>;
export {};
//# sourceMappingURL=plugin.d.ts.map