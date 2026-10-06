// NarrativeBeatPlan 契约镜像件——真源：Pinax shared/narrativeBeatPlanContract.js（Q3）。
// BeatPlan 是每轮写正文前的局部节拍计划：不是世界工具、不查询外部状态、不计入 grounding。
// 镜像原因与 contract.ts 相同：适配器独立 typecheck，不跨目录引 Pinax 源码。
import { Type } from "@earendil-works/pi-ai";

export const NARRATIVE_BEAT_PLAN_SCHEMA_VERSION = 1;
export const NARRATIVE_BEAT_PLAN_TOOL = "submit_narrative_beat_plan";

export const NARRATIVE_BEAT_PLAN_LIMITS = Object.freeze({
  minCausalSteps: 0,
  maxCausalSteps: 4,
  maxCharacterMoves: 6,
  maxFunctionalDetails: 2,
  maxAvoidRepeats: 6,
  maxFieldChars: 120,
  maxChars: 2400,
});

function text(value: unknown, limit: number = NARRATIVE_BEAT_PLAN_LIMITS.maxFieldChars): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}

// P6：容错归一化——真实模型常把数组写成顿号/逗号分隔字符串
function stringArray(value: unknown, limit: number): string[] {
  const raw = Array.isArray(value)
    ? value
    : (typeof value === "string" ? value.split(/[、,，;；\n]+/) : []);
  const output: string[] = [];
  for (const item of raw) {
    const cleaned = text(item);
    if (!cleaned || output.includes(cleaned)) continue;
    output.push(cleaned);
    if (output.length >= limit) break;
  }
  return output;
}

function moveArray(value: unknown) {
  const list = Array.isArray(value)
    ? value
    : (value && typeof value === "object" && !Array.isArray(value) ? [value] : []);
  return (list as Record<string, unknown>[]).slice(0, NARRATIVE_BEAT_PLAN_LIMITS.maxCharacterMoves).map((move) => ({
    character: text(move?.character || move?.name, 80),
    intent: text(move?.intent || move?.immediateIntent),
    action: text(move?.action),
    result: text(move?.result),
  })).filter((move) => move.character);
}

function detailArray(value: unknown) {
  const list = Array.isArray(value)
    ? value
    : (value && typeof value === "object" && !Array.isArray(value) ? [value] : []);
  return (list as Record<string, unknown>[]).slice(0, NARRATIVE_BEAT_PLAN_LIMITS.maxFunctionalDetails).map((item) => ({
    detail: text(item?.detail),
    affects: text(item?.affects),
  })).filter((item) => item.detail);
}

export interface BeatPlan {
  schemaVersion: number;
  sceneThreadRevision: string;
  intent: string;
  mode: string;
  responseObligation: string;
  causalSteps: string[];
  characterMoves: { character: string; intent: string; action: string; result: string }[];
  functionalDetails: { detail: string; affects: string }[];
  revealOrChange: string;
  endCondition: string;
  avoidRepeats: string[];
  targetChars: number;
}

export function normalizeNarrativeBeatPlan(raw: unknown = {}): BeatPlan {
  const r = (raw ?? {}) as Record<string, unknown>;
  const causalSteps = stringArray(r.causalSteps, NARRATIVE_BEAT_PLAN_LIMITS.maxCausalSteps);
  return {
    schemaVersion: NARRATIVE_BEAT_PLAN_SCHEMA_VERSION,
    sceneThreadRevision: text(r.sceneThreadRevision, 120),
    intent: text(r.intent, 40),
    mode: text(r.mode, 40),
    responseObligation: text(r.responseObligation),
    causalSteps,
    characterMoves: moveArray(r.characterMoves),
    functionalDetails: detailArray(r.functionalDetails),
    revealOrChange: text(r.revealOrChange),
    endCondition: text(r.endCondition),
    avoidRepeats: stringArray(r.avoidRepeats, NARRATIVE_BEAT_PLAN_LIMITS.maxAvoidRepeats),
    targetChars: Number.isFinite(Number(r.targetChars)) ? Math.max(0, Number(r.targetChars)) : 0,
  };
}

function error(code: string, message: string): { valid: false; error: { code: string; message: string } } {
  return { valid: false, error: { code, message } };
}

function hasMetaNarrativeEndCondition(value: string) {
  return /(故事|叙事|剧情).*(结束|停下|告一段落)|等待.*(玩家|读者|下一步|选择|行动)|留待.*(下一轮|下一步|后续)/.test(value);
}

export function validateNarrativeBeatPlanInput(rawInput: unknown): { valid: true; plan: BeatPlan } | { valid: false; error: { code: string; message: string } } {
  if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput)) {
    return error("NARRATIVE_BEAT_PLAN_INVALID", "BeatPlan 必须是 JSON 对象");
  }
  const plan = normalizeNarrativeBeatPlan(rawInput);
  if (!plan.responseObligation) {
    return error("NARRATIVE_BEAT_PLAN_OBLIGATION_REQUIRED", "responseObligation 不能为空：本轮玩家输入必须得到什么回应");
  }
  if (plan.causalSteps.length > NARRATIVE_BEAT_PLAN_LIMITS.maxCausalSteps) {
    return error("NARRATIVE_BEAT_PLAN_STEPS_TOO_MANY", `causalSteps 至多 ${NARRATIVE_BEAT_PLAN_LIMITS.maxCausalSteps} 个`);
  }
  if (plan.functionalDetails.length > NARRATIVE_BEAT_PLAN_LIMITS.maxFunctionalDetails) {
    return error("NARRATIVE_BEAT_PLAN_DETAILS_TOO_MANY", `functionalDetails 至多 ${NARRATIVE_BEAT_PLAN_LIMITS.maxFunctionalDetails} 个`);
  }
  if (plan.characterMoves.length > NARRATIVE_BEAT_PLAN_LIMITS.maxCharacterMoves) {
    return error("NARRATIVE_BEAT_PLAN_MOVES_TOO_MANY", `characterMoves 至多 ${NARRATIVE_BEAT_PLAN_LIMITS.maxCharacterMoves} 个`);
  }
  if (!plan.revealOrChange) {
    return error("NARRATIVE_BEAT_PLAN_REVEAL_REQUIRED", "revealOrChange 不能为空：本轮最终新增的信息/关系/目标/局势变化");
  }
  if (!plan.endCondition) {
    return error("NARRATIVE_BEAT_PLAN_END_REQUIRED", "endCondition 不能为空：必须给出最后一个可观察场景状态");
  }
  if (hasMetaNarrativeEndCondition(plan.endCondition)) {
    return error("NARRATIVE_BEAT_PLAN_END_META", "endCondition 必须是场景内可观察的动作、台词或事实，不能描述故事结束或等待下一步");
  }
  const hasCausalStep = plan.causalSteps.length >= 1;
  const hasMoveWithResult = plan.characterMoves.some((move) => move.action && move.result);
  if (!hasCausalStep && !hasMoveWithResult) {
    return error("NARRATIVE_BEAT_PLAN_NO_CAUSAL_CONTENT", "BeatPlan 必须包含至少一个因果步骤，或一个带 action+result 的角色动作");
  }
  if (JSON.stringify(plan).length > NARRATIVE_BEAT_PLAN_LIMITS.maxChars) {
    return error("NARRATIVE_BEAT_PLAN_TOO_LONG", "BeatPlan 超过长度上限");
  }
  return { valid: true, plan };
}

export function narrativeBeatPlanRevision(plan: unknown): string {
  const normalized = normalizeNarrativeBeatPlan(plan);
  const serialized = JSON.stringify({
    obligation: normalized.responseObligation,
    steps: normalized.causalSteps,
    reveal: normalized.revealOrChange,
    end: normalized.endCondition,
    moves: normalized.characterMoves,
    details: normalized.functionalDetails,
    avoid: normalized.avoidRepeats,
  });
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `bp_${(hash >>> 0).toString(36)}`;
}

/** BeatPlan 工具的 JSON schema（进入 pi-agent 工具目录，镜像 Pinax 侧同名函数）。 */
export function narrativeBeatPlanToolSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["responseObligation", "causalSteps", "revealOrChange", "endCondition"],
    properties: {
      sceneThreadRevision: { type: "string" },
      intent: { type: "string" },
      mode: { type: "string" },
      responseObligation: { type: "string", maxLength: NARRATIVE_BEAT_PLAN_LIMITS.maxFieldChars },
      causalSteps: {
        type: "array",
        maxItems: NARRATIVE_BEAT_PLAN_LIMITS.maxCausalSteps,
        items: { type: "string", maxLength: NARRATIVE_BEAT_PLAN_LIMITS.maxFieldChars },
      },
      characterMoves: {
        type: "array",
        maxItems: NARRATIVE_BEAT_PLAN_LIMITS.maxCharacterMoves,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["action"],
          properties: {
            character: { type: "string" },
            intent: { type: "string" },
            action: { type: "string", maxLength: NARRATIVE_BEAT_PLAN_LIMITS.maxFieldChars },
            result: { type: "string", maxLength: NARRATIVE_BEAT_PLAN_LIMITS.maxFieldChars },
          },
        },
      },
      functionalDetails: {
        type: "array",
        maxItems: NARRATIVE_BEAT_PLAN_LIMITS.maxFunctionalDetails,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            detail: { type: "string" },
            affects: { type: "string" },
          },
        },
      },
      revealOrChange: { type: "string", maxLength: NARRATIVE_BEAT_PLAN_LIMITS.maxFieldChars },
      endCondition: {
        type: "string",
        maxLength: NARRATIVE_BEAT_PLAN_LIMITS.maxFieldChars,
        description: "最后一个可观察场景状态（动作完成、台词落地或事实确认）；不得描述故事结束或等待玩家行动。",
      },
      avoidRepeats: {
        type: "array",
        maxItems: NARRATIVE_BEAT_PLAN_LIMITS.maxAvoidRepeats,
        items: { type: "string", maxLength: NARRATIVE_BEAT_PLAN_LIMITS.maxFieldChars },
      },
      targetChars: { type: "integer", minimum: 0 },
    },
  };
}
