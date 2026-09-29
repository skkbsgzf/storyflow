import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants, createWriteStream } from "node:fs";
import { access, appendFile, lstat, mkdir, mkdtemp, open as openFile, readdir, readFile, realpath, rename, rm, writeFile, } from "node:fs/promises";
import { homedir, constants as osConstants, tmpdir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ExecutionError, err, FileError, ok, toError, } from "../types.js";
import { OutputCapture } from "../utils/output-capture.js";
const MAX_TIMEOUT_MS = 2_147_483_647;
const MAX_TIMEOUT_SECONDS = MAX_TIMEOUT_MS / 1000;
const EXIT_STDIO_GRACE_MS = 100;
const SPILL_HIGH_WATER_MARK = 8 * 1024 * 1024;
function resolveTimeoutMs(timeout) {
    if (timeout === undefined)
        return ok(undefined);
    if (!Number.isFinite(timeout) || timeout <= 0) {
        return err(new ExecutionError("timeout", "Invalid timeout: must be a finite number of seconds"));
    }
    const timeoutMs = timeout * 1000;
    if (timeoutMs > MAX_TIMEOUT_MS) {
        return err(new ExecutionError("timeout", `Invalid timeout: maximum is ${MAX_TIMEOUT_SECONDS} seconds`));
    }
    return ok(timeoutMs);
}
function resolvePath(cwd, path) {
    let normalized = path;
    if (normalized === "~") {
        normalized = homedir();
    }
    else if (normalized.startsWith("~/") || (process.platform === "win32" && normalized.startsWith("~\\"))) {
        normalized = join(homedir(), normalized.slice(2));
    }
    else if (normalized.startsWith("file://")) {
        try {
            normalized = fileURLToPath(normalized);
        }
        catch {
            // Keep malformed URLs as ordinary paths so filesystem methods preserve their non-throwing contract.
        }
    }
    return isAbsolute(normalized) ? resolve(normalized) : resolve(cwd, normalized);
}
function fileKindFromStats(stats) {
    if (stats.isFile())
        return "file";
    if (stats.isDirectory())
        return "directory";
    if (stats.isSymbolicLink())
        return "symlink";
    return undefined;
}
function fileInfoFromStats(path, stats) {
    const kind = fileKindFromStats(stats);
    if (!kind)
        return err(new FileError("invalid", "Unsupported file type", path));
    return ok({
        name: basename(path),
        path,
        kind,
        size: stats.size,
        mtimeMs: stats.mtimeMs,
    });
}
function isNodeError(error) {
    return error instanceof Error && "code" in error;
}
function toFileError(error, fallbackPath) {
    if (error instanceof FileError)
        return error;
    const cause = toError(error);
    const nodeError = isNodeError(error) ? error : undefined;
    const path = typeof nodeError?.path === "string" ? nodeError.path : fallbackPath;
    if (nodeError) {
        const message = nodeError.message;
        switch (nodeError.code) {
            case "ABORT_ERR":
                return new FileError("aborted", message, path, cause);
            case "ENOENT":
                return new FileError("not_found", message, path, cause);
            case "EACCES":
            case "EPERM":
                return new FileError("permission_denied", message, path, cause);
            case "ENOTDIR":
                return new FileError("not_directory", message, path, cause);
            case "EISDIR":
                return new FileError("is_directory", message, path, cause);
            case "EINVAL":
                return new FileError("invalid", message, path, cause);
        }
    }
    return new FileError("unknown", cause.message, path, cause);
}
function abortResult(signal, path) {
    return signal?.aborted ? err(new FileError("aborted", "aborted", path)) : undefined;
}
async function pathExists(path) {
    try {
        await access(path, constants.F_OK);
        return true;
    }
    catch {
        return false;
    }
}
async function runCommand(command, args, timeoutMs) {
    return await new Promise((resolve) => {
        let stdout = "";
        let child;
        try {
            child = spawn(command, args, {
                stdio: ["ignore", "pipe", "ignore"],
                windowsHide: true,
            });
        }
        catch {
            resolve({ stdout: "", status: null });
            return;
        }
        const timeout = setTimeout(() => {
            if (child.pid)
                killProcessTree(child.pid);
        }, timeoutMs);
        child.stdout?.setEncoding("utf8");
        child.stdout?.on("data", (chunk) => {
            stdout += chunk;
        });
        child.on("error", () => {
            clearTimeout(timeout);
            resolve({ stdout: "", status: null });
        });
        child.on("close", (status) => {
            clearTimeout(timeout);
            resolve({ stdout, status });
        });
    });
}
async function findBashOnPath() {
    const result = process.platform === "win32"
        ? await runCommand("where", ["bash.exe"], 5000)
        : await runCommand("which", ["bash"], 5000);
    if (result.status !== 0 || !result.stdout)
        return null;
    const firstMatch = result.stdout.trim().split(/\r?\n/)[0];
    return firstMatch && (await pathExists(firstMatch)) ? firstMatch : null;
}
function isLegacyWslBashPath(path) {
    const normalized = path.replace(/\//g, "\\").toLowerCase();
    return /^[a-z]:\\windows\\(?:system32|sysnative)\\bash\.exe$/.test(normalized);
}
function getBashShellConfig(shell) {
    return isLegacyWslBashPath(shell) ? { shell, args: ["-s"], commandTransport: "stdin" } : { shell, args: ["-c"] };
}
async function getShellConfig(customShellPath) {
    if (customShellPath) {
        if (await pathExists(customShellPath)) {
            return ok(getBashShellConfig(customShellPath));
        }
        return err(new ExecutionError("shell_unavailable", `Custom shell path not found: ${customShellPath}`));
    }
    if (process.platform === "win32") {
        const candidates = [];
        const programFiles = process.env.ProgramFiles;
        if (programFiles)
            candidates.push(`${programFiles}\\Git\\bin\\bash.exe`);
        const programFilesX86 = process.env["ProgramFiles(x86)"];
        if (programFilesX86)
            candidates.push(`${programFilesX86}\\Git\\bin\\bash.exe`);
        for (const candidate of candidates) {
            if (await pathExists(candidate)) {
                return ok(getBashShellConfig(candidate));
            }
        }
        const bashOnPath = await findBashOnPath();
        if (bashOnPath) {
            return ok(getBashShellConfig(bashOnPath));
        }
        return err(new ExecutionError("shell_unavailable", `No bash shell found. Options:\n` +
            `  1. Install Git for Windows: https://git-scm.com/download/win\n` +
            `  2. Add your bash to PATH (Cygwin, MSYS2, etc.)\n` +
            "  3. Configure an explicit shellPath\n\n" +
            `Searched Git Bash in:\n${candidates.map((path) => `  ${path}`).join("\n")}`));
    }
    if (await pathExists("/bin/bash")) {
        return ok(getBashShellConfig("/bin/bash"));
    }
    const bashOnPath = await findBashOnPath();
    if (bashOnPath) {
        return ok(getBashShellConfig(bashOnPath));
    }
    return ok({ shell: "sh", args: ["-c"] });
}
function getShellEnv(baseEnv, extraEnv, inheritEnv = true) {
    if (!inheritEnv)
        return { ...extraEnv };
    return {
        ...process.env,
        ...baseEnv,
        ...extraEnv,
    };
}
function killProcessTree(pid) {
    if (process.platform === "win32") {
        try {
            const child = spawn(join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe"), ["/F", "/T", "/PID", String(pid)], {
                stdio: "ignore",
                detached: true,
                windowsHide: true,
            });
            // A failed spawn emits "error" asynchronously; consume it to avoid crashing Node.
            child.once("error", () => { });
        }
        catch {
            // Ignore errors.
        }
        return;
    }
    try {
        process.kill(-pid, "SIGKILL");
    }
    catch {
        try {
            process.kill(pid, "SIGKILL");
        }
        catch {
            // Process already dead.
        }
    }
}
function waitForChildProcess(child, spillIsDraining) {
    return new Promise((resolvePromise, reject) => {
        let settled = false;
        let exited = false;
        let exitCode = null;
        let exitSignal = null;
        let postExitTimer;
        let stdoutEnded = child.stdout === null;
        let stderrEnded = child.stderr === null;
        const cleanup = () => {
            if (postExitTimer)
                clearTimeout(postExitTimer);
            child.removeListener("error", onError);
            child.removeListener("exit", onExit);
            child.removeListener("close", onClose);
            child.stdout?.removeListener("end", onStdoutEnd);
            child.stderr?.removeListener("end", onStderrEnd);
            child.stdout?.removeListener("data", onData);
            child.stderr?.removeListener("data", onData);
        };
        const finalize = () => {
            if (settled)
                return;
            settled = true;
            cleanup();
            child.stdout?.destroy();
            child.stderr?.destroy();
            resolvePromise({ code: exitCode, signal: exitSignal });
        };
        const maybeFinalizeAfterExit = () => {
            if (exited && stdoutEnded && stderrEnded)
                finalize();
        };
        const armIdleTimer = () => {
            if (postExitTimer)
                clearTimeout(postExitTimer);
            postExitTimer = setTimeout(() => {
                if (spillIsDraining())
                    armIdleTimer();
                else
                    finalize();
            }, EXIT_STDIO_GRACE_MS);
        };
        const onData = () => {
            if (exited && !settled)
                armIdleTimer();
        };
        const onStdoutEnd = () => {
            stdoutEnded = true;
            maybeFinalizeAfterExit();
        };
        const onStderrEnd = () => {
            stderrEnded = true;
            maybeFinalizeAfterExit();
        };
        const onError = (error) => {
            if (settled)
                return;
            settled = true;
            cleanup();
            reject(error);
        };
        const onExit = (code, signal) => {
            exited = true;
            exitCode = code;
            exitSignal = signal;
            maybeFinalizeAfterExit();
            if (!settled)
                armIdleTimer();
        };
        const onClose = (code, signal) => {
            exitCode = code;
            exitSignal = signal;
            finalize();
        };
        child.stdout?.once("end", onStdoutEnd);
        child.stderr?.once("end", onStderrEnd);
        child.stdout?.on("data", onData);
        child.stderr?.on("data", onData);
        child.once("error", onError);
        child.once("exit", onExit);
        child.once("close", onClose);
    });
}
/** Strict LF reader; Node readline does not report whether its final line was newline-terminated. */
class NodeTextLineReader {
    file;
    path;
    decoder = new TextDecoder();
    chunk = new Uint8Array(64 * 1024);
    byteOffset = 0;
    buffered = "";
    ended = false;
    closed = false;
    constructor(file, path) {
        this.file = file;
        this.path = path;
    }
    async readLine(context) {
        const aborted = abortResult(context.abortSignal, this.path);
        if (aborted)
            return aborted;
        if (this.closed)
            return err(new FileError("invalid", "Text line reader is closed", this.path));
        try {
            while (true) {
                const newline = this.buffered.indexOf("\n");
                if (newline !== -1) {
                    const text = this.buffered.slice(0, newline);
                    this.buffered = this.buffered.slice(newline + 1);
                    return ok({ text, terminated: true });
                }
                if (this.ended) {
                    if (this.buffered.length === 0)
                        return ok(undefined);
                    const text = this.buffered;
                    this.buffered = "";
                    return ok({ text, terminated: false });
                }
                // Explicit positions allow an aborted read to be retried without skipping bytes.
                const { bytesRead } = await this.file.read(this.chunk, 0, this.chunk.length, this.byteOffset);
                const afterReadAbort = abortResult(context.abortSignal, this.path);
                if (afterReadAbort)
                    return afterReadAbort;
                this.byteOffset += bytesRead;
                if (bytesRead === 0) {
                    this.buffered += this.decoder.decode();
                    this.ended = true;
                }
                else {
                    this.buffered += this.decoder.decode(this.chunk.subarray(0, bytesRead), { stream: true });
                }
            }
        }
        catch (error) {
            return err(toFileError(error, this.path));
        }
    }
    async close(_context) {
        if (this.closed)
            return;
        this.closed = true;
        this.buffered = "";
        try {
            await this.file.close();
        }
        catch {
            // Closing is best-effort, including after cancellation or an earlier I/O failure.
        }
    }
}
export class NodeExecutionEnv {
    cwd;
    shellPath;
    shellEnv;
    activeChildPids = new Set();
    constructor(options) {
        this.cwd = options.cwd;
        this.shellPath = options.shellPath;
        this.shellEnv = options.shellEnv;
    }
    async absolutePath(path, _context) {
        return ok(resolvePath(this.cwd, path));
    }
    async joinPath(parts, _context) {
        return ok(join(...parts));
    }
    async exec(command, options, context) {
        const signal = context.abortSignal;
        if (signal?.aborted)
            return err(new ExecutionError("aborted", "aborted"));
        const timeoutMsResult = resolveTimeoutMs(options?.timeout);
        if (!timeoutMsResult.ok)
            return err(timeoutMsResult.error);
        const timeoutMs = timeoutMsResult.value;
        const cwd = options?.cwd ? resolvePath(this.cwd, options.cwd) : this.cwd;
        const shellConfig = await getShellConfig(this.shellPath);
        if (!shellConfig.ok)
            return shellConfig;
        try {
            await access(cwd, constants.F_OK);
        }
        catch (error) {
            const cause = toError(error);
            return err(new ExecutionError("spawn_error", `Working directory does not exist: ${cwd}\nCannot execute bash commands.`, cause));
        }
        return await new Promise((resolvePromise) => {
            let settled = false;
            let timedOut = false;
            let callbackError;
            let spillError;
            let child;
            let timeoutId;
            const spillPrefix = [];
            let spillPath;
            const spillQueue = [];
            let spillStart;
            let spillStream;
            let spillBackpressured = false;
            const onAbort = () => {
                if (child?.pid)
                    killProcessTree(child.pid);
            };
            const failCallback = (error) => {
                if (callbackError !== undefined)
                    return;
                const cause = toError(error);
                callbackError = new ExecutionError("callback_error", cause.message, cause);
                onAbort();
            };
            let capture;
            try {
                capture = new OutputCapture(options?.capture, context, {
                    onUpdate: options?.onUpdate,
                    onError: failCallback,
                });
            }
            catch (error) {
                const cause = toError(error);
                resolvePromise(err(new ExecutionError("unknown", cause.message, cause)));
                return;
            }
            const settle = (result) => {
                if (settled)
                    return;
                settled = true;
                if (timeoutId)
                    clearTimeout(timeoutId);
                if (signal)
                    signal.removeEventListener("abort", onAbort);
                if (child?.pid)
                    this.activeChildPids.delete(child.pid);
                capture.dispose();
                resolvePromise(result);
            };
            const pauseOutput = () => {
                child?.stdout?.pause();
                child?.stderr?.pause();
            };
            const resumeOutput = () => {
                if (callbackError || spillError || timedOut || signal?.aborted || spillBackpressured)
                    return;
                child?.stdout?.resume();
                child?.stderr?.resume();
            };
            const failSpill = (error) => {
                if (spillError !== undefined)
                    return;
                const cause = toError(error);
                spillError = new ExecutionError("unknown", `Failed to preserve complete shell output: ${cause.message}`, cause);
                spillBackpressured = false;
                onAbort();
            };
            const writeSpill = (chunk) => {
                if (spillStream === undefined || chunk.length === 0)
                    return;
                if (spillStream.write(chunk) || spillBackpressured)
                    return;
                spillBackpressured = true;
                pauseOutput();
                spillStream.once("drain", () => {
                    spillBackpressured = false;
                    resumeOutput();
                });
            };
            const startSpill = (chunk) => {
                if (spillStream !== undefined) {
                    writeSpill(chunk);
                    return;
                }
                spillQueue.push(chunk);
                if (spillStart !== undefined)
                    return;
                pauseOutput();
                spillStart = (async () => {
                    const created = await this.createTempFile({ prefix: "pi-output-", suffix: ".log" }, context);
                    if (!created.ok)
                        throw created.error;
                    spillPath = created.value;
                    capture.setSpillPath(spillPath);
                    spillStream = createWriteStream(spillPath, { flags: "a", highWaterMark: SPILL_HIGH_WATER_MARK });
                    spillStream.on("error", failSpill);
                    for (const queued of spillQueue)
                        writeSpill(queued);
                    spillQueue.length = 0;
                })()
                    .catch(failSpill)
                    .finally(resumeOutput);
            };
            const finishSpill = async () => {
                await spillStart;
                const stream = spillStream;
                if (stream === undefined || spillError !== undefined || stream.destroyed)
                    return;
                await new Promise((resolveFinish) => {
                    stream.once("error", () => resolveFinish());
                    stream.once("finish", resolveFinish);
                    stream.end();
                });
            };
            try {
                const commandFromStdin = shellConfig.value.commandTransport === "stdin";
                child = spawn(shellConfig.value.shell, commandFromStdin ? shellConfig.value.args : [...shellConfig.value.args, command], {
                    cwd,
                    detached: process.platform !== "win32",
                    env: getShellEnv(this.shellEnv, options?.env, options?.inheritEnv),
                    stdio: [commandFromStdin ? "pipe" : "ignore", "pipe", "pipe"],
                    windowsHide: true,
                });
                if (child.pid)
                    this.activeChildPids.add(child.pid);
                if (commandFromStdin) {
                    child.stdin?.on("error", () => { });
                    child.stdin?.end(command);
                }
            }
            catch (error) {
                const cause = toError(error);
                settle(err(new ExecutionError("spawn_error", cause.message, cause)));
                return;
            }
            timeoutId =
                timeoutMs === undefined
                    ? undefined
                    : setTimeout(() => {
                        timedOut = true;
                        onAbort();
                    }, timeoutMs);
            if (signal) {
                if (signal.aborted)
                    onAbort();
                else
                    signal.addEventListener("abort", onAbort, { once: true });
            }
            const feed = (chunk) => {
                try {
                    const wasTruncated = capture.truncated;
                    capture.push(chunk);
                    if (!options?.capture?.spill || chunk.length === 0)
                        return;
                    if (spillPath !== undefined || wasTruncated) {
                        startSpill(chunk);
                    }
                    else if (capture.truncated) {
                        for (const prefix of spillPrefix)
                            startSpill(prefix);
                        spillPrefix.length = 0;
                        startSpill(chunk);
                    }
                    else {
                        spillPrefix.push(chunk);
                    }
                }
                catch (error) {
                    failCallback(error);
                }
            };
            child.stdout?.on("data", feed);
            child.stderr?.on("data", feed);
            void waitForChildProcess(child, () => spillError === undefined &&
                spillStart !== undefined &&
                (spillStream === undefined || spillBackpressured)).then(async ({ code, signal: exitSignal }) => {
                await finishSpill();
                try {
                    capture.finish();
                    capture.flush();
                }
                catch (error) {
                    failCallback(error);
                }
                if (callbackError) {
                    settle(err(callbackError));
                    return;
                }
                if (timedOut) {
                    settle(err(new ExecutionError("timeout", `timeout:${options?.timeout}`)));
                    return;
                }
                if (signal?.aborted) {
                    settle(err(new ExecutionError("aborted", "aborted")));
                    return;
                }
                if (spillError) {
                    settle(err(spillError));
                    return;
                }
                const output = capture.snapshot();
                // A process killed by a signal (e.g. OOM killer) has no exit code; map it
                // to the conventional 128 + signal number so callers do not mistake it
                // for a successful exit.
                const exitCode = code ?? (exitSignal ? 128 + (osConstants.signals[exitSignal] ?? 0) : 1);
                settle(ok({
                    exitCode,
                    truncation: output.truncation,
                    ...(output.spillPath === undefined ? {} : { spillPath: output.spillPath }),
                    ...(output.lastLineBytes === undefined ? {} : { lastLineBytes: output.lastLineBytes }),
                }));
            }, (error) => settle(err(new ExecutionError("spawn_error", error.message, error))));
        });
    }
    async openTextLineReader(path, context) {
        const resolved = resolvePath(this.cwd, path);
        const aborted = abortResult(context.abortSignal, resolved);
        if (aborted)
            return aborted;
        try {
            const file = await openFile(resolved, "r");
            const afterOpenAbort = abortResult(context.abortSignal, resolved);
            if (afterOpenAbort) {
                await file.close().catch(() => undefined);
                return afterOpenAbort;
            }
            return ok(new NodeTextLineReader(file, resolved));
        }
        catch (error) {
            return err(toFileError(error, resolved));
        }
    }
    async readTextFile(path, context) {
        const resolved = resolvePath(this.cwd, path);
        const signal = context.abortSignal;
        const aborted = abortResult(signal, resolved);
        if (aborted)
            return aborted;
        try {
            return ok(await readFile(resolved, { encoding: "utf8", signal }));
        }
        catch (error) {
            return err(toFileError(error, resolved));
        }
    }
    async readTextLines(path, options, context) {
        if (options?.maxLines !== undefined && options.maxLines <= 0)
            return ok([]);
        const opened = await this.openTextLineReader(path, context);
        if (!opened.ok)
            return opened;
        const lines = [];
        try {
            while (options?.maxLines === undefined || lines.length < options.maxLines) {
                const line = await opened.value.readLine(context);
                if (!line.ok)
                    return line;
                if (line.value === undefined)
                    break;
                lines.push(line.value.text);
            }
            return ok(lines);
        }
        finally {
            await opened.value.close(context);
        }
    }
    async readBinaryFile(path, context) {
        const resolved = resolvePath(this.cwd, path);
        const signal = context.abortSignal;
        const aborted = abortResult(signal, resolved);
        if (aborted)
            return aborted;
        try {
            return ok(await readFile(resolved, { signal }));
        }
        catch (error) {
            return err(toFileError(error, resolved));
        }
    }
    async writeFile(path, content, context) {
        const resolved = resolvePath(this.cwd, path);
        const signal = context.abortSignal;
        const aborted = abortResult(signal, resolved);
        if (aborted)
            return aborted;
        try {
            await mkdir(resolve(resolved, ".."), { recursive: true });
            const afterMkdirAbort = abortResult(signal, resolved);
            if (afterMkdirAbort)
                return afterMkdirAbort;
            await writeFile(resolved, content, { signal });
            return ok(undefined);
        }
        catch (error) {
            return err(toFileError(error, resolved));
        }
    }
    async appendFile(path, content, context) {
        const resolved = resolvePath(this.cwd, path);
        const signal = context.abortSignal;
        const aborted = abortResult(signal, resolved);
        if (aborted)
            return aborted;
        try {
            await mkdir(resolve(resolved, ".."), { recursive: true });
            const afterMkdirAbort = abortResult(signal, resolved);
            if (afterMkdirAbort)
                return afterMkdirAbort;
            await appendFile(resolved, content);
            const afterAppendAbort = abortResult(signal, resolved);
            return afterAppendAbort ?? ok(undefined);
        }
        catch (error) {
            return err(toFileError(error, resolved));
        }
    }
    async renameFile(sourcePath, destinationPath, context) {
        const source = resolvePath(this.cwd, sourcePath);
        const destination = resolvePath(this.cwd, destinationPath);
        const aborted = abortResult(context.abortSignal, destination);
        if (aborted)
            return aborted;
        try {
            await rename(source, destination);
            return ok(undefined);
        }
        catch (error) {
            return err(toFileError(error, source));
        }
    }
    async fileInfo(path, context) {
        const resolved = resolvePath(this.cwd, path);
        const aborted = abortResult(context.abortSignal, resolved);
        if (aborted)
            return aborted;
        try {
            return fileInfoFromStats(resolved, await lstat(resolved));
        }
        catch (error) {
            return err(toFileError(error, resolved));
        }
    }
    async listDir(path, context) {
        const resolved = resolvePath(this.cwd, path);
        const signal = context.abortSignal;
        const aborted = abortResult(signal, resolved);
        if (aborted)
            return aborted;
        try {
            const entries = await readdir(resolved, { withFileTypes: true });
            const infos = [];
            for (const entry of entries) {
                const loopAbort = abortResult(signal, resolved);
                if (loopAbort)
                    return loopAbort;
                const entryPath = resolve(resolved, entry.name);
                try {
                    const info = fileInfoFromStats(entryPath, await lstat(entryPath));
                    if (info.ok)
                        infos.push(info.value);
                }
                catch (error) {
                    return err(toFileError(error, entryPath));
                }
            }
            return ok(infos);
        }
        catch (error) {
            return err(toFileError(error, resolved));
        }
    }
    async canonicalPath(path, context) {
        const resolved = resolvePath(this.cwd, path);
        const aborted = abortResult(context.abortSignal, resolved);
        if (aborted)
            return aborted;
        try {
            return ok(await realpath(resolved));
        }
        catch (error) {
            return err(toFileError(error, resolved));
        }
    }
    async exists(path, context) {
        const result = await this.fileInfo(path, context);
        if (result.ok)
            return ok(true);
        if (result.error.code === "not_found")
            return ok(false);
        return err(result.error);
    }
    async createDir(path, options, context) {
        const resolved = resolvePath(this.cwd, path);
        const aborted = abortResult(context.abortSignal, resolved);
        if (aborted)
            return aborted;
        try {
            await mkdir(resolved, { recursive: options?.recursive ?? true });
            return ok(undefined);
        }
        catch (error) {
            return err(toFileError(error, resolved));
        }
    }
    async remove(path, options, context) {
        const resolved = resolvePath(this.cwd, path);
        const aborted = abortResult(context.abortSignal, resolved);
        if (aborted)
            return aborted;
        try {
            await rm(resolved, { recursive: options?.recursive ?? false, force: options?.force ?? false });
            return ok(undefined);
        }
        catch (error) {
            return err(toFileError(error, resolved));
        }
    }
    async createTempDir(prefix, context) {
        const aborted = abortResult(context.abortSignal);
        if (aborted)
            return aborted;
        try {
            prefix ??= "tmp-";
            return ok(await mkdtemp(join(tmpdir(), prefix)));
        }
        catch (error) {
            return err(toFileError(error));
        }
    }
    async createTempFile(options, context) {
        const dir = await this.createTempDir("tmp-", context);
        if (!dir.ok)
            return dir;
        const filePath = join(dir.value, `${options?.prefix ?? ""}${randomUUID()}${options?.suffix ?? ""}`);
        try {
            await writeFile(filePath, "");
            return ok(filePath);
        }
        catch (error) {
            return err(toFileError(error, filePath));
        }
    }
    async cleanup(_context) {
        for (const pid of this.activeChildPids)
            killProcessTree(pid);
        this.activeChildPids.clear();
    }
}
//# sourceMappingURL=nodejs.js.map