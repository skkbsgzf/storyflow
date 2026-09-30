/**
 * Composition resolver —— gate-preset.yml → AssertionPresetComposition。
 * 缺省值统一在这里落（schema 只管形状）：gateMode 缺省由顶层 defaultGateMode 决定，
 * progressive 阈值缺省 warn=2 / block=5。
 */

import { nodeFs } from "../abstraction/defaults.js";
import type { IFileSystem } from "../abstraction/fs.js";
import { load } from "js-yaml";
import { assertSchema, SchemaViolation } from "../schema.js";
import type {
  AssertionConfig,
  AssertionGroup,
  AssertionPresetComposition,
  GateMode,
  PresetTrust,
} from "./types.js";

const GATE_MODES: GateMode[] = ["warn-only", "block-critical", "strict"];

export class CompositionError extends Error {}

/** 解析组合文件；形状/取值非法抛 CompositionError（discovery 侧转成 broken，不静默）。 */
export function loadPresetComposition(gatePath: string, trust: PresetTrust, dirId: string, fs: IFileSystem = nodeFs): AssertionPresetComposition {
  let parsed: unknown;
  try {
    parsed = load(fs.readText(gatePath));
  } catch (e) {
    throw new CompositionError(`invalid YAML: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`);
  }
  try {
    assertSchema("assertion-preset", parsed);
  } catch (e) {
    if (e instanceof SchemaViolation) throw new CompositionError(`schema: ${e.errors}`);
    throw new CompositionError(e instanceof Error ? e.message : String(e));
  }
  const doc = parsed as Record<string, unknown>;
  const rawGroups = doc.groups as Record<string, unknown>[];
  const defaultGateMode = (doc.defaultGateMode as GateMode | undefined) ?? "block-critical";

  const groups: AssertionGroup[] = rawGroups.map((g) => {
    const groupMode = (g.gateMode as GateMode | undefined) ?? defaultGateMode;
    const assertions: AssertionConfig[] = (g.assertions as Record<string, unknown>[]).map((a) => {
      const mode = (a.gateMode as GateMode | undefined) ?? groupMode;
      if (!GATE_MODES.includes(mode)) throw new CompositionError(`非法 gateMode: ${String(mode)}`);
      return {
        assertionType: String(a.assertionType),
        gateMode: mode,
        warnThreshold: (a.warnThreshold as number | undefined) ?? 2,
        blockThreshold: (a.blockThreshold as number | undefined) ?? 5,
        ...(a.when !== undefined ? { when: String(a.when) } : {}),
        ...(a.hintTemplate !== undefined ? { hintTemplate: String(a.hintTemplate) } : {}),
      };
    });
    const gid = String(g.id);
    if (!GATE_MODES.includes(groupMode)) throw new CompositionError(`组 ${gid} 非法 gateMode: ${String(groupMode)}`);
    return {
      id: gid,
      assertions,
      gateMode: groupMode,
      isolate: !!g.isolate,
      ...(g.disabled !== undefined ? { disabled: String(g.disabled) } : {}),
    };
  });

  return {
    // id 以目录名为准（文件里写错不另立门户，健康检查注释已说明）
    id: dirId,
    trust,
    groups,
    defaultGateMode,
    diagnosticEnabled: doc.diagnosticEnabled !== false,
    progressiveResetMs: (doc.progressiveResetMs as number | undefined) ?? 0,
  };
}
