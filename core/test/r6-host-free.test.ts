/**
 * 工单 R6 · 宿主面清零的**运行时证据**
 *
 * R6 的出口判据写在卡面上是两条 grep（`node:fs` 只剩 `abstraction/adapters/`），但「换了 import 源」和
 * 「真换了管道」是两件事：把 `import fs from "node:fs"` 改成 `import { nodeFs } from "./abstraction/adapters/node.js"`
 * 一样能过 grep，可它照旧吃宿主盘。所以这里的判据与 R5 的 `fs-call-matrix.test.ts` 同一把尺——
 * **挂到内存盘上跑一遍，宿主盘一条都不许多**。四张面各自取证：
 *  ① 普查门：`src/**` 除 `abstraction/` 外不许出现 FS 族 `node:*`；剩下的非 FS 族例外钉成一张死表（双向）。
 *  ② agent 会话面 + `fs_*` 工具族 + 系统提示：整条跑在 MockFs 上，含越界拒绝与 MCP 内联的配置读。
 *  ③ `flow_lint`：经注入的 proc 跑，四个返回分支逐个验，cwd 必须是 `kernel.repoRoot`。
 *  ④ 静态面 `GET /`：走 `kernel.fs.readBuffer` + Buffer 出口（R6 把 `statSync`/`readFileSync` 换掉的那两处）。
 *
 * 例外表是**双向**断言：多一处 = 新长出一条宿主尾巴，少一处 = 表过期了（文档与盘面漂移）。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MockFsAdapter, MockPathAdapter, MockProcLauncher } from "../src/abstraction/adapters/mock.js";
import { nodePath } from "../src/abstraction/adapters/node.js";
import type { ProcResult } from "../src/abstraction/proc.js";
import { AgentMcp } from "../src/agent-mcp.js";
import { Kernel, KernelError } from "../src/kernel.js";
import {
  buildSystemPrompt,
  buildTools,
  createSession,
  deleteSession,
  getSession,
  listSessions,
  mcpFor,
  renameSession,
  type AgentTool,
} from "../src/agent.js";
import { buildHttpApp } from "../src/http.js";

const DATA_ROOT = "/mock-r6-data";
const STATIC_ROOT = "/mock-r6-static";

/**
 * 宿主盘探针：`/mock-r6-*` 在 Windows 上会 resolve 成当前盘根下的真目录（`path.resolve` 实测）。
 * 写路径漏传注入 = 那儿凭空长出一棵树，这条断言就是那棵树——和 R3/R5 冒烟同一把尺。
 */
function hostLeak(): string | undefined {
  for (const probeRoot of [DATA_ROOT, STATIC_ROOT]) {
    const probe = path.resolve(probeRoot);
    if (fs.existsSync(probe)) return probe;
  }
  return undefined;
}

function mockKernel(projectId: string): {
  kernel: Kernel;
  projectDir: string;
  mock: MockFsAdapter;
  mp: MockPathAdapter;
  proc: MockProcLauncher;
} {
  const mock = new MockFsAdapter(DATA_ROOT);
  const mp = new MockPathAdapter();
  const proc = new MockProcLauncher();
  mock.seed({
    [`${DATA_ROOT}/projects/${projectId}/state.json`]: JSON.stringify({
      runId: "r1",
      projectId,
      flowId: "novel-prose",
      status: "running",
      nodes: { n1: { status: "done" }, n2: { status: "awaiting" } },
    }),
    [`${DATA_ROOT}/projects/${projectId}/世界书/graph.json`]: JSON.stringify({ stats: { entries: 7, edges: 3 } }),
    [`${DATA_ROOT}/projects/${projectId}/大纲.md`]: "# 大纲\n第一幕：抵达\n",
  });
  const kernel = new Kernel({ root: DATA_ROOT, repoRoot: DATA_ROOT, fs: mock, path: mp, proc });
  return { kernel, projectDir: `${DATA_ROOT}/projects/${projectId}`, mock, mp, proc };
}

/** 取工具：按名查，查不到直接失败（避免「工具没注册」被写成「断言空过」）。 */
function pick(tools: AgentTool[], name: string): AgentTool {
  const t = tools.find((x) => x.name === name);
  expect(t, `工具表里没有 ${name}`).toBeTruthy();
  return t as AgentTool;
}

// ── ① 普查门 ────────────────────────────────────────────────────────────────
describe("R6 · 普查门：FS 族宿主 import 只在 abstraction/ 豁免区", () => {
  const SRC = fileURLToPath(new URL("../src/", import.meta.url));
  /** `from "node:x"` 与 `import("node:x")` 两种形态都算——动态 import 一样是宿主绑定。 */
  const SPEC = /(?:from|import)\s*\(?\s*["']node:([a-z_-]+)["']/g;
  const FS_FAMILY = ["fs", "path", "child_process"];

  function walk(dir: string): string[] {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .flatMap((e) => {
        const abs = path.join(dir, e.name);
        return e.isDirectory() ? walk(abs) : e.name.endsWith(".ts") ? [abs] : [];
      });
  }

  /** src 之下（abstraction/ 之外）的文件 → 该文件用到的 node: 模块名集合。 */
  function hostRefs(): Map<string, Set<string>> {
    const out = new Map<string, Set<string>>();
    for (const file of walk(SRC)) {
      const rel = path.relative(SRC, file).split(path.sep).join("/");
      if (rel.startsWith("abstraction/")) continue;
      const mods = new Set<string>();
      for (const m of fs.readFileSync(file, "utf-8").matchAll(SPEC)) mods.add(m[1] ?? "");
      if (mods.size) out.set(rel, mods);
    }
    return out;
  }

  it("除 abstraction/ 外没有 node:fs / node:path / node:child_process（含动态 import）", () => {
    const hits: string[] = [];
    for (const [rel, mods] of hostRefs()) {
      for (const mod of mods) if (FS_FAMILY.includes(mod)) hits.push(`${rel} → node:${mod}`);
    }
    expect(hits.sort(), `漏网：${hits.join("；")}`).toEqual([]);
  });

  /**
   * 非 FS 族的既得例外（R6 口径：卡面出口只管 `node:fs`，这四处是进程/编码/随机/打包宿主本职，
   * 归 R7 拆包按包边界处置）。写成双向断言是防两件事：悄悄长出新尾巴、以及文档销账后表还留着旧行。
   */
  it("剩余非 FS 族宿主绑定逐条等于例外死表", () => {
    const expected = [
      "cli.ts|node:net", // pickFreePort：端口探测只有 net 有，属进程面
      "cli.ts|node:process", // CLI 入口读 argv / exitCode
      "export-cli.ts|node:process",
      // R7-2 销账：ids.ts 的 crypto 归哈希面（nodeHash）、kernel.ts 死码 createRequire 已删。
      "quality-cli.ts|node:process",
    ].sort();
    const found: string[] = [];
    for (const [rel, mods] of hostRefs()) for (const mod of mods) found.push(`${rel}|node:${mod}`);
    expect([...new Set(found)].sort()).toEqual(expected);
  });

  it("IFsPath.fromFileUrl（R6 新增）在 Node 适配器上等于 fileURLToPath", () => {
    // schema.ts 定位包根就靠这一件：它把最后一处 node:url 从宿主件换进了抽象层豁免区
    expect(nodePath.fromFileUrl(import.meta.url)).toBe(fileURLToPath(import.meta.url));
    // 解码交给 node 本体（Windows 上无盘符的 file URL 本就不是合法路径），这里只验「前缀没了、%20 开了」
    const decoded = nodePath.fromFileUrl("file:///D%3A/tmp/a%20b/r6.ts");
    expect(decoded).toContain("a b");
    expect(decoded).not.toContain("file:");
  });
});

// ── ② agent 会话面 + fs_* 工具族 + 系统提示 ──────────────────────────────────
describe("R6 · agent 面整条吃注入（内存盘上跑，宿主盘零泄漏）", () => {
  it("会话 CRUD：建→列→读→改名→删，全落在内存盘", async () => {
    const { kernel, projectDir, mock } = mockKernel("p-r6-sess");
    const s = createSession(kernel, "p-r6-sess", "测试会话");
    expect(s.title).toBe("测试会话");
    expect(mock.exists(`${projectDir}/registry/agent-sessions/${s.id}.json`)).toBe(true);

    expect(listSessions(kernel, "p-r6-sess").map((x) => x.id)).toEqual([s.id]);

    const renamed = renameSession(kernel, "p-r6-sess", s.id, "改名后的会话");
    expect(getSession(kernel, "p-r6-sess", s.id).title).toBe("改名后的会话");
    expect(renamed.createdAt).toBe(s.createdAt); // 改名只动 title， createdAt 原样

    deleteSession(kernel, "p-r6-sess", s.id);
    expect(listSessions(kernel, "p-r6-sess")).toEqual([]);
    let err: unknown;
    try {
      getSession(kernel, "p-r6-sess", s.id);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(KernelError);
    expect((err as KernelError).code).toBe("NO_SESSION");
    // 删不存在会话走 remove({force:true})：不抛，与 node:fs rm force 同语义
    expect(() => deleteSession(kernel, "p-r6-sess", "s-从来没有")).not.toThrow();
    expect(hostLeak()).toBeUndefined();
  });

  it("fs_* 工具族读写与搜索吃注入盘，越界判定拒绝逃出项目的路径", async () => {
    const { kernel, mock, projectDir } = mockKernel("p-r6-fs");
    const tools = await buildTools(kernel, "p-r6-fs", new AgentMcp({ fs: mock, path: new MockPathAdapter() }));

    expect(await pick(tools, "fs_read").exec({ path: "大纲.md" })).toContain("第一幕：抵达");

    const tree = await pick(tools, "fs_tree").exec({});
    expect(tree).toContain("state.json");
    expect(tree).toContain("大纲.md");

    const writeOut = await pick(tools, "fs_write").exec({ path: "内部/笔记.md", content: "# 笔记\n先洗后剪\n" });
    expect(writeOut).toContain("已写入 内部/笔记.md");
    expect(mock.readText(`${projectDir}/内部/笔记.md`)).toBe("# 笔记\n先洗后剪\n");

    const grepOut = await pick(tools, "fs_grep").exec({ pattern: "抵达" });
    expect(grepOut).toContain("大纲.md:2: 第一幕：抵达");

    let escapeErr: unknown;
    try {
      await pick(tools, "fs_read").exec({ path: "../../outside.md" });
    } catch (e) {
      escapeErr = e;
    }
    expect(escapeErr).toBeInstanceOf(KernelError);
    expect((escapeErr as KernelError).code).toBe("INVALID_INPUT");
    expect(hostLeak()).toBeUndefined();
  });

  it("buildSystemPrompt 的盘面一行读自注入盘（state + 世界书统计）", async () => {
    const { kernel } = mockKernel("p-r6-prompt");
    const prompt = buildSystemPrompt(kernel, "p-r6-prompt");
    expect(prompt).toContain("项目 p-r6-prompt（novel-prose）");
    expect(prompt).toContain("flow=novel-prose 状态=running 节点 1/2 完成，待决：n2");
    expect(prompt).toContain("世界书 7 词条 / 3 关系边");

    // 未开跑的项目：不抛，诚实回显「无 state.json」——空盘面上的降级路径同样不许碰宿主
    const bare = new MockFsAdapter(DATA_ROOT);
    const k2 = new Kernel({ root: DATA_ROOT, repoRoot: DATA_ROOT, fs: bare, path: new MockPathAdapter() });
    expect(buildSystemPrompt(k2, "p-r6-none")).toContain("（无 state.json——项目未开跑）");
    expect(hostLeak()).toBeUndefined();
  });

  it("MCP 内联的配置读吃注入 io：内存盘没配 .external/agent-mcp.json ⇒ 零 mcp__ 工具", async () => {
    const { kernel, mock } = mockKernel("p-r6-mcp");
    // 缺省 AgentMcp 用的是 Node 适配器（会去读宿主仓库的 .external/），这里显式注入内存盘：
    // 假盘上没有配置文件 ⇒ 工具表里不该出现任何 mcp__ 项，也不该出现"配置读失败"的兜底工具。
    const tools = await buildTools(kernel, "p-r6-mcp", new AgentMcp({ fs: mock, path: new MockPathAdapter() }));
    expect(tools.filter((t) => t.name.startsWith("mcp__"))).toEqual([]);
    expect(tools.map((t) => t.name)).not.toContain("mcp_unavailable");
    // 动词白名单与 fs_* 照样在（注入没把工具表清空）
    expect(tools.map((t) => t.name)).toContain("mf_flow_next");
    expect(hostLeak()).toBeUndefined();
  });

  it("mcpFor 按注入的盘分桶：同一块盘共用连接桶，注入盘另起一桶不冒充宿主配置", async () => {
    const { kernel } = mockKernel("p-r6-bucket");
    const host = new Kernel(); // 缺省 Node 适配器 = 现网那块盘
    expect(mcpFor(host)).toBe(mcpFor(new Kernel())); // 同盘同桶：HTTP 面行为逐字节不变
    expect(mcpFor(kernel)).not.toBe(mcpFor(host)); // 异盘异桶：连接的配置读各归各的盘
    const tools = await buildTools(kernel, "p-r6-bucket", mcpFor(kernel));
    expect(tools.filter((t) => t.name.startsWith("mcp__"))).toEqual([]);
    expect(hostLeak()).toBeUndefined();
  });
});

// ── ③ flow_lint 经注入 proc ─────────────────────────────────────────────────
describe("R6 · flow_lint 走 kernel.proc，四个返回分支照旧可分辨", () => {
  async function lintOnce(result: Partial<ProcResult>, flow?: string) {
    const { kernel, mock, proc } = mockKernel("p-r6-lint");
    proc.on("python tools/flow-lint.py", () => ({ status: 0, stdout: "", stderr: "", ...result }));
    const tools = await buildTools(kernel, "p-r6-lint", new AgentMcp({ fs: mock, path: new MockPathAdapter() }));
    const out = await pick(tools, "flow_lint").exec(flow ? { flow } : {});
    return { out, proc, kernel };
  }

  it("有输出 ⇒ 原样透传（截断到工具上限），cwd = kernel.repoRoot", async () => {
    const payload = JSON.stringify({ flows: [{ id: "novel-prose", errors: 0 }] }, null, 1);
    const { out, proc, kernel } = await lintOnce({ stdout: payload });
    expect(out).toBe(payload);
    expect(proc.calls).toHaveLength(1);
    const call = proc.calls[0];
    expect(call?.cmd).toBe("python");
    expect(call?.args).toEqual(["tools/flow-lint.py", "--json"]);
    expect(call?.options?.cwd).toBe(kernel.repoRoot); // 不再是 projectDir 上跳两级
    expect(call?.options?.timeoutMs).toBe(90_000);
    expect(hostLeak()).toBeUndefined();
  });

  it("带 flow 参数 ⇒ 进 argv 第二段", async () => {
    const { proc } = await lintOnce({ stdout: "ok" }, "novel-prose");
    expect(proc.calls[0]?.args).toEqual(["tools/flow-lint.py", "novel-prose", "--json"]);
  });

  it("启动层错误 ⇒ 「执行失败」分支，stderr 一并端出", async () => {
    const { out } = await lintOnce({ error: "python 不存在", stderr: "command not found" });
    expect(out).toContain("flow-lint 执行失败: python 不存在");
    expect(out).toContain("command not found");
  });

  it("退出非零且无输出 ⇒ 保留退出码 + stderr，不缩成干巴巴的 exit=1", async () => {
    const { out } = await lintOnce({ status: 2, stdout: "", stderr: "flow-lint 报了 3 个 error" });
    expect(out).toContain("flow-lint 退出码 2（无输出）");
    expect(out).toContain("flow-lint 报了 3 个 error");
  });

  it("退出零且无输出 ⇒ 「exit=0」占位，不留空串", async () => {
    const { out } = await lintOnce({ status: 0, stdout: "" });
    expect(out).toBe("exit=0");
  });
});

// ── ④ 静态面 GET / ─────────────────────────────────────────────────────────
describe("R6 · 静态面读路径吃注入（stat + readBuffer，宿主盘零参与）", () => {
  async function mockApp() {
    const mock = new MockFsAdapter(STATIC_ROOT);
    mock.seed({
      [`${STATIC_ROOT}/index.html`]: "<h1>INDEX_R6</h1>",
      [`${STATIC_ROOT}/.git/config`]: "[secret]\n",
    });
    const kernel = new Kernel({ root: STATIC_ROOT, repoRoot: STATIC_ROOT, fs: mock, path: new MockPathAdapter() });
    const app = buildHttpApp(kernel);
    await app.ready();
    return { app, mock };
  }

  it("GET / 经 kernel.fs.readBuffer 出页面，Content-Type 由注入的 path 判定", async () => {
    const { app } = await mockApp();
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("INDEX_R6");
    await app.close();
    expect(hostLeak()).toBeUndefined();
  });

  it("白名单在注入盘上照样生效：敏感段与不存在的路径都是 404", async () => {
    const { app } = await mockApp();
    const denied = await app.inject({ method: "GET", url: "/.git/config" });
    expect(denied.statusCode).toBe(404);
    const missing = await app.inject({ method: "GET", url: "/没有这个页面.html" });
    expect(missing.statusCode).toBe(404);
    await app.close();
    expect(hostLeak()).toBeUndefined();
  });
});
