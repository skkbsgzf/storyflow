// pi-agent 的 MCP 内联：把用户配置的 MCP server（stdio）的工具接进对话流工具环。
// 配置 = <repoRoot>/.external/agent-mcp.json（gitignore 区，与 agent-model.json 同纪律）：
//   { "servers": [ { "name": "fetch", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-fetch"], "env": {} } ] }
// 工具名内联为 mcp__<server>__<tool>，避免与 miniflow 工具撞名。
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { FsIo } from "./abstraction/fs.js";
import { nodeFs, nodePath } from "./abstraction/defaults.js";

interface McpServerConf { name: string; command: string; args?: string[]; env?: Record<string, string> }
interface McpConn { client: Client; tools: { name: string; description?: string; inputSchema: unknown }[] }

// 相对 repoRoot 的配置位置，拼接交给注入的 path（模块级不许碰 node:path）
const CONFIG_REL = ".external/agent-mcp.json";

interface McpToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  server: string;
  tool: string;
}

export class AgentMcp {
  private conns = new Map<string, McpConn>();
  private loadedFrom: string | null = null;
  /** 配置读走注入的 io 束，缺省 = Node 适配器；换宿主的连接缓存各自一个实例（连接是进程级态，不跨实例共享）。 */
  constructor(private readonly io: FsIo = { fs: nodeFs, path: nodePath }) {}

  private conf(repoRoot: string): McpServerConf[] {
    try {
      const raw = JSON.parse(this.io.fs.readText(this.io.path.join(repoRoot, CONFIG_REL))) as { servers?: McpServerConf[] };
      return (raw.servers || []).filter((s) => s.name && s.command);
    } catch {
      return [];
    }
  }

  /** 惰性连接：配置变了（文件 mtime/内容）即重连，否则复用存活连接。 */
  private async ensure(repoRoot: string): Promise<Map<string, McpConn>> {
    const file = this.io.path.join(repoRoot, CONFIG_REL);
    let stamp: string | null = null;
    try { stamp = this.io.fs.readText(file); } catch { stamp = null; }
    if (stamp !== this.loadedFrom) {
      // 配置变了：全部重连（进程级缓存，不追增量）
      for (const [, conn] of this.conns) { try { await conn.client.close(); } catch { /* 幂等 */ } }
      this.conns.clear();
      this.loadedFrom = stamp;
      for (const conf of this.conf(repoRoot)) {
        try {
          const client = new Client({ name: "miniflow-pi-agent", version: "0.1.0" });
          const transport = new StdioClientTransport({ command: conf.command, args: conf.args || [], env: { ...(process.env as Record<string, string>), ...(conf.env || {}) } });
          await client.connect(transport);
          const listed = await client.listTools();
          this.conns.set(conf.name, {
            client,
            tools: (listed.tools || []).map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
          });
        } catch (e) {
          // 单个 server 挂了不拖垮其余——显式留痕在工具名里
          this.conns.set(conf.name, { client: null as unknown as Client, tools: [], });
          this.conns.get(conf.name)!.tools = [{
            name: "__unavailable__",
            description: `MCP server「${conf.name}」连接失败: ${e instanceof Error ? e.message : String(e)}`,
            inputSchema: { type: "object", properties: {} },
          }];
        }
      }
    }
    return this.conns;
  }

  async tools(repoRoot: string): Promise<McpToolDef[]> {
    const conns = await this.ensure(repoRoot);
    const out: McpToolDef[] = [];
    for (const [server, conn] of conns) {
      for (const t of conn.tools) {
        out.push({
          name: `mcp__${server}__${t.name}`,
          description: `[MCP·${server}] ${t.description || t.name}`,
          parameters: (t.inputSchema as Record<string, unknown>) || { type: "object", properties: {} },
          server,
          tool: t.name,
        });
      }
    }
    return out;
  }

  async call(repoRoot: string, server: string, tool: string, args: Record<string, unknown>): Promise<unknown> {
    const conns = await this.ensure(repoRoot);
    const conn = conns.get(server);
    if (!conn || !conn.client) throw new Error(`MCP server「${server}」未连接`);
    return await conn.client.callTool({ name: tool, arguments: args });
  }
}
