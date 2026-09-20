/**
 * R8-OPS · server 合一（内核 API + legacy 页面端点 + 静态页同进程）—— 回归测试
 *
 * 两条被测命题：
 *   ① **静态面不再裸奔**：旧 `tools/serve.py` 继承 SimpleHTTPRequestHandler，任何 `/xxx` 都照发
 *      ⇒ `/.zhuque-key`、`/.git/config`、`/src/kakaxing-Json/*`（29M 含真实姓名/电话/UCloud 密钥）
 *      全部可下载。开源部署下这是 P0，必须在门禁里钉死。
 *   ② **legacy 页面端点可用**：页面的 fetch 打的是 serve.py 的路径，合一之后必须仍能打，
 *      否则「单进程」只是把页面搬到另一个 404 上。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
