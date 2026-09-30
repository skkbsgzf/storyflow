// miniflow MCP 面：**动词表派生**的 tools（stdio transport）。交付不自动注册进宿主。
//
// R8-OPS 步骤 3：此前这里是 7 个手写 `registerTool`（list/run/next/submit/resume/gate/rerun），
// 与 CLI 的 13 个动词不同步 ⇒ `flow_init`（初始化面板的落点）/`flow_effect`/`flow_mine`/
// `skill_patch`/`flow_optimize`/`flow_overlay` 在 MCP 面上**根本不存在**。
// 现在改为逐条遍历 `VERBS` —— 新增动词只改 `verbs.ts` 一处，MCP 自动跟上。
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Kernel } from "./kernel.js";
import { ROOT } from "./schema.js";
import { VERBS, type VerbParam } from "./verbs.js";

const json = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }] });

/**
 * BETA 期 MCP 面动词调用留痕：与 `core/src/cli.ts` 写同一处 `trace/cli.jsonl`（同形状 + `via:"mcp"`）。
 * 为什么要写：内核动作自 A#23 起改走 MCP 面，而留痕原来只在 CLI 出口——
 * 走 MCP 的一轮在台账上等于"什么都没干"，`tools/method-brief.mjs` 的工具账会整体瞎掉。
 * 旁路纪律照旧：BETA 不在位就什么都不写；写失败静默，绝不影响动词返回（长参数截断，别把正文灌进台账）。
 */
function traceMcp(verb: string, args: Record<string, unknown>, ms: number, exit: number): void {
  try {
    if (!fs.existsSync(path.join(ROOT, "BETA"))) return;
    const argv = [verb];
    for (const [k, v] of Object.entries(args ?? {})) {
      if (v === undefined || v === null || v === false) continue;
      argv.push(`--${k}`, (typeof v === "string" ? v : JSON.stringify(v)).slice(0, 120));
    }
    const dir = path.join(ROOT, "trace");
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(
      path.join(dir, "cli.jsonl"),
      JSON.stringify({
        ts: new Date().toISOString(),
        verb,
        argv,
        project: typeof args?.project === "string" ? args.project : null,
        exit,
        ms,
        via: "mcp",
      }) + "\n",
    );
  } catch {
    /* 旁路 */
  }
}

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
    for (const p of def.params) {
      const sch = inputSchema[p.name];
      if (p.required && sch) inputSchema[p.name] = sch.describe(p.desc);
    }
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
      { description: def.description, inputSchema: specs[i]?.inputSchema as z.ZodRawShape },
      (async (args: Record<string, unknown>) => {
        const t0 = Date.now();
        try {
          const out = await def.run(kernel, args ?? {});
          traceMcp(def.name, args ?? {}, Date.now() - t0, 0);
          return json(out);
        } catch (e) {
          traceMcp(def.name, args ?? {}, Date.now() - t0, 1);
          throw e;
        }
      }) as never,
    );
  });

  return server;
}

export async function startMcp(kernel: Kernel): Promise<void> {
  const server = buildMcpServer(kernel);
  await server.connect(new StdioServerTransport());
  console.error(`miniflow MCP server ready (stdio) · ${VERBS.length} verbs: ${VERBS.map((v) => v.name).join(", ")}`);
}

// 直接运行：tsx src/mcp.ts 或 node dist/mcp.js（dist 后缀也要能自启动，宿主注册走这条路）
if (process.argv[1] && /mcp\.(ts|js)$/.test(process.argv[1].replace(/\\/g, "/"))) {
  startMcp(new Kernel()).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
