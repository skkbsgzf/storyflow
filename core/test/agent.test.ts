/**
 * pi-agent 对话流（2026-09-22）：确定性面回归——会话存储、工具集形状、文件越界防护。
 * LLM 工具环的在线链路由 .external 端点 + SSE 冒烟覆盖（见 docs 记录），此处不依赖网络。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Kernel } from "../src/kernel.js";
import { buildTools, createSession, deleteSession, getSession, listSessions, renameSession } from "../src/agent.js";

function tmpRoot(): { root: string; pid: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-root-"));
  const pid = "p-agent-demo";
  fs.mkdirSync(path.join(root, "projects", pid), { recursive: true });
  return { root, pid };
}

describe("pi-agent · 会话存储（projects/<id>/registry/agent-sessions/）", () => {
  it("CRUD 全链：建 → 列 → 改名 → 读 → 删", () => {
    const { root, pid } = tmpRoot();
    const dir = path.join(root, "projects", pid);
    const s = createSession(dir, "测试会话");
    expect(s.id).toMatch(/^s-/);
    expect(s.title).toBe("测试会话");
    expect(listSessions(dir).map((x) => x.id)).toContain(s.id);
    renameSession(dir, s.id, "改过的名字");
    expect(getSession(dir, s.id).title).toBe("改过的名字");
    deleteSession(dir, s.id);
    expect(listSessions(dir).map((x) => x.id)).not.toContain(s.id);
  });

  it("读不存在的会话 = 显式报错（不静默空对象）", () => {
    const { root, pid } = tmpRoot();
    expect(() => getSession(path.join(root, "projects", pid), "s-none")).toThrow(/会话不存在/);
  });
});

describe("pi-agent · 工具集（动词白名单 ∷ fs ∷ lint）", () => {
  it("P0 宿主解禁：run 状态动词入环（flow_run/resume/submit/rerun/overlay），唯 flow_gate 与 set_decision 维持禁入", async () => {
    const { root, pid } = tmpRoot();
    const k = new Kernel({ root });
    const tools = await buildTools(k, pid, { tools: async () => [] } as never);
    const names = tools.map((t) => t.name);
    expect(names).toContain("mf_worldbook_search");
    expect(names).toContain("mf_flow_next");
    expect(names).toContain("mf_skill_patch");
    // P0 解禁（09-23 甲方批准，docs/排期-pi-agent原生workflow运行时）：宿主可驱动 workflow
    for (const promoted of ["mf_flow_run", "mf_flow_resume", "mf_flow_submit", "mf_flow_rerun", "mf_flow_overlay"]) {
      expect(names).toContain(promoted);
    }
    // 纪律仍守住的两条：门裁决是人的动词（铁律 6：机器不得代裁）；决策登记面不在 agent 职责内
    for (const banned of ["mf_flow_gate", "mf_set_decision"]) {
      expect(names).not.toContain(banned);
    }
    expect(names).toContain("fs_read");
    expect(names).toContain("fs_write");
    expect(names).toContain("flow_lint");
  });

  it("P0 护栏：mf_flow_submit 路由内核本体——无 run 状态项目走内核 NO_RUN 错误（完整性闸随动词走）", async () => {
    const { root, pid } = tmpRoot();
    const k = new Kernel({ root });
    const tools = await buildTools(k, pid, { tools: async () => [] } as never);
    const submit = tools.find((t) => t.name === "mf_flow_submit");
    expect(submit).toBeDefined();
    await expect(submit!.exec({ project: pid, node: "m1.x", content: "任意产物" })).rejects.toThrow(/NO_RUN|state/i);
  });

  it("fs_write 项目内可写、越界拒绝（文件系统感知的护栏）", async () => {
    const { root, pid } = tmpRoot();
    const k = new Kernel({ root });
    const tools = await buildTools(k, pid, { tools: async () => [] } as never);
    const write = tools.find((t) => t.name === "fs_write")!;
    await write.exec({ path: "02-编剧/notes.md", content: "hello" });
    expect(fs.readFileSync(path.join(root, "projects", pid, "02-编剧", "notes.md"), "utf-8")).toBe("hello");
    await expect(write.exec({ path: "../../outside.md", content: "x" })).rejects.toThrow(/越出项目/);
  });

  it("MCP 未配置时工具环照常（空内联，不编造工具）", async () => {
    const { root, pid } = tmpRoot();
    const k = new Kernel({ root });
    const tools = await buildTools(k, pid, { tools: async () => [] } as never);
    expect(tools.map((t) => t.name).filter((n) => n.startsWith("mcp__"))).toEqual([]);
  });
});
