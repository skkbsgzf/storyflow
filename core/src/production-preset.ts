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

// ═══ R8 · Auto 预设路由 v1（规则式，拍板点③采纳「规则式先行」）═══
/**
 * 关键词 + 输入形状 → 预设建议。为什么规则式而不是模型式：**可测试、可解释、零模型依赖**——
 * 每条路由都能在测试里点名校验，路由错了用户能一眼看出是哪条规则；模型式路由的错是黑盒的。
 * 返回 undefined = 该输入形状下没有比缺省流水线更好的选择（不硬选，缺省即完整流水线）。
 * 路由依据只取字符串型输入拼接文本（跳过 project 这类结构位），不猜值、不读盘。
 */
const AUTO_RULES: { flowId: string; keywords: RegExp; preset: string; why: string }[] = [
  { flowId: "screenplay", keywords: /分镜提示词|视频提示词|即梦|seedance|comfy|视频/i, preset: "comfyui-script", why: "方向含视频/提示词语义" },
  { flowId: "novel", keywords: /世界观|世界书|设定集|bible/i, preset: "world-bible", why: "需求只提世界观/设定" },
  { flowId: "topic", keywords: /短篇|单篇|一次性成稿/i, preset: "short-story", why: "需求明示短篇速成" },
];

/** Auto 路由的可解释回执：命中规则时给 preset + 一句理由；未命中给 undefined（走缺省流水线）。 */
export function suggestProductionPreset(
  flowId: string,
  inputs: Record<string, unknown>,
): { preset: string; why: string } | undefined {
  const text = Object.entries(inputs)
    .filter(([k]) => k !== "project")
    .map(([, v]) => (typeof v === "string" ? v : ""))
    .join(" ");
  if (!text.trim()) return undefined;
  for (const r of AUTO_RULES) {
    if (r.flowId === flowId && r.keywords.test(text)) return { preset: r.preset, why: r.why };
  }
  return undefined;
}
