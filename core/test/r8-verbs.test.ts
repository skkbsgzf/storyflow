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
import {
  MCP_PROMPTS,
  MCP_RESOURCES,
  buildMcpServer,
  gateAssistBrief,
  verbToolSpecs,
  worldbookReviewBrief,
} from "../src/mcp.js";

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
    // fromFlags 现在真读盘（FS1：经 kernel.fs 而非宿主 node:fs），null 内核传不得
    const kernel = new Kernel({ root, repoRoot: root });
    const args = def.fromFlags!(kernel, { project: "p1", node: "n1", "content-file": f });
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

// ── R4（工单 20261001）· MCP 资源面与提示面 ─────────────────────────────
//
// 被测命题：**只有 verbs 的 MCP 面看不见故事**。资源/提示两张表与 tools 一样必须**派生**，
// 所以测试不枚举动词、不硬写 URI 字符串，而是拿 `MCP_RESOURCES` / `MCP_PROMPTS` 当判据：
// 表里加了第 5 类资源而注册没跟上 ⇒ 握手断言直接红（同源纪律，第 4 份副本进不来）。
// 内核构造一律 `new Kernel({ root })`（repoRoot 落真语料）——gate-assist 要真的解析 flow@3。

/** 世界书 graph.json 夹具（worldbook-graph@1 最小形状）：e_orphan 无关系边，e_shop/e_orphan 缺摘要。 */
function seedWorldbook(root: string, projectId: string): void {
  const dir = path.join(root, "projects", projectId, "世界书");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "graph.json"),
    JSON.stringify(
      {
        format: "worldbook-graph@1",
        built_at: "2026-09-30T10:00:00.000Z",
        entries: [
          { id: "e_chef", cat: "人物", title: "老陈", tags: ["发型师"], summary: "坚持先洗后剪的三十年师傅", path: "世界书/人物/老陈.md" },
          { id: "e_shop", cat: "场景", title: "快剪店", tags: ["连锁"], path: "世界书/场景/快剪店.md" },
          { id: "e_orphan", cat: "道具", title: "旧剪刀", path: "世界书/道具/旧剪刀.md" },
        ],
        relations: [{ a: "e_chef", b: "e_shop", src: "世界书/人物/老陈.md", weight: 3 }],
      },
      null,
      2,
    ) + "\n",
    "utf-8",
  );
}

/** 运行态 + 登记产物夹具（m3.link = topic flow@3 唯一人工门；token/round 与 gate-assist 的凭据断言同源）。 */
function seedRun(root: string, projectId: string): string {
  const pd = path.join(root, "projects", projectId);
  fs.mkdirSync(path.join(pd, "registry"), { recursive: true });
  fs.mkdirSync(path.join(pd, "01-选题"), { recursive: true });
  fs.writeFileSync(path.join(pd, "01-选题", "选题报告.md"), "# 选题报告\n\n正文。\n", "utf-8");
  fs.writeFileSync(
    path.join(pd, "state.json"),
    JSON.stringify(
      {
        runId: "run-r4",
        projectId,
        flowId: "topic",
        flowVersion: "6.0.0",
        status: "awaiting_input",
        plan: { order: ["m1.topic-report", "m3.link"] },
        nodes: { "m1.topic-report": { status: "done", round: 1 }, "m3.link": { status: "awaiting", round: 1 } },
        gate: { verdict: "awaiting", node: "m3.link", at: "2026-09-30T09:00:00.000Z", round: 1, token: "tk-1" },
        inputs: {},
        comments: {},
      },
      null,
      2,
    ) + "\n",
    "utf-8",
  );
  fs.writeFileSync(
    path.join(pd, "registry", "artifacts.json"),
    JSON.stringify(
      {
        artifacts: [
          {
            path: "01-选题/选题报告.md",
            node: "m1.topic-report",
            round: 1,
            sha1: "deadbeef",
            ts: "2026-09-30T09:30:00.000Z",
            producer: "kit/topic.topic-report",
            validations: [{ name: "AE-HEAD", status: "pass" }, { name: "AE-OUTPUT-PURITY", status: "warn", detail: "正文含过程口径" }],
          },
        ],
      },
      null,
      2,
    ) + "\n",
    "utf-8",
  );
  return pd;
}

type TextItem = { type: string; text: string };

async function mcpClient(kernel: Kernel) {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const server = buildMcpServer(kernel);
  const client = new Client({ name: "r4-test", version: "0" });
  await Promise.all([server.connect(st), client.connect(ct)]);
  return { client, server };
}

describe("R4 · MCP 资源面 = 表（in-memory 真握手）", () => {
  it("四类资源的 URI 模板与 MCP_RESOURCES 一一对应，tools 仍等于动词表全量", async () => {
    const root = seedRoot();
    const { client, server } = await mcpClient(new Kernel({ root }));

    // 模板清单在 resources/templates/list（SDK 1.30：listResources 只走 list 回调出实体 URI）
    const listed = await client.listResourceTemplates();
    expect(listed.resourceTemplates.map((t) => t.uriTemplate).sort()).toEqual(MCP_RESOURCES.map((r) => r.uriTemplate).sort());
    expect(listed.resourceTemplates.map((t) => t.name).sort()).toEqual(MCP_RESOURCES.map((r) => r.name).sort());
    // 工单核对项：MCP 工具数 = VERBS 全量（R4 前后都只允许「表 = 面」，不许第 5 份副本）
    const tools = await client.listTools();
    expect(tools.tools.length).toBe(VERBS.length);
    expect(MCP_RESOURCES.length).toBe(4);

    await client.close();
    await server.close();
  });

  it("读 wb://{project}/graph：词条/关系/计数逐项对上夹具", async () => {
    const root = seedRoot();
    seedWorldbook(root, "p-r4");
    const { client, server } = await mcpClient(new Kernel({ root }));

    const r = await client.readResource({ uri: "wb://p-r4/graph" });
    const g = JSON.parse(r.contents[0]!.text) as {
      project: string;
      format: string;
      built_at: string;
      counts: { entries: number; relations: number };
      truncated: { entries: boolean; relations: boolean };
      entries: { id: string }[];
    };
    expect(g.project).toBe("p-r4");
    expect(g.format).toBe("worldbook-graph@1");
    expect(g.built_at).toBe("2026-09-30T10:00:00.000Z");
    expect(g.counts).toEqual({ entries: 3, relations: 1 });
    expect(g.truncated).toEqual({ entries: false, relations: false });
    expect(g.entries.map((e) => e.id)).toEqual(["e_chef", "e_shop", "e_orphan"]);

    await client.close();
    await server.close();
  });

  it("读 wb://{project}/entry/{id}：单词条带一跳关系；无世界书/查无此条都是明说的失败", async () => {
    const root = seedRoot();
    seedWorldbook(root, "p-r4");
    const { client, server } = await mcpClient(new Kernel({ root }));

    const r = await client.readResource({ uri: "wb://p-r4/entry/e_chef" });
    const one = JSON.parse(r.contents[0]!.text) as {
      entry: { title: string };
      relations: { with: string; with_title: string; weight: number; src: string }[];
    };
    expect(one.entry.title).toBe("老陈");
    expect(one.relations).toEqual([{ with: "e_shop", with_title: "快剪店", weight: 3, src: "世界书/人物/老陈.md" }]);

    // 查无此条 = 带找回路径的错误，不是空对象
    await expect(client.readResource({ uri: "wb://p-r4/entry/e_nobody" })).rejects.toThrow(/无词条 e_nobody/);
    // 项目没有世界书 = 明说怎么重建（不静默返回空图）
    fs.mkdirSync(path.join(root, "projects", "p-empty"), { recursive: true });
    await expect(client.readResource({ uri: "wb://p-empty/graph" })).rejects.toThrow(/worldbook_index/);

    await client.close();
    await server.close();
  });

  it("中文项目 id 进出 URI 都要编解码：list 给的 uri 原样读得回", async () => {
    const root = seedRoot();
    seedWorldbook(root, "老张的店");
    const { client, server } = await mcpClient(new Kernel({ root }));

    const listed = await client.listResources();
    const uri = listed.resources.find((x) => x.uri.endsWith("/graph"))!.uri;
    expect(uri).toBe(`wb://${encodeURIComponent("老张的店")}/graph`);
    const r = await client.readResource({ uri });
    expect(JSON.parse(r.contents[0]!.text).project).toBe("老张的店");

    await client.close();
    await server.close();
  });

  it("flow://{project}/state 与面板 live 切片同源；artifact:// 只读已登记产物", async () => {
    const root = seedRoot();
    seedRun(root, "p-r4");
    const kernel = new Kernel({ root });
    const { client, server } = await mcpClient(kernel);

    const st = await client.readResource({ uri: "flow://p-r4/state" });
    const body = JSON.parse(st.contents[0]!.text) as { project: string; state: { flowId: string; gate: { verdict: string; node: string } }; revision: string };
    expect(body.project).toBe("p-r4");
    expect(body.state.flowId).toBe("topic");
    expect(body.state.gate).toMatchObject({ verdict: "awaiting", node: "m3.link" });
    // 同源性：资源正文 = 面板轮询的同一份 live 切片（revision 一致即同一个实现，不留第二份读模型）
    expect(body.revision).toBe(kernel.viewLive("p-r4").revision);

    const rel = `${encodeURIComponent("01-选题")}/${encodeURIComponent("选题报告.md")}`;
    const art = await client.readResource({ uri: `artifact://p-r4/${rel}` });
    expect(art.contents[0]!.mimeType).toContain("text/plain");
    expect(art.contents[0]!.text).toContain("# 选题报告");

    // 未登记 = 读不到（与 HTTP 面同一判定，登记外的路径穿越天然无效）
    await expect(client.readResource({ uri: "artifact://p-r4/01-%E9%80%89%E9%A2%98/%E8%84%9A%E6%9C%AC.md" })).rejects.toThrow(/未注册产物不可读/);

    await client.close();
    await server.close();
  });
});

describe("R4 · MCP 提示面（只摆事实，不下结论）", () => {
  it("两个提示模板在握手面上可见，参数名与 MCP_PROMPTS 一致", async () => {
    const root = seedRoot();
    const { client, server } = await mcpClient(new Kernel({ root }));

    const p = await client.listPrompts();
    expect(p.prompts.map((x) => x.name)).toEqual(MCP_PROMPTS.map((x) => x.name));
    for (const spec of MCP_PROMPTS) {
      const got = p.prompts.find((x) => x.name === spec.name)!;
      expect((got.arguments ?? []).map((a) => a.name).sort()).toEqual(spec.args.map((a) => a.name).sort());
    }

    await client.close();
    await server.close();
  });

  it("review-worldbook：孤儿/缺摘要是数出来的，正文里不出现裁决口径", async () => {
    const root = seedRoot();
    seedWorldbook(root, "p-r4");
    const { client, server } = await mcpClient(new Kernel({ root }));

    const got = await client.getPrompt({ name: "review-worldbook", arguments: { project: "p-r4", q: "老陈" } });
    const text = (got.messages[0]!.content as TextItem).text;
    expect(text).toContain("词条 3，关系边 1");
    expect(text).toContain("孤儿词条（图中无任何关系边）1 条");
    expect(text).toContain("缺摘要词条（检索打分吃不到 summary）2 条");
    expect(text).toContain("检索「老陈」");
    expect(text).toContain("e_chef（人物）老陈");
    expect(text).toContain("分类分布");
    // 提示模板给的是材料，判决权在评审者——文本里不许出现闸话
    expect(text).not.toMatch(/打回|不通过|合格线|自动放行/);

    await client.close();
    await server.close();
  });

  it("gate-assist：门/凭据/产物完整性/裁决后果逐项上桌，并声明裁决归评审者", () => {
    const root = seedRoot();
    seedRun(root, "p-r4");
    const text = gateAssistBrief(new Kernel({ root }), { project: "p-r4" });

    expect(text).toContain("当前悬置门");
    expect(text).toContain("token=tk-1");
    expect(text).toContain("已登记产物（最新一版 1 件");
    expect(text).toContain("m1.topic-report → 01-选题/选题报告.md");
    expect(text).toContain("AE-OUTPUT-PURITY(warn)");
    // 连接件门的后果只有两值（与 doGate 的 link 分支同口径，不在提示里另写一套）
    expect(text).toContain("连接件只接受两值");
    expect(text).toContain("本简报只摆事实与后果，不构成裁决");
  });

  it("三种空态都说明白：没开跑 / 没世界书 / 没有登记产物", () => {
    const root = seedRoot();
    const kernel = new Kernel({ root });
    expect(gateAssistBrief(kernel, { project: "p-none" })).toContain("项目未开跑");
    // 世界书不在位 = 明说的失败（带重建命令），不是空图糊过去
    expect(() => worldbookReviewBrief(kernel, { project: "p-none" })).toThrow(/worldbook_index/);

    seedRun(root, "p-r4");
    fs.rmSync(path.join(root, "projects", "p-r4", "registry", "artifacts.json"));
    const bare = gateAssistBrief(kernel, { project: "p-r4", node: "m3.link" });
    expect(bare).toContain("本项目还没有登记产物");
    expect(bare).toContain("m3.link");
  });
});
