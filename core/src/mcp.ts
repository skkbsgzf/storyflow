// miniflow MCP 面：**动词表派生**的 tools（stdio transport）。交付不自动注册进宿主。
//
// R8-OPS 步骤 3：此前这里是 7 个手写 `registerTool`（list/run/next/submit/resume/gate/rerun），
// 与 CLI 的 13 个动词不同步 ⇒ `flow_init`（初始化面板的落点）/`flow_effect`/`flow_mine`/
// `skill_patch`/`flow_optimize`/`flow_overlay` 在 MCP 面上**根本不存在**。
// 现在改为逐条遍历 `VERBS` —— 新增动词只改 `verbs.ts` 一处，MCP 自动跟上。
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Kernel } from "./kernel.js";
import { VERBS, type VerbParam } from "./verbs.js";

const json = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }] });

/** 把动词表的一项参数描述折成 zod（MCP inputSchema 需要 zod 形状）。 */
export function zodOf(p: VerbParam): z.ZodTypeAny {
  let base: z.ZodTypeAny;
  switch (p.type) {
    case "number":
      base = z.number();
      break;
    case "boolean":
      base = z.boolean();
      break;
    case "record":
      base = z.record(z.string(), z.unknown());
      break;
    case "string[]":
      base = z.array(z.string());
      break;
    default:
      base = p.enum ? z.enum(p.enum as [string, ...string[]]) : z.string();
  }
  return p.required ? base : base.optional().describe(p.desc);
}

/** 动词表 → MCP tool 形状（导出以便单测断言「MCP 面 = 表」）。 */
export function verbToolSpecs(): { name: string; description: string; inputSchema: Record<string, z.ZodTypeAny> }[] {
  return VERBS.map((def) => {
    const inputSchema: Record<string, z.ZodTypeAny> = {};
    for (const p of def.params) inputSchema[p.name] = zodOf(p);
    // required 的参数把 desc 挂在 description 上（zod 的 .describe 对 optional 已用，这里对必填补一次）
    for (const p of def.params) if (p.required) inputSchema[p.name] = inputSchema[p.name].describe(p.desc);
    return { name: def.name, description: def.description, inputSchema };
  });
}

/** 构建 MCP server（不连接 transport）—— 单独导出以便测试用 in-memory transport 真握手。 */
export function buildMcpServer(kernel: Kernel): McpServer {
  const server = new McpServer({ name: "miniflow", version: "0.1.0" });

  const specs = verbToolSpecs();
  VERBS.forEach((def, i) => {
    server.registerTool(
      def.name,
      { description: def.description, inputSchema: specs[i].inputSchema as z.ZodRawShape },
      (async (args: Record<string, unknown>) => json(await def.run(kernel, args ?? {}))) as never,
    );
  });

  return server;
}

export async function startMcp(kernel: Kernel): Promise<void> {
  const server = buildMcpServer(kernel);
  await server.connect(new StdioServerTransport());
  console.error(`miniflow MCP server ready (stdio) · ${VERBS.length} verbs: ${VERBS.map((v) => v.name).join(", ")}`);
}

// 直接运行：tsx src/mcp.ts
if (process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("mcp.ts")) {
  startMcp(new Kernel()).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
