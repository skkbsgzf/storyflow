import { type Static, Type } from "typebox";
import type { Context } from "../context.ts";
import type { AgentHarnessTool, ShellOutputTruncation } from "../types.ts";
import type { ExecutionToolContext } from "./tool-context.ts";
declare const bashSchema: Type.TObject<{
    command: Type.TString;
    timeout: Type.TOptional<Type.TNumber>;
}>;
export type BashToolInput = Static<typeof bashSchema>;
export interface BashToolDetails {
    truncation?: ShellOutputTruncation;
    fullOutputPath?: string;
}
export interface BashExecution {
    command: string;
    cwd: string;
    env: Record<string, string>;
    inheritEnv: boolean;
}
export type BashPrepare<TContext extends ExecutionToolContext = ExecutionToolContext> = (execution: BashExecution, toolContext: TContext, context: Context) => void | Promise<void>;
export interface BashToolOptions<TContext extends ExecutionToolContext = ExecutionToolContext> {
    commandPrefix?: string;
    prepare?: BashPrepare<TContext>;
}
export declare function createBashTool<TContext extends ExecutionToolContext = ExecutionToolContext>(options?: BashToolOptions<TContext>): AgentHarnessTool<TContext, typeof bashSchema, BashToolDetails | undefined>;
export {};
//# sourceMappingURL=bash.d.ts.map