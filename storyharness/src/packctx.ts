// 包调用上下文（波13 步1）：serve 在派发挂载表条目前用 runWithPack 绑定，
// 包代码经 currentPackCtx() 取底座注入（cfg / PackRuntime / 包命名空间配置），
// 免把 runtime 塞进每个 handler 签名——引擎函数的 cfg 形参保持原样。
// 纪律：context 缺失 = 显式抛错（包不该在挂载表之外被裸调），不静默兜底。
import { AsyncLocalStorage } from "node:async_hooks";
import type { HarnessConfig } from "./config.js";
import type { PackRuntime } from "./packs.js";

export interface PackCtx {
  pack: string;
  cfg: HarnessConfig;
  runtime: PackRuntime;
  /** 本包配置命名空间（cfg.extensions.<pack>；S3），未配置 = 空对象。 */
  packCfg: Record<string, unknown>;
  /** 本次 API 派发的剥前缀辅助："/api/deduce/state?x" + 12 → "state"。 */
  stripPrefix: (url: string) => string;
}

const als = new AsyncLocalStorage<PackCtx>();

export function runWithPack<T>(ctx: PackCtx, fn: () => Promise<T>): Promise<T> {
  return als.run(ctx, fn);
}

export function currentPackCtx(): PackCtx {
  const c = als.getStore();
  if (!c) throw new Error("pack 上下文缺失：包入口只应由 serve 挂载表派发（runWithPack 未包）");
  return c;
}
