/**
 * Layer 0：Discovery —— preset 根扫描 + 健康检查（对标 DSH discovery.ts）。
 *
 * 健康检查四级：目录可读 → gate-preset.yml 存在 → YAML 合法 → schema 通过。
 * broken 的 preset 照常列出（`broken` 写明原因），挂载时才拒绝——能力发现与可用性分离。
 * 全同步 fs：与本仓库其余内核代码同一 I/O 习惯（http/内核路径均为 sync）。
 */

import { nodeFs, nodePath } from "../abstraction/defaults.js";
import type { FsEntry, IFileSystem, IFsPath } from "../abstraction/fs.js";
import { load } from "js-yaml";
import { assertSchema, SchemaViolation } from "../schema.js";
import type { AssertionPreset, PresetRoot } from "./types.js";

const PRESET_ID = /^[a-z0-9][a-z0-9-]*$/;

/** 扫描单个 root；root 不存在 = 空（合法常态，不报错）。 */
export function scanRoot(root: PresetRoot, fs: IFileSystem = nodeFs, path: IFsPath = nodePath): AssertionPreset[] {
  let children: FsEntry[];
  try {
    children = fs.readDirEntries(root.path);
  } catch {
    return [];
  }
  const found: AssertionPreset[] = [];
  for (const child of children) {
    if (!child.isDirectory || !PRESET_ID.test(child.name)) continue;
    const presetDir = path.join(root.path, child.name);
    const gatePath = path.join(presetDir, "gate-preset.yml");
    const presetPath = path.join(presetDir, "preset.yml");
    const broken = healthCheck(gatePath, fs);
    const meta = readMetadata(presetPath, fs);
    found.push({
      id: child.name,
      trust: root.trust,
      path: gatePath,
      name: meta.name,
      description: meta.description,
      ...(broken ? { broken } : {}),
    });
  }
  return found.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
}

/** 健康检查（对标 DSH compositionProblem）：返回 undefined = 健康。 */
function healthCheck(gatePath: string, fs: IFileSystem): string | undefined {
  if (!fs.exists(gatePath)) return "gate-preset.yml is missing";
  let parsed: unknown;
  try {
    parsed = load(fs.readText(gatePath));
  } catch (e) {
    return `invalid YAML: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`;
  }
  try {
    // id 与目录名一致性这里不查（resolver 会以目录名为准回填），schema 只管形状
    assertSchema("assertion-preset", parsed);
  } catch (e) {
    if (e instanceof SchemaViolation) return `schema validation failed: ${e.errors}`;
    return `schema validation failed: ${e instanceof Error ? e.message : String(e)}`;
  }
  return undefined;
}

function readMetadata(presetPath: string, fs: IFileSystem): { name?: string; description?: string } {
  try {
    const meta = load(fs.readText(presetPath)) as { name?: unknown; description?: unknown } | null;
    if (!meta || typeof meta !== "object") return {};
    return {
      ...(typeof meta.name === "string" ? { name: meta.name } : {}),
      ...(typeof meta.description === "string" ? { description: meta.description } : {}),
    };
  } catch {
    // preset.yml 只是元数据，坏了不致命（broken 与否由 gate-preset.yml 决定）
    return {};
  }
}

/** 全 roots 发现；同 id 多 root 命中时 first-root-wins（system 根在前 = 系统优先）。 */
export function discoverPresets(roots: PresetRoot[], fs: IFileSystem = nodeFs, path: IFsPath = nodePath): AssertionPreset[] {
  const byId = new Map<string, AssertionPreset>();
  for (const root of roots) {
    for (const preset of scanRoot(root, fs, path)) {
      if (!byId.has(preset.id)) byId.set(preset.id, preset);
    }
  }
  return [...byId.values()];
}
