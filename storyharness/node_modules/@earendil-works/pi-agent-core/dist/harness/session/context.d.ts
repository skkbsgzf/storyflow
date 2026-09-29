import type { AgentMessage } from "../../types.ts";
import type { Context } from "../context.ts";
import type { Entry, EntryProjector } from "./types.ts";
export interface SessionContextBuildOptions {
    entryProjectors?: Readonly<Record<string, EntryProjector>>;
}
export declare function buildContextEntries(pathEntries: readonly Entry[]): Entry[];
export declare function sessionEntryToContextMessages(entry: Entry): AgentMessage[];
export declare function buildSessionContext(pathEntries: readonly Entry[], options: SessionContextBuildOptions | undefined, context: Context): Promise<AgentMessage[]>;
//# sourceMappingURL=context.d.ts.map