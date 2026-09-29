// 交互对话环（pi 单脑的交互面）：与产线执行器同一个 pi Agent，只是由人驱动。
//   会话持久化 = 内部/sessions/<sid>.jsonl（mode=chat；executor 轨迹同库，网页「对话」页签一并可见）。
//   事件形状镜像内核 http.ts 的 AgentEvent（delta/thinking_delta/tool_call/tool_result/round/done/error）
//   ——工作台对话页签只需切 API 基址即可换脑，不改渲染（R4 §5.3 单名不兜底）。
//   护栏：工具环带 lifecycle（flow 六动词），flow_gate/set_decision 仍不入环（铁律 6）。
//   B9（2026-09-28）指标面：provider 逐条 usage 随 message 行落盘，每回合收口再落一行 chat_turn_end
//   （本轮用量＋会话累计＋上下文占用＋压缩压力读数）。sessionStats() 只重放这些行——面板上的数字
//   与磁盘上的账是同一份（铁律 10：报数必附收据，收据要能指回 jsonl 行号）。
import {
  Agent,
  DEFAULT_COMPACTION_SETTINGS, estimateContextTokens,
} from "@earendil-works/pi-agent-core";
import { buildTools } from "./tools.js";
import { makeAnalysisTools } from "./analysis.js";
import { makeModels, makeStreamFn, resolveModel } from "./llm.js";
import {
  newSession, appendSession, endSession, capResult, readSession, listSessions, readSessionNumbered, sessionFile,
  normUsage, addUsage, zeroUsage,
  type TokenUsage, type SessionMeta,
} from "./sessions.js";
import {
  compactionReadout, contextReadout, modelMeta, replayStats, rateOf,
  type EventRow, type ModelMeta, type SessionStats, type ContextReadout,
} from "./metrics.js";
import { buildProjectBrief } from "./brief.js";
import * as fs from "node:fs";
import path from "node:path";
import type { KernelClient } from "./kernel.js";
import type { HarnessConfig } from "./config.js";

export type ChatEvent =
  | { type: "delta"; text: string }
  | { type: "thinking_delta"; text: string }
  | { type: "tool_call"; id: string; name: string; args: string }
  | { type: "tool_result"; id: string; name: string; ok: boolean; content: string }
  | { type: "round"; n: number }
  | { type: "done"; text: string; turn?: { rounds: number; toolCalls: number; usage: TokenUsage }; context?: ContextReadout; model?: { provider: string; id: string; contextWindow: number } }
  | { type: "error"; message: string };

const CHAT_SYSTEM = [
  "你是 StoryHarness 创作助手（pi 单脑）：交互对话与产线执行器是同一个 agent，只是现在由人驱动。",
  "工作区纪律：",
  "- 开工先 mf_whereami 看盘面；立项走 mf_flow_list → mf_flow_init → mf_flow_run（type=enum 的输入必须先问清用户，缺了内核会抛「选择未决」）。",
  "- 产出正文写到任务包 outputContract.file 指定路径（fs_write），再 mf_flow_submit 交卷；被拒会带拒因，按拒因修了再交。",
  "- 写前用 mf_kb_search / mf_kb_read 找判定标尺；设定口径查 mf_worldbook_search；交卷前可 mf_quality_scan 出证据。",
  "- 门裁决（flow_gate）与决策写入（set_decision）不在你的工具环——如实告诉用户去工作台或 CLI 由人操作，不要假装已裁决。",
  "- 文件路径一律相对项目根；不要改 flow/state/registry 等运行状态文件。全程中文。",
].join("\n");

/** 权限四档（对齐 Codex 模式）：每档 = 工具子集 + 系统提示附加段。 */
export type ChatMode = "plan" | "confirm" | "auto" | "full";
export const CHAT_MODES: Record<ChatMode, { label: string; systemAddon: string }> = {
  plan: { label: "计划模式", systemAddon: "当前为计划模式：你只有只读工具——只做调研、盘面分析与方案建议，不产出文件、不推进流程。" },
  confirm: { label: "变更前确认", systemAddon: "当前为变更前确认模式：写文件或推进流程前，必须先在回复里列出将要做的变更（写什么文件/交什么卷），等用户在下一轮消息里明确同意后才执行。" },
  auto: { label: "自动编辑", systemAddon: "当前为自动编辑模式：文件写入可直接执行；推进流程（mf_flow_run/mf_flow_submit/mf_flow_resume）前先在回复里说明你要做什么。" },
  full: { label: "完全访问", systemAddon: "" },
};

/** 按权限档装配工具环（E-A 权限四档）：plan=只读；其余档全环（confirm/auto 靠提示词纪律）。 */
export function toolsForMode(kernel: KernelClient, project: string, mode: ChatMode): ReturnType<typeof buildTools> {
  const all = buildTools(kernel, project, { lifecycle: mode !== "plan" });
  if (mode === "plan") return all.filter((t) => t.name !== "fs_write");
  return all;
}

const THINKING_BUDGETS: Record<string, Record<string, number>> = {
  off: {},
  low: { low: 1024, medium: 2048, high: 4096 },
  medium: { low: 2048, medium: 8192, high: 16384 },
  high: { low: 4096, medium: 16384, high: 32768 },
};

type AgentMessageLike = { role: string; content: unknown };

/** 从会话 JSONL 重建 pi 消息历史（message 事件原样存了 pi 的 role/content 形状）。 */
function rebuildMessages(kernel: KernelClient, project: string, sid: string): AgentMessageLike[] {
  return readSession(kernel.projectDir(project), kernel.corpus, sid)
    .filter((e) => e.kind === "message")
    .map((e) => ({ role: (e as unknown as { role: string }).role, content: (e as unknown as { content: unknown }).content }));
}

export interface ChatIndexEntry { id: string; title: string; updatedAt: string; turns: number; mode: string; ended: boolean }

/** 会话清单（含 executor 轨迹——产线跑的每一步在「对话」页签同样可看）。 */
export function listChats(kernel: KernelClient, project: string): ChatIndexEntry[] {
  return listSessions(kernel.projectDir(project), kernel.corpus).map((s) => ({
    id: s.sid,
    title: s.meta.title || (s.meta.mode === "executor" ? `执行器 · ${s.meta.node ?? s.sid}` : s.sid),
    updatedAt: s.mtime,
    turns: s.turns,
    mode: s.meta.mode ?? "chat",
    ended: s.ended,
    pinned: s.pinned,
    archived: s.archived,
  }));
}

export function createChat(kernel: KernelClient, project: string, title?: string): { id: string } {
  const sid = newSession(kernel.projectDir(project), kernel.corpus, { project, mode: "chat", title: title || "新会话" });
  return { id: sid };
}

export function chatTranscript(kernel: KernelClient, project: string, sid: string, opts?: { withCuts?: boolean }): { id: string; title: string; updatedAt: string; turns: number; messages: Record<string, unknown>[]; events: Array<{ ts: string; event: Record<string, unknown> }>; cuts?: number[] } {
  const events = readSession(kernel.projectDir(project), kernel.corpus, sid);
  if (!events.length) throw new Error("会话不存在");
  const start = events[0] as { kind: string; meta?: { title?: string; mode?: string; node?: string } };
  // 从 JSONL 事件重建内核形状（assistant.tool_calls + role:"tool"）——工作台回放零渲染改动
  // 就能还原工具卡；纯工具回合的空文本不产生空气泡（用户实测截图病灶）。
  const messages: Record<string, unknown>[] = [];
  // C6 · withCuts：平行记录每条（存活）消息的首事件行下标（events 数组序，session_start=0）。
  // fork?at 用它做逐字前缀拷贝的切点——分叉逻辑不复制分段规则，避免两套「什么是下一条消息」漂移。
  const cuts: number[] = [];
  let cur: { role: "assistant"; content: string; tool_calls: { id: string; type: "function"; function: { name: string; arguments: string } }[]; usage?: TokenUsage; model?: { provider: string; id: string }; firstEv: number } | null = null;
  // B18/B19 · assistant 段随带该段 usage（逐行求和）与 model（取末条非空）；查无则不落键（不编 0/空串冒充）
  const flush = () => {
    if (!cur) return;
    const { usage, model, firstEv, ...rest } = cur;
    const extra: Record<string, unknown> = {};
    if (usage) extra.usage = usage;
    if (model) extra.model = model;
    messages.push(Object.keys(extra).length ? { ...rest, ...extra } : rest);
    cuts.push(firstEv);
    cur = null;
  };
  const textOf = (c: unknown): string =>
    typeof c === "string" ? c : Array.isArray(c) ? c.filter((b) => (b as { type?: string }).type === "text").map((b) => (b as { text?: string }).text ?? "").join("") : "";
  for (let ei = 0; ei < events.length; ei++) {
    const e = events[ei];
    if (e.kind === "message") {
      const me = e as unknown as { role: string; content: unknown; usage?: unknown; model?: { provider: string; id: string } };
      const text = textOf(me.content);
      if (me.role === "user") {
        flush();
        if (text) { messages.push({ role: "user", content: text }); cuts.push(ei); }
      } else if (me.role === "assistant") {
        if (cur?.tool_calls.length) flush();          // 工具回合后的新文本 = 新 assistant 段
        if (!cur) cur = { role: "assistant", content: "", tool_calls: [], firstEv: ei };
        if (text) cur.content += (cur.content ? "\n" : "") + text;
        const au = normUsage(me.usage);
        if (au) cur.usage = cur.usage ? addUsage(cur.usage, au) : au;
        if (me.model?.id) cur.model = me.model;
      }
      // role:"toolResult" 等内部消息不进回放（结果已由 tool_result 事件承载）
    } else if (e.kind === "tool_call") {
      const te = e as unknown as { toolCallId: string; toolName: string; args: unknown };
      if (!cur) cur = { role: "assistant", content: "", tool_calls: [], firstEv: ei };
      cur.tool_calls.push({ id: te.toolCallId, type: "function", function: { name: te.toolName, arguments: JSON.stringify(te.args ?? {}) } });
    } else if (e.kind === "tool_result") {
      const te = e as unknown as { toolCallId: string; result?: string };
      flush();
      messages.push({ role: "tool", tool_call_id: te.toolCallId, content: te.result ?? "" });
      cuts.push(ei);   // 平行数组不许错位：tool 条目也占一格（气泡轴推导按 cleaned 对齐）
    }
  }
  flush();
  const cleanedCuts: number[] = [];
  const cleaned = messages.filter((m, i) => {
    const keep = Boolean((m.content as string) || ((m.tool_calls as unknown[] | undefined)?.length));
    if (keep) cleanedCuts.push(cuts[i]);
    return keep;
  });
  // C6 · 气泡轴切点：按 ui replay.ts 的精确规则模拟——user 开新泡且清 curA；assistant 在 curA 空
  // 时开新泡、否则并入；tool 永远并入当前泡。fork?at 的下标走这条规则换算，规则改两边必须同步。
  const bubbleCuts: number[] = [];
  let curA = false;
  cleaned.forEach((m, i) => {
    if (m.role === "user") { bubbleCuts.push(cleanedCuts[i]); curA = false; }
    else if (m.role === "assistant") { if (!curA) { bubbleCuts.push(cleanedCuts[i]); curA = true; } }
  });
  const turns = cleaned.filter((m) => m.role === "user").length;
  const last = events[events.length - 1] as { ts?: string };
  // C-B3 · 契约（与工单 C-A5 一字不差）：transcript.events = run_event 类事件的时序提取，
  // 形状 [{ ts, event: { event, node?, ok?, round?, flagged?, detail? } }]；
  // 旧会话无 run_event → 空数组（缺省合法），messages 结构零改动。
  const RUN_EVENT_KINDS = new Set(["submit", "integrity_reject", "judge_evidence", "chat_turn_end"]);
  const runEvents = events.filter((e) => e.kind === "run_event") as unknown as { ts?: string; event: Record<string, unknown> }[];
  const eventsOut = runEvents
    .filter((e) => RUN_EVENT_KINDS.has(String(e.event?.event)))
    .map((e) => ({ ts: e.ts ?? "", event: e.event }));
  return {
    id: sid,
    title: start.meta?.title || (start.meta?.mode === "executor" ? `执行器 · ${start.meta?.node ?? sid}` : sid),
    updatedAt: last.ts ?? "",
    turns,
    messages: cleaned,
    events: eventsOut,
    ...(opts?.withCuts ? { cuts: bubbleCuts } : {}),
  };
}

export function deleteChat(kernel: KernelClient, project: string, sid: string): void {
  const f = path.join(kernel.projectDir(project), kernel.corpus.sessionsDir, `${sid.replace(/[^\w.-]/g, "_")}.jsonl`);
  fs.rmSync(f, { force: true });
}

export function renameChat(kernel: KernelClient, project: string, sid: string, title: string): void {
  const f = path.join(kernel.projectDir(project), kernel.corpus.sessionsDir, `${sid.replace(/[^\w.-]/g, "_")}.jsonl`);
  const events = readSession(kernel.projectDir(project), kernel.corpus, sid);
  if (!events.length) throw new Error("会话不存在");
  const start = events[0] as { kind: string; meta?: Record<string, unknown> };
  if (start.kind === "session_start" && start.meta) start.meta.title = title;
  fs.writeFileSync(f, events.map((e) => JSON.stringify({ ts: (e as { ts?: string }).ts ?? new Date().toISOString(), ...e })).join("\n") + "\n", "utf-8");
}

/** D-E · 会话元数据位更新（置顶/归档）——首行 meta 持久化，清单回带。 */
export function setSessionFlags(kernel: KernelClient, project: string, sid: string, patch: { pinned?: boolean; archived?: boolean }): void {
  const f = path.join(kernel.projectDir(project), kernel.corpus.sessionsDir, `${sid.replace(/[^\w.-]/g, "_")}.jsonl`);
  const events = readSession(kernel.projectDir(project), kernel.corpus, sid);
  if (!events.length) throw new Error("会话不存在");
  const start = events[0] as { kind: string; meta?: Record<string, unknown> };
  if (start.kind !== "session_start" || !start.meta) throw new Error("会话元数据损坏");
  if (patch.pinned !== undefined) start.meta.pinned = patch.pinned;
  if (patch.archived !== undefined) start.meta.archived = patch.archived;
  fs.writeFileSync(f, events.map((e) => JSON.stringify({ ts: (e as { ts?: string }).ts ?? new Date().toISOString(), ...e })).join("\n") + "\n", "utf-8");
}

/** D-E · 分叉会话：at 缺省=复制全部事件（分支点即当下全文）；at=N=只保留第 0..N 个气泡（含第 N 个，
 *  气泡轴=ui 回放轴：user 切泡、工具/连体 assistant 并入当前泡——与 ui 的 replay.ts 同一条规则）。
 *  事件行逐字拷贝（工具往返/usage/model/思维链全保真），旧会话不动。切点用 chatTranscript(withCuts)
 *  的同一套分段规则——分叉不自带「什么是下一条消息」的第二份实现。 */
export function forkChat(kernel: KernelClient, project: string, sid: string, opts?: { at?: number }): { id: string } {
  const src = path.join(kernel.projectDir(project), kernel.corpus.sessionsDir, `${sid.replace(/[^\w.-]/g, "_")}.jsonl`);
  const events = readSession(kernel.projectDir(project), kernel.corpus, sid);
  if (!events.length) throw new Error("会话不存在");
  let carried = events.slice(1);
  if (opts?.at !== undefined) {
    if (!Number.isInteger(opts.at) || opts.at < 0) throw new Error("at 必须是非负整数气泡下标");
    const t = chatTranscript(kernel, project, sid, { withCuts: true });
    const cuts = (t as { cuts?: number[] }).cuts ?? [];
    if (opts.at >= cuts.length) throw new Error(`at 越界：会话共 ${cuts.length} 个气泡`);
    const cut = cuts[opts.at + 1]; // 下一个气泡的首事件行；从末气泡分叉=undefined=全文
    if (cut !== undefined) carried = events.slice(1, cut);
  }
  const start = events[0] as { kind: string; meta?: Record<string, unknown> };
  const title = String(start.meta?.title || sid) + " ·分叉";
  const newMeta: SessionMeta = { project, mode: "chat", title };
  const newSid = newSession(kernel.projectDir(project), kernel.corpus, newMeta);
  const dst = path.join(kernel.projectDir(project), kernel.corpus.sessionsDir, `${newSid}.jsonl`);
  const rows = carried.map((e) => JSON.stringify({ ts: (e as { ts?: string }).ts ?? new Date().toISOString(), ...e }));
  fs.writeFileSync(dst, JSON.stringify({ ts: new Date().toISOString(), kind: "session_start", meta: newMeta }) + "\n" + (rows.length ? rows.join("\n") + "\n" : ""), "utf-8");
  return { id: newSid };
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.filter((b) => (b as { type?: string }).type === "text").map((b) => (b as { text?: string }).text ?? "").join("");
  return "";
}

/** 一个对话回合：SSE 逐事件产出（内核形状），同时落会话 JSONL。
 *  mode = 权限四档（plan/confirm/auto/full，D-E 权限设置）；turn 记录到会话元数据。 */
export async function* chatTurn(
  kernel: KernelClient,
  cfg: HarnessConfig,
  project: string,
  sid: string,
  text: string,
  agents: Map<string, Agent>,
  mode: ChatMode = "full",
): AsyncGenerator<ChatEvent> {
  const trimmed = (text || "").trim();
  if (!trimmed) { yield { type: "error", message: "空消息" }; return; }
  const projectDir = kernel.projectDir(project);
  if (!fs.existsSync(projectDir)) { yield { type: "error", message: `项目不存在：${project}` }; return; }

  const models = makeModels({ provider: cfg.provider, model: cfg.model, apiKey: cfg.apiKey, baseUrl: cfg.baseUrl });
  const model = resolveModel(models, cfg);

  const key = `${project}:${sid}`;
  let agent = agents.get(key);
  // 模式变更 → 换新 agent（工具环与系统提示按档重建；历史从会话 JSONL 重建，不丢上下文）
  const modeKey = `${key}:${mode}`;
  if (!agent || (agents.get("__mode__" + key) as unknown as string) !== modeKey) {
    agents.delete("__mode__" + key);
    const sys = CHAT_SYSTEM + (CHAT_MODES[mode]?.systemAddon ? "\n" + CHAT_MODES[mode].systemAddon : "");
    agent = new Agent({
      initialState: {
        systemPrompt: sys,
        model,
        tools: [
          ...toolsForMode(kernel, project, mode),
          ...makeAnalysisTools(kernel, { models, model, projectDir }),
        ],
      },
      // 赋能前移（甲方 0927）：项目简报每回合新鲜注入上下文头部——agent 醒来即知盘面，
      // 消「每次对话都 whereami/fs_tree 考古」的病根；简报是 system 消息，不进历史存储。
      transformContext: async (msgs) => {
        const brief = buildProjectBrief(kernel, project);
        return brief ? [{ role: "system", content: brief } as never, ...msgs] : msgs;
      },
      thinkingBudgets: THINKING_BUDGETS[cfg.thinking] ?? THINKING_BUDGETS.medium,
      streamFn: makeStreamFn(models),
    });
    const history = rebuildMessages(kernel, project, sid);
    if (history.length) {
      (agent.state as unknown as { messages: unknown[] }).messages = history.map((m) => ({ role: m.role, content: m.content }));
    }
    agents.set(key, agent);
    agents.set("__mode__" + key, modeKey as unknown as Agent);
  }

  // 用户消息由 pi 的 message_end 事件统一落盘（手工再 append 会双写——重建历史时用户消息翻倍）
  const queue: ChatEvent[] = [];
  let finished = false;
  let round = 0;
  let toolCount = 0;
  let turnUsage = zeroUsage();   // B9 · 本回合逐条 usage 累加（与 message 行同源，不另算一套）
  const push = (ev: ChatEvent) => { queue.push(ev); };
  const unsub = agent.subscribe((ev) => {
    if (ev.type === "message_update") {
      const a = (ev as unknown as { assistantMessageEvent?: { type?: string; delta?: string } }).assistantMessageEvent;
      if (a?.type === "text_delta" && a.delta) push({ type: "delta", text: a.delta });
      if (a?.type === "thinking_delta" && a.delta) push({ type: "thinking_delta", text: a.delta });
    } else if (ev.type === "message_end") {
      const role = (ev.message as { role?: string }).role ?? "assistant";
      // B9 · 逐条用量随行落盘：provider 不回报用量时 normUsage 给 undefined → 不写空对象占位
      const mu = normUsage((ev.message as { usage?: unknown }).usage);
      // B19 · assistant 行带 model（A15 灰字小标「这条哪个模型跑的」的数据源）；provider 不回报 usage 时 mu=undefined → 行不带 usage（查无，不编 0）
      appendSession(projectDir, kernel.corpus, sid, {
        kind: "message", role, content: (ev.message as { content?: unknown }).content, ...(mu ? { usage: mu } : {}),
        ...(role === "assistant" ? { model: { provider: model.provider, id: model.id } } : {}),
      });
      if (mu && role === "assistant") turnUsage = addUsage(turnUsage, mu);
      // 模型侧失败（端点未配 key / provider 未注册 / 网络不可达）在 pi 里是一条 stopReason:"error" 的
      // assistant 消息，**不抛异常**——不透出就只剩「气泡空白、日志无声」。
      // 现场证据（0929 冒烟）：自定义端点缺 MINIFLOW_AGENT_KEY/ZAI_API_KEY 时回合 2ms 收口、
      // content=[]、usage 全 0，真因「Provider is not configured: mock」被吞了三轮才追出来。
      if (role === "assistant" && (ev.message as { stopReason?: string }).stopReason === "error") {
        const em = String((ev.message as { errorMessage?: string }).errorMessage ?? "模型未返回内容");
        push({ type: "error", message: `模型调用失败：${em}` });
      }
    } else if (ev.type === "tool_execution_start") {
      toolCount += 1;
      push({ type: "tool_call", id: ev.toolCallId, name: ev.toolName, args: JSON.stringify(ev.args) });
      appendSession(projectDir, kernel.corpus, sid, { kind: "tool_call", toolCallId: ev.toolCallId, toolName: ev.toolName, args: ev.args });
    } else if (ev.type === "tool_execution_end") {
      push({ type: "tool_result", id: ev.toolCallId, name: ev.toolName, ok: !ev.isError, content: capResult(ev.result) });
      appendSession(projectDir, kernel.corpus, sid, { kind: "tool_result", toolCallId: ev.toolCallId, toolName: ev.toolName, isError: ev.isError, result: capResult(ev.result) });
    } else if (ev.type === "turn_end") {
      round += 1;
      push({ type: "round", n: round });
    }
  });

  try {
    const done = agent.prompt(trimmed).then(() => { finished = true; });
    while (true) {
      if (queue.length) {
        const ev = queue.shift()!;
        yield ev;
        continue;
      }
      if (finished) break;
      await new Promise((r) => setTimeout(r, 15));
    }
    await done;
  } catch (e) {
    unsub();
    const msg = String((e as Error).message || "");
    // 用户主动终止（agent.abort）不算错误：优雅收口为 done（保留已生成的部分）
    if (/abort/i.test(msg)) {
      endSession(projectDir, kernel.corpus, sid, "用户终止");
      // B18 · 终止也带已发生的部分量（context 不给：半途读数无意义）
      yield { type: "done", text: "（已终止）", turn: { rounds: round, toolCalls: toolCount, usage: turnUsage } };
      return;
    }
    endSession(projectDir, kernel.corpus, sid, `回合异常: ${msg.slice(0, 120)}`);
    yield { type: "error", message: msg };
    return;
  }
  unsub();

  const msgs = (agent.state as unknown as { messages?: AgentMessageLike[] }).messages ?? [];
  const lastAssistant = [...msgs].reverse().find((m) => m.role === "assistant");
  // 逐回合遥测埋点（B9 扩容）：本轮用量／会话累计／上下文占用／压缩压力一并入会话流——
  // 指标面板与「会话转工作流」挖掘读的都是这一行，不在别处第二套算法里再算一遍。
  let sessionUsage = zeroUsage();
  for (const m of msgs) sessionUsage = addUsage(sessionUsage, normUsage((m as unknown as { usage?: unknown }).usage));
  // estimateContextTokens = 最后一条 provider 实报用量 + 其后消息的字符估算（pi 的压缩口径）。
  // 注意：transformContext 每回合临时注入的项目简报不落 messages，故不计入本读数（略偏低，如实记在注释里）。
  const est = estimateContextTokens(msgs as never);
  const ctx = contextReadout(model.contextWindow ?? 0, est);
  appendSession(projectDir, kernel.corpus, sid, {
    kind: "run_event",
    event: {
      event: "chat_turn_end",
      rounds: round,
      toolCalls: toolCount,
      usage: turnUsage,
      sessionUsage,
      model: { provider: model.provider, id: model.id, contextWindow: model.contextWindow },
      context: ctx,
      compaction: compactionReadout(ctx, DEFAULT_COMPACTION_SETTINGS, false),
    },
  });
  // B18 · done 带本轮用量/上下文占用/模型（与上方 chat_turn_end 行同源变量，不第二套算法）——
  // A19 .colstats 打完一轮即刷新的数据源；历史回放的同一批数字走 /stats 与 transcript.usage。
  yield {
    type: "done", text: extractText(lastAssistant?.content),
    turn: { rounds: round, toolCalls: toolCount, usage: turnUsage },
    context: ctx,
    model: { provider: model.provider, id: model.id, contextWindow: model.contextWindow ?? 0 },
  };
}

// ── B9 · 指标面读取（GET /api/projects/:id/agent/sessions/:sid/stats 走这里）────────────

/** 当前配置的模型元信息（窗口 / maxTokens / 价率）。解析失败给全 0——面板显式标「窗口未知」，不猜 128k。
 *  serve.ts 的 /api/agent/model 与 sessionStats 共用这一份，两端不各解析一次。 */
export function modelMetaOf(cfg: HarnessConfig): ModelMeta {
  try {
    const models = makeModels({ provider: cfg.provider, model: cfg.model, apiKey: cfg.apiKey, baseUrl: cfg.baseUrl });
    return modelMeta(resolveModel(models, cfg) as never);
  } catch {
    return modelMeta(undefined);
  }
}

/** 会话指标：纯重放 JSONL 的 usage 行（不读 agent 内存态，刷新页面/换进程后照样对得上账）。
 *  模型元信息取当前配置——旧会话没存过 window 时用它兜底，数字家在哪由 basis 说明。 */
export function sessionStats(kernel: KernelClient, cfg: HarnessConfig, project: string, sid: string): SessionStats {
  const projectDir = kernel.projectDir(project);
  if (!fs.existsSync(projectDir)) throw new Error("项目不存在");
  const rows = readSessionNumbered(projectDir, kernel.corpus, sid) as EventRow[];
  if (!rows.length) throw new Error("会话不存在");
  // C7 · 价率表按当前配置模型查（provider/model 优先、裸 id 兜底）——未配置 = null，成本位照旧「查无」
  const rates = rateOf(cfg.pricing, cfg.provider, cfg.model);
  return { ...replayStats(rows, sessionFile(projectDir, kernel.corpus, sid), modelMetaOf(cfg), rates), sid };
}
