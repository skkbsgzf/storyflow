// miniflow HTTP 面：REST 版本化 v1（core/src/api-v1.ts 的路由表）+ legacy `/api/*`
// （冻结契约 contracts/http-openapi.json，只标弃用不改载荷）+ CORS，供官方可视化底座消费
import fastify from "fastify";
import type { FastifyReply, FastifyRequest } from "fastify";
import cors from "@fastify/cors";
// 宿主面显式登记平台适配器（副作用）：HTTP 面跑在 Node 上，不该靠 schema.ts 的传递 import 侥幸拿到实现
import "./abstraction/adapters/node.js";
import { contractsDirOf, rootOf } from "./schema.js";
import { Kernel, KernelError } from "./kernel.js";
import { recordDiag } from "./diag.js";
import { registerCompat } from "./compat.js";
import { registerLegacyMarkers, registerV1, resolveProjectFlowId } from "./api-v1.js";
import type { RouteRegistrar } from "./api-v1.js";
import { contentTypeOf, resolveStaticPath } from "./static.js";
import { closeSignalOf, emitSseEvents, heartbeatMsOf, sseFrame, SSE_FRAME_DONE } from "./sse.js";
import { VERB_BY_NAME, VERB_NAMES } from "./verbs.js";
import { mcpFor, deleteSession, createSession, getSession, listSessions, loadModelConfig, renameSession, runTurn, saveModelConfig } from "./agent.js";

export function buildHttpApp(kernel: Kernel) {
  const app = fastify({ logger: false });
  void app.register(cors, { origin: true });
  // 弃用标记必须在任何路由之前挂（Fastify 的路由在注册时绑定钩子）。
  // R7-2：宿主边界把 fastify 实例收窄为库面的结构化子集（同一对象，零包装）。
  registerLegacyMarkers(app as unknown as RouteRegistrar);
  // v1 面（统一包装 + 自生成 OpenAPI）：路由清单只有一处事实源 = api-v1.ts 的 V1_ROUTES。
  registerV1(app as unknown as RouteRegistrar, kernel);

  const openapiFile = kernel.path.join(contractsDirOf(), "http-openapi.json");
  const openapi = kernel.fs.exists(openapiFile) ? JSON.parse(kernel.fs.readText(openapiFile)) : { openapi: "3.1.0", paths: {} };

  app.get("/api/openapi.json", async () => openapi);

  app.get("/api/projects", async () => kernel.viewProjects());

  app.get("/api/projects/:id/state", async (req, reply) => {
    const { id } = req.params as { id: string };
    const dir = kernel.projectDir(id);
    const file = kernel.path.join(dir, "state.json");
    if (!kernel.fs.exists(file)) {
      const legacy = kernel.path.join(dir, "run-state.json");
      if (kernel.fs.exists(legacy)) {
        reply.code(200);
        return { ...(JSON.parse(kernel.fs.readText(legacy)) as object), _legacy: true };
      }
      reply.code(404);
      return { error: "NO_RUN" };
    }
    return JSON.parse(kernel.fs.readText(file));
  });

  app.get("/api/projects/:id/graph", async (req, reply) => {
    const { id } = req.params as { id: string };
    // flowId 寻源单点在 api-v1.ts（v1 与本 legacy 面共用同一份策略，不再各写一遍）
    const flowId = resolveProjectFlowId(kernel, id);
    if (!flowId) { reply.code(404); return { error: "NO_FLOW" }; }
    try {
      return kernel.loadFlow(flowId);
    } catch (e) {
      // 报 NO_FLOW 是"可见的失败"，但失败原因（flow 损坏？schema 违约？）此前被丢掉 ⇒ 留痕。
      recordDiag(kernel, kernel.projectDir(id), "io", `http:graph:loadFlow(${flowId})`, e);
      reply.code(404);
      return { error: "NO_FLOW" };
    }
  });

  app.get("/api/projects/:id/artifacts", async (req) => {
    const { id } = req.params as { id: string };
    const { node, latest } = req.query as { node?: string; latest?: string };
    return kernel.viewArtifacts(id, { node, latest: latest === "true" || latest === "1" });
  });

  app.get("/api/projects/:id/artifacts/content", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { path: rel } = req.query as { path?: string };
    if (!rel) { reply.code(400); return { error: "MISSING_PATH" }; }
    const text = kernel.viewArtifactContent(id, rel);
    if (text === undefined) { reply.code(403); return { error: "NOT_REGISTERED", detail: "未注册产物不可读（未注册=不存在）" }; }
    reply.type("text/plain; charset=utf-8");
    return text;
  });

  app.get("/api/projects/:id/journal", async (req) => {
    const { id } = req.params as { id: string };
    const { since, limit, node } = req.query as { since?: string; limit?: string; node?: string };
    return kernel.viewJournal(id, { since, limit: limit ? Number(limit) : undefined, node });
  });

  // R8-OPS 诊断通道（旁路失败可见面）：
  //   项目级 = 指标/断言/词汇表类失败；仓库级（/api/diagnostics）= 知识库索引/台账类失败。
  //   count > 0 意味着"本项目的某个结论可能不可信"——页面据此出黄条，不再静默。
  app.get("/api/projects/:id/diagnostics", async (req) => {
    const { id } = req.params as { id: string };
    return kernel.viewDiagnostics(id);
  });

  app.get("/api/diagnostics", async () => kernel.viewDiagnostics());

  // R8-OPS 前端 live 化：页面轮询的**实时切片**（状态/生效编排/overlay/提案/指标/诊断），
  // 带 `revision` 与 `filesRevision` 两个指纹——页面据此决定要不要重渲染、要不要来取产物正文。
  // `?files=1` 才回产物正文（可能上 MB），避免每轮轮询搬大包。
  app.get("/api/projects/:id/live", async (req) => {
    const { id } = req.params as { id: string };
    const { files } = req.query as { files?: string };
    return kernel.viewLive(id, { files: files === "1" || files === "true" });
  });

  app.get("/api/projects/:id/snapshots/:node", async (req) => {
    const { id, node } = req.params as { id: string; node: string };
    return kernel.viewSnapshots(id, node);
  });

  app.get("/api/projects/:id/config", async (req) => {
    const { id } = req.params as { id: string };
    return kernel.viewConfig(id);
  });

  app.put("/api/projects/:id/config", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      return kernel.writeConfig(id, body);
    } catch (e) {
      return httpError(reply, e);
    }
  });

  app.get("/api/projects/:id/workbench-payload", async (req) => {
    const { id } = req.params as { id: string };
    return kernel.viewWorkbenchPayload(id);
  });

  app.post("/api/projects/:id/gate", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { nodeId: string; verdict: "pass" | "pass-with-conditions" | "send-back" | "reject"; comment?: string; rootCauseStage?: string; round?: number; token?: string };
    try {
      return await kernel.flow_gate(id, body);
    } catch (e) {
      return httpError(reply, e);
    }
  });

  app.post("/api/projects/:id/rerun", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { nodeId: string; dryRun?: boolean };
    try {
      return await kernel.flow_rerun(id, { nodeId: body.nodeId, dryRun: body.dryRun ?? true });
    } catch (e) {
      return httpError(reply, e);
    }
  });

  // 动词直通（POST /api/verbs/<verb>）：**按 verbs.ts 的动词表分派**（R8-OPS 步骤 3）。
  // 此前这里只有 4 个 case（run/next/resume/submit）并让 gate/rerun「走专用端点」——
  // 那是动词表的第 4 份副本，`flow_init`/`effect`/`mine`/`skill_patch`/`optimize`/`overlay`
  // 在 HTTP 面上完全不可达。现在表即面：表里有几个动词，这里就能收几个。
  // 专用端点（/gate、/rerun、/config）保留为便利面，与表分派**同源同语义**。
  app.post("/api/verbs/:verb", async (req, reply) => {
    const { verb } = req.params as { verb: string };
    const def = VERB_BY_NAME[verb];
    if (!def) {
      reply.code(404);
      return { error: "UNKNOWN_VERB", detail: `可用动词：${VERB_NAMES.join(", ")}` };
    }
    try {
      return await def.run(kernel, (req.body ?? {}) as Record<string, unknown>);
    } catch (e) {
      return httpError(reply, e);
    }
  });

  // R8-OPS：legacy 页面端点（serve.py 语义）并入内核面 —— 同一份页面在本进程内即可跑。
  registerCompat(app, kernel);

  // ── pi-agent 对话流（2026-09-22）：会话管理 + 工具环 + SSE 逐事件流 ─────────
  // 工具内联 = miniflow 动词白名单 ∷ 项目文件系统 ∷ flow-lint ∷ MCP（.external/agent-mcp.json）。
  // 模型凭据只走 .external/agent-model.json / env（永不入 payload/journal——kakaxing 纪律）。
  app.get("/api/agent/model", async () => {
    const { cfg, source, keyMasked } = loadModelConfig(kernel);
    return { configured: !!cfg, source, baseUrl: cfg?.baseUrl, model: cfg?.model, keyMasked };
  });
  app.post("/api/agent/model", async (req, reply) => {
    const b = (req.body ?? {}) as { baseUrl?: string; model?: string; apiKey?: string; maxTokens?: number; temperature?: number };
    if (!b.baseUrl || !b.model) { reply.code(400); return { error: "baseUrl 与 model 必填" }; }
    saveModelConfig(kernel, { baseUrl: b.baseUrl, model: b.model, apiKey: b.apiKey, maxTokens: b.maxTokens, temperature: b.temperature });
    const { cfg, source, keyMasked } = loadModelConfig(kernel);
    return { ok: true, source, baseUrl: cfg?.baseUrl, model: cfg?.model, keyMasked };
  });
  app.get("/api/projects/:id/agent/sessions", async (req) => {
    const { id } = req.params as { id: string };
    return listSessions(kernel, id);
  });
  app.post("/api/projects/:id/agent/sessions", async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = (req.body ?? {}) as { title?: string };
    if (!kernel.fs.exists(kernel.projectDir(id))) { reply.code(404); return { error: "NO_PROJECT" }; }
    return createSession(kernel, id, b.title);
  });
  app.get("/api/projects/:id/agent/sessions/:sid", async (req, reply) => {
    const { id, sid } = req.params as { id: string; sid: string };
    try { return getSession(kernel, id, sid); }
    catch (e) { reply.code(404); return { error: e instanceof Error ? e.message : String(e) }; }
  });
  app.post("/api/projects/:id/agent/sessions/:sid/rename", async (req, reply) => {
    const { id, sid } = req.params as { id: string; sid: string };
    const b = (req.body ?? {}) as { title?: string };
    try { return renameSession(kernel, id, sid, b.title || ""); }
    catch (e) { reply.code(404); return { error: e instanceof Error ? e.message : String(e) }; }
  });
  app.delete("/api/projects/:id/agent/sessions/:sid", async (req) => {
    const { id, sid } = req.params as { id: string; sid: string };
    deleteSession(kernel, id, sid);
    return { ok: true };
  });
  // 回合：SSE 逐事件（delta / tool_call / tool_result / round / done / error）
  app.post("/api/projects/:id/agent/sessions/:sid/turn", async (req, reply) => {
    const { id, sid } = req.params as { id: string; sid: string };
    const b = (req.body ?? {}) as { text?: string };
    const q = (req.query ?? {}) as { heartbeatMs?: string };
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    const sink = { write: (t: string) => reply.raw.write(t) };
    const closeSignal = closeSignalOf(reply.raw);
    try {
      // 管道单点在 sse.ts：线格式、心跳、[DONE] 与 v1 项目流共用同一段代码
      await emitSseEvents(sink, runTurn(kernel, id, sid, b.text || "", mcpFor(kernel)), {
        open: { type: "open", sid },
        heartbeatMs: heartbeatMsOf(q.heartbeatMs),
        closeSignal,
      });
    } catch (e) {
      // 头已发出，信封救不回来——只补一帧 error（runTurn 内部错误自己 yield error 事件，这里兜的是管道故障）
      sink.write(sseFrame({ type: "error", message: e instanceof Error ? e.message : String(e) }));
      sink.write(SSE_FRAME_DONE);
    }
    reply.raw.end();
    return reply;
  });


  // 静态面（最末优先级）：同端口托管页面。白名单见 static.ts —— 关键差别是它**不会**
  // 把 .zhuque-key / .git / src/kakaxing-Json 一起发出去（旧 serve.py 会）。
  // 注册两次是因为 find-my-way 里 `/*` 与 `/` 是两条不同路由，`/`（入口页）不能漏。
  const statics = async (req: FastifyRequest, reply: FastifyReply) => {
    const url = (req.raw.url ?? "/").split("?")[0] ?? "/";
    const abs = resolveStaticPath(kernel.root, url, kernel.fs, kernel.path);
    if (!abs) {
      reply.code(404);
      return { error: "NOT_FOUND" };
    }
    reply.header("cache-control", "no-store, must-revalidate");
    reply.type(contentTypeOf(abs, kernel.path));
    // readBuffer 给的是 Uint8Array；Fastify 的二进制出口按 Buffer 走，就地包一层
    return Buffer.from(kernel.fs.readBuffer(abs));
  };
  app.get("/", statics);
  app.get("/*", statics);

  return app;
}

export async function startHttp(kernel: Kernel, port = 8421): Promise<void> {
  const app = buildHttpApp(kernel);
  await app.listen({ port, host: "127.0.0.1" });
  console.log(
    [
      `miniflow 内核 + 前端已同进程启动：http://127.0.0.1:${port}`,
      `  页面  /                       （静态面，白名单托管）`,
      `  索引  /index.html`,
      `  v1    /api/v1                  （统一包装 ApiResponse/ApiError，路由表见 core/src/api-v1.ts）`,
      `  事件  /api/v1/projects/<id>/stream（SSE：台账投影 + 心跳）`,
      `  文档  /api/v1/openapi.json     （由 V1_ROUTES + VERBS 生成，对账：node scripts/gen-openapi.mjs --check）`,
      `  接口  /api/openapi.json        （legacy 冻结契约 v1.2，响应头已标 deprecation）`,
      `  诊断  /api/diagnostics        （仓库级旁路失败；项目级 /api/projects/<id>/diagnostics）`,
      `  rootOf()=${rootOf()}`,
    ].join("\n"),
  );
}

function httpError(reply: { code: (n: number) => { send: (v: unknown) => void } }, e: unknown): void {
  if (e instanceof KernelError) {
    reply.code(e.http).send({ error: e.code, message: e.message });
  } else {
    reply.code(500).send({ error: "INTERNAL", message: e instanceof Error ? e.message : String(e) });
  }
}

// 直接运行：node/tsx src/http.ts [--port 8421]
// R7-3 红线：dist/http.js 同样可直跑——旧守卫只认 http.ts，编译产物静默退出
// （此前 serve 走 tsx src/http.ts 才没踩到；mcp.ts 的守卫本就是 .ts|.js 双认，此处对齐）。
if (process.argv[1] && /http\.(ts|js)$/.test(process.argv[1].replace(/\\/g, "/"))) {
  const portIdx = process.argv.indexOf("--port");
  startHttp(new Kernel(), portIdx >= 0 ? Number(process.argv[portIdx + 1]) : 8421).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
