/**
 * R7-1 · 平台默认适配器注册表（`core/src/abstraction/defaults.ts`）
 *
 * 拆包（工单 R7）要求 `@storyflow/core` 不 import 任何宿主实现，而 FS1 §四第 2 条的
 * 168 处尾参默认 `= nodeFs` 得有个缺省值——两头同时成立只有一招：默认值改成「一次查找」。
 * 数字口径（可复算，R7-2 销账后）：`src` 内四种标注形态字面匹配 169 处，
 * 减 `defaults.ts` 头注释 1 处 = 真默认参数 168 处；cfg-template 的 10 处已改吃注册表
 * （不再是宿主例外），168 处分布在 28 个文件，默认值全部取自 `abstraction/defaults.js`。
 * 本文件钉住这招的四件事：① core 侧确实没人再 import Node 适配器（普查双向死表）；
 * ② `defaults.ts` 自身零 `node:*`；③ 没注册就抛、注册了就转发（不静默回落）；
 * ④ 用了尾参默认的文件除宿主入口外一律从 `defaults.js` 取（不许绕过注册表直抓实现）。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MockFsAdapter, MockPathAdapter, MockProcLauncher, mockEnv, mockHash } from "../src/abstraction/adapters/mock.js";
import { currentAdapters, registerAdapters, nodeFs, nodePath, nodeProc } from "../src/abstraction/defaults.js";

const SRC_DIR = fileURLToPath(new URL("../src/", import.meta.url));

/** 读 src 下全部 .ts（含子目录），返回 {相对 src 路径, 文本}。本测试是普查门，用宿主盘直读是本职。 */
function srcFiles(): { rel: string; text: string }[] {
  const out: { rel: string; text: string }[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) walk(abs, rel);
      else if (e.name.endsWith(".ts")) out.push({ rel, text: fs.readFileSync(abs, "utf-8") });
    }
  };
  walk(SRC_DIR, "");
  return out;
}

describe("R7-1 · core 与 Node 适配器解绑", () => {
  /**
   * 豁免区（`abstraction/adapters/`）之外仍 import `adapters/node.js` 的文件——逐字死表，双向断言。
   * R7-2 后死表缩到五件：`schema.ts` / `cfg-template.ts` 的模块级求值已解（rootOf 惰性 +
   * defaults.js 注册表），宿主入口剩 `cli.ts` / `mcp.ts` / `export-cli.ts` / `quality-cli.ts`
   * 与显式登记点 `http.ts`。适配器实现自身不算——它在豁免区里，普查把它排除掉，
   * 免得「注释里提一句适配器路径」也能凑过这条门。
   */
  const HOST_SIDE = [
    "cli.ts",
    "export-cli.ts",
    "http.ts",
    "mcp.ts",
    "quality-cli.ts",
  ].sort();

  it("豁免区之外，core/src import Node 适配器的只剩死表这五件（双向：多一处=新尾巴，少一处=表过期）", () => {
    const hits = srcFiles()
      .filter((f) => !f.rel.startsWith("abstraction/adapters/"))
      .filter((f) => /(?:from\s+|^\s*import\s)"[^"]*adapters\/node\.js"/m.test(f.text))
      .map((f) => f.rel)
      .sort();
    expect(hits).toEqual(HOST_SIDE);
  });

  it("defaults.ts 自身零 node:* import，且不 import 任何适配器实现（R7-3 起本体在 @storyflow/adapters 包源）", () => {
    const text = fs.readFileSync(path.join(SRC_DIR, "../../adapters/src/defaults.ts"), "utf-8");
    expect([...text.matchAll(/(?:from|import\s*\()?\s*["'](node:[a-z_-]+)["']/g)].map((m) => m[1])).toEqual([]);
    // 只查 import 形态，不查裸文本：未注册就抛的那句错误消息**必须**告诉宿主该 import 哪一件，
    // 按裸文本匹配会把这条指路消息判成违规（R7-1 自测时就这样被自己的消息绊了一次）。
    expect(/(?:from\s+|^\s*import\s)["'][^"']*adapters\/(?:node|mock)\.js["']/m.test(text)).toBe(false);
    expect(text).toMatch(/registerAdapters/);
  });

  /** FS1 §四第 2 条的尾参默认（四种类型标注形态）——注释里的同名字样不算，故必须带类型标注前缀。 */
  const TAIL_DEFAULT = [
    /:\s*IFileSystem = nodeFs/g,
    /:\s*IFsPath = nodePath/g,
    /:\s*IProcessLauncher = nodeProc/g,
    /:\s*FsIo = \{ fs: nodeFs, path: nodePath \}/g,
  ];

  it("尾参默认普查：除宿主入口 cfg-template.ts 外，带尾参默认的文件一律从 defaults.js 取值", () => {
    const bypass: string[] = [];
    let total = 0;
    let hostEntry = 0;
    let servedFiles = 0;
    for (const f of srcFiles()) {
      // 豁免区 = 适配器实现自身；defaults.ts 的那一处是它头注释里的口径说明
      if (f.rel.startsWith("abstraction/adapters/") || f.rel === "abstraction/defaults.ts") continue;
      const n = TAIL_DEFAULT.reduce((acc, re) => acc + (f.text.match(re) ?? []).length, 0);
      if (!n) continue;
      total += n;
      if (f.rel === "cfg-template.ts") {
        hostEntry += n; // R7-2 的账：入口桥仍直连 Node 单例
        continue;
      }
      servedFiles += 1;
      if (!/(?:from\s+|^\s*import\s)["'][^"']*defaults\.js["']/m.test(f.text)) bypass.push(f.rel);
    }
    expect(bypass, "绕过注册表直抓宿主实现的默认点").toEqual([]);
    // 头注口径逐数可复算：168 处真默认 = 158（经注册表，27 个文件）+ 10（cfg-template）
    expect(total).toBe(168);
    expect(hostEntry).toBe(10);
    expect(total - hostEntry).toBe(158);
    expect(servedFiles).toBe(27);
  });

  it("宿主 setup 已注册：currentAdapters() 非空，三个转发对象身份稳定且可用", () => {
    expect(currentAdapters()).not.toBeNull();
    expect(nodeFs).toBe(nodeFs);
    const probe = path.join(SRC_DIR, "abstraction/defaults.ts");
    expect(nodeFs.exists(probe)).toBe(true);
    expect(typeof nodePath.join("a", "b")).toBe("string");
    expect(typeof nodeProc.run).toBe("function");
  });
});

describe("R7-1 · 注册表语义（未注册抛、注册后转发、后注册覆盖前注册）", () => {
  /** 每个用例要一份干净的注册表，所以重置模块注册后再动态取新的 defaults。 */
  async function freshDefaults() {
    vi.resetModules();
    const mod = await import("../src/abstraction/defaults.js");
    const { registerAdapters: reg, nodeFs: fsForward, nodePath: pForward, nodeProc: procForward } = mod;
    return { reg, fsForward, pForward, procForward };
  }

  let seq = 0;
  const root = () => `/mock-r71-${(seq += 1)}`;

  it("未注册就用 = 抛错点名，不静默回落到任何实现", async () => {
    const { fsForward, pForward, procForward } = await freshDefaults();
    for (const [name, use] of [
      ["nodeFs", () => fsForward.exists("/anything")],
      ["nodePath", () => pForward.join("a", "b")],
      ["nodeProc", () => procForward.run("python", ["-c", "0"])],
    ] as const) {
      let err = "";
      try {
        use();
      } catch (e) {
        err = e instanceof Error ? e.message : String(e);
      }
      expect(err, name).toContain("未注册平台适配器");
      expect(err, name).toContain("registerAdapters");
    }
  });

  it("注册即转发到那一家：换假盘之后默认参数读的是假盘，宿主盘一条不多", async () => {
    const { reg, fsForward, pForward } = await freshDefaults();
    const dir = root();
    const mock = new MockFsAdapter(dir);
    mock.writeText(path.posix.join(dir, "a.md"), "# A\n");
    reg({ fs: mock, path: new MockPathAdapter(), proc: new MockProcLauncher(), env: mockEnv, hash: mockHash });
    expect(fsForward.exists(path.posix.join(dir, "a.md"))).toBe(true);
    expect(fsForward.readText(path.posix.join(dir, "a.md"))).toBe("# A\n");
    expect(fsForward.exists(path.posix.join(dir, "nope.md"))).toBe(false);
    expect(pForward.basename(path.posix.join(dir, "a.md"))).toBe("a.md");
    // 宿主盘上不该因为这轮注册多出任何东西
    expect(fs.existsSync(path.resolve(dir))).toBe(false);
  });

  it("后注册覆盖前注册（宿主换实现、测试换假盘都靠这条），getter 形态一并转发", async () => {
    const { reg, fsForward, pForward } = await freshDefaults();
    const node = await import("../src/abstraction/adapters/node.js");
    reg({ fs: node.nodeFs, path: node.nodePath, proc: node.nodeProc, env: node.nodeEnv, hash: node.nodeHash });
    expect(pForward.sep).toBe(path.sep);
    const mockPath = new MockPathAdapter();
    reg({ fs: new MockFsAdapter(root()), path: mockPath, proc: new MockProcLauncher(), env: mockEnv, hash: mockHash });
    expect(pForward.sep).toBe(mockPath.sep);
    expect(pForward.sep).toBe("/");
  });

  it("只登记引用不复制包装：注册进去的对象与转发对象行为一致（同一实现同一身份语义）", async () => {
    const { reg, fsForward } = await freshDefaults();
    const mock = new MockFsAdapter(root());
    reg({ fs: mock, path: new MockPathAdapter(), proc: new MockProcLauncher() });
    fsForward.mkdir("/mock-r71-x", { recursive: true });
    fsForward.writeText("/mock-r71-x/一层.md", "内容");
    expect(mock.readText("/mock-r71-x/一层.md")).toBe("内容");
    expect(mock.readDir("/mock-r71-x")).toEqual(["一层.md"]);
  });
});

beforeEach(() => {
  // 上面的用例都在 fresh 模块里玩注册表；这里显式声明：本文件的断言不得依赖跨用例的注册顺序
  expect(currentAdapters()).not.toBeNull();
});
