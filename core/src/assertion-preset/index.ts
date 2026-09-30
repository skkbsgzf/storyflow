/**
 * Layer 1：AssertionPresets —— 断言预设注册表服务（对标 DSH AgentPresets）。
 *
 * roots 约定（first-root-wins，system 在前 = 同名时系统优先）：
 *   system = repoRoot/presets（框架自带），user = 数据根/presets（项目自定义）。
 * 全同步 API：与内核其余 I/O 同习惯；mount 带 stamp 热重载（组合文件改了即生效，
 * progressive 状态随新 generation 清零）。
 */

import path from "node:path";
import { discoverPresets } from "./discovery.js";
import { MountCache } from "./mount.js";
import type { AssertionPreset, PresetRoot, StandingMount } from "./types.js";
import { CompositionError } from "./resolver.js";

export const DEFAULT_PRESET_ID = "novel-fanqie";

/** 组装默认 roots：system（repoRoot）在前，user（数据根）在后。 */
export function defaultPresetRoots(repoRoot: string, dataRoot: string): PresetRoot[] {
  return [
    { path: path.join(repoRoot, "assertion-presets"), trust: "system" },
    { path: path.join(dataRoot, "assertion-presets"), trust: "user" },
  ];
}

export class AssertionPresets {
  private readonly cache = new MountCache();

  constructor(
    private readonly roots: PresetRoot[],
    private readonly defaultId: string = DEFAULT_PRESET_ID,
  ) {}

  /** 全量列出（含 broken——broken 字段写明原因）。 */
  list(): AssertionPreset[] {
    return discoverPresets(this.roots);
  }

  /** 按 id 解析；缺失抛错（含可用清单）。 */
  resolve(id?: string): AssertionPreset {
    const wanted = id ?? this.defaultId;
    const presets = this.list();
    const found = presets.find((p) => p.id === wanted);
    if (!found) {
      throw new Error(`preset "${wanted}" not found (available: ${presets.map((p) => p.id).join(", ") || "无"})`);
    }
    return found;
  }

  /** 挂载：broken/缺失抛错；成功返回站立挂载（带 progressive 状态）。 */
  mount(id?: string): StandingMount {
    const preset = this.resolve(id);
    if (preset.broken) throw new Error(`preset "${preset.id}" is broken: ${preset.broken}`);
    return this.cache.mountFor(preset);
  }

  /**
   * 内核静默入口：活跃 preset 不可用（缺失/损坏/解析失败）→ undefined = 特性不激活，
   * 门点按无 preset 处理（结果原样透传）。不抛错——预设层的故障不许拦死流水线，
   * 但调用方应把 undefined 的事实记进诊断（见 kernel 侧 recordDiag）。
   */
  mountFor(id?: string): StandingMount | undefined {
    try {
      const preset = this.resolve(id ?? this.defaultId);
      if (preset.broken) return undefined;
      return this.cache.mountFor(preset);
    } catch (e) {
      if (e instanceof CompositionError) return undefined;
      return undefined;
    }
  }
}
