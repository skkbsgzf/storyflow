/** kit transcript 消息 → pi SessionEntry[] 转换（水合的主写作面）。
 *  kit 消息形状 = storyharness chatTranscript 的 OpenAI 族（role/content/tool_calls/tool_call_id），
 *  pi 条目形状 = lib/types.ts 的 SessionMessageEntry（message: UserMessage | AssistantMessage | ToolResultMessage）。 */
import type { AgentMessage, SessionEntry } from "@/lib/types";

type KitToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

type KitMsg =
  | { role: "user"; content?: string }
  | {
      role: "assistant";
      content?: string;
      tool_calls?: KitToolCall[];
      usage?: unknown;
      model?: { provider: string; id: string };
    }
  | { role: "tool"; tool_call_id?: string; content?: string };

function estimateTokens(text: string): number {
  return Math.max(1, Math.round(text.length / 3.6));
}

/** 把 transcript.messages 转成 parent 链完整的 pi 条目序列。 */
export function transcriptToEntries(messages: KitMsg[]): SessionEntry[] {
  const entries: SessionEntry[] = [];
  let leafId: string | null = null;
  let counter = 0;
  const nextId = () => `kit${(++counter).toString(16).padStart(4, "0")}`;
  const stamp = (i: number) => new Date(Date.now() - (messages.length - i) * 60_000).toISOString();
  const toolNames = new Map<string, string>();

  const push = (message: AgentMessage, i: number): void => {
    const entry = {
      type: "message",
      id: nextId(),
      parentId: leafId,
      timestamp: stamp(i),
      message,
    } as unknown as SessionEntry;
    entries.push(entry);
    leafId = (entry as { id: string }).id;
  };

  let i = -1;
  for (const m of messages as KitMsg[]) {
    i += 1;
    if (m.role === "user") {
      push({ role: "user", content: [{ type: "text", text: String(m.content ?? "") }], timestamp: Date.now() }, i);
    } else if (m.role === "assistant") {
      const content: unknown[] = [];
      if (m.content) content.push({ type: "text", text: m.content });
      for (const call of m.tool_calls ?? []) {
        toolNames.set(call.id, call.function.name);
        let input: Record<string, unknown> = {};
        try {
          input = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>;
        } catch {
          input = { _raw: call.function.arguments };
        }
        content.push({ type: "toolCall", toolCallId: call.id, toolName: call.function.name, input });
      }
      if (!content.length) continue; // 空 assistant 段不成泡
      const usage = m.usage as Record<string, number> | undefined;
      const message = {
        role: "assistant",
        content,
        model: m.model?.id ?? "unknown",
        provider: m.model?.provider ?? "kit",
        stopReason: "stop",
        timestamp: Date.now(),
        ...(usage
          ? {
              usage: {
                ...usage,
                totalTokens: Number(usage.totalTokens ?? usage.input ?? 0) + Number(usage.output ?? 0),
                cost: usage.cost ?? null,
              },
            }
          : {}),
      };
      push(message as AgentMessage, i);
    } else if (m.role === "tool") {
      push(
        {
          role: "toolResult",
          toolCallId: String(m.tool_call_id ?? ""),
          toolName: toolNames.get(String(m.tool_call_id ?? "")),
          content: [{ type: "text", text: String(m.content ?? "") }],
          isError: false,
          timestamp: Date.now(),
        } as AgentMessage,
        i,
      );
    }
  }
  return entries;
}

/** 首条用户文本（侧栏 firstMessage 摘要用）。 */
export function firstUserText(entries: SessionEntry[]): string {
  for (const e of entries) {
    if (e.type === "message") {
      const m = (e as { message?: { role?: string; content?: unknown } }).message;
      if (m?.role === "user") {
        const c = m.content;
        if (typeof c === "string") return c;
        if (Array.isArray(c)) {
          const t = c.find((b) => (b as { type?: string }).type === "text");
          if (t) return String((t as { text?: string }).text ?? "");
        }
      }
    }
  }
  return "";
}
