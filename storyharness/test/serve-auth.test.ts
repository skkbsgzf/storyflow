// 工单 WO-B1 · 鉴权闸集成测：真起协议面（tmp 工作区 + 随机端口），按验收线逐条打：
//   无 token → 401 / 页面导航 302 到 /login / 口令换 cookie 后放行 / 连错 5 次锁 30s /
//   project 与 file 越界 → 400·403 / 无口令时本机形态零改变 / 非本机绑定无口令 = 拒起 / CORS 收紧。
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { AddressInfo } from "node:net";
import { KernelClient } from "../src/kernel.js";
import type { HarnessConfig } from "../src/config.js";
import { startServe } from "../src/serve.js";
import { makeToken } from "../src/auth.js";

const PASSWORD = "b1-unit-password";
const secretOf = (pw: string) => crypto.createHash("sha256").update(`storyharness:${pw}`).digest("hex");

function tmpWorkspace(): { root: string; cfg: HarnessConfig } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sh-b1-"));
  fs.mkdirSync(path.join(root, "projects", "p-b1"), { recursive: true });
  fs.writeFileSync(path.join(root, "projects", "p-b1", "notes.md"), "# 项目内文件\n", "utf-8");
  const corpus = {
    projectsDir: "projects",
    receiptsDir: path.join("内部", "收据"),
    quarantineDir: path.join("内部", "backup"),
    sessionsDir: path.join("内部", "sessions"),
    telemetryDir: path.join("内部", "telemetry"),
    lintTool: path.join("tools", "flow-lint.py"),
    lintCommand: "python",
  };
  const cfg = {
    harnessVersion: "test", workspaceRoot: root, corpusName: "tmp", corpus,
    serve: {
      hostname: "127.0.0.1", password: PASSWORD, passwordSource: "env",
      tokenTtlHours: 72, allowedOrigins: [], credentialsFile: path.join(root, ".external", "credentials.json"),
    },
    kernelBase: "http://127.0.0.1:9", project: "p-b1", provider: "zai", model: "test", maxParallel: 1, thinking: "low",
  } as unknown as HarnessConfig;
  return { root, cfg };
}

async function withServer(cfg: HarnessConfig, fn: (base: string) => Promise<void>) {
  const server = startServe(new KernelClient(cfg.kernelBase, cfg.workspaceRoot, cfg.corpus), cfg, 0);
  await new Promise<void>((r) => server.once("listening", r));
  try { await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`); }
  finally { server.close(); }
}

const login = (base: string, password: string) =>
  fetch(`${base}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }), redirect: "manual" });

test("口令闸：未登录 API 401 / 页面 302 / 登录后 cookie 与 Bearer 双通道 / logout 清 cookie", async () => {
  const { cfg } = tmpWorkspace();
  await withServer(cfg, async (base) => {
    const hub = await fetch(`${base}/api/hub`);
    assert.equal(hub.status, 401, "无 token 打 API 必须 401");
    assert.equal((await hub.json()).error, "UNAUTHORIZED");

    const nav = await fetch(`${base}/`, { headers: { accept: "text/html" }, redirect: "manual" });
    assert.equal(nav.status, 302, "未登录的页面导航跳登录页");
    assert.match(nav.headers.get("location") ?? "", /^\/login\?next=/);

    const page = await fetch(`${base}/login?next=%2F`, { redirect: "manual" });
    assert.equal(page.status, 200);
    assert.match(await page.text(), /\/api\/login/);

    const bad = await login(base, "wrong-one");
    assert.equal(bad.status, 401);
    assert.equal((await bad.json()).error, "BAD_PASSWORD");

    const ok = await login(base, PASSWORD);
    assert.equal(ok.status, 200, "正确口令应放行");
    const cookie = (ok.headers.get("set-cookie") ?? "").split(";")[0];
    assert.match(cookie, /^sh_token=/);
    assert.equal((await fetch(`${base}/api/hub`, { headers: { cookie } })).status, 200, "带 cookie 应 200");
    assert.equal((await fetch(`${base}/api/hub`, { headers: { authorization: `Bearer ${cookie.split("=")[1]}` } })).status, 200, "Bearer 通道同样放行（curl/脚本用）");

    const out = await fetch(`${base}/api/logout`, { method: "POST", headers: { cookie } });
    assert.equal(out.status, 200);
    assert.match(out.headers.get("set-cookie") ?? "", /Max-Age=0/);
  });
});

test("路径边界：project 带 ../ → 400；退役面板面 → 410", async () => {
  const { cfg } = tmpWorkspace();
  await withServer(cfg, async (base) => {
    const cookie = `sh_token=${makeToken(secretOf(PASSWORD), 60_000)}`;
    const h = { cookie };
    assert.equal((await fetch(`${base}/api/projects/${encodeURIComponent("../../etc")}/agent/sessions`, { headers: h })).status, 400, "%2F 编码的 ../ 必须在入口拒");
    // 2026-10-02 前端切割：worldbook/telemetry/changes/canvas 退役 = 410 显式回；
    // files/raw/preview 已按工单-20261002 批A 以官方能力面回归（覆盖见 panel-files.test.ts）
    const gone = await fetch(`${base}/api/panel/worldbook?project=p-b1`, { headers: h });
    assert.equal(gone.status, 410, "退役面必须 410 显式回，不静默 404");
    assert.equal((await gone.json()).error, "GONE");
  });
});

test("连错 5 次 → 锁 30s：第 5 次上锁，锁期内正确口令也拒（429）", async () => {
  const { cfg } = tmpWorkspace();
  await withServer(cfg, async (base) => {
    for (let i = 1; i <= 4; i++) {
      const r = await login(base, `nope-${i}`);
      assert.equal(r.status, 401, `第 ${i} 次错口令 = 401`);
      assert.equal((await r.json()).error, "BAD_PASSWORD");
    }
    const fifth = await login(base, "nope-5");
    assert.equal(fifth.status, 401);
    const j5 = await fifth.json();
    assert.equal(j5.error, "TOO_MANY_ATTEMPTS", "第 5 次触发锁");
    assert.equal(j5.retryAfterMs, 30_000);
    const locked = await login(base, PASSWORD);
    assert.equal(locked.status, 429, "锁期内正确口令也不给过");
    assert.equal(locked.headers.get("retry-after"), "30");
  });
});

test("本机缺省形态零改变：不设口令 → API 直通（仍只绑 loopback），登录端点不暴露", async () => {
  const { cfg } = tmpWorkspace();
  cfg.serve.password = undefined;
  cfg.serve.passwordSource = undefined;
  await withServer(cfg, async (base) => {
    assert.equal((await fetch(`${base}/api/hub`)).status, 200);
    const loginTry = await fetch(`${base}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(loginTry.status, 404, "未启用鉴权时登录端点不存在");
  });
});

test("fail-closed：非本机绑定却没口令 → 服务拒起", () => {
  const { cfg } = tmpWorkspace();
  cfg.serve.password = undefined;
  cfg.serve.hostname = "0.0.0.0";
  assert.throws(() => startServe(new KernelClient(cfg.kernelBase, cfg.workspaceRoot, cfg.corpus), cfg, 0), /fail-closed/);
});

test("CORS 收紧：公网站点不给 ACAO，loopback 源照常放行（8421 作业台不断线）", async () => {
  const { cfg } = tmpWorkspace();
  await withServer(cfg, async (base) => {
    const evil = await fetch(`${base}/api/hub`, { headers: { origin: "https://evil.example" } });
    assert.equal(evil.headers.get("access-control-allow-origin"), null, "公网站点不放行");
    const local = await fetch(`${base}/api/hub`, { headers: { origin: "http://127.0.0.1:8421" } });
    assert.equal(local.headers.get("access-control-allow-origin"), "http://127.0.0.1:8421");
    assert.equal(local.headers.get("vary"), "Origin");
    assert.equal((await fetch(`${base}/api/hub`, { method: "OPTIONS", headers: { origin: "https://evil.example" } })).status, 403, "非法源的预检直接拒");
  });
});

test("换口令即全面失效：旧 cookie 在新口令下打不进", async () => {
  const { cfg } = tmpWorkspace();
  const oldToken = makeToken(secretOf("previous-password"), 60_000);
  await withServer(cfg, async (base) => {
    const r = await fetch(`${base}/api/hub`, { headers: { cookie: `sh_token=${oldToken}` } });
    assert.equal(r.status, 401, "secret 由口令派生：改了口令，历史 token 一律作废");
  });
});
