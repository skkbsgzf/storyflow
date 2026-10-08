// 统一模型漏斗基座（2026-10-07）：/model 热切换 + /complete 一次性补全转发。
// - /model：patch {provider?, model!, baseUrl?, apiKey?, thinking?, api?} → 持久化配置文件 + 内存 cfg 热生效
//   （makeModels/getModel/THINKING_BUDGETS 均在 createRun 时读取，改 cfg 即对新区间生效，无需重启）。
//   api 是传输协议轴（openai-completions / anthropic-messages），缺省 openai-completions。
//   注意 zai provider 会把内联 key 写 process.env.ZAI_API_KEY（粘性）——切走后再切回需重发 key。
// - /complete：pi-ai Models.complete 一次性补全（无需 Agent 循环）；
//   消费方（Pinax server 漏斗）只经此内部协议调用，key 只写不回显。
import fs from "node:fs";
import path from "node:path";
import type { AdapterConfig } from "./config.js";
import { configPath } from "./config.js";
import { makeModels, resolveModel, THINKING_BUDGETS, type LlmApi } from "../llm.js";

const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high"]);
const API_PROTOCOLS = new Set<LlmApi>(["openai-completions", "anthropic-messages"]);

export interface ModelPatch {
  provider?: string;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  thinking?: string;
  api?: LlmApi;
}

export function maskKey(key?: string): string | null {
  return key ? `${key.slice(0, 4)}****${key.slice(-4)}` : null;
}

export function modelStatus(cfg: AdapterConfig) {
  return { provider: cfg.provider, model: cfg.model, baseUrl: cfg.baseUrl ?? null, api: cfg.api ?? "openai-completions", thinking: cfg.thinking, keyMasked: maskKey(cfg.apiKey) };
}

function readConfigFile(file: string): Record<string, unknown> {
  try { return JSON.parse(fs.readFileSync(file, "utf-8")); } catch { return {}; }
}

/** 校验并收敛 patch；返回 {ok:false,message} 或 {ok:true,patch（只含合法字段）}。 */
export function validateModelPatch(body: unknown): { ok: true; patch: ModelPatch } | { ok: false; message: string } {
  if (!body || typeof body !== "object") return { ok: false, message: "请求体必须是对象" };
  const raw = body as Record<string, unknown>;
  const patch: ModelPatch = {};
  if (raw.provider !== undefined) {
    if (typeof raw.provider !== "string" || !raw.provider.trim()) return { ok: false, message: "provider 非法" };
    patch.provider = raw.provider.trim();
  }
  if (typeof raw.model !== "string" || !raw.model.trim()) return { ok: false, message: "model 必填" };
  patch.model = raw.model.trim();
  if (raw.baseUrl !== undefined) {
    if (raw.baseUrl !== null && typeof raw.baseUrl !== "string") return { ok: false, message: "baseUrl 非法" };
    patch.baseUrl = raw.baseUrl ? String(raw.baseUrl).trim() : "";
  }
  if (raw.apiKey !== undefined) {
    if (raw.apiKey !== null && typeof raw.apiKey !== "string") return { ok: false, message: "apiKey 非法" };
    patch.apiKey = String(raw.apiKey ?? "");
  }
  if (raw.api !== undefined) {
    if (typeof raw.api !== "string" || !API_PROTOCOLS.has(raw.api as LlmApi)) {
      return { ok: false, message: `api 必须是 ${[...API_PROTOCOLS].join("/")}` };
    }
    patch.api = raw.api as LlmApi;
  }
  if (raw.thinking !== undefined) {
    if (typeof raw.thinking !== "string" || !THINKING_LEVELS.has(raw.thinking)) return { ok: false, message: `thinking 必须是 ${[...THINKING_LEVELS].join("/")}` };
    patch.thinking = raw.thinking;
  }
  return { ok: true, patch };
}

/** 持久化 patch 到配置文件（读-合并-写，原子替换），并把合法字段热赋到内存 cfg。返回热切后的模型标识。 */
export function applyModelPatch(cfg: AdapterConfig, patch: ModelPatch): string {
  const file = configPath(process.env);
  const merged = { ...readConfigFile(file), ...patch } as Record<string, unknown>;
  for (const key of ["baseUrl", "apiKey"]) {
    if (merged[key] === "") delete merged[key];
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(merged, null, 2) + "\n", "utf-8");
  fs.renameSync(tmp, file);
  // 内存热生效：makeModels/getModel/THINKING_BUDGETS 在每次 createRun 时读 cfg
  for (const [key, value] of Object.entries(patch)) {
    if (value === "") {
      if (key === "baseUrl") delete cfg.baseUrl;
      if (key === "apiKey") delete cfg.apiKey;
      continue;
    }
    (cfg as unknown as Record<string, unknown>)[key] = value;
  }
  return `${cfg.provider}.${cfg.model}`;
}

export interface CompleteRequest {
  systemPrompt?: string;
  messages: CompleteMessage[];
  tools?: { name: string; description?: string; parameters?: Record<string, unknown> }[];
  toolChoice?: "auto" | "none" | { type: "function"; function: { name: string } };
  temperature?: number;
  maxTokens?: number;
  thinking?: string;
  responseFormat?: "json_object";
  timeoutMs?: number;
}

/** 四角色 transcript（与 Pinax generationToolContract 对齐）：叙事工具回合需要 assistant 工具轮与 tool 结果轮。 */
export interface CompleteMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string;
  toolCalls?: { id: string; name: string; arguments: Record<string, unknown> }[];
  toolCallId?: string;
  toolName?: string;
  output?: string;
  isError?: boolean;
}

export function validateCompleteRequest(body: unknown): { ok: true; value: CompleteRequest } | { ok: false; message: string } {
  if (!body || typeof body !== "object") return { ok: false, message: "请求体必须是对象" };
  const raw = body as Record<string, unknown>;
  if (!Array.isArray(raw.messages) || !raw.messages.length) return { ok: false, message: "messages 必填" };
  const messages: CompleteMessage[] = [];
  for (const item of raw.messages) {
    const message = item as Record<string, unknown>;
    if (!message || typeof message !== "object") return { ok: false, message: "messages 项非法" };
    const role = String(message.role || "");
    if (!["system", "user", "assistant", "tool"].includes(role)) return { ok: false, message: `messages.role 非法：${role}` };
    if (role === "tool") {
      if (typeof message.toolCallId !== "string" || !message.toolCallId) return { ok: false, message: "tool 消息需要 toolCallId" };
      messages.push({
        role: "tool",
        content: typeof message.content === "string" ? message.content : "",
        toolCallId: message.toolCallId,
        toolName: typeof message.toolName === "string" ? message.toolName : "",
        output: typeof message.output === "string" ? message.output : "",
        isError: message.isError === true
      });
      continue;
    }
    if (role === "assistant" && Array.isArray(message.toolCalls)) {
      const toolCalls = message.toolCalls.map((call) => {
        const callItem = call as Record<string, unknown>;
        return {
          id: String(callItem?.id || ""),
          name: String(callItem?.name || ""),
          arguments: (callItem?.arguments && typeof callItem.arguments === "object" ? callItem.arguments : {}) as Record<string, unknown>
        };
      }).filter((call) => call.id && call.name);
      messages.push({
        role: "assistant",
        content: typeof message.content === "string" ? message.content : "",
        toolCalls
      });
      continue;
    }
    if (typeof message.content !== "string") return { ok: false, message: `messages[${role}].content 必须是字符串` };
    messages.push({ role: role as "system" | "user" | "assistant", content: message.content });
  }
  if (!messages.length) return { ok: false, message: "messages 无有效项" };
  // 20261009 空提示词护栏：全部 user/system 轮正文为空（且无独立 systemPrompt）时，
  // 模型只会自由发挥——这是提示词组装回归的最后一道防线（Pinax 侧曾静默发生，产出与提示词无关的文本）。
  const hasAnchoredPrompt =
    messages.some((m) => (m.role === "user" || m.role === "system") && String(m.content ?? "").trim().length > 0) ||
    (typeof raw.systemPrompt === "string" && raw.systemPrompt.trim().length > 0);
  if (!hasAnchoredPrompt) return { ok: false, message: "所有 user/system 轮正文为空——疑似提示词组装回归，拒绝转发" };
  const value: CompleteRequest = {
    messages,
    ...(typeof raw.systemPrompt === "string" ? { systemPrompt: raw.systemPrompt } : {}),
    ...(Array.isArray(raw.tools) ? { tools: raw.tools as CompleteRequest["tools"] } : {}),
    ...(raw.toolChoice !== undefined ? { toolChoice: raw.toolChoice as CompleteRequest["toolChoice"] } : {}),
    ...(Number.isFinite(Number(raw.temperature)) ? { temperature: Number(raw.temperature) } : {}),
    ...(Number.isFinite(Number(raw.maxTokens)) ? { maxTokens: Number(raw.maxTokens) } : {}),
    ...(typeof raw.thinking === "string" && THINKING_LEVELS.has(raw.thinking) ? { thinking: raw.thinking } : {}),
    ...(raw.responseFormat === "json_object" ? { responseFormat: "json_object" } : {}),
    ...(Number.isFinite(Number(raw.timeoutMs)) ? { timeoutMs: Number(raw.timeoutMs) } : {})
  };
  return { ok: true, value };
}

/** 把四角色 transcript 映射为 pi-ai Context（assistant 工具轮 → toolCall 块；tool → toolResult；tools 挂 context）。 */
function toPiContext(request: CompleteRequest) {
  let systemPrompt = request.systemPrompt ?? "";
  const messages: unknown[] = [];
  for (const message of request.messages) {
    if (message.role === "system") {
      systemPrompt = systemPrompt ? `${systemPrompt}\n\n${message.content}` : (message.content ?? "");
      continue;
    }
    if (message.role === "tool") {
      messages.push({
        role: "toolResult",
        toolCallId: message.toolCallId ?? "",
        toolName: message.toolName ?? "",
        content: [{ type: "text", text: message.output ?? message.content ?? "" }],
        isError: message.isError === true,
        timestamp: Date.now()
      });
      continue;
    }
    if (message.role === "assistant" && message.toolCalls?.length) {
      const blocks: unknown[] = [];
      if (message.content) blocks.push({ type: "text", text: message.content });
      for (const call of message.toolCalls) blocks.push({ type: "toolCall", id: call.id, name: call.name, arguments: call.arguments });
      messages.push({ role: "assistant", content: blocks, timestamp: Date.now() });
      continue;
    }
    messages.push({ role: message.role, content: message.content ?? "", timestamp: Date.now() });
  }
  return {
    ...(systemPrompt ? { systemPrompt } : {}),
    messages,
    ...(request.tools?.length ? { tools: request.tools.map((tool) => ({ name: tool.name, description: tool.description ?? "", parameters: tool.parameters ?? { type: "object", properties: {} } })) } : {})
  };
}

/** pi-ai 一次性补全：makeModels(cfg) + models.complete（tools 走 context，responseFormat 走 samplingParams 逃生舱）。 */
export async function runComplete(cfg: AdapterConfig, request: CompleteRequest, signal?: AbortSignal) {
  const models = makeModels(cfg);
  const model = resolveModel(models, cfg);
  const thinking = (request.thinking ?? cfg.thinking) as string;
  const options: Record<string, unknown> = {
    ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
    maxTokens: request.maxTokens ?? 4096,
    ...(request.timeoutMs ? { timeoutMs: request.timeoutMs } : {}),
    ...(signal ? { signal } : {}),
    ...(THINKING_BUDGETS[thinking] ? { thinkingBudgets: THINKING_BUDGETS[thinking] } : {}),
    ...(request.toolChoice !== undefined ? { toolChoice: request.toolChoice } : {}),
    ...(request.responseFormat ? { samplingParams: { response_format: { type: request.responseFormat } } } : {})
  };
  const message = await models.complete(model, toPiContext(request) as never, options as never);
  const content = (message.content ?? []).filter((block) => block.type === "text").map((block) => (block as { text?: string }).text ?? "").join("");
  const toolCalls = (message.content ?? []).filter((block) => block.type === "toolCall").map((block) => {
    const call = block as { id?: string; name: string; arguments: Record<string, unknown> };
    return { id: call.id ?? "", name: call.name, arguments: call.arguments };
  });
  return {
    ok: true,
    content,
    toolCalls,
    finishReason: message.stopReason ?? "stop",
    usage: message.usage ? { inputTokens: message.usage.input ?? 0, outputTokens: message.usage.output ?? 0, totalTokens: message.usage.totalTokens ?? 0 } : null,
    model: `${cfg.provider}.${cfg.model}`
  };
}

/** 流式补全：增量回调 + 完整结果（与 runComplete 同返回形状）。 */
export async function runCompleteStream(cfg: AdapterConfig, request: CompleteRequest, onDelta: (delta: string) => void, signal?: AbortSignal) {
  const models = makeModels(cfg);
  const model = resolveModel(models, cfg);
  const thinking = (request.thinking ?? cfg.thinking) as string;
  const options: Record<string, unknown> = {
    ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
    maxTokens: request.maxTokens ?? 4096,
    ...(request.timeoutMs ? { timeoutMs: request.timeoutMs } : {}),
    ...(signal ? { signal } : {}),
    ...(THINKING_BUDGETS[thinking] ? { thinkingBudgets: THINKING_BUDGETS[thinking] } : {})
  };
  const events = models.streamSimple(model, toPiContext(request) as never, options as never);
  let content = "";
  for await (const event of events) {
    const item = event as { type?: string; delta?: string };
    if (item.type === "text_delta" && typeof item.delta === "string" && item.delta) {
      content += item.delta;
      onDelta(item.delta);
    }
  }
  return { ok: true, content, toolCalls: [], finishReason: content ? "stop" : "empty", usage: null, model: `${cfg.provider}.${cfg.model}` };
}
