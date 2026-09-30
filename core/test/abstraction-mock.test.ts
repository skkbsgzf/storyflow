/**
 * R1 抽象层自测：mock 的读写扫描 + 错误码保真 + Node/mock 同语义对表 + proc 脚本化。
 * 这一张是 R3「可嵌入」冒烟的前置——先证明抽象层自身站得住，再谈把内核搬上来。
 * R6 追加：接口扩容的两件（IFsPath.fromFileUrl、IProcessLauncher.detach）同样进对表——
 * 新增成员不配对表，等于让 Node 与 mock 各长一套语义（规范 §四.5 的后半段义务）。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { IFsPath, IFileSystem } from "../src/abstraction/fs.js";
import { NodeFsAdapter, NodePathAdapter, NodeProcLauncher } from "../src/abstraction/adapters/node.js";
import { MockFsAdapter, MockPathAdapter, MockProcLauncher } from "../src/abstraction/adapters/mock.js";

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return String((e as { code?: string }).code ?? "");
  }
  return "";
}

describe("抽象层 · mock 自测（读写扫描）", () => {
  it("seed 之后可读、可列、可 stat", () => {
    const m = new MockFsAdapter("/work").seed({
      "/work/项目配置.json": "{}",
      "/work/大纲/第一卷.md": "# 一",
      "/work/大纲/第二卷.md": "# 二",
    });
    expect(m.readText("/work/项目配置.json")).toBe("{}");
    expect(m.readDir("/work/大纲").sort()).toEqual(["第一卷.md", "第二卷.md"]);
    expect(m.stat("/work/大纲/第一卷.md")?.isFile).toBe(true);
    expect(m.stat("/work/大纲")?.isDirectory).toBe(true);
    expect(m.stat("/work/不存在")).toBeUndefined();
    expect(m.listFiles()).toEqual(["/work/大纲/第一卷.md", "/work/大纲/第二卷.md", "/work/项目配置.json"]);
  });

  it("readDirEntries 分得清文件与目录", () => {
    const m = new MockFsAdapter("/work").seed({ "/work/a.md": "x" });
    m.mkdir("/work/sub", { recursive: true });
    const entries = m.readDirEntries("/work").map((e) => `${e.name}:${e.isDirectory ? "d" : "f"}`).sort();
    expect(entries).toEqual(["a.md:f", "sub:d"]);
  });

  it("原子写不留中间态，父目录自动建", () => {
    const m = new MockFsAdapter("/work");
    m.writeTextAtomic("/work/deep/deeper/state.json", "{}");
    expect(m.exists("/work/deep/deeper/state.json")).toBe(true);
    expect(m.listFiles()).toEqual(["/work/deep/deeper/state.json"]);
  });

  it("mkdir 非递归时已存在即抛 EEXIST（LockDir 的互斥靠这条）", () => {
    const m = new MockFsAdapter("/work");
    m.mkdir("/work/x.lock");
    expect(codeOf(() => m.mkdir("/work/x.lock"))).toBe("EEXIST");
    expect(m.exists("/work/x.lock")).toBe(true);
  });

  it("错误码与 node 同族：缺文件 ENOENT、对目录写 EISDIR、父不存在 ENOTDIR", () => {
    const m = new MockFsAdapter("/work").seed({ "/work/f.txt": "1" });
    expect(codeOf(() => m.readText("/work/nope"))).toBe("ENOENT");
    expect(codeOf(() => m.writeText("/work", "x"))).toBe("EISDIR");
    m.mkdir("/work/d");
    expect(codeOf(() => m.writeText("/work/d/f2/x", "y"))).toBe("ENOENT");
    expect(codeOf(() => m.readDir("/work/f.txt"))).toBe("ENOTDIR");
  });

  it("remove 的 recursive/force 语义", () => {
    const m = new MockFsAdapter("/work").seed({ "/work/d/a.md": "x" });
    expect(codeOf(() => m.remove("/work/d"))).toBe("ENOTEMPTY");
    m.remove("/work/d", { recursive: true });
    expect(m.exists("/work/d/a.md")).toBe(false);
    m.remove("/work/d", { force: true });
    expect(codeOf(() => m.remove("/work/d"))).toBe("ENOENT");
  });

  it("rename 带走整棵子树，copy 只搬单文件（recursive 才搬目录）", () => {
    const m = new MockFsAdapter("/work").seed({ "/work/a/1.md": "x", "/work/a/b/2.md": "y" });
    m.rename("/work/a", "/work/c");
    expect(m.listFiles()).toEqual(["/work/c/1.md", "/work/c/b/2.md"]);
    m.copy("/work/c/1.md", "/work/c/1.copy.md");
    expect(m.exists("/work/c/1.copy.md")).toBe(true);
    expect(codeOf(() => m.copy("/work/c/b", "/work/c/b2"))).toBe("EISDIR");
    m.copy("/work/c/b", "/work/c/b2", { recursive: true });
    expect(m.exists("/work/c/b2/2.md")).toBe(true);
  });

  it("watchDir 拿到取消函数，取消后不再回调", () => {
    const m = new MockFsAdapter("/work");
    const seen: string[] = [];
    const unwatch = m.watchDir("/work", (name) => seen.push(name));
    m.writeText("/work/新文件.md", "1");
    expect(seen).toEqual(["新文件.md"]);
    unwatch();
    m.writeText("/work/另一个.md", "2");
    expect(seen).toEqual(["新文件.md"]);
  });

  it("appendText 累加、readBuffer 与文本一致", () => {
    const m = new MockFsAdapter("/work");
    m.writeTextAtomic("/work/j.jsonl", '{"a":1}\n');
    m.appendText("/work/j.jsonl", '{"a":2}\n');
    expect(m.readText("/work/j.jsonl")).toBe('{"a":1}\n{"a":2}\n');
    expect(new TextDecoder().decode(m.readBuffer("/work/j.jsonl"))).toBe(m.readText("/work/j.jsonl"));
  });
});

describe("抽象层 · Node/mock 同语义对表", () => {
  function tmpRoot(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "fs-abs-"));
  }

  const ops: {
    name: string;
    run: (fsys: IFileSystem, p: IFsPath, base: string) => unknown;
  }[] = [
    {
      name: "原子写后可读回，父目录存在",
      run: (f, p, base) => {
        f.writeTextAtomic(p.join(base, "deep/deep/state.json"), '{"ok":true}');
        return f.readText(p.join(base, "deep/deep/state.json"));
      },
    },
    {
      name: "列目录得到名字集合",
      run: (f, p, base) => {
        f.writeTextAtomic(p.join(base, "d/1.md"), "a");
        f.writeTextAtomic(p.join(base, "d/2.md"), "b");
        return f.readDir(p.join(base, "d")).sort().join(",");
      },
    },
    {
      name: "stat 缺失返回 undefined",
      run: (f, p, base) => String(f.stat(p.join(base, "nope"))),
    },
    {
      name: "非递归 mkdir 重复即抛 EEXIST",
      run: (f, p, base) => codeOf(() => {
        f.mkdir(p.join(base, "lockdir"));
        f.mkdir(p.join(base, "lockdir"));
      }),
    },
  ];

  for (const spec of ops) {
    it(spec.name, () => {
      const root = tmpRoot();
      const nodeOut = spec.run(new NodeFsAdapter(), new NodePathAdapter(), root);
      const mockOut = spec.run(new MockFsAdapter("/work"), new MockPathAdapter(), "/work");
      expect(mockOut).toBe(nodeOut);
      fs.rmSync(root, { recursive: true, force: true });
    });
  }

  it("路径适配器：join/dirname/basename/extname/relative/posixJoin/format 对表", () => {
    const n = new NodePathAdapter();
    const m = new MockPathAdapter();
    expect(m.join("a", "b")).toBe("/a/b");
    expect(m.dirname("/a/b/c.md")).toBe("/a/b");
    expect(m.basename("/a/b/c.md")).toBe("c.md");
    expect(m.basename("/a/b/c.md", ".md")).toBe("c");
    expect(m.extname("/a/b/c.md")).toBe(".md");
    expect(m.extname("/a/b/c")).toBe("");
    expect(m.relative("/a/b", "/a/c/d")).toBe(path.posix.relative("/a/b", "/a/c/d"));
    expect(m.relative("/a/b", "/a/b/c")).toBe(path.posix.relative("/a/b", "/a/b/c"));
    expect(m.posixJoin("a", "b")).toBe("/a/b");
    expect(m.format({ dir: "/a", name: "b", ext: ".json" })).toBe("/a/b.json");
    expect(m.format({ dir: "/a", base: "b.json" })).toBe("/a/b.json");
    expect(n.sep).toBe(path.sep);
    expect(m.sep).toBe("/");
    expect(n.join("a", "b")).toBe(path.join("a", "b"));
    expect(n.format({ dir: "/a", name: "b", ext: ".json" })).toBe(path.format({ dir: "/a", name: "b", ext: ".json" }));
    // fromFileUrl（R6 扩容）：Node 侧对齐 fileURLToPath，mock 侧只认「剥前缀 + 百分号解码」这一档语义
    expect(n.fromFileUrl(import.meta.url)).toBe(fileURLToPath(import.meta.url));
    expect(m.fromFileUrl("file:///a/b%20c.md")).toBe("/a/b c.md");
    expect(m.fromFileUrl("file:///a/b.md")).toBe("/a/b.md");
  });
});

describe("抽象层 · proc 脚本化", () => {
  it("mock 的 run 记录调用、未注册时按启动失败处理", () => {
    const p = new MockProcLauncher();
    const r = p.run("python", ["tools/x.py"]);
    expect(r.status).toBe(127);
    expect(p.calls).toHaveLength(1);
    expect(p.calls[0]?.cmd).toBe("python");
  });

  it("注册应答后 run 返回脚本化结果，exec 非零即抛 ProcExecutionError", () => {
    const p = new MockProcLauncher().on("python tools/page.py", () => ({ status: 0, stdout: "page ok", stderr: "" }));
    expect(p.run("python", ["tools/page.py"]).stdout).toBe("page ok");
    expect(p.exec("python", ["tools/page.py"])).toBe("page ok");
    p.on("python tools/bad.py", () => ({ status: 2, stdout: "", stderr: "boom" }));
    try {
      p.exec("python", ["tools/bad.py"]);
      expect.unreachable();
    } catch (e) {
      expect((e as Error).name).toBe("ProcExecutionError");
      expect((e as { status?: number }).status).toBe(2);
      expect((e as { stderr?: string }).stderr).toBe("boom");
    }
  });

  it("Node 实现跑真子进程：status/stdout 与 exec 的抛错形态", () => {
    const p = new NodeProcLauncher();
    const echo = process.platform === "win32" ? "cmd" : "/bin/sh";
    const args = process.platform === "win32" ? ["/c", "echo hi"] : ["-c", "echo hi"];
    const r = p.run(echo, args);
    expect(r.status).toBe(0);
    expect(String(r.stdout)).toContain("hi");
    const bad = p.run(echo, process.platform === "win32" ? ["/c", "exit 3"] : ["-c", "exit 3"]);
    expect(bad.status).toBe(3);
    // 启动层失败：不存在的解释器
    const missing = p.run("__no_such_binary__", []);
    expect(missing.status).toBeNull();
    expect(missing.error).toBeTruthy();
  });

  it("detach（R6 扩容）：mock 只留账不起进程，Node 侧是真分离启动且不等结果", () => {
    const p = new MockProcLauncher();
    p.detach("cmd", ["/c", "start", "", "http://127.0.0.1:8421/"]);
    expect(p.detached).toEqual([{ cmd: "cmd", args: ["/c", "start", "", "http://127.0.0.1:8421/"] }]);
    // Node 侧只验「这件存在、且不等结果不抛」：起一个立刻退出的自身进程，不碰浏览器不占端口
    expect(() => new NodeProcLauncher().detach(process.execPath, ["-e", "0"])).not.toThrow();
  });
});
