// 端到端冒烟：mock LLM（OpenAI 兼容 SSE）+ 真实适配器服务端。
// 验证：①事件流可被上游 parseNarrativeAgentSseEvent 全数解析；②工具回合真实发生且结果进转录；
// ③取消/恢复（Issue #3 的 state/cancellation/recovery）。
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { startServer } from "../src/pinax/server.js";
import { parseNarrativeAgentSseEvent } from "../src/pinax/contract.js";

// ---- mock LLM：脚本按「消息里是否已有 toolResult」选择回合 ----
let mockCalls: unknown[][] = [];
let hangNext = false;
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
      const messages = (body.messages || []) as { role: string }[];
      mockCalls.push(messages);
      res.writeHead(200, { "content-type": "text/event-stream" });
      const hasToolResult = messages.some((m) => m.role === "tool");
      if (hangNext) {
        sseWrite(res, { id: "m", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: "半" } }] });
        return; // 不关闭——由适配器超时/取消掐断
      }
      if (!hasToolResult) {
        sseWrite(res, { id: "m", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant" } }] });
        sseWrite(res, {
          id: "m", object: "chat.completion.chunk",
          choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_w1", type: "function", function: { name: "world_lookup", arguments: '{"action":"search","query":"药庐"}' } }] } }],
        });
        sseWrite(res, { id: "m", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] }, true);
        res.end();
        return;
      }
      sseWrite(res, { id: "m", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant" } }] });
      sseWrite(res, { id: "m", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: "青梧镇的雨下了整夜。" } }] });
      sseWrite(res, { id: "m", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: "药庐的灯还亮着。" } }] });
      sseWrite(res, { id: "m", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }, true);
      res.end();
    });
  });
  return new Promise((resolve) => mockServer.listen(0, "127.0.0.1", () => resolve((mockServer.address() as AddressInfo).port)));
}

// ---- 测试夹具 ----
const turnRequest = (requestId: string, overrides: Record<string, unknown> = {}) => ({
  requestId,
  mode: "continue" as const,
  intent: "推进药庐线",
  formatInstructions: "输出纯叙事正文，不要标题。",
  maxTokens: 1200,
  kernel: {
    revision: "krev_1",
    blocks: [
      { kind: "scene", title: "当前场景", text: "青梧镇药庐，雨夜。" },
      { kind: "character", title: "当前角色", text: "沈砚宁（女医）独处，心中守着不离镇的约。" },
    ],
  },
  resources: {
    revision: "rev_test_1",
    currentPlaceId: "p_wutown",
    domains: {
      world_lookup: [
        { id: "c_yanning", title: "沈砚宁", type: "角色", summary: "青梧镇药庐女医，善辨百草。" },
        { id: "k_talisman", title: "引路符", type: "物品", text: "燃尽后可指向亡者安息之地。" },
      ],
      memory_lookup: [{ id: "m_promise", title: "守镇之约", summary: "砚宁答应老周不离镇。" }],
    },
  },
  budget: { agentTimeoutMs: 15_000, maxModelSteps: 4, maxCallsPerTurn: 4 },
  ...overrides,
});

let adapter: http.Server;
let adapterPort = 0;
const taskIdFor = async (requestId: string) => {
  const res = await fetch(`http://127.0.0.1:${adapterPort}/v1/pinax/tasks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(turnRequest(requestId)),
  });
  return res;
};

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

before(async () => {
  const llmPort = await startMockLlm();
  const tasksDir = `tasks-test-${Date.now()}`;
  adapter = startServer({
    port: 0,
    tasksDir,
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

test("全链：工具回合→正文流→完成快照，事件全部过上游契约解析", async () => {
  mockCalls = [];
  const res = await taskIdFor("e2e_happy_1");
  assert.equal(res.status, 200);
  const parsed: ReturnType<typeof parseNarrativeAgentSseEvent>[] = [];
  let taskCompleted: Record<string, unknown> | undefined;
  for await (const raw of sseFrames(res)) {
    const ev = parseNarrativeAgentSseEvent(raw);
    if (ev) parsed.push(ev);
    else if (/^event: task\.completed/m.test(raw)) taskCompleted = JSON.parse(raw.split("data: ")[1]);
  }
  const types = parsed.map((e) => e!.type);
  assert.ok(types.includes("step.start"), "缺 step.start");
  assert.ok(types.includes("tool.input.delta") && types.includes("tool.call"), "缺工具事件");
  assert.ok(types.includes("text.delta"), "缺正文 delta");
  assert.ok(types.includes("step.finish"), "缺 step.finish");
  assert.ok(types.includes("usage"), "缺 usage");
  const toolCall = parsed.find((e) => e!.type === "tool.call")!;
  assert.equal(toolCall!.toolName, "world_lookup");
  assert.equal(toolCall!.action, "search");
  const text = parsed.filter((e) => e!.type === "text.delta").map((e) => e!.content).join("");
  assert.match(text, /青梧镇的雨下了整夜/);
  assert.ok(taskCompleted && taskCompleted.status === "completed");

  // 任务快照：状态/转录（含 toolResult）
  const statusRes = await fetch(`http://127.0.0.1:${adapterPort}/v1/pinax/tasks/${taskCompleted!.taskId}`);
  const snap = await statusRes.json() as Record<string, unknown>;
  assert.equal(snap.status, "completed");
  assert.ok(Number(snap.finalTextChars) > 10);

  // 第二回合请求确实带了 tool 结果（工具进转录）
  assert.equal(mockCalls.length, 2);
  assert.ok((mockCalls[1] as { role: string }[]).some((m) => m.role === "tool"));
});

test("显式 cancel 端点掐断挂起的任务→task.failed(cancelled)", async () => {
  hangNext = true;
  const req = turnRequest("e2e_cancel_ep_1", { taskId: "ptask_explicit_cancel" });
  const res = await fetch(`http://127.0.0.1:${adapterPort}/v1/pinax/tasks`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(req),
  });
  const reader = res.body!.getReader();
  // 等首帧到达（任务确实开跑）再取消
  await reader.read();
  const cancelRes = await fetch(`http://127.0.0.1:${adapterPort}/v1/pinax/tasks/ptask_explicit_cancel/cancel`, { method: "POST" });
  assert.equal(cancelRes.status, 200);
  hangNext = false;
  const dec = new TextDecoder();
  let all = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    all += dec.decode(value, { stream: true });
  }
  assert.match(all, /event: task\.failed/);
  assert.match(all, /"status":"cancelled"/);
  const snap = await (await fetch(`http://127.0.0.1:${adapterPort}/v1/pinax/tasks/ptask_explicit_cancel`)).json() as Record<string, unknown>;
  assert.equal(snap.status, "cancelled");
});

test("取消→快照 cancelled→resume 续跑不重放", async () => {
  hangNext = true;
  mockCalls = [];
  const res = await taskIdFor("e2e_cancel_1");
  const frames: string[] = [];
  for await (const raw of sseFrames(res)) frames.push(raw);
  hangNext = false;
  const failedFrame = frames.find((f) => /^event: task\.failed/m.test(f));
  assert.ok(failedFrame, "取消后应出 task.failed 帧");
  const failBody = JSON.parse(failedFrame!.split("data: ")[1]);
  assert.equal(failBody.status, "cancelled");
  const taskId = failBody.taskId as string;
  assert.ok(taskId, "取消路径也要回带 taskId（Issue 的 cancellation 可用性）");

  // 取消后转录应至少含首轮（可恢复的前提）
  const snap = await (await fetch(`http://127.0.0.1:${adapterPort}/v1/pinax/tasks/${taskId}`)).json() as Record<string, unknown>;
  assert.equal(snap.status, "cancelled");

  // resume：重发同一请求体（含 kernel/resources），转录由服务端快照续接
  const rres = await fetch(`http://127.0.0.1:${adapterPort}/v1/pinax/tasks/${taskId}/resume`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(turnRequest("e2e_resume_1")),
  });
  assert.equal(rres.status, 200);
  const parsed: ReturnType<typeof parseNarrativeAgentSseEvent>[] = [];
  let done: Record<string, unknown> | undefined;
  for await (const raw of sseFrames(rres)) {
    const ev = parseNarrativeAgentSseEvent(raw);
    if (ev) parsed.push(ev);
    else if (/^event: task\.completed/m.test(raw)) done = JSON.parse(raw.split("data: ")[1]);
  }
  assert.ok(done, "resume 应跑到 completed");
  assert.ok(parsed.some((e) => e!.type === "text.delta"));
  // resume 的首个 LLM 请求必须带上被取消回合的既有消息（续跑，不是从零重跑）
  assert.ok(mockCalls[0].length > 1, "resume 未重放既有转录");
});

test("PR#4审阅④：task.started 帧先于完成帧到达，运行中即知 taskId", async () => {
  hangNext = true;
  try {
    const res = await taskIdFor("e2e_started_1");
    assert.equal(res.status, 200);
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    // 首帧必须是 task.started（此前客户端要等任务结束才知道 taskId，运行中取消无从下手）
    const { value } = await reader.read();
    const firstChunk = dec.decode(value, { stream: true });
    assert.match(firstChunk, /event: task\.started/, "首帧应为 task.started");
    const startedFrame = firstChunk.split("\n\n").find((f) => /^event: task\.started/m.test(f))!;
    const startedBody = JSON.parse(startedFrame.split("data: ")[1]);
    assert.ok(startedBody.taskId, "started 帧必须携带 taskId");
    // 后端真的可停：/cancel 掐断挂起的 provider 流
    await fetch(`http://127.0.0.1:${adapterPort}/v1/pinax/tasks/${startedBody.taskId}/cancel`, { method: "POST" });
    let rest = firstChunk;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      rest += dec.decode(value, { stream: true });
    }
    assert.match(rest, /"status":"cancelled"/);
  } finally {
    hangNext = false; // 断言失败也不得泄漏给后续用例（否则 mock 挂起引发级联超时）
  }
});

test("PR#4审阅②：bookId 作品归属贯穿创建→快照→列表，resume 漏发时回落快照", async () => {
  const req = turnRequest("e2e_book_1", { taskId: "ptask_book_1", bookId: "wb_alpha" });
  const res = await fetch(`http://127.0.0.1:${adapterPort}/v1/pinax/tasks`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(req),
  });
  let completed: Record<string, unknown> | undefined;
  for await (const raw of sseFrames(res)) {
    if (/^event: task\.completed/m.test(raw)) completed = JSON.parse(raw.split("data: ")[1]);
  }
  assert.ok(completed);
  const snap = await (await fetch(`http://127.0.0.1:${adapterPort}/v1/pinax/tasks/ptask_book_1`)).json() as Record<string, unknown>;
  assert.equal(snap.bookId, "wb_alpha", "归属应落账到任务快照");
  const list = await (await fetch(`http://127.0.0.1:${adapterPort}/v1/pinax/tasks/list`)).json() as { tasks: { taskId: string; bookId?: string }[] };
  const hit = list.tasks.find((t) => t.taskId === "ptask_book_1");
  assert.equal(hit?.bookId, "wb_alpha", "归属应随列表外露（面板按作品过滤的数据源）");
  // resume 漏发 bookId → 以快照为准，归属不变（旧任务永远归旧作品）
  const rres = await fetch(`http://127.0.0.1:${adapterPort}/v1/pinax/tasks/ptask_book_1/resume`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(turnRequest("e2e_book_1_resume")),
  });
  assert.equal(rres.status, 200);
  for await (const raw of sseFrames(rres)) {
    if (/^event: task\.completed/m.test(raw)) break;
  }
  const snap2 = await (await fetch(`http://127.0.0.1:${adapterPort}/v1/pinax/tasks/ptask_book_1`)).json() as Record<string, unknown>;
  assert.equal(snap2.bookId, "wb_alpha", "resume 后归属不得漂移");
});
