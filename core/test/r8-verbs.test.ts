/**
 * R8-OPS · 步骤 3：动词表唯一源（`verbs.ts`）—— 回归测试
 *
 * 被测命题：**「同一事实写在多处」必须变成「一处声明、三面派生」**。
 *   · 改造前：CLI 13 动词 / MCP 7 / HTTP(POST /api/verbs/:verb) 4 / Skill 纯文档 —— 四份副本；
 *     `flow_init` 恰好「CLI 有、MCP 无、HTTP 无」⇒ **初始化面板所需的动词最不可达**。
 *   · 改造后：`VERBS` 是唯一台账；MCP 逐条派 tool、HTTP 按表分派、CLI usage 由表生成。
 *
 * 因此本测试**不逐条枚举动词**（那又会变成第 5 份副本），而是断言「三面 = 表」这个**关系**：
 *   表里每新增一个动词，MCP 与 HTTP 必须自动认得它；不认得 = 关系破了 = 红灯。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Kernel } from "../src/kernel.js";
import { buildHttpApp } from "../src/http.js";
import { VERB_BY_NAME, VERB_NAMES, flagsToArgs, usageFromVerbs, VERBS } from "../src/verbs.js";
import { verbToolSpecs, buildMcpServer } from "../src/mcp.js";

function seedRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miniflow-verbs-"));
  fs.writeFileSync(path.join(root, "index.html"), "<h1>ok</h1>", "utf-8");
  fs.mkdirSync(path.join(root, "projects"), { recursive: true });
  fs.mkdirSync(path.join(root, "skills"), { recursive: true });
  return root;
}

async function appOf(root: string) {
  const k = new Kernel({ root, repoRoot: root, flowsDir: path.join(root, "flows") });
  const app = buildHttpApp(k);
  await app.ready();
  return { app, k };
}

describe("R8 · 动词表是唯一台账", () => {
  it("表非空、名字唯一、且含 R8-OPS 前「只有 CLI 有」的那批动词", () => {
    expect(VERB_NAMES.length).toBeGreaterThanOrEqual(13);
    expect(new Set(VERB_NAMES).size).toBe(VERB_NAMES.length);
    // 这 6 个正是改造前 MCP 面（7 个手写 tool）与 HTTP 面（4 个 case）**都缺失**的
    for (const v of ["flow_init", "flow_effect", "flow_mine", "skill_patch", "flow_optimize", "flow_overlay"]) {
      expect(VERB_NAMES).toContain(v);
    }
  });

  it("每个动词：有说明、有分组、必填参数有 desc（三面共用这些字段）", () => {
    for (const def of VERBS) {
      expect(def.description.length, `${def.name} 缺 description`).toBeGreaterThan(0);
      expect(def.group.length, `${def.name} 缺 group`).toBeGreaterThan(0);
      expect(typeof def.run, `${def.name} 缺 run`).toBe("function");
      for (const p of def.params) expect(p.desc.length, `${def.name}.${p.name} 缺 desc`).toBeGreaterThan(0);
    }
  });

  it("CLI usage 由表生成：每个动词名都出现（不可能漂移）", () => {
    const u = usageFromVerbs();
    for (const name of VERB_NAMES) expect(u, `usage 漏了 ${name}`).toContain(name);
  });

  it("MCP 面 = 表：tool 名集合与表一致；必填参数在 inputSchema 里", () => {
    const specs = verbToolSpecs();
    expect(specs.map((s) => s.name)).toEqual(VERB_NAMES);
    for (const spec of specs) {
      const def = VERB_BY_NAME[spec.name];
      for (const p of def.params) expect(spec.inputSchema, `${spec.name} 缺 ${p.name}`).toHaveProperty(p.name);
    }
  });

  it("MCP 真握手（in-memory transport）：tools/list 返回的正是表里的动词", async () => {
    const root = seedRoot();
    const k = new Kernel({ root, repoRoot: root, flowsDir: path.join(root, "flows") });
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const server = buildMcpServer(k);
    const client = new Client({ name: "test", version: "0" });
    await Promise.all([server.connect(st), client.connect(ct)]);

    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toEqual(VERB_NAMES);
    // 描述与参数说明也来自表（三面同源）
    const submit = tools.tools.find((t) => t.name === "flow_submit")!;
    expect(submit.description).toContain("rejected");

    // 真调一次表里的动词（flow_list 无副作用）→ 与 CLI 同一执行路径
    const res = await client.callTool({ name: "flow_list", arguments: {} });
    expect(JSON.parse((res.content as { text: string }[])[0].text)).toEqual([]);

    await client.close();
    await server.close();
  });
});

describe("R8 · HTTP 面 = 表（POST /api/verbs/:verb）", () => {
  it("表里每一个动词都被 HTTP 认识（不是 UNKNOWN_VERB）", async () => {
    const root = seedRoot();
    const { app } = await appOf(root);

    for (const name of VERB_NAMES) {
      const r = await app.inject({
        method: "POST",
        url: `/api/verbs/${name}`,
        payload: { project: "p1", flow: "nope", node: "n1", nodeId: "g1", verdict: "pass", action: "list" },
      });
      const body = JSON.parse(r.body) as { error?: string };
      // 允许业务错（无项目/无 flow/无门…），但**不允许**「不认识这个动词」——
      // 改造前 flow_init/effect/mine/skill_patch/optimize/overlay 全部走 default 分支报 UNKNOWN_VERB。
      expect({ verb: name, error: body.error }).not.toEqual({ verb: name, error: "UNKNOWN_VERB" });
    }
    await app.close();
  });

  it("未知动词 → 404 UNKNOWN_VERB，且 detail 列出可用动词（不静默）", async () => {
    const root = seedRoot();
    const { app } = await appOf(root);
    const r = await app.inject({ method: "POST", url: "/api/verbs/not_a_verb", payload: {} });
    expect(r.statusCode).toBe(404);
    const body = JSON.parse(r.body) as { error: string; detail: string };
    expect(body.error).toBe("UNKNOWN_VERB");
    for (const name of VERB_NAMES) expect(body.detail).toContain(name);
    await app.close();
  });

  it("回归原缺口：flow_init 经 HTTP 真能落 项目配置.json（初始化面板的动词可达）", async () => {
    const root = seedRoot();
    const { app } = await appOf(root);
    const r = await app.inject({ method: "POST", url: "/api/verbs/flow_init", payload: { project: "p-new" } });
    expect(r.statusCode).toBe(200);
    const file = path.join(root, "projects", "p-new", "项目配置.json");
    expect(fs.existsSync(file)).toBe(true);
    expect(JSON.parse(fs.readFileSync(file, "utf-8"))).toMatchObject({ 项目: "p-new", 严肃性: "标准" });
    await app.close();
  });
});

describe("R8 · CLI flags → 归一化入参", () => {
  it("通用映射：kebab 旗标 → 参数名、类型转换、未给的不进参", () => {
    const gate = VERB_BY_NAME["flow_gate"];
    const args = flagsToArgs(gate, { project: "p1", node: "g1", verdict: "pass", round: "2" });
    expect(args).toMatchObject({ project: "p1", nodeId: "g1", verdict: "pass", round: 2 });
    expect(args).not.toHaveProperty("comment");
  });

  it("自定义映射：flow_submit 的 --content-file 折进 content", () => {
    const root = seedRoot();
    const f = path.join(root, "draft.md");
    fs.writeFileSync(f, "# 产物", "utf-8");
    const def = VERB_BY_NAME["flow_submit"];
    const args = def.fromFlags!(null as unknown as Kernel, { project: "p1", node: "n1", "content-file": f });
    expect(args.content).toBe("# 产物");
  });

  it("自定义映射：skill_patch 的 --approve/--reject/--list 折成 action", () => {
    const def = VERB_BY_NAME["skill_patch"];
    const F = (flags: Record<string, string | boolean>) => def.fromFlags!(null as unknown as Kernel, flags);
    expect(F({ approve: "sp-001" })).toMatchObject({ action: "approve", id: "sp-001" });
    expect(F({ reject: "sp-002" })).toMatchObject({ action: "reject", id: "sp-002" });
    expect(F({ list: true })).toMatchObject({ action: "list" });
    expect(F({ target: "a/b", text: "t", reason: "r" })).toMatchObject({ action: "add", target: "a/b" });
  });
});
