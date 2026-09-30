/**
 * FS 抽象层的内存实现。用途有二：R3 的「可嵌入」冒烟（内核跑在假盘上），以及抽象层自身的
 * 契约自测——它的错误语义刻意对齐 node（ENOENT / EEXIST / ENOTDIR），因为 aesthetic.ts 会按
 * code 分流，mock 若不带 code 就等于换了行为。
 * 规范：`docs/规范-FS抽象层-FS1.md` §4.2。
 */
import type {
  CopyOptions,
  FsEntry,
  FsPathLike,
  FsStats,
  IFsPath,
  IFileSystem,
  MkdirOptions,
  RemoveOptions,
} from "../fs.js";
import type { IProcessLauncher, ProcOptions, ProcResult } from "../proc.js";
import { ProcExecutionError } from "../proc.js";

type Code = "ENOENT" | "EEXIST" | "ENOTDIR" | "EISDIR" | "ENOTEMPTY";

function fail(code: Code, path: string): never {
  const err = new Error(`${code}: ${code === "ENOENT" ? "no such file or directory" : "operation failed"}: ${path}`) as Error & {
    code: string;
  };
  err.code = code;
  throw err;
}

interface MockFile {
  kind: "file";
  text?: string;
  buffer?: Uint8Array;
  mtimeMs: number;
}

interface MockDir {
  kind: "dir";
  mtimeMs: number;
}

type MockNode = MockFile | MockDir;

/** 内存盘：路径以 "/" 分隔，根为 "/"。所有写入即生效，无缓冲。 */
export class MockFsAdapter implements IFileSystem {
  private nodes = new Map<string, MockNode>();
  private listeners = new Map<string, Set<(name: string) => void>>();
  private clock = 1_700_000_000_000;

  constructor(root = "/work") {
    this.mkdirSyncInternal(root, true);
  }

  /** 播种文件表（键为绝对路径），测试与冒烟用。 */
  seed(files: Record<string, string>): this {
    for (const [p, text] of Object.entries(files)) {
      this.mkdirSyncInternal(this.path.dirname(p), true);
      this.nodes.set(this.path.normalizeKey(p), { kind: "file", text, mtimeMs: this.tick() });
      this.notify(p);
    }
    return this;
  }

  /** 当前全部文件路径（排序稳定，便于断言）。 */
  listFiles(): string[] {
    return [...this.nodes.entries()]
      .filter(([, n]) => n.kind === "file")
      .map(([p]) => p)
      .sort();
  }

  readText(p: string): string {
    const node = this.nodes.get(this.path.normalizeKey(p));
    if (!node) fail("ENOENT", p);
    if (node.kind === "dir") fail("EISDIR", p);
    return node.text ?? new TextDecoder().decode(node.buffer ?? new Uint8Array());
  }

  readBuffer(p: string): Uint8Array {
    const node = this.nodes.get(this.path.normalizeKey(p));
    if (!node) fail("ENOENT", p);
    if (node.kind === "dir") fail("EISDIR", p);
    if (node.buffer) return node.buffer;
    return new TextEncoder().encode(node.text ?? "");
  }

  writeText(p: string, text: string): void {
    const key = this.path.normalizeKey(p);
    this.requireParentDir(key);
    const existing = this.nodes.get(key);
    if (existing?.kind === "dir") fail("EISDIR", p);
    this.nodes.set(key, { kind: "file", text, mtimeMs: this.tick() });
    this.notify(p);
  }

  appendText(p: string, text: string): void {
    const key = this.path.normalizeKey(p);
    const node = this.nodes.get(key);
    if (node && node.kind === "file") this.writeText(p, (node.text ?? "") + text);
    else {
      this.requireParentDir(key);
      this.writeText(p, text);
    }
  }

  /** 原子性在这里是「不可观测的中间态」：整文件一次替换，不留 tmp。父目录自动建，与 Node 版一致。 */
  writeTextAtomic(p: string, text: string): void {
    const key = this.path.normalizeKey(p);
    this.mkdirSyncInternal(this.path.dirname(key), true);
    this.writeText(p, text);
  }

  exists(p: string): boolean {
    return this.nodes.has(this.path.normalizeKey(p));
  }

  stat(p: string): FsStats | undefined {
    const key = this.path.normalizeKey(p);
    const node = this.nodes.get(key);
    if (!node) return undefined;
    if (node.kind === "dir") {
      return { isFile: false, isDirectory: true, size: 0, mtimeMs: node.mtimeMs };
    }
    const size = node.buffer
      ? node.buffer.byteLength
      : new TextEncoder().encode(node.text ?? "").byteLength;
    return { isFile: true, isDirectory: false, size, mtimeMs: node.mtimeMs };
  }

  readDir(p: string): string[] {
    return this.readDirEntries(p).map((e) => e.name);
  }

  readDirEntries(p: string): FsEntry[] {
    const key = this.path.normalizeKey(p);
    const dir = this.nodes.get(key);
    if (!dir) fail("ENOENT", p);
    if (dir.kind !== "dir") fail("ENOTDIR", p);
    const out: FsEntry[] = [];
    for (const [child, node] of this.nodes) {
      if (child === key) continue;
      if (this.path.dirname(child) !== key) continue;
      out.push({
        name: this.path.basename(child),
        isFile: node.kind === "file",
        isDirectory: node.kind === "dir",
      });
    }
    return out;
  }

  mkdir(p: string, options?: MkdirOptions): void {
    this.mkdirSyncInternal(p, options?.recursive ?? false);
  }

  remove(p: string, options?: RemoveOptions): void {
    const key = this.path.normalizeKey(p);
    const node = this.nodes.get(key);
    if (!node) {
      if (options?.force) return;
      fail("ENOENT", p);
    }
    if (node.kind === "file") {
      this.nodes.delete(key);
      this.notify(p);
      return;
    }
    const children = [...this.nodes.keys()].filter((k) => k.startsWith(key + "/"));
    if (children.length && !options?.recursive) fail("ENOTEMPTY", p);
    for (const child of children) this.nodes.delete(child);
    this.nodes.delete(key);
    this.notify(p);
  }

  rename(from: string, to: string): void {
    const src = this.path.normalizeKey(from);
    const dst = this.path.normalizeKey(to);
    const node = this.nodes.get(src);
    if (!node) fail("ENOENT", from);
    if (this.nodes.has(dst)) fail("EEXIST", to);
    this.requireParentDir(dst);
    const moved = new Map<string, MockNode>();
    if (node.kind === "dir") {
      for (const [k, v] of this.nodes) {
        if (k === src || k.startsWith(src + "/")) {
          moved.set(dst + k.slice(src.length), v);
          this.nodes.delete(k);
        }
      }
      moved.forEach((v, k) => this.nodes.set(k, v));
    } else {
      this.nodes.delete(src);
      this.nodes.set(dst, node);
    }
    const stamp = this.tick();
    node.mtimeMs = stamp;
    this.notify(from);
    this.notify(to);
  }

  copy(from: string, to: string, options?: CopyOptions): void {
    const src = this.path.normalizeKey(from);
    const dst = this.path.normalizeKey(to);
    const node = this.nodes.get(src);
    if (!node) fail("ENOENT", from);
    if (node.kind === "file") {
      this.requireParentDir(dst);
      this.nodes.set(dst, { ...node, mtimeMs: this.tick() });
      this.notify(to);
      return;
    }
    if (!options?.recursive) fail("EISDIR", from);
    for (const [k, v] of [...this.nodes]) {
      if (k === src || k.startsWith(src + "/")) {
        const target = dst + k.slice(src.length);
        if (v.kind === "file") this.requireParentDir(target);
        this.nodes.set(target, { ...v });
      }
    }
    this.notify(to);
  }

  /**
   * 注册目录监听，返回取消函数。
   * @param path 被监听目录
   * @param onChange 变动回调（文件名，不含路径）
   */
  watchDir(path: string, onChange: (name: string) => void): () => void {
    const key = this.path.normalizeKey(path);
    const node = this.nodes.get(key);
    if (!node) fail("ENOENT", path);
    if (node.kind !== "dir") fail("ENOTDIR", path);
    let set = this.listeners.get(key);
    if (!set) {
      set = new Set();
      this.listeners.set(key, set);
    }
    set.add(onChange);
    return () => {
      set!.delete(onChange);
    };
  }

  /** 手动触发一次监听回调（Node 版靠 fs.watch，内存版靠这个显式驱动）。 */
  fire(dirPath: string, name: string): void {
    const set = this.listeners.get(this.path.normalizeKey(dirPath));
    if (set) for (const cb of [...set]) cb(name);
  }

  private mkdirSyncInternal(p: string, recursive: boolean): void {
    const key = this.path.normalizeKey(p);
    if (key === "/") {
      if (!this.nodes.has("/")) this.nodes.set("/", { kind: "dir", mtimeMs: this.tick() });
      return;
    }
    const existing = this.nodes.get(key);
    if (existing?.kind === "dir") {
      if (!recursive) fail("EEXIST", p);
      return;
    }
    if (existing) fail("EEXIST", p);
    const parent = this.path.dirname(key);
    if (parent === key) fail("ENOENT", p);
    if (!this.nodes.get(parent)) {
      if (!recursive) fail("ENOENT", p);
      this.mkdirSyncInternal(parent, true);
    }
    this.nodes.set(key, { kind: "dir", mtimeMs: this.tick() });
  }

  private requireParentDir(key: string): void {
    const parent = this.path.dirname(key);
    const node = this.nodes.get(parent);
    if (!node) fail("ENOENT", parent);
    if (node.kind !== "dir") fail("ENOTDIR", parent);
  }

  private notify(p: string): void {
    this.fire(this.path.dirname(p), this.path.basename(p));
  }

  private tick(): number {
    return ++this.clock;
  }

  private readonly path = new MockPathAdapter();
}

/** 恒 posix 的路径实现：内存盘不认平台分隔符，也不碰 node:path。 */
export class MockPathAdapter implements IFsPath {
  readonly sep = "/";

  join(...segments: string[]): string {
    const joined = segments
      .filter((s) => s.length)
      .join("/")
      .replace(/\/{2,}/g, "/");
    return joined.startsWith("/") ? joined : "/" + joined;
  }

  resolve(...segments: string[]): string {
    const parts: string[] = [];
    for (const seg of segments) {
      if (seg.startsWith("/")) parts.length = 0;
      for (const piece of seg.split("/")) {
        if (!piece || piece === ".") continue;
        if (piece === "..") parts.pop();
        else parts.push(piece);
      }
    }
    return "/" + parts.join("/");
  }

  dirname(p: string): string {
    const clean = p.replace(/\/+$/, "");
    const i = clean.lastIndexOf("/");
    return i <= 0 ? "/" : clean.slice(0, i);
  }

  basename(p: string, ext?: string): string {
    const clean = p.replace(/\/+$/, "");
    const base = clean.slice(clean.lastIndexOf("/") + 1);
    return ext && base.endsWith(ext) ? base.slice(0, -ext.length) : base;
  }

  extname(p: string): string {
    const base = this.basename(p);
    const i = base.lastIndexOf(".");
    return i <= 0 ? "" : base.slice(i);
  }

  relative(from: string, to: string): string {
    const a = this.resolve(from).split("/");
    const b = this.resolve(to).split("/");
    while (a.length && b.length && a[0] === b[0]) {
      a.shift();
      b.shift();
    }
    return [...a.map(() => ".."), ...b].join("/");
  }

  posixJoin(...segments: string[]): string {
    return this.join(...segments);
  }

  format(parts: FsPathLike): string {
    if (parts.base) return this.join(parts.dir ?? parts.root ?? "", parts.base);
    return this.join(parts.dir ?? parts.root ?? "", (parts.name ?? "") + (parts.ext ?? ""));
  }

  /**
   * 不接平台细节（Windows 盘符、URI 编码规则都留给 Node 实现）：
   * 剥 `file://` 前缀 + 解码 + 去掉盘符前的空斜杠，够测试里断言「前缀没了」即可。
   */
  fromFileUrl(url: string): string {
    const rest = decodeURIComponent(url.replace(/^file:\/\/\/?/, ""));
    return /^[A-Za-z]:\//.test(rest) ? rest : "/" + rest;
  }

  /** 内部键：绝对、无尾斜杠。 */
  normalizeKey(p: string): string {
    const r = this.resolve(p);
    return r.length > 1 ? r.replace(/\/+$/, "") : "/";
  }
}

/** 进程发起的内存替身：按 `cmd + 首参` 注册脚本化结果。 */
export class MockProcLauncher implements IProcessLauncher {
  private handlers = new Map<string, (args: readonly string[], options?: ProcOptions) => ProcResult>();
  readonly calls: { cmd: string; args: readonly string[]; options?: ProcOptions }[] = [];
  /** detach 的留账（不真起进程）：测试据此断言「该递递交出去了、递交了几次」。 */
  readonly detached: { cmd: string; args: readonly string[] }[] = [];

  /** 注册应答；key 形如 `"python tools/x.py"` 或纯 `"python"`（后者为兜底）。 */
  on(key: string, handler: (args: readonly string[], options?: ProcOptions) => ProcResult): this {
    this.handlers.set(key, handler);
    return this;
  }

  run(cmd: string, args: readonly string[], options?: ProcOptions): ProcResult {
    this.calls.push({ cmd, args, options });
    const handler =
      this.handlers.get([cmd, ...args].join(" ")) ??
      this.handlers.get(args.length ? `${cmd} ${args[0]}` : cmd) ??
      this.handlers.get(cmd);
    if (handler) return handler(args, options);
    return { status: 127, stdout: "", stderr: `no handler for ${cmd}`, error: `no handler for ${cmd}` };
  }

  exec(cmd: string, args: readonly string[], options?: ProcOptions): string {
    const r = this.run(cmd, args, options);
    if (r.error) throw new ProcExecutionError(cmd, args, r.status, r.error);
    if (r.status !== 0) throw new ProcExecutionError(cmd, args, r.status, r.stderr);
    return r.stdout;
  }

  /** 异步形态：内存盘不模拟真实时序，直接复用注册应答（测试里要超时/信号就给一个带 timedOut 的 handler）。 */
  runAsync(cmd: string, args: readonly string[], options?: ProcOptions): Promise<ProcResult> {
    return Promise.resolve(this.run(cmd, args, options));
  }

  /** 分离启动在内存替身里只留账：不真起进程、不模拟时序，测试断言 `detached` 里有没有这条即可。 */
  detach(cmd: string, args: readonly string[]): void {
    this.detached.push({ cmd, args });
  }
}
