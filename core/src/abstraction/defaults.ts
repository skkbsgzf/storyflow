/**
 * 平台默认适配器的**注册表**（core 侧，零 `node:*`）。
 *
 * 为什么要有这一层：拆包（工单 R7）要求 `@storyflow/core` 不 import 任何宿主实现，
 * 而 FS1 §四第 2 条的 166 处尾参默认 `fs: IFileSystem = nodeFs` 又要一个「缺省值」。
 * 两者不冲突的办法是把「缺省」从**一个实例**改成**一次查找**：
 * core 只持有这张表，宿主启动时把自家适配器注册进来（Node 宿主见 `adapters/node.ts` 末行）。
 *
 * 三条后果，都是有意为之：
 * 1. 名字仍叫 `nodeFs`/`nodePath`/`nodeProc`——它们从此指「平台缺省适配器」，不指 Node；
 *    改名要动 166 处尾参，换来的只是语义纯洁，不值。规范口径以 FS1 §4.1 为准。
 * 2. **没注册就用 = 抛错**，不静默回落。回落到任何一家实现都会让「core 不依赖宿主」这件事
 *    在运行时被悄悄违背（嵌入式宿主上就是数据写错盘，同 §四第 6 条必传首参的理由）。
 * 3. 转发对象身份稳定（同一进程内 `nodeFs === nodeFs`），所以 FS1 D4 那套「按适配器身份分桶」
 *    的缓存语义不变：注册后的平台缺省仍是一个桶。
 */
import type { IFsPath, IFileSystem } from "./fs.js";
import type { IProcessLauncher } from "./proc.js";

export interface PlatformAdapters {
  fs: IFileSystem;
  path: IFsPath;
  proc: IProcessLauncher;
}

let registered: PlatformAdapters | null = null;

/**
 * 宿主启动时调一次（重复注册以后者为准——测试里换假盘、宿主里换实现都靠它）。
 * 只登记引用，不复制、不包装：注册什么就用什么。
 */
export function registerAdapters(adapters: PlatformAdapters): void {
  registered = adapters;
}

/** 当前注册的平台适配器；未注册返回 null（给「我要不要注册」的判定用，不参与转发）。 */
export function currentAdapters(): PlatformAdapters | null {
  return registered;
}

function need<K extends keyof PlatformAdapters>(key: K): PlatformAdapters[K] {
  if (!registered) {
    throw new Error(
      `FS 抽象层未注册平台适配器：core 包不 import 任何宿主实现，用 \`node${key === "fs" ? "Fs" : key === "path" ? "Path" : "Proc"}\` 之前` +
        `须先 registerAdapters({ fs, path, proc })（Node 宿主：import 抽象层的 Node 件即自动注册，` +
          `现路径 "./abstraction/adapters/node.js"；R7-3 拆包后为 "@storyflow/adapters/node"）`,
    );
  }
  return registered[key];
}

/**
 * 逐次调用转发：默认参数表达式在**每次调用**时求值，所以 `= nodeFs` 的语义
 * 从「拿一个 Node 实例」变成「拿当前注册的平台缺省」，注册时机不受 import 顺序约束。
 */
function forward<K extends keyof PlatformAdapters>(key: K): PlatformAdapters[K] {
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      const impl = need(key) as unknown as Record<string | symbol, unknown>;
      const value = impl[prop];
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(impl) : value;
    },
  };
  return new Proxy({}, handler) as PlatformAdapters[K];
}

export const nodeFs: IFileSystem = forward("fs");
export const nodePath: IFsPath = forward("path");
export const nodeProc: IProcessLauncher = forward("proc");
