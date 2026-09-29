/* mcp-probe.mjs — 内核 MCP 面握手体检：initialize→tools/list→可选实调用，计时墙钟。
 * 用法：node scripts/mcp-probe.mjs [--call flow_list '{"flow":"..."}']  */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const callIdx = args.indexOf('--call');
const callSpec = callIdx >= 0 ? { name: args[callIdx + 1], args: JSON.parse(args[callIdx + 2] || '{}') } : null;

const t0 = Date.now();
const child = spawn(process.execPath, [path.join(ROOT, 'dist', 'mcp.js')], { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] });
let stderrBuf = '';
child.stderr.on('data', d => { stderrBuf += d; });
const pending = new Map();
let buf = '';
child.stdout.on('data', d => {
  buf += d; let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (!line) continue;
    let j; try { j = JSON.parse(line); } catch { continue; }
    if (pending.has(j.id)) { pending.get(j.id)(j); pending.delete(j.id); }
  }
});
let id = 0;
const rpc = (method, params, timeoutMs = 60000) => new Promise((resolve, reject) => {
  const n = ++id;
  pending.set(n, resolve);
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n');
  setTimeout(() => { if (pending.has(n)) { pending.delete(n); reject(new Error('timeout ' + method)); } }, timeoutMs);
});

const ms = () => Date.now() - t0;
try {
  const init = await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'probe', version: '0' } });
  console.log(`[+${ms()}ms] initialize → ${JSON.stringify(init.result?.serverInfo)}`);
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n');
  const tl = await rpc('tools/list', {});
  const tools = tl.result?.tools || [];
  console.log(`[+${ms()}ms] tools/list → ${tools.length} 动词: ${tools.map(t => t.name).join(', ')}`);
  if (callSpec) {
    const t = Date.now();
    const r = await rpc('tools/call', { name: callSpec.name, arguments: callSpec.args });
    console.log(`[+${ms()}ms] tools/call ${callSpec.name} 单次耗时 ${Date.now() - t}ms → isError=${r.result?.isError} 输出 ${String(r.result?.content?.[0]?.text || '').length} 字符`);
    console.log(String(r.result?.content?.[0]?.text || '').slice(0, 400));
  }
} catch (e) {
  console.error('PROBE FAIL:', e.message, '\nserver stderr:\n' + stderrBuf);
  process.exitCode = 1;
} finally {
  child.kill();
}
