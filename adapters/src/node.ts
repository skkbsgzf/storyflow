/**
 * FS 抽象层的 Node 实现。这里的每条方法都直接落到内核现在已在用的 node:* 调用，
 * 不新增行为——R3 迁移的原则是「换管道，不换水性」。
 * 规范：`docs/规范-FS抽象层-FS1.md` §4.1。
 */
import crypto from "node:crypto";
import { execFile, execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import type {
  CopyOptions,
  FsPathLike,
  IFsPath,
  IFileSystem,
  MkdirOptions,
  RemoveOptions,
} from "./fs.js";
import type { IProcessLauncher, ProcOptions, ProcResult } from "./proc.js";
import { ProcExecutionError } from "./proc.js";
import { registerAdapters } from "./defaults.js";
import type { IEnv } from "./env.js";
import type { IHasher } from "./hash.js";

export class NodeFsAdapter implements IFileSystem {
  readText(p: string): string {
    return fs.readFileSync(p, "utf-8");
  }

  readBuffer(p: string): Uint8Array {
    return new Uint8Array(fs.readFileSync(p));
  }

  writeText(p: string, text: string): void {
    fs.writeFileSync(p, text, "utf-8");
  }

  appendText(p: string, text: string): void {
    fs.appendFileSync(p, text, "utf-8");
  }

  /** 与 fsio.atomicWriteText 逐行同构：建父目录 → 写带 pid 的 tmp → rename，被占用时先删目标再 rename。 */
  writeTextAtomic(p: string, text: string): void {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const tmp = p + ".tmp-" + process.pid + "-" + Math.random().toString(36).slice(2, 8);
    fs.writeFileSync(tmp, text, "utf-8");
    try {
      fs.renameSync(tmp, p);
    } catch {
      try {
        fs.rmSync(p, { force: true });
      } catch {
        /* 目标本来就不存在 */
      }
      fs.renameSync(tmp, p);
    }
  }

  exists(p: string): boolean {
    return fs.existsSync(p);
  }

  stat(p: string) {
    if (!fs.existsSync(p)) return undefined;
    const st = fs.statSync(p);
    return { isFile: st.isFile(), isDirectory: st.isDirectory(), size: st.size, mtimeMs: st.mtimeMs };
  }

  readDir(p: string): string[] {
    return fs.readdirSync(p);
  }

  readDirEntries(p: string) {
    return fs
      .readdirSync(p, { withFileTypes: true })
      .map((d) => ({ name: d.name, isFile: d.isFile(), isDirectory: d.isDirectory() }));
  }

  mkdir(p: string, options?: MkdirOptions): void {
    fs.mkdirSync(p, { recursive: options?.recursive ?? false });
  }

  remove(p: string, options?: RemoveOptions): void {
    fs.rmSync(p, { recursive: options?.recursive ?? false, force: options?.force ?? false });
  }

  rename(from: string, to: string): void {
    fs.renameSync(from, to);
  }

  copy(from: string, to: string, options?: CopyOptions): void {
    if (options?.recursive) fs.cpSync(from, to, { recursive: true });
    else fs.copyFileSync(from, to);
  }

  /** persistent:false —— 监听不该拖住进程退出；取消函数幂等。 */
  watchDir(p: string, onChange: (name: string) => void): () => void {
    const watcher = fs.watch(p, { persistent: false });
    watcher.on("change", (_event, filename) => {
      if (filename) onChange(String(filename));
    });
    return () => {
      try {
        watcher.close();
      } catch {
        /* 已关闭 */
      }
    };
  }
}

export class NodePathAdapter implements IFsPath {
  join(...segments: string[]): string {
    return path.join(...segments);
  }

  resolve(...segments: string[]): string {
    return path.resolve(...segments);
  }

  dirname(p: string): string {
    return path.dirname(p);
  }

  basename(p: string, ext?: string): string {
    return ext === undefined ? path.basename(p) : path.basename(p, ext);
  }

  extname(p: string): string {
    return path.extname(p);
  }

  relative(from: string, to: string): string {
    return path.relative(from, to);
  }

  get sep(): string {
    return path.sep;
  }

  posixJoin(...segments: string[]): string {
    return path.posix.join(...segments);
  }

  format(parts: FsPathLike): string {
    return path.format(parts as path.ParsedPath);
  }

  fromFileUrl(url: string): string {
    return fileURLToPath(url);
  }
}

export class NodeProcLauncher implements IProcessLauncher {
  /** env 优先；否则 envDelta = 继承宿主 env + 差量；都没给 = undefined（spawn 的「继承」语义）。 */
  private envOf(options?: ProcOptions): NodeJS.ProcessEnv | undefined {
    if (options?.env) return options.env as NodeJS.ProcessEnv;
    if (options?.envDelta) return { ...process.env, ...options.envDelta } as NodeJS.ProcessEnv;
    return undefined;
  }
  run(cmd: string, args: readonly string[], options?: ProcOptions): ProcResult {
    const r = spawnSync(cmd, [...args], {
      cwd: options?.cwd,
      encoding: "utf-8",
      timeout: options?.timeoutMs,
      maxBuffer: options?.maxBufferBytes,
      env: this.envOf(options),
    });
    return {
      status: r.status,
      stdout: r.stdout ? String(r.stdout) : "",
      stderr: r.stderr ? String(r.stderr) : "",
      error: r.error ? r.error.message : undefined,
    };
  }

  /**
   * 异步形态：与 minitools.ts 原来的 `promisify(execFile)(...)` 逐参同构
   * （windowsHide 是 Windows 控制台细节，固定在适配器里；timeout/killSignal/maxBuffer 照传）。
   * 永不抛——`killed`/`signal` 折进 `timedOut`/`signal`，调用方自己分流「超时被杀」与「退出非零」。
   */
  async runAsync(cmd: string, args: readonly string[], options?: ProcOptions): Promise<ProcResult> {
    const execFileAsync = promisify(execFile);
    try {
      const { stdout, stderr } = await execFileAsync(cmd, [...args], {
        cwd: options?.cwd,
        encoding: "utf-8",
        timeout: options?.timeoutMs,
        maxBuffer: options?.maxBufferBytes,
        killSignal: options?.killSignal as NodeJS.Signals | undefined,
        windowsHide: true,
        env: this.envOf(options),
      });
      return { status: 0, stdout: String(stdout ?? ""), stderr: String(stderr ?? ""), signal: null };
    } catch (e) {
      const err = e as { code?: number | string; killed?: boolean; signal?: string; stdout?: unknown; stderr?: unknown; message?: string };
      const status = typeof err.code === "number" ? err.code : null;
      return {
        status,
        stdout: String(err.stdout ?? ""),
        stderr: String(err.stderr ?? ""),
        error: status === null ? String(err.message ?? e) : undefined,
        signal: err.signal ?? null,
        timedOut: Boolean(err.killed),
      };
    }
  }

  /** 分离启动（不开管道、不等退出）；与 `cli.ts` 原来的 `spawn(...).unref()` 逐参同形。 */
  detach(cmd: string, args: readonly string[]): void {
    spawn(cmd, [...args], { detached: true, stdio: "ignore" }).unref();
  }

  exec(cmd: string, args: readonly string[], options?: ProcOptions): string {
    try {
      return execFileSync(cmd, [...args], {
        cwd: options?.cwd,
        encoding: "utf-8",
        timeout: options?.timeoutMs,
        maxBuffer: options?.maxBufferBytes,
        shell: false,
        env: this.envOf(options),
      }) as string;
    } catch (e) {
      const err = e as { status?: number | null; stderr?: unknown; message?: string };
      throw new ProcExecutionError(
        cmd,
        args,
        err.status ?? null,
        String(err.stderr ?? err.message ?? e).slice(0, 1200),
      );
    }
  }
}

/** 缺省注入用（R3 起函数尾参 `fs: IFileSystem = nodeFs`）。 */
export const nodeFs: IFileSystem = new NodeFsAdapter();
export const nodePath: IFsPath = new NodePathAdapter();
export const nodeProc: IProcessLauncher = new NodeProcLauncher();

/**
 * 本模块是宿主面（R7 拆包后归 `@storyflow/adapters`）：import 它即把 Node 三家登记为平台缺省，
 * core 侧的 `nodeFs`/`nodePath`/`nodeProc`（`abstraction/defaults.ts` 的同名转发）从此落地。
 * 副作用注册是有意的——入口件本就 `import { nodeFs } from ".../adapters/node.js"`，
 * 不必每家再手写一行 registerAdapters；漏 import 的宿主会在第一次用缺省时拿到明确抛错。
 */
/** 环境面：读单变量 + 平台标识（R7-2 入册；整包 env 展开仍属宿主件特权）。 */
export const nodeEnv: IEnv = {
  get: (name) => process.env[name],
  platform: () => process.platform,
};

/** 哈希面：node:crypto sha1（与 ids.ts 旧实现逐字节等价）。 */
export const nodeHash: IHasher = {
  sha1Hex: (text) => crypto.createHash("sha1").update(text, "utf-8").digest("hex"),
};

registerAdapters({ fs: nodeFs, path: nodePath, proc: nodeProc, env: nodeEnv, hash: nodeHash });
