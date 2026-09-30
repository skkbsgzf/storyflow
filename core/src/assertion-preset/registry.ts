/**
 * AE-* 断言注册表：preset 声明的 aesthetic 面断言类型 → 实际执行。
 *
 * 实现刻意薄：runAestheticAsserts 本就是按产物路径/形态路由的 canonical 分发器
 * （选题报告/剧本/拍级/正文各自走专项断言组），注册表只做「跑一次、按声明类型过滤」，
 * 不再造第二套路由。integrity 面（exists/no-debris/artifact-header/…）不经过注册表——
 * 它们在提交链与 check_* 节点上无条件运行，preset 只做策略层（见 executor.ts）。
 */

import type { Validation } from "../types.js";
import { runAestheticAsserts } from "../aesthetic.js";
import type { IFileSystem, IFsPath } from "../abstraction/fs.js";
import { nodeFs, nodePath } from "../abstraction/defaults.js";

/** 跑一次 aesthetic 断言全集，只保留 preset 声明的 AE-* 类型。 */
export function runDeclaredAesthetic(
  types: string[],
  projectDir: string,
  relPath: string,
  budget?: Record<string, number>,
  fs: IFileSystem = nodeFs,
  path: IFsPath = nodePath,
): Validation[] {
  const wanted = new Set(types.filter((t) => t.startsWith("AE-")));
  if (!wanted.size) return [];
  const all = runAestheticAsserts(projectDir, relPath, budget, fs, path);
  return all.filter((v) => wanted.has(v.name));
}
