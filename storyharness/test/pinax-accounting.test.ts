// 记账与空 completion 守卫：mock LLM（OpenAI 兼容 SSE）+ 真实适配器服务端。
// 钉住两个实验抓到的缺陷：①回合结束无正文必须落 task.failed（不再静默空成功）；
// ②落盘任务快照的 steps/toolCalls 必须反映真实计数（曾恒为 0）。
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { startServer } from "../src/pinax/server.js";

let emptyCalls = 0;
let planningRequests = 0;
let hangPlanning = false;
let printToolOnce = false;
const requestedTokens: number[] = [];
let mockServer: http.Server;

function sseWrite(res: http.ServerResponse, obj: unknown, last = false) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
  if (last) res.write("data: [DONE]\n\n");
}

function startMockLlm(): Promise<number> {
  mockServer = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
      requestedTokens.push(body.max_tokens);
      if (JSON.stringify(body.messages).includes("你是节拍规划器")) {
        planningRequests++;
        if (hangPlanning) return;
        res.writeHead(200, { "content-type": "text/event-stream" });
        sseWrite(res, { id: "plan", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", content: JSON.stringify({ responseObligation: "回应敲门", causalSteps: ["开门"], characterMoves: [], revealOrChange: "见到访客", endCondition: "门已打开", avoidRepeats: [] }) } }] });
        sseWrite(res, { id: "plan", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }, true);
        return res.end();
      }
      const messages = (body.messages || []) as { role: string }[];
      res.writeHead(200, { "content-type": "text/event-stream" });
      const hasToolResult = messages.some((m) => m.role === "tool");
      if (!hasToolResult && printToolOnce) {
        printToolOnce = false;
        sseWrite(res, { id: "pseudo", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", content: '```typescript\nfunctions.world_lookup({"action":"get","id":"c1"})\n```' } }] });
        sseWrite(res, { id: "pseudo", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }, true);
        return res.end();
      }
      if (!hasToolResult) {
        // 首回合：一次工具调用
        sseWrite(res, { id: "m", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant" } }] });
        sseWrite(res, {
          id: "m", object: "chat.completion.chunk",
          choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_w1", type: "function", function: { name: "world_lookup", arguments: '{"action":"search","query":"药庐"}' } }] } }],
        });
        sseWrite(res, { id: "m", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] }, true);
        res.end();
        return;
      }
      emptyCalls += 1;
      if (emptyCalls === 1) {
        // 次回合：正常出正文（供计数断言用）
        sseWrite(res, { id: "m", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant" } }] });
        sseWrite(res, { id: "m", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: "青梧镇的雨下了整夜。" } }] });
        sseWrite(res, { id: "m", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }, true);
      } else {
        // 之后：finish stop 但零正文 → 必须显式失败而非空成功
        sseWrite(res, { id: "m", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant" } }] });
        sseWrite(res, { id: "m", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }, true);
      }
      res.end();
    });
  });
  return new Promise((resolve) => mockServer.listen(0, "127.0.0.1", () => resolve((mockServer.address() as AddressInfo).port)));
}

const turnRequest = (requestId: string, overrides: Record<string, unknown> = {}) => ({
  requestId,
  mode: "continue" as const,
  intent: "推进药庐线",
  maxTokens: 1200,
  kernel: { revision: "krev_1", blocks: [{ kind: "scene", title: "当前场景", text: "青梧镇药庐，雨夜。" }] },
  resources: { revision: "rev_1", currentPlaceId: "p_wutown", domains: { world_lookup: [{ id: "c1", title: "沈砚宁", type: "角色", summary: "女医。" }] } },
  budget: { agentTimeoutMs: 15_000, maxModelSteps: 4, maxCallsPerTurn: 4 },
  ...overrides,
});

async function* sseFrames(res: Response) {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const raw = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      if (raw.trim()) yield raw;
    }
  }
}

let adapter: http.Server;
let adapterPort = 0;

before(async () => {
  const llmPort = await startMockLlm();
  adapter = startServer({
    port: 0,
    tasksDir: `tasks-test-accounting-${Date.now()}`,
    provider: "mock",
    model: "mock-model",
    baseUrl: `http://127.0.0.1:${llmPort}/v1`,
    apiKey: "test-key",
    thinking: "off",
  });
  await new Promise((r) => adapter.once("listening", r));
  adapterPort = (adapter.address() as AddressInfo).port;
});

after(() => {
  adapter?.closeAllConnections?.();
  mockServer?.closeAllConnections?.();
  adapter?.close();
  mockServer?.close();
});

test("快照计数：工具回合+正文的任务，落盘 steps/toolCalls 反映真实值", async () => {
  const res = await fetch(`http://127.0.0.1:${adapterPort}/v1/pinax/tasks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(turnRequest("acct_counts_1", { taskId: "ptask_acct_counts" })),
  });
  let completed: Record<string, unknown> | undefined;
  for await (const raw of sseFrames(res)) {
    if (/^event: task\.completed/m.test(raw)) completed = JSON.parse(raw.split("data: ")[1]);
  }
  assert.equal(completed?.status, "completed");
  assert.ok(requestedTokens.every(tokens => tokens === 1200), "runner must respect caller token limits");
  assert.equal(completed?.finalText, "青梧镇的雨下了整夜。");
  assert.equal(completed?.steps, 2);
  assert.equal(completed?.toolCalls, 1);
  const snap = await (await fetch(`http://127.0.0.1:${adapterPort}/v1/pinax/tasks/ptask_acct_counts`)).json() as Record<string, unknown>;
  assert.equal(snap.status, "completed");
  assert.equal(snap.steps, 2, "落盘快照 steps 应为真实计数");
  assert.equal(snap.toolCalls, 1, "落盘快照 toolCalls 应为真实计数");
});

test("空 completion：回合结束无正文 → task.failed(PINAX_ADAPTER_EMPTY_COMPLETION)，不再空成功", async () => {
  const res = await fetch(`http://127.0.0.1:${adapterPort}/v1/pinax/tasks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(turnRequest("acct_empty_1", { taskId: "ptask_acct_empty" })),
  });
  let failed: Record<string, unknown> | undefined;
  const all: string[] = [];
  for await (const raw of sseFrames(res)) {
    all.push(raw);
    if (/^event: task\.failed/m.test(raw)) failed = JSON.parse(raw.split("data: ")[1]);
  }
  assert.ok(failed, "空 completion 必须出 task.failed 帧");
  assert.equal(failed?.status, "failed");
  assert.equal((failed?.error as Record<string, unknown>)?.code, "PINAX_ADAPTER_EMPTY_COMPLETION");
  assert.ok(!all.some((f) => /^event: task\.completed/m.test(f)), "不得出现 task.completed 假成功帧");
  const snap = await (await fetch(`http://127.0.0.1:${adapterPort}/v1/pinax/tasks/ptask_acct_empty`)).json() as Record<string, unknown>;
  assert.equal(snap.status, "failed");
});


// —— BeatPlan 规划轮（②）：独立 mock LLM（round1 提交计划，round2 出正文），不与共享 mock 耦合 ——

let beatMockServer: http.Server;

function startBeatMockLlm(): Promise<number> {
  beatMockServer = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
      requestedTokens.push(body.max_tokens);
      if (JSON.stringify(body.messages).includes("你是节拍规划器")) {
        planningRequests++;
        if (hangPlanning) return;
        res.writeHead(200, { "content-type": "text/event-stream" });
        sseWrite(res, { id: "plan", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", content: JSON.stringify({ responseObligation: "回应叩门", causalSteps: ["沈砚宁起身开门"], characterMoves: [], revealOrChange: "门外站着她的旧识", endCondition: "门开着，两人对视", avoidRepeats: [] }) } }] });
        sseWrite(res, { id: "plan", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }, true);
        return res.end();
      }
      const messages = (body.messages || []) as { role: string }[];
      res.writeHead(200, { "content-type": "text/event-stream" });
      const hasToolResult = messages.some((m) => m.role === "tool");
      sseWrite(res, { id: "b", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant" } }] });
      if (!hasToolResult && (body.tools || []).some((tool: { function?: { name?: string } }) => tool.function?.name === "submit_narrative_beat_plan")) {
        sseWrite(res, {
          id: "b", object: "chat.completion.chunk",
          choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_bp", type: "function", function: { name: "submit_narrative_beat_plan", arguments: JSON.stringify({ responseObligation: "回应叩门", causalSteps: ["沈砚宁起身开门"], revealOrChange: "门外站着她的旧识", endCondition: "门开着，两人对视" }) } }] } }],
        });
        sseWrite(res, { id: "b", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] }, true);
      } else {
        sseWrite(res, { id: "b", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: "门开了。" } }] });
        sseWrite(res, { id: "b", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }, true);
      }
      res.end();
    });
  });
  return new Promise((resolve) => beatMockServer.listen(0, "127.0.0.1", () => resolve((beatMockServer.address() as AddressInfo).port)));

  void beatMockServer;
}

test("BeatPlan 规划轮（②）：mode=init 受理节拍计划 → beat.plan 帧 + 快照/返回携带（含 revision）", async () => {
  const llmPort = await startBeatMockLlm();
  const beatAdapter = startServer({
    port: 0,
    tasksDir: `tasks-test-accounting-beat-${Date.now()}`,
    provider: "mock",
    model: "mock-model",
    baseUrl: `http://127.0.0.1:${llmPort}/v1`,
    apiKey: "test-key",
    thinking: "off",
  });
  await new Promise((r) => beatAdapter.once("listening", r));
  const beatPort = (beatAdapter.address() as AddressInfo).port;
  try {
    const res = await fetch(`http://127.0.0.1:${beatPort}/v1/pinax/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(turnRequest("acct_beat_1", { taskId: "ptask_acct_beat", mode: "init" })),
    });
    const all: string[] = [];
    let completed: Record<string, unknown> | undefined;
    for await (const raw of sseFrames(res)) {
      all.push(raw);
      if (/^event: task\.completed/m.test(raw)) completed = JSON.parse(raw.split("data: ")[1]);
    }
    const beatFrame = all.find((f) => /^event: beat\.plan/m.test(f));
    assert.ok(beatFrame, "受理计划应发 beat.plan 扩展帧");
    const beatPlan = (JSON.parse(beatFrame.split("data: ")[1]) as { plan: Record<string, unknown> }).plan;
    assert.match(String(beatPlan.revision), /^bp_/);
    assert.equal(beatPlan.responseObligation, "回应叩门");
    assert.equal((completed?.beatPlan as Record<string, unknown>)?.revision, beatPlan.revision);
    const snap = await (await fetch(`http://127.0.0.1:${beatPort}/v1/pinax/tasks/ptask_acct_beat`)).json() as Record<string, unknown>;
    assert.equal((snap.beatPlan as Record<string, unknown>)?.revision, beatPlan.revision, "落盘快照应含 beatPlan");
    assert.equal(snap.status, "completed");
  } finally {
    beatAdapter.closeAllConnections?.();
    beatAdapter.close();
    beatMockServer?.closeAllConnections?.();
    beatMockServer?.close();
  }
});

test("BeatPlan 工具语义：hooks 暴露、无效计划拒绝且不触发受理、有效计划回调 revision", async () => {
  const { buildPinaxTools } = await import("../src/pinax/tools.js");
  let accepted = 0;
  const tools = buildPinaxTools({ revision: "r", domains: {} }, [], { onBeatPlan: () => { accepted += 1; } });
  const tool = tools.find((t) => t.name === "submit_narrative_beat_plan");
  assert.ok(tool, "hooks 存在时应暴露规划工具");
  const invalid = await tool.execute("x", { responseObligation: "" } as never) as unknown as { content: { text: string }[] };
  assert.match(invalid.content[0].text, /NARRATIVE_BEAT_PLAN_OBLIGATION_REQUIRED/);
  assert.equal(accepted, 0, "无效计划不触发受理回调");
  const valid = await tool.execute("x", { responseObligation: "回应叩门", causalSteps: ["沈砚宁开门"], revealOrChange: "门外是旧识", endCondition: "门开着，两人对视" } as never) as unknown as { content: { text: string }[] };
  assert.match(valid.content[0].text, /"revision":"bp_/);
  assert.equal(accepted, 1);
});


test("规划轮计入模型步数，终态正文不混入工具前言", async () => {
  emptyCalls = 0;
  const initialCalls = requestedTokens.length;
  const response = await fetch(`http://127.0.0.1:${adapterPort}/v1/pinax/tasks`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(turnRequest("acct_plan", { mode: "auto", taskId: "ptask_acct_plan", taskKind: "narrative" })),
  });
  let completed: Record<string, unknown> | undefined;
  for await (const raw of sseFrames(response)) if (/^event: task\.completed/m.test(raw)) completed = JSON.parse(raw.split("data: ")[1]);
  assert.equal(completed?.steps, 3);
  assert.ok(completed?.beatPlan);
  assert.deepEqual(requestedTokens.slice(initialCalls), [900, 1200, 1200]);
  printToolOnce = true;
  emptyCalls = 0;
  const repaired = await fetch(`http://127.0.0.1:${adapterPort}/v1/pinax/tasks`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(turnRequest("acct_pseudo_tool", { taskId: "ptask_acct_pseudo_tool", taskKind: "assistant" })),
  });
  let terminal: Record<string, unknown> | undefined;
  for await (const raw of sseFrames(repaired)) if (/^event: task\.completed/m.test(raw)) terminal = JSON.parse(raw.split("data: ")[1]);
  assert.equal(terminal?.steps, 3);
  assert.equal(terminal?.toolCalls, 1);
  assert.equal(terminal?.finalText, "青梧镇的雨下了整夜。");

});

test("规划模型悬挂时取消也会停止任务并确认终态", async () => {
  hangPlanning = true;
  const initialPlans = planningRequests;
  try {
    const response = await fetch(`http://127.0.0.1:${adapterPort}/v1/pinax/tasks`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(turnRequest("acct_plan_cancel", { mode: "auto", taskId: "ptask_acct_plan_cancel" })),
    });
    for (let attempt = 0; attempt < 50 && planningRequests === initialPlans; attempt++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(planningRequests > initialPlans);
    const receipt = await (await fetch(`http://127.0.0.1:${adapterPort}/v1/pinax/tasks/ptask_acct_plan_cancel/cancel`, { method: "POST" })).json() as Record<string, unknown>;
    assert.equal(receipt.stopped, true);
    assert.equal(receipt.status, "cancelled");
    assert.match(await response.text(), /task.failed/);
  } finally { hangPlanning = false; }
});
