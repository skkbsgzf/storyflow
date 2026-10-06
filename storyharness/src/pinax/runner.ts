// 运行器：pi-agent 回合循环（Node 侧拥有循环）→ 事件翻译为 Pinax SSE 契约。
// 预算守护镜像 Pinax NARRATIVE_AGENT_RUNTIME_LIMITS：超限=强制收敛（收工具+要正文），不静默截断。
import { Agent } from "@earendil-works/pi-agent-core";
import {
  createNarrativeAgentStreamEvent,
  serializeNarrativeAgentSseEvent,
  NARRATIVE_TOOL_LIMITS,
  type PinaxToolName,
  type NarrativeStreamEventType,
} from "./contract.js";
import { buildPinaxTools, type ResourceSnapshot } from "./tools.js";
import { buildSystemPrompt, buildUserPrompt, buildResumePrompt, buildBeatPlannerPrompt, buildBeatPlannerUserPrompt, type TurnRequest } from "./prompt.js";
import type { BeatPlan } from "./beatPlan.js";
import { narrativeBeatPlanRevision, validateNarrativeBeatPlanInput } from "./beatPlan.js";
import type { AdapterConfig } from "./config.js";
import type { TaskSnapshot } from "./store.js";

// ---- LLM 绑定（口径统一 P1）：makeModels/THINKING_BUDGETS 单源在 kit storyharness/src/llm.ts，
// 本文件为 vendor 副本消费方——compat 旗标按 PROVIDER_PROFILES 精确注入（dots 等），generic 端点不带。----
import { makeModels, THINKING_BUDGETS } from "../llm.js";
import type { Model } from "@earendil-works/pi-ai";

export interface RunHandle {
  taskId: string;
  requestId: string;
  /** 订阅翻译后的 Pinax SSE 帧（含任务尾部扩展帧） */
  onFrame: (listener: (frame: string) => void) => () => void;
  abort: (reason?: string) => void;
  done: Promise<TaskSnapshot>;
}

interface RunCounters {
  steps: number;
  toolCalls: number;
  roundsInTurn: number;
  turnToolFlags: boolean;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
}

function usageOf(message: unknown): { inputTokens: number; outputTokens: number; totalTokens: number } | undefined {
  const u = (message as { usage?: Record<string, number> })?.usage;
  if (!u) return undefined;
  return {
    inputTokens: Number(u.input ?? u.inputTokens ?? 0),
    outputTokens: Number(u.output ?? u.outputTokens ?? 0),
    totalTokens: Number(u.totalTokens ?? (Number(u.input ?? 0) + Number(u.output ?? 0))),
  };
}

export function boundedResumeMessages(messages: unknown[] = []): unknown[] {
  // Cut only at user-turn boundaries so tool calls and results remain paired.
  let start = messages.length;
  let characters = 0;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index] as { role?: string };
    characters += JSON.stringify(message).length;
    if (message.role === "user") {
      if (start < messages.length && (messages.length - index > 32 || characters > 48000)) break;
      start = index;
    }
  }
  return messages.slice(start);
}

export function createRun(req: TurnRequest, cfg: AdapterConfig, snapshot: ResourceSnapshot, opts: { resumeMessages?: unknown[] } = {}): RunHandle {
  const listeners = new Set<(frame: string) => void>();
  let seq = 0;
  const emit = (type: NarrativeStreamEventType, payload: Record<string, unknown>) => {
    const frame = serializeNarrativeAgentSseEvent(
      createNarrativeAgentStreamEvent(type, payload, { requestId: req.requestId, seq: ++seq, at: Date.now() }),
    );
    for (const l of listeners) l(frame);
    return frame;
  };
  // 扩展帧：Pinax 流契约之外的任务生命周期信号（客户端可安全忽略未知事件）
  const emitTask = (event: string, data: Record<string, unknown>) => {
    const frame = `event: task.${event}\ndata: ${JSON.stringify({ requestId: req.requestId, at: Date.now(), ...data })}\n\n`;
    for (const l of listeners) l(frame);
  };

  const budget = { ...cfg.budget };
  for (const key of Object.keys(budget) as (keyof typeof budget)[]) {
    const requested = req.budget?.[key];
    if (typeof requested === "number" && Number.isFinite(requested) && requested > 0) budget[key] = Math.min(budget[key], Math.floor(requested));
  }
  const counters: RunCounters = { steps: 0, toolCalls: 0, roundsInTurn: 0, turnToolFlags: false, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } };

  const models = makeModels(cfg);
  const model = models.getModel(cfg.provider, cfg.model) as Model<any>;
  if (!model) throw new Error(`模型不可解析：${cfg.provider}/${cfg.model}（自定义端点需配 baseUrl）`);

  const toolNames = (Object.keys(snapshot.domains) as PinaxToolName[]).filter((n) => (snapshot.domains[n]?.length || 0) > 0);
  // BeatPlan 规划轮（②）：init/auto/respond 计划先行；continue 复用当前计划不暴露。
  // 受理的节拍计划落 runExtras + 扩展帧 beat.plan（契约枚举外，上游 parser 安全忽略）。
  const runExtras: { beatPlan: Record<string, unknown> | null; capabilityResult: Record<string, unknown> | null } = { beatPlan: null, capabilityResult: null };
  const beatPlanEnabled = (req.taskKind === "narrative" || req.taskKind === undefined) && req.mode !== "continue" && budget.maxModelSteps > 1;
  const capability = req.taskKind === "capability" ? req.capability : undefined;
  const toolHooks: Parameters<typeof buildPinaxTools>[2] = beatPlanEnabled
    ? {
        onBeatPlan: (plan: BeatPlan, revision: string) => {
          runExtras.beatPlan = { ...plan, revision };
          const frame = `event: beat.plan\ndata: ${JSON.stringify({ requestId: req.requestId, at: Date.now(), plan: runExtras.beatPlan })}\n\n`;
          for (const l of listeners) l(frame);
        },
      }
    : undefined;
  const lookupTools = buildPinaxTools(snapshot, toolNames, toolHooks);
  // 能力任务（BeatPlan 模式推广）：强制提交工具——调用回执即任务结果（语义校验在 Pinax 服务端）
  const submitToolName = capability?.submitTool.name ?? "";
  // submitTool.parameters 来自运行时 JSON schema（Record）——pi 的 TSchema 泛型面用 as 收敛（与 toolManifest 同法）
  const buildSubmitTool = (): (typeof lookupTools)[number] => ({
    name: capability!.submitTool.name,
    label: capability!.submitTool.name,
    description: capability!.submitTool.description ?? "提交本任务的最终结构化结果；提交即结束任务。",
    parameters: capability!.submitTool.parameters,
    execute: async (_toolCallId: string, args: unknown) => {
      runExtras.capabilityResult = (args && typeof args === "object") ? args as Record<string, unknown> : { value: args };
      return { content: [{ type: "text" as const, text: JSON.stringify({ ok: true, received: true }) }], details: undefined } as never;
    },
  });
  const tools = capability ? [...lookupTools, buildSubmitTool()] : lookupTools;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error("PINAX_ADAPTER_AGENT_TIMEOUT")), budget.agentTimeoutMs);

  const agent = new Agent({
    initialState: {
      systemPrompt: capability ? capability.systemPrompt : buildSystemPrompt(req, tools.map(tool => tool.name), { beatPlanEnabled }),
      model,
      tools,
      ...(opts.resumeMessages?.length ? { messages: boundedResumeMessages(opts.resumeMessages) as never } : {}),
    },
    thinkingBudgets: THINKING_BUDGETS[cfg.thinking] ?? THINKING_BUDGETS.medium,
    streamFn: (m, context, options) =>
      models.streamSimple(m, context as never, { ...(options as Record<string, unknown> | undefined), maxTokens: Math.max(200, Math.min(8000, req.maxTokens || 1600)), timeoutMs: budget.agentTimeoutMs } as never) as never,
    beforeToolCall: async (ctx) => {
      // 单轮调用限额（镜像 maxCallsPerRound）
      if (counters.toolCalls >= budget.maxCallsPerTurn) return { block: true, reason: "本次工具预算已用尽，请依据已有资料完成回答。" };
      if (counters.roundsInTurn >= NARRATIVE_TOOL_LIMITS.maxCallsPerRound) {
        return { block: true, reason: `本轮工具调用已达上限（${NARRATIVE_TOOL_LIMITS.maxCallsPerRound}），请直接依据已有资料产出正文。` };
      }
      return undefined;
    },
  });

  let finalText = "";

  agent.subscribe((ev) => {
    switch (ev.type) {
      case "turn_start":
        if (ac.signal.aborted) return;
        if (counters.steps >= budget.maxModelSteps) { ac.abort(new Error("PINAX_ADAPTER_STEP_LIMIT")); return; }
        if (counters.steps >= budget.maxModelSteps - 1 || counters.toolCalls >= budget.maxCallsPerTurn) {
          if (capability) agent.state.tools = agent.state.tools.filter((tool) => tool.name === submitToolName);
          else agent.state.tools.length = 0;
        }
        counters.steps += 1;
        counters.roundsInTurn = 0;
        counters.turnToolFlags = false;
        emit("step.start", { stepIndex: Math.min(counters.steps - 1, 20), toolChoice: agent.state.tools.length ? "auto" : "none" });
        break;
      case "message_update": {
        const aev = (ev as { assistantMessageEvent?: { type: string; delta?: string } }).assistantMessageEvent;
        if (aev?.type === "text_delta" && aev.delta) emit("text.delta", { content: aev.delta });
        // 思维链增量（dots 等深度思考模型）：契约枚举之外的扩展帧，上游 parser 按设计安全忽略
        if (aev?.type === "thinking_delta" && aev.delta) {
          const frame = `event: reasoning.delta\ndata: ${JSON.stringify({ requestId: req.requestId, at: Date.now(), delta: String(aev.delta) })}\n\n`;
          for (const l of listeners) l(frame);
        }
        break;
      }
      case "message_end": {
        const u = usageOf((ev as { message?: unknown }).message);
        if ((ev as { message?: { role?: string } }).message?.role === "assistant" && u) {
          counters.usage.inputTokens += u.inputTokens;
          counters.usage.outputTokens += u.outputTokens;
          counters.usage.totalTokens += u.totalTokens;
          emit("usage", { usage: u });
        }
        const msg = (ev as { message?: { role?: string; content?: unknown[] } }).message;
        if (msg?.role === "assistant") {
          const text = (msg.content || [])
            .filter((b) => (b as { type?: string }).type === "text")
            .map((b) => (b as { text?: string }).text || "")
            .join("");
          if (text) finalText = text;
        }
        break;
      }
      case "tool_execution_start": {
        counters.toolCalls += 1;
        counters.roundsInTurn += 1;
        counters.turnToolFlags = true;
        const args = (ev as { args?: Record<string, unknown> }).args || {};
        emit("tool.input.delta", { callId: (ev as { toolCallId?: string }).toolCallId, toolName: (ev as { toolName?: string }).toolName, input: args });
        emit("tool.call", { callId: (ev as { toolCallId?: string }).toolCallId, toolName: (ev as { toolName?: string }).toolName, action: String(args.action || "") });
        break;
      }
      case "tool_execution_end": {
        const event = ev as { toolName?: string; result?: unknown; isError?: boolean };
        const frame = `event: tool.result\ndata: ${JSON.stringify({ toolName: event.toolName, result: event.result, isError: Boolean(event.isError) })}\n\n`;
        for (const listener of listeners) listener(frame);
        // 能力任务：submit 回执落账即终态（abort 带 SUBMITTED 标记，start() 捕获后走成功终态）
        if (capability && event.toolName === submitToolName && runExtras.capabilityResult) {
          ac.abort(new Error("PINAX_ADAPTER_SUBMITTED"));
        }
        break;
      }
      case "turn_end":
        emit("step.finish", {
          stepIndex: Math.min(counters.steps - 1, 20),
          status: counters.turnToolFlags ? "tool_calls" : "final_ready",
          terminalMode: counters.turnToolFlags ? "tool-round" : "direct-text",
          toolRounds: counters.turnToolFlags ? 1 : 0,
          totalCalls: counters.toolCalls,
          finishReason: "",
        });
        // 收敛闸：达步数上限仍在用工具 → 收掉工具，下一回合只能成文（镜像 Pinax evidenceExhausted→toolChoice:none）
        if (counters.turnToolFlags && counters.steps >= budget.maxModelSteps && agent.state.tools.length) {
          if (capability) agent.state.tools = agent.state.tools.filter((tool) => tool.name === submitToolName);
          else agent.state.tools.length = 0;
        }
        break;
      default:
        break;
    }
  });

  const abort = (reason = "PINAX_ADAPTER_CANCELLED") => {
    try { ac.abort(new Error(reason)); } catch { /* already aborted */ }
  };
  let planningAgent: Agent | null = null;
  ac.signal.addEventListener("abort", () => { try { agent.abort(); planningAgent?.abort(); } catch { /* not running */ } });

  const start = async (): Promise<TaskSnapshot> => {
    // PR #4 审阅④：启动即广播 taskId——此前客户端要等任务结束才知道 id，运行中取消无从下手
    emitTask("started", { status: "running", taskId: req.taskId || "", ...(req.bookId ? { bookId: req.bookId } : {}) });
    const base: Omit<TaskSnapshot, "status" | "finalText" | "messages" | "error"> = {
      taskId: req.taskId || "", requestId: req.requestId, createdAt: Date.now(), updatedAt: Date.now(),
      mode: req.mode, ...(req.bookId ? { bookId: req.bookId } : {}),
      steps: counters.steps, toolCalls: counters.toolCalls, usage: counters.usage,
    };
    // abort 竞速：provider 侧悬挂时 Promise 可能不 settle，取消必须硬落账（cancellation 可用性）
    const abortGate = new Promise<never>((_, reject) => {
      if (ac.signal.aborted) reject(new Error("PINAX_ADAPTER_ABORTED"));
      ac.signal.addEventListener("abort", () => reject(new Error(String((ac.signal.reason as Error)?.message || "PINAX_ADAPTER_ABORTED"))));
    });
    try {
      // BeatPlan 强制规划轮（②）：计划先行——独立一次模型调用只产规划 JSON，
      // 校验受理后注入写作轮 system prompt（镜像本体「规划调用不占资料轮次」）。
      // 失败/超时静默降级：无计划也照常写（快照 beatPlan=null 诚实标记）。
      if (beatPlanEnabled) {
        try {
          let planText = "";
          counters.steps += 1;
          const planAgent = new Agent({
            initialState: { systemPrompt: buildBeatPlannerPrompt(), model, tools: [] },
            thinkingBudgets: THINKING_BUDGETS[cfg.thinking] ?? THINKING_BUDGETS.medium,
            streamFn: (m, context, options) =>
              models.streamSimple(m, context as never, { ...(options as Record<string, unknown> | undefined), maxTokens: 900, timeoutMs: Math.min(90_000, budget.agentTimeoutMs) }) as never,
          });
          planningAgent = planAgent;
          planAgent.subscribe((ev) => {
            const aev = (ev as { assistantMessageEvent?: { type: string; delta?: string } }).assistantMessageEvent;
            if (aev?.type === "text_delta" && aev.delta) planText += aev.delta;
            const u = usageOf((ev as { message?: unknown }).message);
            if (ev.type === "message_end" && (ev as { message?: { role?: string } }).message?.role === "assistant" && u) {
              counters.usage.inputTokens += u.inputTokens;
              counters.usage.outputTokens += u.outputTokens;
              counters.usage.totalTokens += u.totalTokens;
            }
          });
          await Promise.race([
            planAgent.prompt(buildBeatPlannerUserPrompt(req)),
            abortGate,
          ]);
          planningAgent = null;
          const jsonMatch = /\{[\s\S]*\}/.exec(planText);
          if (jsonMatch) {
            const r = validateNarrativeBeatPlanInput(JSON.parse(jsonMatch[0]));
            if (r.valid) {
              runExtras.beatPlan = { ...(r.plan as unknown as Record<string, unknown>), revision: narrativeBeatPlanRevision(r.plan) };
              const frame = `event: beat.plan\ndata: ${JSON.stringify({ requestId: req.requestId, at: Date.now(), plan: runExtras.beatPlan })}\n\n`;
              for (const l of listeners) l(frame);
            }
          }
          if (runExtras.beatPlan) {
            agent.state.tools = agent.state.tools.filter(tool => tool.name !== "submit_narrative_beat_plan");
            const plan = runExtras.beatPlan as unknown as BeatPlan & { revision: string };
            (agent.state as { systemPrompt: string }).systemPrompt = `${agent.state.systemPrompt}\n\n== 本轮计划已提交，无须再次规划；已受理节拍计划（revision: ${plan.revision}，落实作者要求，冲突时以作者明确要求为准）==\n回应义务：${plan.responseObligation}\n因果步骤：${plan.causalSteps.join("；") || "（无）"}\n角色行动：${plan.characterMoves.map((m) => `${m.character}：${m.action}→${m.result || "?"}`).join("；") || "（无）"}\n最终新增：${plan.revealOrChange}\n收束条件：${plan.endCondition}\n避免重复：${plan.avoidRepeats.join("；") || "（无）"}`;
          }
        } catch { /* 规划失败静默降级：无计划照常写 */ }
      }
      if (ac.signal.aborted) throw new Error("PINAX_ADAPTER_ABORTED");
      await Promise.race([
        opts.resumeMessages?.length ? agent.prompt(buildResumePrompt(req)) : agent.prompt(buildUserPrompt(req)),
        abortGate,
      ]);
      // Some compatible models print a function call as fenced code instead of executing it.
      // One repair stays inside the same task, transcript, step/call budgets and timeout.
      const printedToolCall = () => /^\s*```[\s\S]*?(?:functions\.)?(?:calc_evaluate|manuscript_search|manuscript_get|notes_search|outline_lookup|world_lookup)\s*\(/.test(finalText);
      if (printedToolCall() && counters.steps < budget.maxModelSteps) {
        await Promise.race([agent.prompt("上轮只打印了工具调用代码，没有实际执行。请使用协议中的 tool call 字段执行工具，得到返回结果后再回答；禁止输出调用代码。"), abortGate]);
      }
      if (printedToolCall()) throw new Error("PINAX_ADAPTER_TOOL_CALL_NOT_EXECUTED");
      // 能力任务兜底（双层）：模型按指令卡把结果 JSON 当文本返回而非调用 submit 工具——
      // ① 文本里的 JSON 直接作为回执接收（传输形态不同，结果等价）；
      // ② 文本无 JSON 且预算允许 → 一次修复重试显式要求调用 submit 工具。
      if (capability && !runExtras.capabilityResult) {
        const extractJson = () => {
          const match = /\{[\s\S]*\}/.exec(finalText);
          if (!match) return null;
          try {
            const parsed = JSON.parse(match[0]);
            return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
          } catch { return null; }
        };
        const fromText = extractJson();
        if (fromText) {
          runExtras.capabilityResult = fromText;
        } else if (counters.steps < budget.maxModelSteps) {
          await Promise.race([agent.prompt(`禁止以文本返回结果。请调用工具 ${capability.submitTool.name}，把上述 JSON 作为该工具的参数整体提交。`), abortGate]);
          const retry = extractJson();
          if (retry) runExtras.capabilityResult = retry;
        }
      }
      if (!finalText.trim() && !(capability && runExtras.capabilityResult)) {
        // 守卫：provider 无 key/端点异常曾被静默吞成「空成功」——这里显式落 failed（实验抓到的缺陷）
        const err = { code: "PINAX_ADAPTER_EMPTY_COMPLETION", message: "回合结束但未产出正文（多为 provider 鉴权失败或端点异常）", retryable: false };
        emit("error", { code: err.code, message: err.message, retryable: err.retryable });
        emitTask("failed", { status: "failed", taskId: req.taskId || base.taskId, error: err });
        return { ...base, steps: counters.steps, toolCalls: counters.toolCalls, beatPlan: runExtras.beatPlan, status: "failed", finalText, messages: agent.state.messages as unknown[], error: err };
      }
      if (capability && !runExtras.capabilityResult) {
        // 能力任务守卫：预算耗尽仍未提交——显式失败（空成功禁令同样适用）
        const err = { code: "PINAX_ADAPTER_NO_SUBMISSION", message: "能力任务结束但未调用提交工具", retryable: false };
        emit("error", { code: err.code, message: err.message, retryable: false });
        emitTask("failed", { status: "failed", taskId: req.taskId || base.taskId, error: err });
        return { ...base, steps: counters.steps, toolCalls: counters.toolCalls, beatPlan: null, status: "failed", finalText, messages: agent.state.messages as unknown[], error: err };
      }
      emit("usage", { usage: counters.usage });
      emitTask("completed", { status: "completed", taskId: req.taskId || base.taskId, model: `${cfg.provider}.${cfg.model}`, usage: counters.usage, steps: counters.steps, toolCalls: counters.toolCalls, textChars: finalText.length, finalText, beatPlan: runExtras.beatPlan, ...(capability ? { capabilityResult: runExtras.capabilityResult } : {}) });
      return { ...base, steps: counters.steps, toolCalls: counters.toolCalls, beatPlan: runExtras.beatPlan, status: "completed", finalText, messages: agent.state.messages as unknown[], ...(capability ? { capabilityResult: runExtras.capabilityResult } : {}) };
    } catch (e) {
      // 能力任务：SUBMITTED 不是取消——提交回执已落账，走成功终态（finalText 可空）
      if (ac.signal.aborted && String((ac.signal.reason as Error)?.message || "") === "PINAX_ADAPTER_SUBMITTED" && runExtras.capabilityResult) {
        emit("usage", { usage: counters.usage });
        emitTask("completed", { status: "completed", taskId: req.taskId || base.taskId, model: `${cfg.provider}.${cfg.model}`, usage: counters.usage, steps: counters.steps, toolCalls: counters.toolCalls, textChars: finalText.length, finalText, beatPlan: null, capabilityResult: runExtras.capabilityResult });
        return { ...base, steps: counters.steps, toolCalls: counters.toolCalls, beatPlan: null, status: "completed", finalText, messages: agent.state.messages as unknown[], capabilityResult: runExtras.capabilityResult };
      }
      // 能力任务：步数收敛（STEP_LIMIT）仍未提交 → 显式 NO_SUBMISSION 失败（非用户取消）
      if (capability && ac.signal.aborted && String((ac.signal.reason as Error)?.message || "") === "PINAX_ADAPTER_STEP_LIMIT" && !runExtras.capabilityResult) {
        const err = { code: "PINAX_ADAPTER_NO_SUBMISSION", message: "能力任务在步数预算内未调用提交工具", retryable: false };
        emit("error", { code: err.code, message: err.message, retryable: false });
        emitTask("failed", { status: "failed", taskId: req.taskId || base.taskId, error: err });
        return { ...base, steps: counters.steps, toolCalls: counters.toolCalls, beatPlan: null, status: "failed", finalText, messages: agent.state.messages as unknown[], error: err };
      }
      const aborted = ac.signal.aborted;
      const msg = String((e as Error)?.message || e);
      const err = aborted
        ? { code: "PINAX_ADAPTER_ABORTED", message: "任务已取消/超时", retryable: true }
        : { code: "PINAX_AGENT_RUN_FAILED", message: msg.slice(0, 240), retryable: /terminated|fetch|ECONN|network|timed out/i.test(msg) };
      emit("error", { code: err.code, message: err.message, retryable: err.retryable });
      emitTask("failed", { status: aborted ? "cancelled" : "failed", taskId: req.taskId || base.taskId, error: err });
      return { ...base, steps: counters.steps, toolCalls: counters.toolCalls, beatPlan: runExtras.beatPlan, status: aborted ? "cancelled" : "failed", finalText, messages: agent.state.messages as unknown[], error: err };
    } finally {
      clearTimeout(timer);
    }
  };

  // 启动推迟一个微任务：server 在 createRun 返回后才订阅 onFrame——同步启动会让
  // task.started 帧发进空监听集（客户端永远收不到 taskId，运行中取消无从下手）
  const run: Promise<TaskSnapshot> = Promise.resolve().then(start);
  return {
    taskId: req.taskId || "",
    requestId: req.requestId,
    onFrame: (l) => { listeners.add(l); return () => listeners.delete(l); },
    abort,
    done: run,
  };
}
