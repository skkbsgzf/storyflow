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

  // 动词直通（POST /api/verbs/<verb>，供 Web 前端不经 CLI 推进 run；M2 起按需细化为细粒度端点）
  app.post("/api/verbs/:verb", async (req, reply) => {
    const { verb } = req.params as { verb: string };
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      switch (verb) {
        case "flow_run":
          return await kernel.flow_run(String(body.flow), String(body.project), (body.inputs as Record<string, unknown>) ?? {});
        case "flow_next":
          return await kernel.flow_next(String(body.project));
        case "flow_resume":
          return await kernel.flow_resume(String(body.project));
        case "flow_submit":
          return await kernel.flow_submit(String(body.project), String(body.node), (body.output as object) ?? {});
        default:
          reply.code(404);
          return { error: "UNKNOWN_VERB", detail: "gate/rerun 走专用端点；flow_import 属 M4" };
      }
    } catch (e) {
      return httpError(reply, e);
    }
  });

  // R8-OPS：legacy 页面端点（serve.py 语义）并入内核面 —— 同一份页面在本进程内即可跑。
  registerCompat(app, kernel);

  // 静态面（最末优先级）：同端口托管页面。白名单见 static.ts —— 关键差别是它**不会**
  // 把 .zhuque-key / .git / src/kakaxing-Json 一起发出去（旧 serve.py 会）。
  // 注册两次是因为 find-my-way 里 `/*` 与 `/` 是两条不同路由，`/`（入口页）不能漏。
  const statics = async (req: FastifyRequest, reply: FastifyReply) => {
    const url = (req.raw.url ?? "/").split("?")[0];
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
    reply.code(500).send({ error: "INTERNAL", message: (e as Error).message });
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
