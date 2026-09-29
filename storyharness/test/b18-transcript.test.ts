// B18/B19 · chatTranscript 重建时随带 assistant 段的 usage（逐行求和）与 model（末条非空）。
//   契约（工单波10 B18/B19 → A15 灰字小标 / A16 组统计行的回放数据源）：
//   · message 行带 usage/model → 段聚合后随带；查无则不落键（不编 0/空串，显式「查无」归 ui 侧）
//   · tool_result 处 flush 分段——每段 usage 只含本段 assistant 行
//   · 旧会话（B9 之前的行）零 usage 零 model → 消息上没有这两个键，形状与波10前一字不差
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import path from "node:path";
import { KernelClient } from "../src/kernel.js";
import { chatTranscript } from "../src/chat.js";
import type { CorpusLayout } from "../src/config.js";

const CORPUS: CorpusLayout = {
  projectsDir: "projects",
  receiptsDir: path.join("内部", "收据"),
  quarantineDir: path.join("内部", "backup"),
  sessionsDir: path.join("内部", "sessions"),
  telemetryDir: path.join("内部", "telemetry"),
  lintTool: path.join("tools", "flow-lint.py"),
  lintCommand: "python",
};

const PID = "p-b18";

function makeProject(files: Record<string, string>): { root: string; kernel: KernelClient; pid: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "b18-"));
  const dir = path.join(root, "projects", PID, "内部", "sessions");
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body, "utf-8");
  return { root, kernel: new KernelClient("http://127.0.0.1:1", root, CORPUS), pid: PID };
}

const U = (input: number, output: number, total: number) => ({
  input, output, cacheRead: 0, cacheWrite: 0, totalTokens: input + output,
  cost: { input: 0.001, output: 0.0002, cacheRead: 0, cacheWrite: 0, total },
});

test("B18/B19 transcript：assistant 段随带 usage（逐行求和）与 model（末条非空）", () => {
  const { kernel } = makeProject({
    "s1.jsonl": [
      JSON.stringify({ ts: "2026-09-28T00:00:00Z", kind: "session_start", meta: { project: PID, mode: "chat", title: "t" } }),
      JSON.stringify({ ts: "2026-09-28T00:00:01Z", kind: "message", role: "user", content: "问题" }),
      JSON.stringify({ ts: "2026-09-28T00:00:02Z", kind: "message", role: "assistant", content: "答一", usage: U(100, 20, 0.0012), model: { provider: "zai", id: "glm-5.3" } }),
      JSON.stringify({ ts: "2026-09-28T00:00:03Z", kind: "tool_call", toolCallId: "c1", toolName: "fs_read", args: {} }),
      JSON.stringify({ ts: "2026-09-28T00:00:04Z", kind: "tool_result", toolCallId: "c1", result: "ok" }),
      JSON.stringify({ ts: "2026-09-28T00:00:05Z", kind: "message", role: "assistant", content: "答二", usage: U(200, 30, 0.0023), model: { provider: "zai", id: "glm-5.3" } }),
      // 连续 assistant 行合并进同一段；本行无 usage/model → 段保持答二的值（不叠加不清洗）
      JSON.stringify({ ts: "2026-09-28T00:00:06Z", kind: "message", role: "assistant", content: "答三" }),
    ].join("\n") + "\n",
  });
  const t = chatTranscript(kernel, PID, "s1");
  const a = t.messages.filter((m) => m.role === "assistant") as Record<string, unknown>[];
  assert.equal(a.length, 2);
  // 段一（带工具调用）：usage=答一单行，model 在
  assert.equal((a[0].usage as { input: number }).input, 100);
  assert.equal((a[0].model as { id: string }).id, "glm-5.3");
  assert.equal((a[0].tool_calls as unknown[]).length, 1);
  // 段二（答二+答三合并）：usage 只累计有数的行（200，不是 300），model 取末条非空
  assert.equal((a[1].usage as { input: number }).input, 200);
  assert.equal((a[1].model as { id: string }).id, "glm-5.3");
  assert.equal(a[1].content, "答二\n答三");
  // user 消息不带 model/usage（模型不属于用户消息）
  const u = t.messages.find((m) => m.role === "user")!;
  assert.ok(!("model" in u) && !("usage" in u));
});

test("B18/B19 transcript：旧会话零 usage 零 model → 键不出现，形状与波10前一字不差", () => {
  const { kernel } = makeProject({
    "s2.jsonl": [
      JSON.stringify({ ts: "2026-09-25T00:00:00Z", kind: "session_start", meta: { project: PID, mode: "chat", title: "old" } }),
      JSON.stringify({ ts: "2026-09-25T00:00:01Z", kind: "message", role: "user", content: "q" }),
      JSON.stringify({ ts: "2026-09-25T00:00:02Z", kind: "message", role: "assistant", content: "a" }),
    ].join("\n") + "\n",
  });
  const t = chatTranscript(kernel, PID, "s2");
  const a = t.messages.find((m) => m.role === "assistant") as Record<string, unknown>;
  assert.equal(a.content, "a");
  assert.ok(!("usage" in a) && !("model" in a));
});
