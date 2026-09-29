#!/usr/bin/env node
/* bench.mjs — route/evaluate 延迟基准（deterministic-v0，无模型）。
 * 用法：node test/bench.mjs [轮数=200]。输出 avg / p50 / p95（毫秒）。 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, '..', 'src', 'server.mjs');
const N = Number(process.argv[2] || 200);
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'skillrouter-bench-'));

const child = spawn(process.execPath, [SERVER], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, SKILLROUTER_HOME: HOME } });
const pending = new Map();
let buf = '';
child.stdout.on('data', d => {
  buf += d.toString();
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
    if (!line) continue;
    let j; try { j = JSON.parse(line); } catch { continue; }
    const p = pending.get(j.id); if (p) { pending.delete(j.id); p(j); }
  }
});
let nextId = 1;
const rpc = (method, params) => new Promise((res, rej) => {
  const id = nextId++; pending.set(id, res);
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout ' + method)); } }, 8000);
});
const callTool = async (name, args) => {
  const r = await rpc('tools/call', { name, arguments: args });
  if (r.result?.isError) throw new Error(name + ': ' + r.result.content[0].text);
  return JSON.parse(r.result.content[0].text);
};

await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'bench', version: '0' } });
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n');

// 预热（JIT/文件缓存）+ 池子加大：把 miniflow-kernel 种子导入 8 份模拟 ~50 工具池
await callTool('route', { request: '预热' });
for (let i = 2; i <= 8; i++) {
  const tk = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'examples', 'demo.toolkit.json'), 'utf-8'));
  tk.name = 'kernel-copy-' + i;
  await callTool('register_toolkit', { toolkit: tk });
}
const reqs = [
  '把新写的章节产物交卷，然后看看下一步该派发什么任务',
  '扫描正文质量，找 AI 味和连续排比',
  '查询当前项目状态与剩余节点',
  '帮我订一张明天出行的火车票',
];
const times = [];
for (let i = 0; i < N; i++) {
  const t0 = performance.now();
  await callTool('route', { request: reqs[i % reqs.length], context: '创作流程' });
  times.push(performance.now() - t0);
}
times.sort((a, b) => a - b);
const stat = a => +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2);
const out = {
  pool_tools: (await callTool('list_toolkits', {})).toolkits.reduce((a, t) => a + t.tools_count, 0),
  rounds: N,
  avg_ms: stat(times),
  p50_ms: +times[Math.floor(N * 0.5)].toFixed(2),
  p95_ms: +times[Math.floor(N * 0.95)].toFixed(2),
  max_ms: +times[N - 1].toFixed(2),
};
console.log(JSON.stringify(out, null, 2));
child.kill();
fs.rmSync(HOME, { recursive: true, force: true });
