import type { Context } from "../../context.ts";
import type { FileError, FileSystem, Result, TextLineReader } from "../../types.ts";
import type { CommittedWrite } from "../commit.ts";
import { type JsonlParsedSessionHeader } from "./codec.ts";
import type { JsonlStorageHeader } from "./types.ts";
export declare function fileValue<T>(result: Result<T, FileError>, action: string): T;
export declare function readJsonlHeader(reader: TextLineReader, path: string, context: Context): Promise<JsonlParsedSessionHeader>;
export declare function parseJsonlTransaction(line: string): CommittedWrite[];
export declare function serializeJsonlTransaction(writes: readonly CommittedWrite[]): string;
/** Publish only after the callback succeeds; it must await each append before returning. */
export declare function publishFileAtomically(fileSystem: FileSystem, destinationPath: string, context: Context, writeContent: (append: (content: string) => Promise<void>) => Promise<void>): Promise<void>;
/** Stream a header and complete transactions through the shared atomic publisher. */
export declare function publishJsonl(fileSystem: FileSystem, destinationPath: string, header: JsonlStorageHeader, context: Context, writeTransactions: (append: (writes: readonly CommittedWrite[]) => Promise<void>) => Promise<void>): Promise<void>;
//# sourceMappingURL=io.d.ts.map