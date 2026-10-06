// Pinax 侧接入件冒烟：bridge 直连适配器，验证「挂进 Pinax 后能跑通并交回 orchestrator 形状」。
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { startServer } from "../src/pinax/server.js";
import { parseNarrativeAgentSseEvent } from "../src/pinax/contract.js";
import { createPiNarrativeAgentBridge, buildResourceSnapshot, buildKernelPayload } from "../src/pinax/pinax-side/pinaxNarrativeAgentBridge.js";

let mock: http.Server;
let mockCalls: { role: string }[][] = [];
let adapter: http.Server;
let adapterPort = 0;

function startMockLlm(): Promise<number> {
  mock = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
      const messages = (body.messages || []) as { role: string }[];
      mockCalls.push(messages);
      res.writeHead(200, { "content-type": "text/event-stream" });
      const w = (o: unknown, last = false) => { res.write(`data: ${JSON.stringify(o)}\n\n`); if (last) res.write("data: [DONE]\n\n"); };
      const hasToolResult = messages.some((m) => m.role === "tool");
      if (!hasToolResult) {
        w({ id: "m", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant" } }] });
        w({ id: "m", object: "chat.completion.chunk", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "c1", type: "function", function: { name: "memory_lookup", arguments: '{"action":"search","query":"守镇"}' } }] } }] });
        w({ id: "m", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] }, true);
      } else {
        w({ id: "m", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant" } }] });
        w({ id: "m", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: "她答应过老周，不离青梧镇。" } }] });
        w({ id: "m", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }, true);
      }
      res.end();
    });
  });
  return new Promise((r) => mock.listen(0, "127.0.0.1", () => r((mock.address() as AddressInfo).port)));
}

// 假 Pinax 索引：byDomain 是 Map（对齐 getNarrativeResourceIndex 产物形状）
const fakeIndex = {
  revision: "idx_rev_7",
  currentPlaceId: "p_wutown",
  byDomain: new Map([
    ["world", [{ id: "c_yanning", title: "沈砚宁", type: "角色", summary: "药庐女医", aliases: ["砚宁"], relations: [{ type: "师徒", targetId: "c_laozhou" }] }]],
    ["memory", [{ id: "m_promise", title: "守镇之约", summary: "砚宁答应老周不离镇", trust: "confirmed-memory" }]],
  ]),
};

const fakeKernel = {
  revision: "krev_9",
  scene: { title: "青梧镇药庐", summary: "雨夜，药庐灯亮。" },
  character: { name: "沈砚宁", profile: "三十上下，惯于把话咽回去。" },
  location: { name: "青梧镇" },
  time: { label: "第七年秋" },
  goals: ["查明药庐旧事"],
  activities: ["整理药材"],
  recentMessages: [{ role: "user", content: "你听见檐外有脚步声。" }],
};

before(async () => {
  const llmPort = await startMockLlm();
  adapter = startServer({
    port: 0,
    tasksDir: `tasks-bridge-${Date.now()}`,
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
  mock?.closeAllConnections?.();
  adapter?.close();
  mock?.close();
});

test("快照构造：Map 型 byDomain → 工具域，条数字段齐备", () => {
  const snap = buildResourceSnapshot(fakeIndex);
  assert.equal(snap.revision, "idx_rev_7");
  assert.deepEqual(Object.keys(snap.domains).sort(), ["memory_lookup", "world_lookup"]);
  assert.equal(snap.domains.world_lookup[0].id, "c_yanning");
  assert.deepEqual(snap.domains.world_lookup[0].relations, [{ type: "师徒", targetId: "c_laozhou" }]);
});

test("PR#4审阅③：世界书正文读取兼容 content 字段（上游 entries 正文键名不统一）", () => {
  const idx = {
    revision: "rev_content",
    byDomain: new Map([
      ["world", [{ id: "e_1", title: "只带 content 的条目", content: "正文写在这里。" }]],
    ]),
  };
  const snap = buildResourceSnapshot(idx);
  assert.equal(snap.domains.world_lookup[0].summary, "正文写在这里。");
});

test("PR#4审阅②：run/resume 透传 bookId，任务快照归属落账", async () => {
  const bridge = createPiNarrativeAgentBridge({ endpoint: `http://127.0.0.1:${adapterPort}`, parseEvent: parseNarrativeAgentSseEvent });
  const run = await bridge.run({
    kernel: fakeKernel,
    index: fakeIndex,
    mode: "continue",
    intent: "归属检查",
    requestId: "bridge_book_1",
    taskId: "bridge_book_task",
    bookId: "wb_beta",
  });
  assert.ok(run.trace.taskId);
  const snap = (await bridge.status("bridge_book_task")) as Record<string, unknown>;
  assert.equal(snap.bookId, "wb_beta", "归属应随请求贯穿到任务快照");
  // resume 漏发 bookId → 服务端以快照回落，归属不变
  await bridge.resume({ taskId: "bridge_book_task", kernel: fakeKernel, index: fakeIndex, intent: "续" });
  const snap2 = (await bridge.status("bridge_book_task")) as Record<string, unknown>;
  assert.equal(snap2.bookId, "wb_beta");
});

test("kernel 载荷：无预序列化时现拼有界块", () => {
  const k = buildKernelPayload(fakeKernel);
  assert.equal(k.revision, "krev_9");
  assert.ok(k.blocks.some((b: { kind: string }) => b.kind === "character"));
  assert.ok(k.blocks.some((b: { kind: string }) => b.kind === "recent"));
});

test("bridge.run：资料回合→流式正文→orchestrator 兼容返回，且事件过上游 parser", async () => {
  mockCalls = [];
  const bridge = createPiNarrativeAgentBridge({ endpoint: `http://127.0.0.1:${adapterPort}`, parseEvent: parseNarrativeAgentSseEvent });
  const chunks: string[] = [];
  const statuses: unknown[] = [];
  const run = await bridge.run({
    kernel: fakeKernel,
    index: fakeIndex,
    registry: { revision: "reg_1" },
    mode: "continue",
    intent: "回应脚步声",
    formatInstructions: "纯叙事正文。",
    maxTokens: 1200,
    requestId: "bridge_1",
    callbacks: { onChunk: (c: { content: string }) => chunks.push(c.content), onComplete: () => {} },
    onStatus: (s: unknown) => statuses.push(s),
  });
  assert.equal(run.ok, true);
  assert.match(run.finalContent, /守镇之约|答应过老周/);
  assert.equal(run.trace.engine, "pi-agent-adapter");
  assert.equal(run.trace.calls?.[0]?.name, "memory_lookup");
  assert.equal(run.totalCalls, 1);
  assert.ok(chunks.length > 0, "onChunk 应收到流式片段");
  assert.ok(statuses.some((s) => (s as { phase: string }).phase === "tool"), "onStatus 应看到工具阶段");
  // 第二回合确实带回工具结果
  assert.equal(mockCalls.length, 2);
  assert.ok(mockCalls[1].some((m) => m.role === "tool"));
  // taskId 可用于后续 status/cancel/resume
  assert.ok(run.trace.taskId, "trace 应回带 taskId");
  const snap = (await bridge.status(run.trace.taskId!)) as Record<string, unknown>;
  assert.equal(snap.status, "completed");
});

test("bridge：适配器不可达时显式失败，不静默兜底", async () => {
  const bridge = createPiNarrativeAgentBridge({ endpoint: "http://127.0.0.1:1" });
  await assert.rejects(() => bridge.run({ kernel: fakeKernel, index: fakeIndex, requestId: "bridge_dead" }));
});
