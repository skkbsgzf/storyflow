// miniflow HTTP 面：REST（冻结契约 contracts/http-openapi.json）+ CORS，供官方可视化底座消费
import fs from "node:fs";
import path from "node:path";
import fastify from "fastify";
import type { FastifyReply, FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import { CONTRACTS_DIR, ROOT } from "./schema.js";
import { Kernel, KernelError } from "./kernel.js";
import { recordDiag } from "./diag.js";
import { registerCompat } from "./compat.js";
import { contentTypeOf, resolveStaticPath } from "./static.js";
import { VERB_BY_NAME, VERB_NAMES } from "./verbs.js";
import { agentMcp, deleteSession, createSession, getSession, listSessions, loadModelConfig, renameSession, runTurn, saveModelConfig } from "./agent.js";

export function buildHttpApp(kernel: Kernel) {
  const app = fastify({ logger: false });
  void app.register(cors, { origin: true });

  const openapiFile = path.join(CONTRACTS_DIR, "http-openapi.json");
  const openapi = fs.existsSync(openapiFile) ? JSON.parse(fs.readFileSync(openapiFile, "utf-8")) : { openapi: "3.1.0", paths: {} };

  app.get("/api/openapi.json", async () => openapi);

  app.get("/api/projects", async () => kernel.viewProjects());

  app.get("/api/projects/:id/state", async (req, reply) => {
    const { id } = req.params as { id: string };
    const dir = kernel.projectDir(id);
    const file = path.join(dir, "state.json");
    if (!fs.existsSync(file)) {
      const legacy = path.join(dir, "run-state.json");
      if (fs.existsSync(legacy)) {
        reply.code(200);
        return { ...(JSON.parse(fs.readFileSync(legacy, "utf-8")) as object), _legacy: true };
      }
      reply.code(404);
      return { error: "NO_RUN" };
    }
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  });

  app.get("/api/projects/:id/graph", async (req, reply) => {
    const { id } = req.params as { id: string };
    const stateFile = path.join(kernel.projectDir(id), "state.json");
    let flowId = "";
    if (fs.existsSync(stateFile)) {
      flowId = (JSON.parse(fs.readFileSync(stateFile, "utf-8")) as { flowId?: string }).flowId ?? "";
    }
    if (!flowId) {
      // 旧项目：取 flows 下第一个可读 flow（与 workbench-payload 同策略）
      for (const d of fs.existsSync(kernel.flowsDir) ? fs.readdirSync(kernel.flowsDir) : []) {
        if (fs.existsSync(path.join(kernel.flowsDir, d, "flow.json"))) { flowId = d; break; }
      }
    }
    if (!flowId) { reply.code(404); return { error: "NO_FLOW" }; }
    try {
      return kernel.loadFlow(flowId);
    } catch (e) {
      // 报 NO_FLOW 是"可见的失败"，但失败原因（flow 损坏？schema 违约？）此前被丢掉 ⇒ 留痕。
      recordDiag(kernel.projectDir(id), "io", `http:graph:loadFlow(${flowId})`, e);
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
    const { cfg, source, keyMasked } = loadModelConfig(kernel.repoRoot);
    return { configured: !!cfg, source, baseUrl: cfg?.baseUrl, model: cfg?.model, keyMasked };
  });
  app.post("/api/agent/model", async (req, reply) => {
    const b = (req.body ?? {}) as { baseUrl?: string; model?: string; apiKey?: string; maxTokens?: number; temperature?: number };
    if (!b.baseUrl || !b.model) { reply.code(400); return { error: "baseUrl 与 model 必填" }; }
    saveModelConfig(kernel.repoRoot, { baseUrl: b.baseUrl, model: b.model, apiKey: b.apiKey, maxTokens: b.maxTokens, temperature: b.temperature });
    const { cfg, source, keyMasked } = loadModelConfig(kernel.repoRoot);
    return { ok: true, source, baseUrl: cfg?.baseUrl, model: cfg?.model, keyMasked };
  });
  app.get("/api/projects/:id/agent/sessions", async (req) => {
    const { id } = req.params as { id: string };
    return listSessions(kernel.projectDir(id));
  });
  app.post("/api/projects/:id/agent/sessions", async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = (req.body ?? {}) as { title?: string };
    if (!fs.existsSync(kernel.projectDir(id))) { reply.code(404); return { error: "NO_PROJECT" }; }
    return createSession(kernel.projectDir(id), b.title);
  });
  app.get("/api/projects/:id/agent/sessions/:sid", async (req, reply) => {
    const { id, sid } = req.params as { id: string; sid: string };
    try { return getSession(kernel.projectDir(id), sid); }
    catch (e) { reply.code(404); return { error: e instanceof Error ? e.message : String(e) }; }
  });
  app.post("/api/projects/:id/agent/sessions/:sid/rename", async (req, reply) => {
    const { id, sid } = req.params as { id: string; sid: string };
    const b = (req.body ?? {}) as { title?: string };
    try { return renameSession(kernel.projectDir(id), sid, b.title || ""); }
    catch (e) { reply.code(404); return { error: e instanceof Error ? e.message : String(e) }; }
  });
  app.delete("/api/projects/:id/agent/sessions/:sid", async (req) => {
    const { id, sid } = req.params as { id: string; sid: string };
    deleteSession(kernel.projectDir(id), sid);
    return { ok: true };
  });
  // 回合：SSE 逐事件（delta / tool_call / tool_result / round / done / error）
  app.post("/api/projects/:id/agent/sessions/:sid/turn", async (req, reply) => {
    const { id, sid } = req.params as { id: string; sid: string };
    const b = (req.body ?? {}) as { text?: string };
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    reply.raw.write(`data: ${JSON.stringify({ type: "open", sid })}\n\n`);
    try {
      for await (const ev of runTurn(kernel, id, sid, b.text || "", agentMcp)) {
        reply.raw.write(`data: ${JSON.stringify(ev)}\n\n`);
      }
    } catch (e) {
      reply.raw.write(`data: ${JSON.stringify({ type: "error", message: e instanceof Error ? e.message : String(e) })}\n\n`);
    }
    reply.raw.write("data: [DONE]\n\n");
    reply.raw.end();
    return reply;
  });


  // 静态面（最末优先级）：同端口托管页面。白名单见 static.ts —— 关键差别是它**不会**
  // 把 .zhuque-key / .git / src/kakaxing-Json 一起发出去（旧 serve.py 会）。
  // 注册两次是因为 find-my-way 里 `/*` 与 `/` 是两条不同路由，`/`（入口页）不能漏。
  const statics = async (req: FastifyRequest, reply: FastifyReply) => {
    const url = (req.raw.url ?? "/").split("?")[0] ?? "/";
    const abs = resolveStaticPath(kernel.root, url);
    if (!abs) {
      reply.code(404);
      return { error: "NOT_FOUND" };
    }
    reply.header("cache-control", "no-store, must-revalidate");
    reply.type(contentTypeOf(abs));
    return fs.readFileSync(abs);
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
      `  接口  /api/openapi.json       （OpenAPI ${String((app as unknown as { openapi?: string }).openapi ?? "contracts/http-openapi.json")}）`,
      `  诊断  /api/diagnostics        （仓库级旁路失败；项目级 /api/projects/<id>/diagnostics）`,
      `  ROOT=${ROOT}`,
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
if (process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("http.ts")) {
  const portIdx = process.argv.indexOf("--port");
  startHttp(new Kernel(), portIdx >= 0 ? Number(process.argv[portIdx + 1]) : 8421).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
