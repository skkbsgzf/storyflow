// C6 · fork?at 消息级分叉（波11）：
//   · at=N=保留第 0..N 个气泡（含第 N 个）——气泡轴=ui 回放轴（replay.ts：user 切泡、工具/连体
//     assistant 并入当前泡），事件行逐字拷贝（工具往返/usage/model 全保真）
//   · 切点与 chatTranscript 分段规则同源（withCuts）——分叉不养第二套「什么是下一条消息」
//   · 越界/非法 at 显式报错；at 缺省 = 全文分叉（D-E 原语义零变化）
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import path from "node:path";
import { KernelClient } from "../src/kernel.js";
import { chatTranscript, forkChat } from "../src/chat.js";
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

const PID = "p-forkat";

function makeProject(files: Record<string, string>): { root: string; kernel: KernelClient } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "forkat-"));
  const dir = path.join(root, "projects", PID, "内部", "sessions");
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body, "utf-8");
  return { root, kernel: new KernelClient("http://127.0.0.1:1", root, CORPUS) };
}

const U = (input: number, output: number, total: number) => ({
  input, output, cacheRead: 0, cacheWrite: 0, totalTokens: input + output,
  cost: { input: 0.001, output: 0.0002, cacheRead: 0, cacheWrite: 0, total },
});

// 会话形状：[u问一, a答一(c1 工具往返), t 结果行, u问二, a答二]——transcript 5 条目 / ui 4 气泡
const SESSION = [
  JSON.stringify({ ts: "2026-09-29T00:00:00Z", kind: "session_start", meta: { project: PID, mode: "chat", title: "原会话" } }),
  JSON.stringify({ ts: "2026-09-29T00:00:01Z", kind: "message", role: "user", content: "问一" }),
  JSON.stringify({ ts: "2026-09-29T00:00:02Z", kind: "message", role: "assistant", content: "答一", usage: U(100, 20, 0.0012), model: { provider: "zai", id: "glm-5.3" } }),
  JSON.stringify({ ts: "2026-09-29T00:00:03Z", kind: "tool_call", toolCallId: "c1", toolName: "fs_read", args: { p: "a.md" } }),
  JSON.stringify({ ts: "2026-09-29T00:00:04Z", kind: "tool_result", toolCallId: "c1", result: "内容" }),
  JSON.stringify({ ts: "2026-09-29T00:00:05Z", kind: "message", role: "user", content: "问二" }),
  JSON.stringify({ ts: "2026-09-29T00:00:06Z", kind: "message", role: "assistant", content: "答二", usage: U(200, 30, 0.0023), model: { provider: "zai", id: "glm-5.3" } }),
].join("\n") + "\n";

test("fork?at：at=2（答一气泡，含工具往返）——新会话 3 气泡，工具行跟脚走，旧会话一字不动", () => {
  const { kernel } = makeProject({ "s1.jsonl": SESSION });
  const before = fs.readFileSync(path.join(kernel.projectDir(PID), CORPUS.sessionsDir, "s1.jsonl"), "utf-8");
  const { id } = forkChat(kernel, PID, "s1", { at: 2 });
  assert.notEqual(id, "s1");
  assert.equal(fs.readFileSync(path.join(kernel.projectDir(PID), CORPUS.sessionsDir, "s1.jsonl"), "utf-8"), before);
  const t = chatTranscript(kernel, PID, id);
  assert.equal(t.messages.length, 4, "条目轴：问一/答一/tool/问二（答二被切掉）");
  assert.equal(t.messages.filter((m) => m.role !== "tool").length, 3, "气泡轴 3：问一/答一/问二");
  assert.equal(t.turns, 2);
  const a0 = t.messages[1] as { content: string; tool_calls: unknown[]; usage?: { input: number }; model?: { id: string } };
  assert.equal(a0.content, "答一");
  assert.equal(a0.tool_calls.length, 1, "分叉点前的工具往返逐字保真");
  assert.equal(a0.usage?.input, 100, "usage 随行保真");
  assert.equal(a0.model?.id, "glm-5.3");
  assert.match(t.title, /·分叉$/);
  assert.ok(!t.messages.some((m) => m.content === "答二"), "分叉点之后的气泡不得进入新会话");
});

test("fork?at：从末气泡分叉=全文（无下一切点），at 越界/负数/小数显式报错", () => {
  const { kernel } = makeProject({ "s1.jsonl": SESSION });
  const full = forkChat(kernel, PID, "s1");                       // 缺省全文
  assert.equal(chatTranscript(kernel, PID, full.id).messages.length, 5);
  const tip = forkChat(kernel, PID, "s1", { at: 3 });             // 末气泡（答二）
  assert.equal(chatTranscript(kernel, PID, tip.id).messages.length, 5, "从末气泡分叉=全文");
  assert.throws(() => forkChat(kernel, PID, "s1", { at: 4 }), /越界/);
  assert.throws(() => forkChat(kernel, PID, "s1", { at: -1 }), /非负整数/);
  assert.throws(() => forkChat(kernel, PID, "s1", { at: 1.5 }), /非负整数/);
});

test("fork?at：at=1（答一气泡）逐字前缀——tool_call/tool_result 行跟脚，不落半个段", () => {
  const { kernel } = makeProject({ "s1.jsonl": SESSION });
  const { id } = forkChat(kernel, PID, "s1", { at: 1 });
  const raw = fs.readFileSync(path.join(kernel.projectDir(PID), CORPUS.sessionsDir, `${id}.jsonl`), "utf-8").trim().split("\n");
  const kinds = raw.map((l) => (JSON.parse(l) as { kind: string }).kind);
  assert.deepEqual(kinds, ["session_start", "message", "message", "tool_call", "tool_result"], "问二及其后的一切不进新会话");
  const t = chatTranscript(kernel, PID, id);
  assert.equal(t.messages.filter((m) => m.role !== "tool").length, 2);
  assert.equal((t.messages[1] as { tool_calls: unknown[] }).tool_calls.length, 1);
});
