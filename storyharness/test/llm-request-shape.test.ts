// 请求形状钉（离线，无网络/无服务/无真 key）：profile 解析的最终可观测后果是发出去的消息角色与字段。
// 只钉 compat 中间结构不够——上游 pi-ai 换版本或链路重构仍可能把 developer 角色漏出去。
// 手法：stub fetch；dispatch 发生在消费流时——必须迭代流才会调到 fetch（见 tmp 探针教训）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeModels, foldSystemIntoUserPayload } from "../src/llm.js";

async function captureBody(target: Parameters<typeof makeModels>[0]): Promise<Record<string, unknown>> {
  const models = makeModels(target);
  const model = models.getModel(target.provider, target.model);
  assert.ok(model, "模型应可解析");
  let captured: unknown;
  try {
    const stream = (await models.streamSimple(
      model,
      {
        systemPrompt: "SYS",
        messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
        tools: [],
      } as never,
      {
        maxTokens: 128,
        timeoutMs: 1000,
        fetch: async (_url: unknown, init: { body?: unknown }) => {
          captured = init?.body;
          throw new Error("STOP-AT-FETCH");
        },
      } as never,
    )) as AsyncIterable<unknown>;
    for await (const _ev of stream) {
      // 消费到 stub fetch 抛出为止
    }
  } catch {
    // stub fetch 的哨兵错误（或上游包装）——请求体已捕获即达标
  }
  assert.ok(captured !== undefined, "stub fetch 应被调用（未捕获到请求体，链路可能在 dispatch 前就变了）");
  return typeof captured === "string" ? (JSON.parse(captured) as Record<string, unknown>) : (captured as Record<string, unknown>);
}

test("请求形状：provider=openai 但 baseUrl 命中 dots 域名——无独立 system/developer 轮（折进首条 user），不带 store", async () => {
  const body = await captureBody({
    provider: "openai",
    model: "dots3-note-prev",
    apiKey: "test-key",
    baseUrl: "https://note3-prev-api.askdiandian.com/v1",
  });
  const messages = body.messages as Array<{ role: string }>;
  assert.ok(
    !messages.some((m) => m.role === "system" || m.role === "developer"),
    "dots 系端点对任何独立 system 轮一律空补全/400——须折进首条 user（foldSystemIntoUser）",
  );
  assert.equal(messages[0]?.role, "user", "首轮应为 user（system 文本折入其内）");
  assert.equal(body.store, undefined, "supportsStore=false 时不应发 store 字段");
});

test("foldSystemIntoUserPayload 边界：无 system 原样返回、developer 同折、无 user 时前置", () => {
  assert.equal(foldSystemIntoUserPayload({ messages: [{ role: "user", content: "hi" }] }), undefined, "无 system 轮应返回 undefined（保持原样）");
  assert.equal(foldSystemIntoUserPayload({ messages: [] }), undefined);
  assert.equal(foldSystemIntoUserPayload(null), undefined);
  const dev = foldSystemIntoUserPayload({
    messages: [{ role: "developer", content: "D" }, { role: "user", content: "hi" }],
  }) as { messages: Array<{ role: string; content: unknown }> };
  assert.deepEqual(dev.messages[0], { role: "user", content: "D\n\nhi" }, "developer 轮同样折叠（string content 合并）");
  const noUser = foldSystemIntoUserPayload({
    messages: [{ role: "system", content: "S" }, { role: "assistant", content: "a" }],
  }) as { messages: Array<{ role: string }> };
  assert.equal(noUser.messages[0]?.role, "user", "无 user 轮时 system 文本前置为新 user");
  assert.equal(noUser.messages[1]?.role, "assistant", "原消息顺序保持");
});

test("请求形状：generic 端点保持 pi-ai 探测行为（developer + store:false——已知坑，改动前先读本测试）", async () => {
  const body = await captureBody({
    provider: "openai",
    model: "gpt-x",
    apiKey: "test-key",
    baseUrl: "https://api.example.invalid/v1",
  });
  const messages = body.messages as Array<{ role: string }>;
  assert.equal(messages[0]?.role, "developer", "generic 端点 pi-ai 探测为 supportsDeveloperRole=true");
  assert.equal(body.store, false, "generic 端点 pi-ai 探测为 supportsStore=true");
});

/** Anthropic 线的可观测面不止 body——请求路径与鉴权头同样是「传输选对了没有」的证据。 */
async function captureRequest(
  target: Parameters<typeof makeModels>[0],
): Promise<{ body: Record<string, unknown>; url: string; headerNames: string[] }> {
  const models = makeModels(target);
  const model = models.getModel(target.provider, target.model);
  assert.ok(model, "模型应可解析");
  let capturedUrl = "";
  let capturedBody: unknown;
  let capturedHeaders: unknown;
  const headerNamesOf = (h: unknown): string[] => {
    if (!h) return [];
    if (Array.isArray(h)) return h.map((pair) => String((pair as [string, unknown])[0]).toLowerCase());
    if (typeof (h as { forEach?: unknown }).forEach === "function") {
      const out: string[] = [];
      (h as { forEach: (value: unknown, key: string) => void }).forEach((_value, key) => out.push(String(key).toLowerCase()));
      return out;
    }
    return Object.keys(h as Record<string, unknown>).map((name) => name.toLowerCase());
  };
  try {
    const stream = (await models.streamSimple(
      model,
      {
        systemPrompt: "SYS 提示",
        messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
        tools: [],
      } as never,
      {
        maxTokens: 128,
        timeoutMs: 1000,
        fetch: async (url: unknown, init: { body?: unknown; headers?: unknown }) => {
          capturedUrl = String(url);
          capturedBody = init?.body;
          capturedHeaders = init?.headers;
          throw new Error("STOP-AT-FETCH");
        },
      } as never,
    )) as AsyncIterable<unknown>;
    for await (const _ev of stream) {
      // 消费到 stub fetch 抛出为止
    }
  } catch {
    // 哨兵错误——已捕获请求即达标
  }
  assert.ok(capturedBody !== undefined, "stub fetch 应被调用（未捕获到请求体，链路可能在 dispatch 前就变了）");
  const body = typeof capturedBody === "string" ? (JSON.parse(capturedBody) as Record<string, unknown>) : (capturedBody as Record<string, unknown>);
  return { body, url: capturedUrl, headerNames: headerNamesOf(capturedHeaders) };
}

test("协议轴：baseUrl 指向 /anthropic → 走 Anthropic messages 线（system 在顶层、messages 无 system 轮、路径 /v1/messages、鉴权 x-api-key）", async () => {
  const { body, url, headerNames } = await captureRequest({
    provider: "minimax",
    model: "MiniMax-Text-01",
    apiKey: "test-key",
    baseUrl: "https://api.minimaxi.com/anthropic",
  });
  assert.ok(/\/v1\/messages(\?|$)/.test(url), `应走 Anthropic messages 路径，实际：${url}`);
  const systemText = typeof body.system === "string" ? body.system : JSON.stringify(body.system ?? "");
  assert.ok(systemText.includes("SYS 提示"), `systemPrompt 应拆到顶层 params.system，实际：${systemText.slice(0, 80)}`);
  const messages = body.messages as Array<{ role: string }>;
  assert.ok(!messages.some((m) => m.role === "system" || m.role === "developer"), "Anthropic 线 messages 内不应有独立 system 轮");
  assert.ok(headerNames.includes("x-api-key"), `鉴权应走 x-api-key，实际头：${headerNames.join(",")}`);
});

test("协议轴：同一端点显式 api=openai-completions 时回到兼容线（证明协议由配置决定，不被域名钉死）", async () => {
  const { url, body } = await captureRequest({
    provider: "minimax",
    model: "MiniMax-Text-01",
    apiKey: "test-key",
    baseUrl: "https://api.minimaxi.com/anthropic",
    api: "openai-completions",
  });
  assert.ok(!/\/v1\/messages$/.test(url), `不应走 Anthropic 路径，实际：${url}`);
  assert.equal(body.system, undefined, "openai-completions 线不发顶层 system");
});
