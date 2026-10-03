/** kit 回合桥：把 kit turn?raw=1 的 pi 事件流接到 demo 的 emit/appendEntry 契约上。
 *  事件序列验收基准 = demo/mock/agent.ts runPrompt（agent_start → 用户消息 → 流式 → 工具起止 → agent_end/settled/prompt_done）。 */
import type { AgentMessage, ToolResultMessage } from "@/lib/types";
import { appendEntry, type MockSession } from "../sessions/store";
import { kitCreateSession, kitStop, kitTurnRaw } from "./client";
import { kitProjectName } from "./hydrate";

export interface PromptIO {
  emit(sessionId: string, event: Record<string, unknown>): void;
  ensureLive(session: MockSession): { running: boolean; streamingMessage: unknown };
}

/** UI 会话 id → kit sid（运行时新建的会话懒建 kit 会话后登记于此）。 */
const sidMap = new Map<string, string>();
const aborts = new Map<string, AbortController>();

async function ensureKitSid(session: MockSession): Promise<string> {
  const known = sidMap.get(session.id);
  if (known) return known;
  const project = kitProjectName();
  if (!project) throw new Error("kit 项目未就绪（水合未完成）");
  const created = await kitCreateSession(project, session.name ?? "");
  sidMap.set(session.id, created.id);
  return created.id;
}

/** kit 帧里出现这些类型时不上屏（demo wire 同款省略 + 我方合成替代）。 */
const SYNTHESIZED = new Set(["agent_start", "agent_end", "agent_settled", "prompt_done", "turn_start", "turn_end"]);

function isUserMessageEvent(ev: Record<string, unknown>): boolean {
  const m = ev.message as { role?: string } | undefined;
  return typeof m?.role === "string" && m.role === "user";
}

export async function runPromptKit(
  session: MockSession,
  text: string,
  project: string,
  io: PromptIO,
): Promise<void> {
  const w = window as unknown as Record<string, unknown>;
  const log: string[] = [];
  w.__kitPromptLog = log;
  const mark = (s: string) => { log.push(s); };
  const live = io.ensureLive(session);
  live.running = true;
  mark("start");
  let kitSid: string;
  try {
    kitSid = await ensureKitSid(session);
    mark("kitSid=" + kitSid);
  } catch (e) {
    mark("ensureKitSid 失败: " + String(e));
    live.running = false;
    io.emit(session.id, { type: "error", message: "kit 会话创建失败：" + String(e) });
    return;
  }
  const controller = new AbortController();
  aborts.set(session.id, controller);
  try {
    io.emit(session.id, { type: "agent_start" });
    const user: AgentMessage = { role: "user", content: [{ type: "text", text }], timestamp: Date.now() };
    appendEntry(session, { type: "message", message: user });
    io.emit(session.id, { type: "message_start", message: user });
    io.emit(session.id, { type: "message_end", message: user });

    let frames = 0;
    for await (const ev of kitTurnRaw(project, kitSid, text, "full", controller.signal)) {
      frames += 1;
      if (frames <= 3) mark("frame:" + String(ev.type));
      const type = String(ev.type ?? "");
      if (SYNTHESIZED.has(type)) continue; // agent 起止与 turn 计数由本桥/线层负责
      if (type === "message_end" && isUserMessageEvent(ev)) continue; // 用户消息已本地落账
      if (type === "message_start" && isUserMessageEvent(ev)) continue;

      if (type === "message_start") {
        live.streamingMessage = ev.message;
      }
      if (type === "message_end") live.streamingMessage = null;

      io.emit(session.id, ev);

      // 历史落账：assistant / toolResult 消息收口时进 entries（重开页面可见）
      if (type === "message_end") {
        const m = ev.message as AgentMessage | undefined;
        if (m && m.role === "assistant") appendEntry(session, { type: "message", message: m });
      }
      if (type === "tool_execution_end") {
        const raw = ev.result as { content?: unknown } | undefined;
        const result: ToolResultMessage = {
          role: "toolResult",
          toolCallId: String(ev.toolCallId ?? ""),
          toolName: ev.toolName ? String(ev.toolName) : undefined,
          content: (raw?.content as ToolResultMessage["content"]) ?? [{ type: "text", text: JSON.stringify(ev.result ?? "") }],
          isError: Boolean(ev.isError),
          timestamp: Date.now(),
        };
        appendEntry(session, { type: "message", message: result });
      }
    }
  } catch (e) {
    if (!controller.signal.aborted) io.emit(session.id, { type: "error", message: String((e as Error).message ?? e) });
  } finally {
    mark("end frames=" + String(frames ?? 0));
    aborts.delete(session.id);
    live.running = false;
    live.streamingMessage = null;
    io.emit(session.id, { type: "agent_end" });
    await new Promise((r) => setTimeout(r, 30));
    io.emit(session.id, { type: "agent_settled" });
    io.emit(session.id, { type: "prompt_done" });
  }
}

export async function abortKit(session: MockSession, project: string): Promise<boolean> {
  const kitSid = sidMap.get(session.id);
  if (!kitSid) return false;
  aborts.get(session.id)?.abort();
  await kitStop(project, kitSid);
  return true;
}
