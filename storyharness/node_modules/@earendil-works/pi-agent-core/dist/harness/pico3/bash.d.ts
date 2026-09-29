import { Type } from "typebox";
import type { ToolDeclaration } from "./types.ts";
declare const parameters: Type.TObject<{
    command: Type.TString;
    cwd: Type.TOptional<Type.TString>;
}>;
/** Run a shell command. Output is piped to the kernel; bounds come from `output`. */
export declare function bashTool(output?: ToolDeclaration["output"]): ToolDeclaration<typeof parameters>;
export {};
//# sourceMappingURL=bash.d.ts.map