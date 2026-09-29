#!/usr/bin/env node
/* skillrouter-mcp · stdio MCP server (zero dependency, newline-delimited JSON-RPC 2.0)
 * 定位：建议制 Tool 调度器。route 排序不裁决，evaluate 只出确定性信号，report 回填建议vs实际。 */
import readline from 'node:readline';
import {
  route, evaluate, report, registerToolkit, importSkill, importModuleJson, importFromMcp,
  createGroup, listGroups, autoGroup, listToolkitsView, ensureSeed,
} from './core.mjs';
import { llmRank, layaRank } from './engines.mjs';

const TOOLS = [
  ['route', '上下文感知的 Tool 调度建议：返回全量候选排序 + primary/secondary/background 分档 + DAG；永不隐藏或禁用工具', { type: 'object', properties: { request: { type: 'string' }, context: { type: 'string' }, group_filter: { type: 'array', items: { type: 'string' } }, engine: { type: 'string', enum: ['deterministic-v0', 'local-llm', 'laya-v1'] } }, required: ['request'] }],
  ['evaluate', 'Tool 执行后的确定性质量信号（非语义判决）', { type: 'object', properties: { tool_id: { type: 'string' }, output: { type: 'string' }, expected_task: { type: 'string' }, checks: { type: 'array' } }, required: ['tool_id', 'output'] }],
  ['report', '聚合执行报告并落 execution_history，回填 suggestion_vs_actual（自进化信号）', { type: 'object', properties: { request_id: { type: 'string' }, request: { type: 'string' }, route_decision: { type: 'object' }, results: { type: 'array' } } }],
  ['list_toolkits', '列出已注册 Tool Kit 与工具计数', { type: 'object', properties: {} }],
  ['register_toolkit', '注册/覆盖一个 Tool Kit（JSON，含 name/tools[]）', { type: 'object', properties: { toolkit: { type: 'object' } }, required: ['toolkit'] }],
  ['import_skill', 'SKILL.md → tool 池：解析 frontmatter 的 tools 或 bind.minitools 注册成 toolkit', { type: 'object', properties: { skill_path: { type: 'string' }, name: { type: 'string' } }, required: ['skill_path'] }],
  ['import_module_json', '从 capability 注册表 module.json 单向导入（不写回源文件）', { type: 'object', properties: { module_path: { type: 'string' } }, required: ['module_path'] }],
  ['import_from_mcp', '连接一个 stdio MCP server，把它的 tools/list 整体导入为 toolkit（唯一事实源=该 server；幂等覆盖）', { type: 'object', properties: { command: { type: 'string' }, args: { type: 'array', items: { type: 'string' } }, toolkit_name: { type: 'string' }, env: { type: 'object' }, id_prefix: { type: 'string' } }, required: ['command'] }],
  ['create_group', '创建 Tool Kit 分组', { type: 'object', properties: { name: { type: 'string' }, toolkits: { type: 'array', items: { type: 'string' } }, auto_activate_on: { type: 'array', items: { type: 'string' } }, description: { type: 'string' } }, required: ['name', 'toolkits'] }],
  ['list_groups', '列出现有分组', { type: 'object', properties: {} }],
  ['auto_group', '按标签相似度建议分组；confirm=true 才落盘', { type: 'object', properties: { threshold: { type: 'number' }, confirm: { type: 'boolean' } } }],
];

async function dispatch(name, a = {}) {
  switch (name) {
    case 'route': return route(a, llmRank, layaRank);
    case 'evaluate': return evaluate(a);
    case 'report': return report(a);
    case 'list_toolkits': return listToolkitsView();
    case 'register_toolkit': return registerToolkit(a.toolkit);
    case 'import_skill': return importSkill(a);
    case 'import_module_json': return importModuleJson(a);
    case 'import_from_mcp': return await importFromMcp(a);
    case 'create_group': return createGroup(a);
    case 'list_groups': return listGroups();
    case 'auto_group': return autoGroup(a);
    default: throw new Error('unknown tool: ' + name);
  }
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', async (line) => {
  let j; try { j = JSON.parse(line); } catch { return; }
  const { id, method, params } = j;
  const send = (o) => process.stdout.write(JSON.stringify(o) + '\n');
  if (method === 'initialize') return send({ jsonrpc: '2.0', id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'skillrouter', version: '0.2.1' } } });
  if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
  if (!id && id !== 0) return; // notifications
  if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: TOOLS.map(([name, description, inputSchema]) => ({ name, description, inputSchema })) } });
  if (method === 'tools/call') {
    try { const r = await dispatch(params.name, params.arguments || {}); return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(r, null, 1) }], isError: false } }); }
    catch (e) { return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'ERROR: ' + e.message }], isError: true } }); }
  }
  return send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'method not found: ' + method } });
});
ensureSeed();
