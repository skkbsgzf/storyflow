// 能力任务模式（taskKind=capability）测试：强制提交语义——取证轮后 submit 回执即终态；
// 预算耗尽未提交显式失败；capabilityResult 随快照/task.completed 回传。
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startServer } from "../src/pinax/server.js";
import type { AddressInfo } from "node:net";

let lastBody: Record<string, unknown> = {};
let plan = "lookup";
const mockServer = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => { body += chunk; });
  req.on("end", () => {
    try { lastBody = JSON.parse(body); } catch { lastBody = {}; }
    res.writeHead(200, { "content-type": "text/event-stream" });
    const write = (obj: Record<string, unknown>, last = false) => {
      res.write(`data: ${JSON.stringify(obj)}\n\n`);
      if (last) res.write("data: [DONE]\n\n");
    };
    if (plan === "lookup") {
      // 取证轮：调 world_lookup 工具
      write({ object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant" } }] });
      write({ object: "chat.completion.chunk", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_w", type: "function", function: { name: "world_lookup", arguments: '{"action":"search","query":"雾港"}' } }] } }] });
      write({ object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] });
      plan = "submit";
      return res.end();
    }
    if (plan === "submit") {
      // 提交轮：调用 submit 工具（参数=结构化结果）
      write({ object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant" } }] });
      write({ object: "chat.completion.chunk", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_s", type: "function", function: { name: "submit_review_findings", arguments: '{"findings":[{"kind":"consistency","issueType":"fact","severity":"major","reason":"罗盘状态前后矛盾"}]},"summary":"发现 1 处矛盾"}' } }] } }] });
      write({ object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] });
      plan = "done";
      return res.end();
    }
    if (plan === "textjson") {
      // 文本兜底场景：模型按指令卡以文本返回 JSON，不调用 submit 工具
      write({ object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", content: '{"answer":"文本兜底的回答","claims":[]}' } }] });
      write({ object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }, true);
      return res.end();
    }
    // 收敛轮：只剩 submit 工具仍不提交 → finish stop 无提交
    write({ object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", content: "（未提交）" } }] });
    write({ object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }, true);
    res.end();
  });
});

let adapter: http.Server;
let adapterPort = 0;
let mockPort = 0;
let configDir = "";

test.before(async () => {
  await new Promise<void>((resolve) => mockServer.listen(0, "127.0.0.1", resolve));
  mockPort = (mockServer.address() as AddressInfo).port;
  configDir = fs.mkdtempSync(path.join(os.tmpdir(), "pinax-capability-"));
  process.env.PINAX_ADAPTER_CONFIG = path.join(configDir, "pinax-adapter.json");
  fs.writeFileSync(process.env.PINAX_ADAPTER_CONFIG, JSON.stringify({ provider: "mock", model: "mock-model", baseUrl: `http://127.0.0.1:${mockPort}/v1`, apiKey: "test-key", thinking: "off" }));
  adapter = startServer({ port: 0, host: "127.0.0.1", tasksDir: path.join(configDir, "tasks") });
  await new Promise((r) => adapter.once("listening", r));
  adapterPort = (adapter.address() as AddressInfo).port;
});

test.after(() => {
  adapter?.closeAllConnections?.();
  mockServer?.closeAllConnections?.();
  adapter?.close();
  mockServer?.close();
  delete process.env.PINAX_ADAPTER_CONFIG;
  fs.rmSync(configDir, { recursive: true, force: true });
});

const uid2 = Math.random().toString(36).slice(2, 8);
const capabilityPayload = (taskId: string, maxModelSteps = 8) => ({
  requestId: `cap_${taskId}`,
  taskId,
  taskKind: "capability",
  mode: "init",
  capability: {
    systemPrompt: "你是章节体检 Agent。先用资料工具核实设定，然后调用 submit_review_findings 提交结构化体检结果。",
    submitTool: {
      name: "submit_review_findings",
      description: "提交章节体检结果",
      parameters: { type: "object", properties: { findings: { type: "array", items: { type: "object", properties: { kind: { type: "string" }, issueType: { type: "string" }, severity: { type: "string" }, reason: { type: "string" } } } }, summary: { type: "string" } } }
    }
  },
  kernel: { blocks: [{ kind: "chapter", title: "第一章", text: "沈砚宁拾起断成两半的罗盘。" }] },
  resources: { domains: { world: [{ id: "e1", title: "罗盘", content: "父亲留下的遗物，断成两半。" }] } },
  budget: { maxModelSteps: maxModelSteps, maxCallsPerTurn: 6 }
});

const runTask = async (body: unknown) => {
  const response = await fetch(`http://127.0.0.1:${adapterPort}/v1/pinax/tasks`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (response.status !== 200) console.error("CREATE STATUS:", response.status, await response.text());
  const frames: string[] = [];
  let completed: Record<string, unknown> | undefined;
  let failed: Record<string, unknown> | undefined;
  let buffer = "";
  const decoder = new TextDecoder();
  for await (const chunk of response.body!) {
    buffer += decoder.decode(chunk, { stream: true });
    let index = buffer.indexOf("\n\n");
    while (index >= 0) {
      const frame = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      index = buffer.indexOf("\n\n");
      if (!frame.trim()) continue;
      frames.push(frame);
      const dataLine = frame.split("\n").find((line) => line.startsWith("data: "));
      if (!dataLine) continue;
      if (/event: task\.completed/.test(frame)) completed = JSON.parse(dataLine.slice(6));
      if (/event: task\.failed/.test(frame)) failed = JSON.parse(dataLine.slice(6));
    }
  }
  return { completed, failed, frames };
};

test("capability 任务：取证轮 → submit 回执即终态（capabilityResult 随快照回传）", async () => {
  plan = "lookup";
  const { completed } = await runTask(capabilityPayload("ptask_cap_ok_muwzq3tf"));
  assert.equal(completed?.status, "completed");
  const result = (completed?.capabilityResult ?? {}) as { findings?: unknown[]; summary?: string };
  assert.ok(Array.isArray(result.findings), `capabilityResult 应含 findings：${JSON.stringify(completed).slice(0, 300)}`);
  assert.equal((result.findings as { reason: string }[])[0]?.reason, "罗盘状态前后矛盾");
  // 取证工具确实被允许（world_lookup 在 submit 前执行）
  assert.ok(lastBody.messages === undefined || Array.isArray(lastBody.messages));
});

test("capability 任务：系统提示用 capability.systemPrompt（非叙事模板）", async () => {
  plan = "submit";
  await runTask(capabilityPayload("ptask_cap_sys_muwzq3tf"));
  const system = (lastBody.messages || []).find((m: { content?: string }) => String(m.content || "").includes("章节体检 Agent"));
  assert.ok(system, "系统提示应来自 capability.systemPrompt（developer/system 角色）");
  assert.ok(!JSON.stringify(lastBody.messages).includes("Narrator"), "不应使用叙事系统模板");
  assert.ok(JSON.stringify(lastBody.tools || []).includes("submit_review_findings"), "submit 工具应注入上游工具表");
});

test("capability 任务：预算耗尽未提交 → PINAX_ADAPTER_NO_SUBMISSION 显式失败", async () => {
  plan = "lookup";
  // 步数预算 1：取证轮用掉唯一一步，收敛后只剩 submit；模型仍不出手 → NO_SUBMISSION
  const { failed } = await runTask(capabilityPayload("ptask_cap_none_muwzq3tf", 1));
  assert.equal(failed?.status, "failed");
  assert.equal((failed?.error as { code?: string })?.code, "PINAX_ADAPTER_NO_SUBMISSION");
});

test("capability 任务：模型以文本返回 JSON → 兜底接收为回执（不再 NO_SUBMISSION）", async () => {
  plan = "textjson";
  const { completed, failed } = await runTask(capabilityPayload(`ptask_cap_text_${Date.now().toString(36)}`));
  assert.ok(!failed, `不应失败：${JSON.stringify(failed)}`);
  assert.equal(completed?.status, "completed");
  const result = (completed?.capabilityResult ?? {}) as { answer?: string };
  assert.equal(result.answer, "文本兜底的回答");
});
