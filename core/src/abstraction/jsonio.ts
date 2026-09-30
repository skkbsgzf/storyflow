/**
 * JSON/JSONL/锁目录的**语义件**（不是 Node 件）：fsio.ts 的四个helper 与 LockDir 迁入抽象层。
 *
 * 为什么进 abstraction/ 而不是留在原处：这几件事与「盘是真是假」无关——序列化、坏行容错、
 * lockdir 互斥都是内核语义；只有 tmp+rename 那条落在 `IFileSystem.writeTextAtomic` 的实现里。
 * 迁入后 `fsio.ts` 整体退役（工单 R3 写集 + 拍板点④）。
 *
 * 注入形态沿用规范 FS1 §四.2：`fs`（及需要建父目录处的 `path`）作**尾参带缺省**，
 * 调用方从 kernel 透传。缺省 = Node 适配器，为的是 P1–P3 批次（metrics/journal/decisions）
 * 在自己轮次到来前不必一次改完；P0 路径一律显式传 `kernel.fs`——
 * 冒烟测试（MockFs 上跑 flow_run→flow_submit）就靠这条断言「运行时不再绑真盘」。
 */
import { nodeFs, nodePath } from "./defaults.js";
import type { IFileSystem, IFsPath } from "./fs.js";

/** 读 JSON；缺失或坏 = undefined（现网「读不到就当没有」的口径，不抛）。 */
export function readJson<T = unknown>(file: string, fs: IFileSystem = nodeFs): T | undefined {
  try {
    return JSON.parse(fs.readText(file)) as T;
  } catch {
    return undefined;
  }
}

/**
 * 原子写 JSON：落盘前 schema 复验（v3 纪律：磁盘快照永远合法）。
 * 父目录由 `writeTextAtomic` 负责建，这里不再 mkdir。
 */
export function writeJsonAtomic(
  file: string,
  obj: unknown,
  validate?: (o: unknown) => void,
  fs: IFileSystem = nodeFs,
): void {
  if (validate) validate(obj);
  fs.writeTextAtomic(file, JSON.stringify(obj, null, 2) + "\n");
}

/** 追加 JSONL（journal/metrics/diagnostics 的写入形态）：自动建父目录。 */
export function appendJsonl(
  file: string,
  obj: unknown,
  fs: IFileSystem = nodeFs,
  path: IFsPath = nodePath,
): void {
  fs.mkdir(path.dirname(file), { recursive: true });
  fs.appendText(file, JSON.stringify(obj) + "\n");
}

/** 坏行容错读 jsonl（v3 纪律：一行坏不炸整读）。 */
export function readJsonl<T = unknown>(file: string, fs: IFileSystem = nodeFs): T[] {
  let raw = "";
  try {
    raw = fs.readText(file);
  } catch {
    return [];
  }
  const out: T[] = [];
  for (const line of raw.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    try {
      out.push(JSON.parse(s) as T);
    } catch {
      /* skip bad line */
    }
  }
  return out;
}

/**
 * lockdir 的持有者标记。不直接写 `process.pid`：R7 拆包后浏览器/WASM 环境没有 `process`，
 * 「谁持锁」只是诊断信息，取不到就落 "host"，不该成为硬依赖。
 */
function ownerTag(): string {
  const pid = (globalThis as { process?: { pid?: number } }).process?.pid;
  return pid === undefined ? "host" : String(pid);
}

/**
 * 尽力锁（lockdir，无依赖）：单写者纪律的软保障。
 * 互斥全靠 `mkdir(recursive:false)` 在已存在时抛——Node 与 mock 适配器同一条语义（规范 §3.3）。
 */
export class LockDir {
  private readonly dir: string;

  constructor(
    file: string,
    private readonly staleMs = 30000,
    private readonly fs: IFileSystem = nodeFs,
    private readonly path: IFsPath = nodePath,
  ) {
    this.dir = file + ".lock";
  }

  acquire(): boolean {
    this.fs.mkdir(this.path.dirname(this.dir), { recursive: true });
    try {
      this.fs.mkdir(this.dir);
      this.fs.writeText(this.path.join(this.dir, "owner"), String(ownerTag()));
      return true;
    } catch {
      const st = this.fs.stat(this.dir);
      // stat 缺失 = 目录已不在（别人抢先清了）：本轮认输返回 false。
      // 此前这里用的是会抛的 statSync，目录恰好消失时会把异常抛出 acquire——锁的读侧被炸穿。
      if (st && Date.now() - st.mtimeMs > this.staleMs) {
        try {
          this.fs.remove(this.dir, { recursive: true, force: true });
        } catch {
          /* 已被别人抢着清掉：继续走一次尝试 */
        }
        try {
          this.fs.mkdir(this.dir);
          return true;
        } catch {
          return false;
        }
      }
      return false;
    }
  }

  release(): void {
    try {
      this.fs.remove(this.dir, { recursive: true, force: true });
    } catch {
      /* 尽力而为 */
    }
  }
}
