import type { Context } from "@earendil-works/chord";
import { type CoreKind, type HookInfo, type Id } from "../types.ts";
export type PostToolsInput = {
    inputs: Id[];
    assistant: Id;
    tools: Id[];
};
export type PostToolsResult = {
    successor?: Id;
    ended?: "terminate" | "handoff";
};
export interface PostToolsHooks {
    afterTools(assistant: Id, results: Id[], info: HookInfo, ctx: Context): void | Promise<void>;
}
export declare const postToolsConfig: {
    readonly sticky: {
        readonly steeringMode: "all" | "one-at-a-time";
        readonly followUpMode: "all" | "one-at-a-time";
    };
};
export declare const postTools: CoreKind<PostToolsInput, never, PostToolsResult, never, null, PostToolsHooks, typeof postToolsConfig>;
//# sourceMappingURL=post-tools.d.ts.map