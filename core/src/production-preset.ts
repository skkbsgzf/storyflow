/**
 * 生产线预设（Production Preset，PP1）——「选一条生产线」的用户面：
 * preset = manifest（preset.yml：名字/描述/适配的 flow 清单）+ 每条 flow 一份可选 overlay
 * （overlay.<flowId>.json，完整 flow-overlay@1，经既有 schema 校验）。
 *
 * 与断言预设（Assertion Preset，AP1，assertion-presets/）是两个正交概念：
 *   生产线预设 = 编排从哪条生产线走、裁掉/追加哪些模块工具（本文件）；
 *   断言预设   = 门点拦控行为（warn-only/strict/progressive，见 assertion-preset/）。
 *
 * 装载序（kernel.effectiveOf）：flow.json ⊕ 出厂 overlay.default ⊕ **预设 overlay** ⊕ 项目 overlay——
 * 预设是「出厂的可选变体」，项目运行时 overlay 仍能在它之上继续调。
 */

import { nodeFs, nodePath } from "./abstraction/defaults.js";
import type { FsEntry, IFileSystem, IFsPath } from "./abstraction/fs.js";
import { load } from "js-yaml";
import { assertSchema, SchemaViolation } from "./schema.js";
import type { FlowOverlay } from "./overlay.js";

export interface ProductionPresetFlow {
  flowId: string;
  /** 是否带该 flow 的 overlay 文件 */
  hasOverlay: boolean;
}

export interface ProductionPreset {
  /** preset id：目录名 */
  id: string;
  name?: string;
  description?: string;
  flows: ProductionPresetFlow[];
  /** 为什么不可用（manifest/overlay 非法）；为空 = 健康 */
  broken?: string;
}

const PRESET_ID = /^[a-z0-9][a-z0-9-]*$/;

/** 列出全部生产线预设（broken 照常列出）。 */
export function listProductionPresets(repoRoot: string, fs: IFileSystem = nodeFs, path: IFsPath = nodePath): ProductionPreset[] {
  const dir = path.join(repoRoot, "presets");
  let children: FsEntry[];
  try {
    children = fs.readDirEntries(dir);
  } catch {
    return [];
  }
  const out: ProductionPreset[] = [];
  for (const child of children) {
    if (!child.isDirectory || !PRESET_ID.test(child.name)) continue;
    const presetDir = path.join(dir, child.name);
    const manifestPath = path.join(presetDir, "preset.yml");
    if (!fs.exists(manifestPath)) {
      out.push({ id: child.name, flows: [], broken: "preset.yml is missing" });
      continue;
    }
    let manifest: { name?: unknown; description?: unknown; flows?: unknown };
    try {
      manifest = (load(fs.readText(manifestPath)) ?? {}) as typeof manifest;
    } catch (e) {
      out.push({ id: child.name, flows: [], broken: `invalid preset.yml: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}` });
      continue;
    }
    const flows: ProductionPresetFlow[] = (Array.isArray(manifest.flows) ? manifest.flows : [])
      .map((f): ProductionPresetFlow | null => {
        const flowId = typeof (f as Record<string, unknown>)?.flowId === "string" ? String((f as Record<string, unknown>).flowId) : "";
        if (!flowId) return null;
        return { flowId, hasOverlay: fs.exists(path.join(presetDir, `overlay.${flowId}.json`)) };
      })
      .filter((f): f is ProductionPresetFlow => !!f);
    out.push({
      id: child.name,
      ...(typeof manifest.name === "string" ? { name: manifest.name } : {}),
      ...(typeof manifest.description === "string" ? { description: manifest.description } : {}),
      flows,
    });
  }
  return out.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
}

export function presetOverlayPath(repoRoot: string, presetId: string, flowId: string, path: IFsPath = nodePath): string {
  return path.join(repoRoot, "presets", presetId, `overlay.${flowId}.json`);
}

/**
 * 装载预设对某条 flow 的 overlay；不存在 = undefined（manifest-only 预设，合法常态）。
 * 存在但非法（schema 不过 / flowId 不符）= 抛错——出厂随包的数据坏了必须大声失败，
 * 不静默跳过（否则「预设说裁掉 m4」静默失效 = 用户拿到完整流水线还以为生效了）。
 */
export function loadPresetOverlay(repoRoot: string, presetId: string, flowId: string, fs: IFileSystem = nodeFs, path: IFsPath = nodePath): FlowOverlay | undefined {
  const file = presetOverlayPath(repoRoot, presetId, flowId, path);
  if (!fs.exists(file)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readText(file));
  } catch (e) {
    throw new Error(`预设 overlay JSON 非法: ${file}（${e instanceof Error ? e.message : String(e)}）`);
  }
  try {
    assertSchema("flow-overlay", parsed);
  } catch (e) {
    if (e instanceof SchemaViolation) throw new Error(`预设 overlay 不合契约: ${file}（${e.errors}）`);
    throw e;
  }
  const ov = parsed as FlowOverlay;
  if (ov.flowId !== flowId) {
    throw new Error(`预设 overlay flowId 不符: ${file}（声明 ${ov.flowId}，用于 ${flowId}）`);
  }
  return ov;
}
