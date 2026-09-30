/**
 * R8-OPS · server 合一（内核 API + legacy 页面端点 + 静态页同进程）—— 回归测试
 *
 * 两条被测命题：
 *   ① **静态面不再裸奔**：旧 `tools/serve.py` 继承 SimpleHTTPRequestHandler，任何 `/xxx` 都照发
 *      ⇒ `/.zhuque-key`、`/.git/config`、`/src/kakaxing-Json/*`（29M 含真实姓名/电话/UCloud 密钥）
 *      全部可下载。开源部署下这是 P0，必须在门禁里钉死。
 *   ② **legacy 页面端点可用**：页面的 fetch 打的是 serve.py 的路径，合一之后必须仍能打，
 *      否则「单进程」只是把页面搬到另一个 404 上。
 *   ③ **R4 · v1 标准化**（工单 20261001）：`/api/v1` 统一包装（ApiResponse/ApiError）、
 *      动词入参前置校验（400 VALIDATION）、OpenAPI 由路由表＋动词表生成；
 *      同时 legacy `/api/*` 载荷**逐字节不变**、只挂弃用响应头——版本化不许以断页面为代价。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { contractsDirOf } from "../src/schema.js";
import { V1_ROUTES, buildOpenApiV1 } from "../src/api-v1.js";
import { VERBS } from "../src/verbs.js";
import { Kernel } from "../src/kernel.js";
import { buildHttpApp } from "../src/http.js";
import { isDeniedRelativePath, resolveStaticPath } from "../src/static.js";

function seedRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miniflow-srv-"));
  fs.writeFileSync(path.join(root, "index.html"), "<h1>INDEX_OK</h1>", "utf-8");
  fs.mkdirSync(path.join(root, "skills"), { recursive: true });
  fs.writeFileSync(path.join(root, "skills", "a.md"), "# 技能文档", "utf-8");
  fs.mkdirSync(path.join(root, "src", "kakaxing-Json"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "kakaxing-Json", "leak.json"), '{"phone":"13800000000"}', "utf-8");
  fs.writeFileSync(path.join(root, ".zhuque-key"), "SECRET-KEY", "utf-8");
  fs.mkdirSync(path.join(root, "projects", "p1"), { recursive: true });
  return root;
}

async function appOf(root: string) {
  const k = new Kernel({ root, repoRoot: root, flowsDir: path.join(root, "flows") });
  const app = buildHttpApp(k);
  await app.ready();
  return { app, k };
}

describe("R8 · 静态面白名单（开源部署 P0）", () => {
  it("resolveStaticPath：允许页面所需，拒绝敏感与穿越", () => {
    const root = seedRoot();
    expect(resolveStaticPath(root, "/")).toContain("index.html");
    expect(resolveStaticPath(root, "/skills/a.md")).toContain("a.md");

    expect(resolveStaticPath(root, "/.zhuque-key")).toBeNull();
    expect(resolveStaticPath(root, "/src/kakaxing-Json/leak.json")).toBeNull();
    expect(resolveStaticPath(root, "/../package.json")).toBeNull();
    expect(resolveStaticPath(root, "/projects/p1/.hidden.md")).toBeNull();
    expect(resolveStaticPath(root, "/node_modules/x/index.js")).toBeNull();
    // 后缀不在白名单（可执行/私有数据）一律不发
    expect(resolveStaticPath(root, "/.git/config")).toBeNull();
  });

  it("isDeniedRelativePath：读路径与写路径共用同一份判定", () => {
    expect(isDeniedRelativePath("src/kakaxing-Json/leak.json")).toBe(true);
    expect(isDeniedRelativePath(".zhuque-key")).toBe(true);
    expect(isDeniedRelativePath("a/../b.md")).toBe(true);
    expect(isDeniedRelativePath("projects/p1/内部/稿本/a.md")).toBe(false);
  });
});

describe("R8 · 单进程 HTTP 面：静态 + legacy 端点", () => {
  it("入口页与技能文档可发；敏感文件一律 404（不泄露存在性）", async () => {
    const root = seedRoot();
    const { app } = await appOf(root);

    const home = await app.inject({ method: "GET", url: "/" });
    expect(home.statusCode).toBe(200);
    expect(home.body).toContain("INDEX_OK");

    const skill = await app.inject({ method: "GET", url: "/skills/a.md" });
    expect(skill.statusCode).toBe(200);
    expect(skill.body).toContain("技能文档");

    for (const url of ["/.zhuque-key", "/src/kakaxing-Json/leak.json", "/..%2Fpackage.json", "/node_modules/a/b.md"]) {
      const r = await app.inject({ method: "GET", url });
      expect({ url, code: r.statusCode }).toEqual({ url, code: 404 });
    }
    await app.close();
  });

  it("写入端点：合法 .md 落盘，敏感路径被拒（与静态面同判定）", async () => {
    const root = seedRoot();
    const { app } = await appOf(root);

    const ok = await app.inject({
      method: "POST",
      url: "/_kit/save",
      payload: { name: "projects/p1/内部/稿本/a.md", content: "# 批注" },
    });
    expect(ok.statusCode).toBe(200);
    expect(fs.readFileSync(path.join(root, "projects/p1/内部/稿本/a.md"), "utf-8")).toBe("# 批注");

    // /api/save 与 /_kit/save 同语义
    const ok2 = await app.inject({ method: "POST", url: "/api/save", payload: { path: "projects/p1/意见.md", content: "x" } });
    expect(ok2.statusCode).toBe(200);

    for (const bad of ["src/kakaxing-Json/evil.json", ".zhuque-key", "projects/p1/a.exe"]) {
      const r = await app.inject({ method: "POST", url: "/_kit/save", payload: { name: bad, content: "{}" } });
      expect({ bad, code: r.statusCode }).toEqual({ bad, code: 400 });
    }
    await app.close();
  });

  it("归档端点把项目移进 _archived，而不是真删", async () => {
    const root = seedRoot();
    fs.writeFileSync(path.join(root, "projects", "p1", "x.json"), "{}", "utf-8");
    const { app } = await appOf(root);

    const r = await app.inject({ method: "POST", url: "/api/archive-project", payload: { project: "p1" } });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).to).toContain("projects/_archived/p1-");
    expect(fs.existsSync(path.join(root, "projects", "p1"))).toBe(false);
    expect(fs.readdirSync(path.join(root, "projects", "_archived")).length).toBe(1);

    const bad = await app.inject({ method: "POST", url: "/api/archive-project", payload: { project: "_archived" } });
    expect(bad.statusCode).toBe(400);
    await app.close();
  });

  it("隧道端点显式声明未启用（不假装有隧道）", async () => {
    const root = seedRoot();
    const { app } = await appOf(root);
    const r = await app.inject({ method: "GET", url: "/_kit/tunnel.json" });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body)).toMatchObject({ active: false, url: "" });
    await app.close();
  });

  it("诊断端点分两档：/api/diagnostics（仓库级）与 /api/projects/:id/diagnostics（项目级）", async () => {
    const root = seedRoot();
    const { app } = await appOf(root);

    const repo = await app.inject({ method: "GET", url: "/api/diagnostics" });
    expect(repo.statusCode).toBe(200);
    expect(JSON.parse(repo.body).scope).toBe("repo");

    const proj = await app.inject({ method: "GET", url: "/api/projects/p1/diagnostics" });
    expect(proj.statusCode).toBe(200);
    expect(JSON.parse(proj.body)).toMatchObject({ scope: "project", projectId: "p1" });
    await app.close();
  });
});

// ── R4（工单 20261001）· v1 标准化 ──────────────────────────────────────
//
// 判据来自两张表本身，不抄第二份名单：`V1_ROUTES` 里每一条都必须真能路由，
// `VERBS` 里每一个动词都必须在 OpenAPI 文档里有自己的条目。加了路由忘了注册、
// 或文档漏了动词 ⇒ 这里直接红（「表 = 面 = 文档」同源纪律）。

describe("R4 · /api/v1 统一包装（ApiResponse）", () => {
  it("读端点：ok/data/meta 三段齐，meta.route 就是路由表里那一行", async () => {
    const root = seedRoot();
    const { app } = await appOf(root);

    const r = await app.inject({ method: "GET", url: "/api/v1/projects" });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body) as { ok: boolean; data: unknown[]; meta: { apiVersion: string; route: string; at: string } };
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.meta).toMatchObject({ apiVersion: "v1", route: "/api/v1/projects" });
    expect(Date.parse(body.meta.at)).not.toBeNaN();
    await app.close();
  });

  it("路由表里每一条都真被注册：响应一律带 v1 信封（路由器级 404 无处遁形）", async () => {
    const root = seedRoot();
    const { app } = await appOf(root);
    for (const route of V1_ROUTES) {
      // 动词直通用真实动词探（flow_list 无副作用）；其余按表内 path 直打（:id 落到夹具里的 p1）。
      // SSE 路由改用不存在的项目：流永不结束，inject 会挂在那儿；而「校验先于响应头」
      // 正是这条路由能被信封断言到的那一面（真流的帧格式在 test/sse-stream.test.ts 里打）。
      const pid = route.sse ? "p-none" : "p1";
      const url = route.path.replace(":verb", "flow_list").replace(":id", pid).replace(":node", "m1.topic-report");
      const r = await app.inject({
        method: route.method,
        url,
        payload: route.method === "GET" || route.method === "DELETE" ? undefined : {},
      });
      const body = JSON.parse(r.body) as { ok?: boolean; meta?: { apiVersion?: string; route?: string } };
      // 未注册时 Fastify 回的是 `{"message":"Route ... not found"}`——没有 ok/meta，正是这条断言要抓的
      expect(body.ok, `${route.method} ${route.path} 未走 v1 信封`).toBeTypeOf("boolean");
      expect(body.meta?.apiVersion).toBe("v1");
      expect(body.meta?.route).toBe(route.path);
    }
    await app.close();
  });

  it("错误也是同一个形状：code/message/meta，detail 给找回路径", async () => {
    const root = seedRoot();
    const { app } = await appOf(root);

    const r = await app.inject({ method: "GET", url: "/api/v1/projects/p1/state" });
    expect(r.statusCode).toBe(404);
    expect(JSON.parse(r.body)).toMatchObject({
      ok: false,
      error: { code: "NO_RUN" },
      meta: { apiVersion: "v1", route: "/api/v1/projects/:id/state" },
    });

    const missing = await app.inject({ method: "GET", url: "/api/v1/projects/p1/artifacts/content" });
    expect(missing.statusCode).toBe(400);
    expect(JSON.parse(missing.body).error).toMatchObject({ code: "MISSING_PATH", detail: expect.any(String) });
    await app.close();
  });

  it("动词直通：非法入参 400 VALIDATION（逐条点名），未知动词 404 带可用清单", async () => {
    const root = seedRoot();
    const { app } = await appOf(root);

    const bad = await app.inject({ method: "POST", url: "/api/v1/verbs/flow_run", payload: { project: "p1" } });
    expect(bad.statusCode).toBe(400);
    const e = JSON.parse(bad.body) as { ok: boolean; error: { code: string; message: string; detail: string }; meta: { verb: string } };
    expect(e.ok).toBe(false);
    expect(e.error.code).toBe("VALIDATION");
    expect(e.error.detail).toContain("flow"); // 缺的就是 flow 这个必填键
    expect(e.meta.verb).toBe("flow_run");

    const unknown = await app.inject({ method: "POST", url: "/api/v1/verbs/flow_nope", payload: {} });
    expect(unknown.statusCode).toBe(404);
    expect(JSON.parse(unknown.body).error).toMatchObject({ code: "UNKNOWN_VERB" });
    expect(JSON.parse(unknown.body).error.detail).toContain("flow_list");

    const ok = await app.inject({ method: "POST", url: "/api/v1/verbs/flow_list", payload: {} });
    expect(ok.statusCode).toBe(200);
    expect(JSON.parse(ok.body)).toMatchObject({ ok: true, meta: { verb: "flow_list", route: "/api/v1/verbs/:verb" } });
    await app.close();
  });

  it("表 → 文档 → 运行时三处同一份：openapi.json 含全部动词且与 contracts 一致", async () => {
    const root = seedRoot();
    const { app } = await appOf(root);

    const r = await app.inject({ method: "GET", url: "/api/v1/openapi.json" });
    expect(r.statusCode).toBe(200);
    const served = JSON.parse(r.body) as { openapi: string; paths: Record<string, unknown> };
    expect(served.openapi).toBe("3.1.0");
    for (const v of VERBS) {
      expect(served.paths, `openapi 缺动词 ${v.name}`).toHaveProperty(`/api/v1/verbs/${v.name}`);
    }
    // 文档自身不套信封（它是文件，不是数据）
    expect(r.body.startsWith("{\"openapi\"")).toBe(true);

    const committed = JSON.parse(fs.readFileSync(path.join(contractsDirOf(), "http-openapi-v1.json"), "utf-8"));
    expect(committed).toEqual(buildOpenApiV1());
    expect(served).toEqual(committed);
    await app.close();
  });
});

describe("R4 · legacy /api/* 零回归（只标弃用，不改载荷）", () => {
  it("legacy 载荷不带信封、响应头标 deprecation + successor-version", async () => {
    const root = seedRoot();
    const { app } = await appOf(root);

    const r = await app.inject({ method: "GET", url: "/api/projects" });
    expect(r.statusCode).toBe(200);
    // 页面按字段直读，v1 的信封绝不能套到 legacy 头上
    expect(Array.isArray(JSON.parse(r.body))).toBe(true);
    expect(r.headers.deprecation).toBe("true");
    expect(r.headers["successor-version"]).toBe("/api/v1");

    const diag = await app.inject({ method: "GET", url: "/api/diagnostics" });
    expect(diag.headers.deprecation).toBe("true");

    // v1 面自身不标弃用；静态面也不该被牵连
    const v1 = await app.inject({ method: "GET", url: "/api/v1/projects" });
    expect(v1.headers.deprecation).toBeUndefined();
    const home = await app.inject({ method: "GET", url: "/" });
    expect(home.statusCode).toBe(200);
    expect(home.headers.deprecation).toBeUndefined();
    await app.close();
  });

  it("旧动词直通仍不收 301（POST 重定向会被降级成 GET，写操作不许靠重定向搬家）", async () => {
    const root = seedRoot();
    const { app } = await appOf(root);
    const r = await app.inject({ method: "POST", url: "/api/verbs/flow_list", payload: {} });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body)).toEqual([]);
    await app.close();
  });
});
