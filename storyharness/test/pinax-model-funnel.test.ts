// 统一模型漏斗测试：/model 热切换（持久化+内存）与 /complete[/stream] 转发（mock LLM，无真实端点）。
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startServer } from "../src/pinax/server.js";
import { validateCompleteRequest, validateModelPatch } from "../src/pinax/modelFunnel.js";
import type { AddressInfo } from "node:net";

function sseFrames(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  return (async function* () {
    let buf = "";
    const decoder = new TextDecoder();
    for await (const chunk of body) {
      buf += decoder.decode(chunk, { stream: true });
      let idx = buf.indexOf("\n\n");
      while (idx >= 0) {
        const raw = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        if (raw.trim()) yield raw;
        idx = buf.indexOf("\n\n");
      }
    }
    if (buf.trim()) yield buf;
  })();
}

// mock LLM（流式 SSE——models.complete 内部走 stream:true）：记录请求体；按模型名返回不同内容/工具调用

let lastBody: Record<string, unknown> = {};
const mockServer = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => { body += chunk; });
  req.on("end", () => {
    try { lastBody = JSON.parse(body); } catch { lastBody = {}; }
    const model = String(lastBody.model || "");
    const wantsTools = Array.isArray(lastBody.tools) && lastBody.tools.length > 0;
    res.writeHead(200, { "content-type": "text/event-stream" });
    const write = (obj: Record<string, unknown>, last = false) => {
      res.write(`data: ${JSON.stringify(obj)}\n\n`);
      if (last) res.write("data: [DONE]\n\n");
    };
    if (model === "second-model" && wantsTools) {
      write({ object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant" } }] });
      write({ object: "chat.completion.chunk", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "calc_evaluate", arguments: "{\"expression\":\"1+1\"}" } }] } }] });
      write({ object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 } }, true);
      return res.end();
    }
    if (model === "second-model") {
      write({ object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", content: "次模型正文" } }] });
      write({ object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 } }, true);
      return res.end();
    }
    write({ object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", content: "首模型正文" } }] });
    write({ object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } }, true);
    return res.end();
  });
});

let adapter: http.Server;
let adapterPort = 0;
let mockPort = 0;
let configDir = "";
let configFile = "";

test.before(async () => {
  await new Promise<void>((resolve) => mockServer.listen(0, "127.0.0.1", resolve));
  mockPort = (mockServer.address() as AddressInfo).port;
  configDir = fs.mkdtempSync(path.join(os.tmpdir(), "pinax-funnel-"));
  configFile = path.join(configDir, "pinax-adapter.json");
  fs.writeFileSync(configFile, JSON.stringify({ provider: "mock", model: "first-model", baseUrl: `http://127.0.0.1:${mockPort}/v1`, apiKey: "test-key", thinking: "off" }));
  process.env.PINAX_ADAPTER_CONFIG = configFile;
  adapter = startServer({ port: 0, host: "127.0.0.1" });
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

const get = (p: string) => fetch(`http://127.0.0.1:${adapterPort}${p}`).then((r) => r.json());
const post = (p: string, body: unknown) => fetch(`http://127.0.0.1:${adapterPort}${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));

test("GET /model 回显当前模型与 key 掩码", async () => {
  const status = await get("/model");
  assert.equal(status.ok, true);
  assert.equal(status.model, "first-model");
  assert.equal(status.keyMasked, "test****-key");
  assert.equal(status.baseUrl, `http://127.0.0.1:${mockPort}/v1`);
});

test("POST /model 热切换：内存即刻生效 + 配置文件合并落盘", async () => {
  const switched = await post("/model", { model: "second-model" });
  assert.equal(switched.body.ok, true);
  assert.equal(switched.body.model, "mock.second-model");
  const status = await get("/model");
  assert.equal(status.model, "second-model");
  const persisted = JSON.parse(fs.readFileSync(configFile, "utf-8"));
  assert.equal(persisted.model, "second-model");
  assert.equal(persisted.baseUrl, `http://127.0.0.1:${mockPort}/v1`, "未提交字段保持原值");
  assert.equal(persisted.apiKey, "test-key");
});

test("POST /model 校验：缺 model 400", async () => {
  const bad = await post("/model", { provider: "x" });
  assert.equal(bad.status, 400);
});

test("/complete：一次性补全（当前模型 second-model）", async () => {
  const result = await post("/v1/pinax/complete", { messages: [{ role: "user", content: "你好" }], maxTokens: 100 });
  assert.equal(result.body.ok, true);
  assert.equal(result.body.content, "次模型正文");
  assert.equal(result.body.model, "mock.second-model");
  assert.equal(result.body.usage.totalTokens, 18);
});

test("/complete：工具调用透传（tools → toolCalls 映射）", async () => {
  const result = await post("/v1/pinax/complete", {
    messages: [{ role: "user", content: "算一下 1+1" }],
    tools: [{ name: "calc_evaluate", description: "算术", parameters: { type: "object", properties: { expression: { type: "string" } } } }],
    toolChoice: "auto"
  });
  assert.equal(result.body.ok, true);
  assert.equal(result.body.finishReason, "toolUse");
  assert.equal(result.body.toolCalls.length, 1);
  assert.equal(result.body.toolCalls[0].name, "calc_evaluate");
  assert.equal(result.body.toolCalls[0].arguments.expression, "1+1");
  assert.ok(lastBody.tools?.[0]?.function?.name === "calc_evaluate", "tools 应透传到上游");
});

test("/complete/stream：{content} 增量帧 + [DONE]", async () => {
  const response = await fetch(`http://127.0.0.1:${adapterPort}/v1/pinax/complete/stream`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: [{ role: "user", content: "流式" }] }) });
  assert.equal(response.status, 200);
  const frames: string[] = [];
  for await (const frame of sseFrames(response.body!)) frames.push(frame);
  const deltas = frames.filter((frame) => /^data: \{"content"/.test(frame)).map((frame) => JSON.parse(frame.slice(6)).content).join("");
  assert.ok(deltas.includes("次模型正文"), `增量应含正文：${frames.join(" | ")}`);
  assert.ok(frames.some((frame) => frame.trim() === "data: [DONE]"));
});

test("热切后新任务用新模型（内存 cfg 生效证明）", async () => {
  await post("/model", { model: "second-model" });
  const probe = await post("/v1/pinax/complete", { messages: [{ role: "user", content: "probe" }] });
  assert.equal(probe.body.model, "mock.second-model");
});

test("/model patch 协议轴：api 合法值透传、非法值拒（validateModelPatch 纯函数面）", () => {
  assert.deepEqual(validateModelPatch({ model: "m", api: "anthropic-messages" }), { ok: true, patch: { model: "m", api: "anthropic-messages" } });
  assert.deepEqual(validateModelPatch({ model: "m" }), { ok: true, patch: { model: "m" } });
  const bad = validateModelPatch({ model: "m", api: "grpc" });
  assert.equal(bad.ok, false);
  assert.match((bad as { message: string }).message, /api/);
});

test("POST /model 非法 api → 400 且当前协议不变（GET /model 回显 api）", async () => {
  const before = await get("/model");
  assert.equal(before.api, "openai-completions");
  const rejected = await post("/model", { model: "second-model", api: "anthropic" });
  assert.equal(rejected.status, 400);
  assert.equal(rejected.body.error, "invalid-model-patch");
  assert.equal((await get("/model")).api, "openai-completions");
});

test("空提示词护栏：全部 user/system 轮正文为空且无 systemPrompt → 拒绝（validateCompleteRequest 纯函数面）", () => {
  const empty = validateCompleteRequest({
    messages: [
      { role: "user", content: "" },
      { role: "assistant", content: "（模型自由发挥的文本）" }
    ]
  });
  assert.equal(empty.ok, false);
  assert.match((empty as { message: string }).message, /正文为空/);
});

test("空提示词护栏：systemPrompt 非空即视为有锚（独立字段不计入 messages）", () => {
  const anchored = validateCompleteRequest({
    systemPrompt: "你是叙事者",
    messages: [{ role: "user", content: "" }]
  });
  assert.equal(anchored.ok, true);
});
