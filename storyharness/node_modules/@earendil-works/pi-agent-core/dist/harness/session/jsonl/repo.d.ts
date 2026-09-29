import type { Context } from "../../context.ts";
import type { ForkOptions, Session, SessionRepo } from "../types.ts";
import { type JsonlSessionCreateOptions, type JsonlSessionListOptions, type JsonlSessionMetadata, type JsonlSessionRepoOptions } from "./types.ts";
/** File-backed format-4 session repository lifecycle. */
export declare class JsonlSessionRepo implements SessionRepo<JsonlSessionMetadata, JsonlSessionCreateOptions, JsonlSessionListOptions> {
    private readonly fileSystem;
    private readonly sessionsRootInput;
    private readonly now;
    private readonly openSessions;
    private readonly pendingCreates;
    private closed;
    private closePromise;
    constructor(options: JsonlSessionRepoOptions);
    create(options: JsonlSessionCreateOptions, context: Context): Promise<Session<JsonlSessionMetadata>>;
    open(metadata: JsonlSessionMetadata, context: Context): Promise<Session<JsonlSessionMetadata>>;
    list(options: JsonlSessionListOptions | undefined, context: Context): Promise<JsonlSessionMetadata[]>;
    delete(metadata: JsonlSessionMetadata, context: Context): Promise<void>;
    fork(source: JsonlSessionMetadata, options: ForkOptions, context: Context): Promise<Session<JsonlSessionMetadata>>;
    close(_context: Context): Promise<void>;
    private resolveCreateDestination;
    private listDirectory;
    private readSessionMetadata;
    private sessionDirectories;
    private sessionDirectory;
    private resolveNewSessionPath;
    private assertSessionIdAvailable;
    private resolveForkInput;
    private isLegacyV3ForkSource;
    private publishOpenSession;
    private sessionKey;
    private loadStorage;
    private root;
    private assertOpen;
}
//# sourceMappingURL=repo.d.ts.map