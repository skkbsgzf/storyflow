/**
 * FS 抽象层 v1 接口。规范：`docs/_archive/规范-FS抽象层-FS1.md`。
 * 方法集合由 core/src 现状调用面反推（见规范 §3.1 普查表），不预设用不上的能力。
 * 约定：路径一律为字符串，语义由注入的 IFsPath 决定；不存在的路径不抛错的方法会明说。
 */

export interface FsStats {
  isFile: boolean;
  isDirectory: boolean;
  size: number;
  mtimeMs: number;
}

/** readDirEntries 的返回项（对应 node 的 Dirent，只暴露内核真用到的字段）。 */
export interface FsEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
}

export interface MkdirOptions {
  /** true = 父目录一并建；false（缺省）= 已存在即抛——LockDir 的互斥语义靠这条。 */
  recursive?: boolean;
}

export interface RemoveOptions {
  recursive?: boolean;
  /** true = 目标不存在时静默返回。 */
  force?: boolean;
}

export interface CopyOptions {
  /** 目录需递归拷贝时置 true（对应现网 compat.ts 的 cpSync）。 */
  recursive?: boolean;
}

export interface IFileSystem {
  /** UTF-8 文本读；目标不存在或非文件即抛（调用方沿用现状的 try/catch 形态）。 */
  readText(path: string): string;
  /** 二进制读（内核仅一处：静态文件服务）。 */
  readBuffer(path: string): Uint8Array;
  /** 覆盖写，不建父目录。 */
  writeText(path: string, text: string): void;
  /** 追加写，不建父目录。 */
  appendText(path: string, text: string): void;
  /** 原子写：tmp + rename，Windows rename 撞占用时先删再 rename（fsio.atomicWriteText 语义）。父目录自动创建。 */
  writeTextAtomic(path: string, text: string): void;
  exists(path: string): boolean;
  /** 不存在返回 undefined，不抛——现网 statSync 前面几乎都跟着 existsSync，合并成一次调用。 */
  stat(path: string): FsStats | undefined;
  /** 目录名列表；目录不存在即抛。排序由调用方决定（现网多数 .sort()）。 */
  readDir(path: string): string[];
  readDirEntries(path: string): FsEntry[];
  mkdir(path: string, options?: MkdirOptions): void;
  remove(path: string, options?: RemoveOptions): void;
  /** 同卷改名；目标父目录需已存在。 */
  rename(from: string, to: string): void;
  copy(from: string, to: string, options?: CopyOptions): void;
  /**
   * 目录监听，返回取消函数。回调参数为变动项的文件名（不含路径）。
   * v1 纳入的唯一理由：SSE stream 需要它，否则 R5 又要直绑 node:fs。
   * 语义弱保证（规范 §五）：事件合并/丢失跨平台不一致，调用方只能把它当「提示重读」，
   * 重读路径必须能独立工作（`project-stream.ts` 的心跳节拍就是独立对账线）。
   */
  watchDir(path: string, onChange: (name: string) => void): () => void;
}

/**
 * 注入束：文件系统 + 路径语义的成对句柄。
 * 用于旁路台账类模块（journal / metrics / diag / decisions）的**必填首参**：
 * 这四类函数调用面广（journalAppend 56 处、recordDiag 17 处……），若按规范 §四的尾参默认形态，
 * 漏传一处就静默回落宿主盘——正是本仓最忌的「以为有，其实没有」。首参必传 ⇒ 编译器替我们守着。
 * `Kernel` 的 `readonly fs` / `readonly path` 天然满足本形状，调用点直接传 `kernel`。
 */
export interface FsIo {
  readonly fs: IFileSystem;
  readonly path: IFsPath;
}

/** path.ParsedPath 的抽象替身（fsio 的 atomicWriteText 收过这个形状）。 */
export interface FsPathLike {
  dir?: string;
  root?: string;
  base?: string;
  ext?: string;
  name?: string;
}

export interface IFsPath {
  join(...segments: string[]): string;
  resolve(...segments: string[]): string;
  dirname(path: string): string;
  basename(path: string, ext?: string): string;
  extname(path: string): string;
  relative(from: string, to: string): string;
  /** 平台分隔符（win32 = "\\"，posix = "/"）。 */
  readonly sep: string;
  /**
   * 恒用 "/" 拼接——产物内相对路径跨平台必须一致，故与 sep 分开提供。
   * @param segments 路径片段
   */
  posixJoin(...segments: string[]): string;
  /** 由 FsPathLike 组装成路径字符串。 */
  format(parts: FsPathLike): string;
  /**
   * `file://` URL → 平台路径字符串（对应 node 的 `fileURLToPath`）。
   * 扩容走的是普查（规范 §3.1／§四.5）：现网唯一调用点 `schema.ts` 用 `import.meta.url` 定位包根，
   * 而 §四.4 的豁免区只有 `abstraction/adapters/*`——把它留在宿主件里就是第二条 `node:*` 尾巴。
   * Mock 实现不接平台细节：按字面剥前缀并解码，虚拟盘上的「模块在哪」本无意义。
   */
  fromFileUrl(url: string): string;
}
