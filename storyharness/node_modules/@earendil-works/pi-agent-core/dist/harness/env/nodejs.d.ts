import type { Context } from "../context.ts";
import { type ExecutionEnv, ExecutionError, FileError, type FileInfo, type Result, type ShellExecOptions, type ShellExecResult, type TextLineReader } from "../types.ts";
export declare class NodeExecutionEnv implements ExecutionEnv {
    cwd: string;
    private shellPath?;
    private shellEnv?;
    private activeChildPids;
    constructor(options: {
        cwd: string;
        shellPath?: string;
        shellEnv?: NodeJS.ProcessEnv;
    });
    absolutePath(path: string, _context: Context): Promise<Result<string, FileError>>;
    joinPath(parts: string[], _context: Context): Promise<Result<string, FileError>>;
    exec(command: string, options: ShellExecOptions | undefined, context: Context): Promise<Result<ShellExecResult, ExecutionError>>;
    openTextLineReader(path: string, context: Context): Promise<Result<TextLineReader, FileError>>;
    readTextFile(path: string, context: Context): Promise<Result<string, FileError>>;
    readTextLines(path: string, options: {
        maxLines?: number;
    } | undefined, context: Context): Promise<Result<string[], FileError>>;
    readBinaryFile(path: string, context: Context): Promise<Result<Uint8Array, FileError>>;
    writeFile(path: string, content: string | Uint8Array, context: Context): Promise<Result<void, FileError>>;
    appendFile(path: string, content: string | Uint8Array, context: Context): Promise<Result<void, FileError>>;
    renameFile(sourcePath: string, destinationPath: string, context: Context): Promise<Result<void, FileError>>;
    fileInfo(path: string, context: Context): Promise<Result<FileInfo, FileError>>;
    listDir(path: string, context: Context): Promise<Result<FileInfo[], FileError>>;
    canonicalPath(path: string, context: Context): Promise<Result<string, FileError>>;
    exists(path: string, context: Context): Promise<Result<boolean, FileError>>;
    createDir(path: string, options: {
        recursive?: boolean;
    } | undefined, context: Context): Promise<Result<void, FileError>>;
    remove(path: string, options: {
        recursive?: boolean;
        force?: boolean;
    } | undefined, context: Context): Promise<Result<void, FileError>>;
    createTempDir(prefix: string | undefined, context: Context): Promise<Result<string, FileError>>;
    createTempFile(options: {
        prefix?: string;
        suffix?: string;
    } | undefined, context: Context): Promise<Result<string, FileError>>;
    cleanup(_context: Context): Promise<void>;
}
//# sourceMappingURL=nodejs.d.ts.map