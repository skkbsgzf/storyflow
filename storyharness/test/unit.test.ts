// StoryHarness 底座单测（node:test + tsx，零新依赖）：npm test
// 覆盖：会话 JSONL 往返 / 路径越界防护 / 调度器 stop 标志 / headless NDJSON 形状 / 档位信号。
// 内核交互全部走 fake KernelClient（只实现被测方法），不依赖 8421 在线。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { newSession, appendSession, endSession, listSessions, readSession, capResult } from "../src/sessions.js";
import type { CorpusLayout } from "../src/config.js";
import { buildTools } from "../src/tools.js";
import { KernelClient } from "../src/kernel.js";
import { runFlow } from "../src/scheduler.js";
import { runHeadless } from "../src/headless.js";
import { pickTarget, tierSignalOf, composeArtifact } from "../src/executor.js";
import { parseLastJson } from "../src/sessions.js";

const CORPUS: CorpusLayout = {
  projectsDir: "projects",
  receiptsDir: path.join("内部", "收据"),
  quarantineDir: path.join("内部", "storyharness", "backup"),
  sessionsDir: path.join("内部", "sessions"),
  lintTool: path.join("tools", "flow-lint.py"),
  lintCommand: "node",
};

const tmpWorkspace = () => fs.mkdtempSync(path.join(os.tmpdir(), "sh-test-"));
const fakeKernel = (root: string) => new KernelClient("http://127.0.0.1:1", root, CORPUS);

test("sessions：新建→追加→结束→索引→回读 往返", () => {
  const root = tmpWorkspace();
  const projectDir = path.join(root, "projects", "p-t");
  const sid = newSession(projectDir, CORPUS, { project: "p-t", mode: "executor", node: "m1.x", model: "zai.glm" });
  assert.match(sid, /^s-\d+-\w+$/);
  appendSession(projectDir, CORPUS, sid, { kind: "message", role: "user", content: "你好" });
  appendSession(projectDir, CORPUS, sid, { kind: "tool_call", toolCallId: "t1", toolName: "fs_read", args: { path: "a.md" } });
  appendSession(projectDir, CORPUS, sid, { kind: "tool_result", toolCallId: "t1", toolName: "fs_read", isError: false, result: "正文" });
  endSession(projectDir, CORPUS, sid, "交卷通过");

  const idx = listSessions(projectDir, CORPUS);
  assert.equal(idx.length, 1);
  assert.equal(idx[0].sid, sid);
  assert.equal(idx[0].meta.node, "m1.x");
  assert.equal(idx[0].ended, true);
  assert.ok(idx[0].events >= 5);

  const events = readSession(projectDir, CORPUS, sid);
  assert.equal(events[0].kind, "session_start");
  assert.equal(events[events.length - 1].kind, "session_end");
  const toolCall = events.find((e) => e.kind === "tool_call") as { toolName: string };
  assert.equal(toolCall.toolName, "fs_read");
  fs.rmSync(root, { recursive: true, force: true });
});

test("sessions：listSessions 对空目录/坏文件不炸", () => {
  const root = tmpWorkspace();
  const projectDir = path.join(root, "projects", "p-empty");
  assert.deepEqual(listSessions(projectDir, CORPUS), []);
  fs.mkdirSync(path.join(projectDir, CORPUS.sessionsDir), { recursive: true });
  fs.writeFileSync(path.join(projectDir, CORPUS.sessionsDir, "bad.jsonl"), "不是json\n", "utf-8");
  assert.equal(listSessions(projectDir, CORPUS).length, 0); // 坏文件跳过不抛
  fs.rmSync(root, { recursive: true, force: true });
});

test("capResult：超 16KB 截断并带标记", () => {
  const small = capResult("短结果");
  assert.equal(small, "短结果");
  const big = capResult("x".repeat(20_000));
  assert.ok(big.length < 17_500);
  assert.ok(big.includes("[截断"));
});

test("tools：fs_write 越界拒绝、项目内写入成功", async () => {
  const root = tmpWorkspace();
  const k = fakeKernel(root);
  const tools = buildTools(k, "p-t");
  const wr = tools.find((t) => t.name === "fs_write")!;
  await assert.rejects(() => wr.execute("id1", { path: "../outside.md", content: "x" }), /越出项目/);
  await wr.execute("id2", { path: "01-选题/a.md", content: "# 标题\n正文" });
  assert.ok(fs.existsSync(path.join(root, "projects", "p-t", "01-选题", "a.md")));
  // 绝对路径同样受控
  await assert.rejects(() => wr.execute("id3", { path: path.join(root, "escape.md"), content: "x" }), /越出项目/);
  fs.rmSync(root, { recursive: true, force: true });
});

const FAKE_PKG = { nodeId: "m1.x", outputContract: { file: "01-选题/x.md" }, spawnPrompt: "写" };

function fakeKernelWithFlowNext(root: string, results: Array<Record<string, unknown>>) {
  const k = fakeKernel(root) as unknown as KernelClient & { flowNext: (p: string) => Promise<Record<string, unknown>>; flowSubmit: (...a: unknown[]) => Promise<unknown> };
  let i = 0;
  (k as unknown as { flowNext: unknown }).flowNext = async () => results[Math.min(i++, results.length - 1)];
  (k as unknown as { flowSubmit: unknown }).flowSubmit = async () => ({ ok: true });
  (k as unknown as { verb: unknown }).verb = async (name: string) => {
    if (name === "flow_run") return { ok: true };
    throw new Error(`unexpected verb ${name}`);
  };
  return k as unknown as KernelClient;
}

test("scheduler：stopCheck 立即生效返回 stopped", async () => {
  const root = tmpWorkspace();
  const k = fakeKernelWithFlowNext(root, [{ status: "awaiting_input", nodeId: "m1.x", taskPackage: FAKE_PKG }]);
  const r = await runFlow(k, { project: "p-t" } as never, { stopCheck: () => true });
  assert.equal(r.ok, true);
  assert.match(String(r.stopped), /\/stop/);
  assert.equal(r.ran, 0);
  fs.rmSync(root, { recursive: true, force: true });
});

test("headless：NDJSON 事件序列形状（completed 短路，不触 LLM）", async () => {
  const root = tmpWorkspace();
  const k = fakeKernelWithFlowNext(root, [{ status: "completed" }]);
  const events: Record<string, unknown>[] = [];
  const r = await runHeadless(k, { project: "p-pending" } as never, {
    direction: "都市逆袭", episodes: 6,
    emit: (e) => events.push(e),
  });
  assert.equal(r.ok, true);
  const names = events.map((e) => e.event);
  assert.deepEqual(names, ["run_start", "run_end", "final"]);
  assert.equal(events[0].flow, "screenplay");
  assert.equal(events[2].ok, true);
  // NDJSON 每行可 JSON.parse
  for (const e of events) assert.ok(typeof JSON.stringify(e) === "string");
  fs.rmSync(root, { recursive: true, force: true });
});

test("headless：项目已有 run 时拒绝冷启动", async () => {
  const root = tmpWorkspace();
  fs.mkdirSync(path.join(root, "projects", "p-exists"), { recursive: true });
  fs.writeFileSync(path.join(root, "projects", "p-exists", "state.json"), "{}", "utf-8");
  const k = fakeKernelWithFlowNext(root, []);
  const events: Record<string, unknown>[] = [];
  const r = await runHeadless(k, { project: "p-pending" } as never, {
    direction: "x", project: "p-exists", emit: (e) => events.push(e),
  });
  assert.equal(r.ok, false);
  assert.equal(events[events.length - 1].event, "final");
  fs.rmSync(root, { recursive: true, force: true });
});

test("档位信号：toolConfig 与 spawnPrompt 两路点名，缺 tiers 时 pickTarget 回默认", () => {
  const cfg = { provider: "zai", model: "glm-5.3-flash" } as never;
  assert.equal(tierSignalOf({ toolConfig: { model_tier: "high" } }), "high");
  assert.equal(tierSignalOf({ spawnPrompt: "说明 model_tier = lite\n..." }), "lite");
  assert.equal(tierSignalOf({}), "default");
  const t = pickTarget(cfg, { toolConfig: { model_tier: "high" } });
  assert.equal(t.model, "glm-5.3-flash"); // 未配 tiers.high → 回默认（降档由 executor 打声明日志）
});

test("composeArtifact：块级 upstream 折叠成行内（内核 parseArtifactHeader 的 pending quirk）", () => {
  const tpl = [
    "---",
    "artifact: 1",
    "id: m1.x",
    "class: input",
    "node: m1.x",
    "round: 1",
    "version: v1",
    "state: draft",
    "at: <YYYY-MM-DD HH:MM>",
    "by: storyharness",
    "upstream:",
    "  []",
    "review: null",
    "---",
    "",
    "# <标题>",
    "> <一句话摘要，≤60 字>",
    "",
  ].join("\n");
  const art = composeArtifact({ nodeId: "m1.x", headerTemplate: tpl, context: [] }, "# 标题\n正文", "zai.glm");
  // 内核解析器 quirk：块级 upstream 会被 review: null 清 pending —— 必须折叠成行内
  assert.match(art, /upstream: \[\]/);
  assert.doesNotMatch(art, /^upstream:\n/m);
});

test("composeArtifact：非空上下文折叠成行内数组", () => {
  const art = composeArtifact({ nodeId: "m1.x", context: [{ ref: "m1.a", hash: "abc" }, { ref: "m1.b" }] }, "# 标题\n正文", "zai.glm");
  assert.match(art, /upstream: \[m1\.a@abc, m1\.b@\]/);
});

test("composeArtifact：头部合成 + 标题摘要推导", () => {
  const art = composeArtifact(FAKE_PKG, "# 测试标题\n\n正文第一段。", "zai.glm");
  assert.ok(art.startsWith("---\n"));
  assert.match(art, /by: storyharness\(zai\.glm\)/);
  assert.match(art, /# 测试标题/);
  assert.match(art, /> 正文第一段。/);
});

test("parseLastJson：纯 JSON / 横幅污染 / 逐行兜底 / 空串", () => {
  assert.deepEqual(parseLastJson('{"a": 1}'), { a: 1 });
  const polluted = [
    '["WARNING"] telemetry bootstrap',
    '{"answers": {"x": 0.1}, "flagged": []}',
    "[otel] flush done",
  ].join("\n");
  const v = parseLastJson(polluted) as { answers?: { x: number } };
  assert.equal(v.answers?.x, 0.1);   // 库级横幅混入时取最后一个完整对象（position 148 教训）
  assert.equal(parseLastJson(""), null);
  assert.equal(parseLastJson("not json at all"), null);
});
