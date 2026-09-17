// miniflow MCP 面：七动词暴露为 tools（stdio transport）。交付不自动注册进宿主。
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Kernel } from "./kernel.js";

const json = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }] });

export async function startMcp(kernel: Kernel): Promise<void> {
  const server = new McpServer({ name: "miniflow", version: "0.1.0" });

  server.registerTool("flow_list", { description: "列出全部 flow（flow@1 描述符）" }, async () =>
    json(kernel.flow_list()),
  );

  server.registerTool(
    "flow_run",
    {
      description: "为项目开跑一条 flow（现网 run-state.json 自动迁移）",
      inputSchema: { flow: z.string(), project: z.string(), inputs: z.record(z.string(), z.unknown()).optional() },
    },
    async ({ flow, project, inputs }) => json(await kernel.flow_run(flow, project, inputs ?? {})),
  );

  server.registerTool(
    "flow_next",
    {
      description:
        "推进到下一停靠点：awaiting_input（宿主领任务包）/ suspended（门挂起）/ blocked / completed。spawn_prompt=true 时附带渲染好的规范派发头（含项目背景卡，可直接作为 subagent 的 prompt）",
      inputSchema: { project: z.string(), spawn_prompt: z.boolean().optional() },
    },
    async ({ project, spawn_prompt }) => json(await kernel.flow_next(project, { spawnPrompt: spawn_prompt })),
  );

  server.registerTool(
    "flow_submit",
    {
      description: "提交认知步产物（完整性断言不过 = rejected 打回；iterate 节点逐实例提交，seal 收口置 done）",
      inputSchema: {
        project: z.string(),
        node: z.string(),
        content: z.string().optional(),
        file: z.string().optional(),
        notes: z.string().optional(),
        seal: z.boolean().optional(),
      },
    },
    async ({ project, node, content, file, notes, seal }) =>
      json(await kernel.flow_submit(project, node, { content, file, notes, seal })),
  );

  server.registerTool(
    "flow_resume",
    { description: "崩溃/失败后恢复（恢复不读图，沿用快照内计划）", inputSchema: { project: z.string() } },
    async ({ project }) => json(await kernel.flow_resume(project)),
  );

  server.registerTool(
    "flow_gate",
    {
      description: "提交人工裁决（pass/pass-with-conditions/send-back/reject；send-back 级联失效）",
      inputSchema: {
        project: z.string(),
        nodeId: z.string(),
        verdict: z.enum(["pass", "pass-with-conditions", "send-back", "reject"]),
        comment: z.string().optional(),
        rootCauseStage: z.string().optional(),
        round: z.number().optional(),
        token: z.string().optional(),
      },
    },
    async ({ project, nodeId, verdict, comment, rootCauseStage, round, token }) =>
      json(await kernel.flow_gate(project, { nodeId, verdict, comment, rootCauseStage, round, token })),
  );

  server.registerTool(
    "flow_rerun",
    {
      description: "重跑范围推演/执行",
      inputSchema: { project: z.string(), nodeId: z.string(), dryRun: z.boolean().optional() },
    },
    async ({ project, nodeId, dryRun }) => json(await kernel.flow_rerun(project, { nodeId, dryRun })),
  );

  await server.connect(new StdioServerTransport());
  console.error("miniflow MCP server ready (stdio)");
}

// 直接运行：tsx src/mcp.ts
if (process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("mcp.ts")) {
  startMcp(new Kernel()).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
