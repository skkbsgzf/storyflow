// miniflow HTTP 面：REST（冻结契约 contracts/http-openapi.json）+ CORS，供官方可视化底座消费
import fs from "node:fs";
import path from "node:path";
import fastify from "fastify";
import cors from "@fastify/cors";
import { CONTRACTS_DIR, ROOT } from "./schema.js";
import { Kernel, KernelError } from "./kernel.js";

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
    } catch {
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

  return app;
}

export async function startHttp(kernel: Kernel, port = 8421): Promise<void> {
  const app = buildHttpApp(kernel);
  await app.listen({ port, host: "127.0.0.1" });
  console.log(`miniflow kernel HTTP listening on http://127.0.0.1:${port}  (OpenAPI: /api/openapi.json, ROOT=${ROOT})`);
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
