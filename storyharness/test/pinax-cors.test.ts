// 8451 CORS 收窄的行为钉：空名单反射 *（开发态）、非空仅回显名单内来源、名单外不回显 allow-origin。
// 曾缺口：config.allowedOrigins 是死旋钮（server.ts 三处硬编码 *，从不读配置）。
import { test, after } from "node:test";
import assert from "node:assert/strict";
import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import type { AddressInfo } from "node:net";
import { startServer, corsOriginFor } from "../src/pinax/server.js";

test("corsOriginFor：空名单反射 *；命中回显；未命中与无 Origin 不回显", () => {
  assert.equal(corsOriginFor([], "http://localhost:3001"), "*");
  assert.equal(corsOriginFor([], undefined), "*");
  assert.equal(corsOriginFor(["http://localhost:3001"], "http://localhost:3001"), "http://localhost:3001");
  assert.equal(corsOriginFor(["http://localhost:3001"], "http://evil.example"), null);
  assert.equal(corsOriginFor(["http://localhost:3001"], undefined), null);
});

const corsTasksDir = `tasks-test-cors-${Date.now()}`;
let server: http.Server;
let port = 0;

function rawRequest(method: string, reqPath: string, headers: Record<string, string>): Promise<{ status: number; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: reqPath, method, headers }, (res) => {
      res.resume();
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("真实 server：名单内回显 + Vary；名单外不回显 allow-origin；预检通过时仍 204", async () => {
  server = startServer({ port: 0, tasksDir: corsTasksDir, provider: "mock", model: "mock-model", baseUrl: "http://127.0.0.1:1/v1", apiKey: "test-key", thinking: "off", allowedOrigins: ["http://localhost:3001"] });
  await new Promise((r) => server.once("listening", r));
  port = (server.address() as AddressInfo).port;

  const pre = await rawRequest("OPTIONS", "/v1/pinax/tasks", { origin: "http://localhost:3001" });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers["access-control-allow-origin"], "http://localhost:3001");
  assert.equal(pre.headers["vary"], "Origin");

  const denied = await rawRequest("OPTIONS", "/v1/pinax/tasks", { origin: "http://evil.example" });
  assert.equal(denied.headers["access-control-allow-origin"], undefined, "名单外来源不得回显 allow-origin");
  assert.equal(denied.status, 204);

  const jsonRes = await rawRequest("GET", "/healthz", { origin: "http://localhost:3001" });
  assert.equal(jsonRes.status, 200);
  assert.equal(jsonRes.headers["access-control-allow-origin"], "http://localhost:3001");

  const jsonDenied = await rawRequest("GET", "/healthz", { origin: "http://evil.example" });
  assert.equal(jsonDenied.headers["access-control-allow-origin"], undefined);
});

after(() => {
  server?.closeAllConnections?.();
  server?.close();
  fs.rmSync(path.resolve(corsTasksDir), { recursive: true, force: true });
});
