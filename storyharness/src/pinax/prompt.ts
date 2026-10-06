// 上下文注入：每 turn 把 Pinax 随请求带来的会话状态拼成 system prompt（注意事项 4）。
// kernel.blocks 直接复用 Pinax 已预算化的 serializeKernelWithinTextPartBudget 产物——
// 预算在源头算过一次，适配器不重算第二套真相。
import { NARRATIVE_TOOL_LIMITS, type PinaxToolName } from "./contract.js";

export interface KernelBlock {
  kind: string;
  title?: string;
  text?: string;
  [key: string]: unknown;
}

export interface TurnRequest {
  taskId?: string;
  requestId: string;
  /** 作品归属（PR #4 审阅②）：任务开始时固定；resume 由客户端重发同值 */
  bookId?: string;
  mode: "init" | "continue" | "auto" | "respond";
  intent?: string | null;
  formatInstructions?: string;
  maxTokens?: number;
  taskKind?: "assistant" | "narrative";
  /** Pinax serializeKernelWithinTextPartBudget 的产物 */
  kernel: { revision?: string; blocks: KernelBlock[]; toolCatalog?: { name: string }[] };
  /** 资源快照（工具桥数据源） */
  resources: {
    revision?: string;
    currentPlaceId?: string;
    coverage?: Record<string, unknown>;
    domains: Partial<Record<PinaxToolName | "manuscript" | "notes" | "outline", unknown[]>>;
  };
  budget?: {
    agentTimeoutMs?: number;
    maxModelSteps?: number;
    maxCallsPerTurn?: number;
    maxToolResultChars?: number;
  };
  /** 恢复：附带已完成 turn 的转录，续跑而非重跑 */
  resumeFrom?: string;
}

export function buildSystemPrompt(req: TurnRequest, toolNames: string[], options: { beatPlanEnabled?: boolean } = {}) {
  const blocks = (req.kernel.blocks || [])
    .map((b) => {
      const t = String(b.text ?? "").trim();
      if (!t) return "";
      return `【${b.title || b.kind}】\n${t}`;
    })
    .filter(Boolean)
    .join("\n\n");

  const toolsGuide = toolNames.length
    ? `你可以调用以下资料工具核实设定，禁止凭记忆或虚构回答资料可查的问题：\n${toolNames
        .map((n) => `- ${n}：${(TOOL_ACTIONS as Record<string, readonly string[]>)[n] ? `actions=${JSON.stringify(TOOL_ACTIONS[n])}` : "按工具声明的 schema 提交输入"}（单次最多返回 ${NARRATIVE_TOOL_LIMITS.maxItems} 条，结果≤${NARRATIVE_TOOL_LIMITS.maxResultChars}字）`)
        .join("\n")}`
    : "本轮无资料工具可用；对没有把握的设定明确说不知道，不得编造。";

  return [
    "你是 Pinax 叙事引擎中的场景生成 Agent（由 StoryFlow harness 驱动）。",
    "你的任务：依据下述会话上下文与资料工具，产出连贯、可信、符合格式要求的叙事正文。",
    "",
    "== 交互纪律 ==",
    "用户消息分两类：①对话类（问好、提问、讨论、要求澄清、关于任务的元交流）——直接自然回应，禁止强行产出小说正文；",
    "②写作类（写/续写/推进/改写/开场等明确创作请求）——才产出叙事正文。",
    "判断不了时先简短确认意图，不要默认倾倒正文。",
    "",
    "== 会话上下文（Pinax Kernel，按注入预算裁剪，revision: " + (req.kernel.revision || "-") + "）==",
    blocks || "（无注入块）",
    req.resources.coverage ? `资料覆盖范围（快照有数量和长度上限，不代表全书完整阅读）：${JSON.stringify(req.resources.coverage)}` : "",
    "",
    "== 资料工具纪律 ==",
    toolsGuide,
    "- 必须通过实际 tool call 调用工具；不可把 functions.xxx(...) 或工具调用代码块当作执行。数值计算必须先得到 calc_evaluate 的返回结果。",
    "- 工具返回的 items 是唯一可信资料；引用时保持设定一致，冲突时以资料为准。",
    `- 每轮最多 ${NARRATIVE_TOOL_LIMITS.maxCallsPerRound} 次工具调用，全程最多 ${NARRATIVE_TOOL_LIMITS.maxCallsPerTurn} 次；预算耗尽必须直接产出正文。`,
    options.beatPlanEnabled
      ? "- 规划先行：动笔前先调用 submit_narrative_beat_plan 提交本轮节拍计划（回应义务/因果步骤/角色行动带 result/最终新增信息/可观察收束条件）；计划只能落实作者要求，不能覆盖作者明确限制。"
      : "",
    "",
    req.formatInstructions ? `== 输出格式要求 ==\n${req.formatInstructions}` : "",
  ].filter(Boolean).join("\n");
}

const TOOL_ACTIONS: Record<string, readonly string[]> = {
  world_lookup: ["search", "get", "related"],
  geo_lookup: ["current", "get", "nearby", "route"],
  history_lookup: ["search", "get", "trace"],
  memory_lookup: ["search", "get"],
  politics_lookup: ["current", "get", "trace"],
};

export function buildUserPrompt(req: TurnRequest): string {
  const modeHint: Record<TurnRequest["mode"], string> = {
    init: "开场：建立场景、人物处境与压迫感入口，铺开第一段。",
    continue: "续写当前场景，衔接最近正文，不重播已发生事件。",
    auto: "按玩家行动自动推进剧情。",
    respond: "回应玩家/角色的当前行动与对白。",
  };
  return [
    req.taskKind === "assistant" ? "按作者意图讨论、查证或创作。不要自行将讨论变为正文。" : `模式：${req.mode}。${modeHint[req.mode] || ""}`,
    req.intent ? `本轮意图：${req.intent}` : "",
    `目标产出：若本轮是写作类请求，产出叙事正文（约 ${req.maxTokens || 1600} tokens 预算内，先查资料后动笔）；对话类请求直接回应即可。`,
  ].filter(Boolean).join("\n");
}

// 恢复/追问：转录末尾是 assistant 正文时 pi-agent 的 continue() 会拒绝
// （Cannot continue from message role: assistant），必须以新 user 轮续接转录。
export function buildResumePrompt(req: TurnRequest): string {
  return [
    req.intent ? `作者追问/指令：${req.intent}` : "作者要求继续推进。请接着当前转录产出叙事正文，不重播已发生事件。",
    `目标产出：若本轮是写作类请求，产出叙事正文（约 ${req.maxTokens || 1600} tokens 预算内，可先查资料）；对话类请求直接回应即可。`,
  ].join("\n");
}

// BeatPlan 强制规划轮（镜像本体「计划先行，规划调用不占资料轮次」）：
// 规划是独立的一次模型调用，只输出契约 JSON；受理后注入写作轮 system prompt。
export function buildBeatPlannerPrompt(): string {
  return [
    "你是节拍规划器。只输出一个 JSON 对象——不要 markdown、不要解释、不要多余字段。",
    "字段契约：",
    '- responseObligation（必填）：本轮输入必须得到什么回应（≤120字）',
    "- causalSteps（≤4 个字符串）：带因果的推进步骤",
    '- characterMoves（≤6 个对象）：{ character, action, result? }，result 是动作的可观察后果',
    "- revealOrChange（必填）：本轮最终新增的信息/关系/目标/局势变化（≤120字）",
    "- endCondition（必填）：最后一个可观察场景状态（动作完成/台词落地/事实确认）；禁止「故事结束/等待玩家行动」类元叙事",
    "- avoidRepeats（≤6）：不得重复的既有桥段",
    "至少一个 causalStep，或一个带 action+result 的 characterMove。产出必须是合法 JSON。",
  ].join("\n");
}

export function buildBeatPlannerUserPrompt(req: TurnRequest): string {
  const blocks = (req.kernel.blocks || [])
    .map((b) => `【${b.title || b.kind}】${String(b.text ?? "").trim()}`.slice(0, 400))
    .filter((t) => t.length > 6)
    .join("\n");
  return [
    `模式：${req.mode}`,
    req.intent ? `本轮意图：${req.intent}` : "",
    "== 上下文 ==",
    blocks || "（无注入块）",
    "== 任务 ==",
    "为下一轮叙事产出提交节拍计划 JSON。",
  ].filter(Boolean).join("\n");
}
