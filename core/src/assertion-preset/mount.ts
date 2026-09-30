/**
 * Layer 2：Standing Mount（对标 DSH PresetMount）—— 解析一次、进程内共享的挂载缓存。
 * stamp（mtime+size）变化 = 新 generation：重解析组合、progressive 清零。
 */

import fs from "node:fs";
import type { AssertionPreset, StandingMount } from "./types.js";
import { loadPresetComposition } from "./resolver.js";

export function stampOf(presetPath: string): { mtimeMs: number; size: number } | undefined {
  try {
    const { mtimeMs, size } = fs.statSync(presetPath);
    return { mtimeMs, size };
  } catch {
    return undefined;
  }
}

function sameStamp(a: { mtimeMs: number; size: number }, b: { mtimeMs: number; size: number }): boolean {
  return a.mtimeMs === b.mtimeMs && a.size === b.size;
}

/** 创建站立挂载（解析组合 + 记 stamp + 空 progressive 状态）。 */
export function createMount(preset: AssertionPreset): StandingMount {
  const composition = loadPresetComposition(preset.path, preset.trust, preset.id);
  const stamp = stampOf(preset.path);
  if (!stamp) throw new Error(`preset "${preset.id}" 组合文件不可读: ${preset.path}`);
  return { presetId: preset.id, composition, progressiveState: new Map(), stamp };
}

/** 挂载缓存：命中且 stamp 未变 → 复用（progressive 延续）；stamp 变了 → 重新 createMount。 */
export class MountCache {
  private readonly byId = new Map<string, StandingMount>();

  mountFor(preset: AssertionPreset): StandingMount {
    const cached = this.byId.get(preset.id);
    if (cached) {
      const current = stampOf(preset.path);
      if (current && sameStamp(cached.stamp, current)) return cached;
    }
    const fresh = createMount(preset);
    this.byId.set(preset.id, fresh);
    return fresh;
  }
}
