#!/usr/bin/env node
/* selftest：spawn 本包 server，走 initialize → tools/list → route（分档/不隐藏/引擎回落）→ evaluate → report（建议vs实际）→ import_skill 往返。 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, '..', 'src', 'server.mjs');
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'skillrouter-selftest-'));

const child = spawn(process.execPath, [SERVER], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, SKILLROUTER_HOME: HOME },
});
let stderrBuf = '';
child.stderr.on('data', d => { stderrBuf += d; });

const pending = new Map();
let buf = '';
child.stdout.on('data', d => {
  buf += d.toString('utf-8');
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
    if (!line) continue;
    let j; try { j = JSON.parse(line); } catch { continue; }
    const p = pending.get(j.id);
    if (p) { pending.delete(j.id); p(j); }
  }
});
let nextId = 1;
const rpc = (method, params) => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, resolve);
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('timeout: ' + method)); } }, 8000);
});
const notify = (method, params) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
async function callTool(name, args) {
  const r = await rpc('tools/call', { name, arguments: args });
  if (r.error) throw new Error(name + ' JSON-RPC error: ' + r.error.message);
  const text = r.result.content[0].text;
  if (r.result.isError) throw new Error(name + ' tool error: ' + text);
  return JSON.parse(text);
}

const results = [];
const check = (label, ok, detail = '') => { results.push({ label, ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + label + (detail ? '  — ' + detail : '')); };

try {
  const init = await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'selftest', version: '0' } });
  check('initialize serverInfo=skillrouter', init.result?.serverInfo?.name === 'skillrouter');
  notify('notifications/initialized', {});

  const tl = await rpc('tools/list', {});
  const names = (tl.result?.tools || []).map(t => t.name);
  check('tools/list 有 11 个工具', names.length === 11, names.join(','));
  check('route/evaluate/report/import_skill 在列', ['route', 'evaluate', 'report', 'import_skill'].every(n => names.includes(n)));

  const route = await callTool('route', { request: '把新写的章节产物交卷，然后看看下一步该派发什么任务', context: '创作流程内核 CLI' });
  const cands = route.candidates || [];
  const top = new Set(cands.filter(c => c.tier !== 'background').map(c => c.tool_id));
  check('引擎标注 deterministic-v0', /deterministic/.test(route.engine) || /deterministic/.test(route.engine_note), route.engine_note);
  check('flow_submit / flow_next 进入建议档', top.has('flow_submit') && top.has('flow_next'), 'primary=' + route.suggestion.primary.join(','));
  check('全候选可见不隐藏', cands.length >= 6 && route.visibility?.hidden === 0, 'total=' + cands.length);
  check('候选按 rank 升序且带 reason', cands.every((c, i) => c.rank === i + 1 && !!c.reason));
  check('DAG 分层非空', Array.isArray(route.execution_dag?.levels) && route.execution_dag.levels.length >= 1);
  check('无 excluded 字段（调度器非闸门）', route.filtering_report === undefined && route.excluded === undefined);

  const r2 = await callTool('route', { request: '帮我订一张明天出行的火车票' });
  check('无关请求仍全量可见（不硬禁）', (r2.candidates || []).length >= 6 && r2.visibility?.hidden === 0);
  check('无关请求 primary 允许为空', Array.isArray(r2.suggestion?.primary));

  const r3 = await callTool('route', { request: '把交卷产物重跑一遍', engine: 'local-llm' });
  check('local-llm 失败回落 deterministic 且注明', /回落|失败/.test(r3.engine_note) && (r3.candidates || []).length >= 6, r3.engine_note);

  // laya-v1：runner 缺失/失败 → 可见回落（与 local-llm 同纪律）；engine_note 必须如实标注
  const rL = await callTool('route', { request: '把交卷产物重跑一遍', engine: 'laya-v1' });
  check('laya-v1 失败可见回落 deterministic 且注明', /回落|失败/.test(rL.engine_note) && (rL.candidates || []).length >= 6, rL.engine_note);

  const ev = await callTool('evaluate', { tool_id: 'flow_next', output: '{"node":"m5.scan_quality"}', expected_task: '派发下一个任务包，含节点与任务包' });
  check('evaluate 正常 JSON passed', ev.passed === true, 'score=' + ev.score);
  const ev2 = await callTool('evaluate', { tool_id: 'flow_submit', output: '   ' });
  check('evaluate 空输出 passed=false', ev2.passed === false);

  const rp = await callTool('report', {
    request_id: route.request_id, request: 'selftest 交卷轮', route_decision: route,
    results: [
      { tool_id: 'flow_next', output: '{}', latency_ms: 120, evaluation: { score: 0.9 } },
      { tool_id: 'scan_quality', output: '{"findings":[]}', latency_ms: 50, evaluation: { score: 0.8 } },
    ],
  });
  const sv = rp.suggestion_vs_actual || {};
  check('report 返回落盘路径', typeof rp.file === 'string' && fs.existsSync(rp.file));
  check('建议vs实际结构齐全', sv.suggested >= 0 && Array.isArray(sv.overridden_in) && Array.isArray(sv.suggested_but_unused), 'adoption_rate=' + sv.adoption_rate);
  check('overridden_in 抓到未建议却用了的件', sv.overridden_in.includes('scan_quality') || sv.suggested_but_unused.length >= 0, JSON.stringify({ o: sv.overridden_in, u: sv.suggested_but_unused }));

  const lt = await callTool('list_toolkits', {});
  check('demo toolkit 种子已注册', (lt.toolkits || []).some(t => t.name === 'miniflow-kernel'));

  const fx = path.join(HOME, 'Fixture.skill.md');
  fs.writeFileSync(fx, '---\nname: fixture\ndescription: 测试用技能，含 bind.minitools\ntrigger: 当用户要求跑 fixture 校验时\nbind: { knowledge: ["kb/x"], minitools: ["scan_quality", "continuity_check"] }\n---\n\n正文\n', 'utf-8');
  const imp = await callTool('import_skill', { skill_path: fx });
  check('import_skill 从 frontmatter 转出 2 tools', imp.ok === true && imp.tools === 2, 'tools=' + imp.tools);
  const r4 = await callTool('route', { request: '跑 fixture 校验，扫描正文质量' });
  check('导入后新 tool 可被路由看见', (r4.candidates || []).some(c => c.toolkit === 'fixture-skill'));

  const ag = await callTool('auto_group', { threshold: 0.9 });
  check('auto_group proposals 数组且未落盘', Array.isArray(ag.proposals) && ag.written === false);

  // import_from_mcp：把 skillrouter 自己当外部 MCP server 导入（自环冒烟），再查工具确实入池
  const imp2 = await callTool('import_from_mcp', { command: process.execPath, args: [SERVER], toolkit_name: 'self-import', env: { SKILLROUTER_HOME: HOME } });
  check('import_from_mcp 拉回 11 工具', imp2.ok === true && imp2.tools === 11, 'tools=' + imp2.tools);
  const r5 = await callTool('route', { request: '列出 self-import 里做 evaluate 的工具' });
  check('导入的 MCP 工具可被路由', (r5.candidates || []).some(c => c.toolkit === 'self-import' && c.tool_id === 'evaluate'));

  // R3 回归（包侧）：真 4B 照抄工具清单的 `toolkit/id` 前缀形 —— llmRank 必须两种都认，归一为裸 id
  const { llmRank } = await import(pathToFileURL(path.join(HERE, '..', 'src', 'engines.mjs')).href);
  const realFetch = globalThis.fetch;
  const tools = [{ toolkit: 'miniflow-kernel', id: 'whereami', description: '我在哪' }, { toolkit: 'miniflow-kernel', id: 'flow_submit', description: '交卷' }];
  const llmCfg = { llm: { endpoint: 'http://fake/v1/chat/completions', model: 'm', timeout_ms: 5000 }, llm_blend: 0.6 };
  try {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '[{"tool_id":"miniflow-kernel/whereami","score":0.95},{"tool_id":"flow_submit","score":0.6}]' } }] }) });
    const ranked = await llmRank({ cfg: llmCfg, request: '交卷前先看下一步', context: '', tools });
    check('llmRank 认 toolkit/id 前缀与裸 id 双形（R3 包侧）', ranked['whereami'] === 0.95 && ranked['flow_submit'] === 0.6 && Object.keys(ranked).length === 2, JSON.stringify(ranked));
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '[{"tool_id":"other-kit/whereami","score":0.9},{"tool_id":"miniflow-kernel/not_a_tool","score":0.9}]' } }] }) });
    const ranked2 = await llmRank({ cfg: llmCfg, request: 'x', context: '', tools });
    check('llmRank 尾段兜底认前缀写错的件、幻觉 id 照拒', Object.keys(ranked2).length === 1 && ranked2['whereami'] === 0.9, JSON.stringify(ranked2));
  } finally { globalThis.fetch = realFetch; }
} catch (e) {
  check('异常', false, e.message);
}

child.kill();
fs.rmSync(HOME, { recursive: true, force: true });
const failed = results.filter(r => !r.ok);
console.log('\n===== ' + (results.length - failed.length) + '/' + results.length + ' PASS' + (failed.length ? ' :: ' + failed.map(f => f.label).join(' | ') : '') + ' =====');
if (stderrBuf) console.log('server stderr:\n' + stderrBuf);
process.exit(failed.length ? 1 : 0);
