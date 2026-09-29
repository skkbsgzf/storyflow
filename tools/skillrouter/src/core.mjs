/* core.mjs — registry, scoring, ranking route, evaluate, report (suggestion-vs-actual), groups, importers.
 * Design stance: this is an ADVISORY scheduler, not a gate. route() never hides or disables a tool;
 * it only ranks and tiers. The agent has final say; report() records 建议 vs 实际 as self-evolution fuel. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

export const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const HOME = process.env.SKILLROUTER_HOME || path.join(os.homedir(), '.skillrouter');
export const DIRS = {
  toolkits: path.join(HOME, 'toolkits'),
  registry: path.join(HOME, 'registry.json'),
  groups: path.join(HOME, 'skill_groups.json'),
  history: path.join(HOME, 'execution_history'),
  config: path.join(HOME, 'config.json'),
};
for (const d of [DIRS.toolkits, DIRS.history]) fs.mkdirSync(d, { recursive: true });

/* ---------- utils ---------- */
const CJK_STOP = ['的', '了', '吗', '呢', '是', '把', '和', '与', '就', '都', '不', '在', '一', '个', '这', '他', '她', '它', '我', '你', '到', '为', '及', '等', '请', '帮', '我', '一下', '这个', '那个', '如果', '因为', '所以'];
const STOP = new Set(CJK_STOP.concat('the a an to of and or for with is are be what'.split(' ')));
export function tokens(s) {
  if (!s) return [];
  s = String(s).toLowerCase();
  const out = new Set();
  for (const m of s.matchAll(/[a-z][a-z0-9_.\-]{1,30}|\d{2,}/g)) out.add(m[0]);
  for (const run of s.match(/[\u4e00-\u9fff]+/g) || []) {
    if (run.length === 1) { if (!STOP.has(run)) out.add(run); continue; }
    for (let i = 0; i < run.length - 1; i++) { const bg = run.slice(i, i + 2); if (!STOP.has(bg[0]) || !STOP.has(bg[1])) out.add(bg); }
  }
  return [...out];
}
export const readJSON = (p, fb) => { try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return fb; }; };
export const writeJSON = (p, o) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(o, null, 2)); };
export const nowISO = () => new Date().toISOString().replace(/\.\d+Z$/, '').replace('T', ' ');
export const rid = () => 'req_' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '_' + Math.random().toString(36).slice(2, 8);

export function getConfig() {
  const c = readJSON(DIRS.config, {});
  return {
    engine: c.engine || 'deterministic-v0',
    llm: { endpoint: 'http://127.0.0.1:8080/v1/chat/completions', model: 'local', timeout_ms: 15000, ...(c.llm || {}) },
    laya: { python: 'python', model_dir: 'convaiinnovations/laya', subfolder: 'multilingual', ...(c.laya || {}) },
    llm_blend: c.llm_blend ?? 0.6,
    thresholds: { required: 0.7, optional: 0.5, ...(c.thresholds || {}) },
    seed_file: c.seed_file || path.join(PKG_ROOT, 'examples', 'demo.toolkit.json'),
  };
}

/* ---------- registry ---------- */
function loadRegistry() { return readJSON(DIRS.registry, { toolkits: [] }); }
function saveRegistry(r) { writeJSON(DIRS.registry, r); }
export function allTools() {
  const out = [];
  for (const e of loadRegistry().toolkits) {
    const tk = readJSON(path.join(DIRS.toolkits, path.basename(e.file)), null);
    if (tk) for (const t of tk.tools || []) out.push({ ...t, toolkit: tk.name, _tk: tk });
  }
  return out;
}
function histPriors() {
  const agg = {};
  const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (f.name.endsWith('.json')) { const r = readJSON(p, null); if (r) for (const x of r.tools_performance || []) { (agg[x.tool] ||= []).push(x.quality_actual ?? null); } } } };
  try { walk(DIRS.history); } catch { }
  const pri = {};
  for (const [k, v] of Object.entries(agg)) { const g = v.filter(x => x != null); if (g.length) pri[k] = g.reduce((a, b) => a + b, 0) / g.length; }
  return pri;
}
let seeded = false;
export function ensureSeed() {
  if (seeded) return; seeded = true;
  const reg = loadRegistry();
  if (reg.toolkits.length) return;
  const cfg = getConfig();
  if (cfg.seed_file && fs.existsSync(cfg.seed_file)) {
    try { registerToolkit(readJSON(cfg.seed_file, null)); } catch { /* bad seed file: stay empty, honest */ }
  }
}

/* ---------- toolkit ops ---------- */
export function registerToolkit(tk) {
  if (!tk?.name || !Array.isArray(tk.tools) || !tk.tools.length) throw new Error('toolkit 需含 name 与非空 tools[]');
  for (const t of tk.tools) if (!t.id || !t.description) throw new Error(`tool ${t.id || '?'} 缺 id/description`);
  const file = path.join(DIRS.toolkits, tk.name + '.json');
  writeJSON(file, tk);
  const reg = loadRegistry();
  reg.toolkits = reg.toolkits.filter(e => e.name !== tk.name);
  reg.toolkits.push({ name: tk.name, source_skill: tk.source_skill || '', version: tk.version || '0', tools_count: tk.tools.length, capability_tags: tk.capability_tags || [], file: path.basename(file) });
  saveRegistry(reg);
  return { ok: true, toolkit: tk.name, tools: tk.tools.length };
}

/* SKILL.md frontmatter: flat `k: v`, block lists `- item`, inline quasi-JSON maps (`bind: { a: [..] }`) */
function parseFrontmatter(text) {
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return {};
  const fm = {}; let pending = null;
  for (const raw of m[1].split(/\r?\n/)) {
    const l = raw.replace(/\s+$/, '');
    if (!l.trim() || l.trim().startsWith('#')) continue;
    if (/^\s*-\s+/.test(l)) { if (pending) pending.list.push(l.replace(/^\s*-\s+/, '').trim()); continue; }
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(l);
    if (!kv) continue;
    const [, k, vRaw] = kv; const v = vRaw.trim();
    if (!v) { pending = { key: k, list: [] }; fm[k] = pending; continue; }
    pending = null;
    if (v.startsWith('{')) { try { fm[k] = JSON.parse(v.replace(/([{,])\s*([A-Za-z_][\w-]*)\s*:/g, '$1"$2":')); continue; } catch { } }
    fm[k] = v.replace(/^["']|["']$/g, '');
  }
  for (const [k, v] of Object.entries(fm)) if (v && Array.isArray(v.list)) fm[k] = v.list;
  return fm;
}

/* ASCII-slug 优先：CJK 标题不进 id，回落文件名 */
function slug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }

/* skill → tool 转换入口：一个 SKILL.md = 一个 toolkit；tools 取 frontmatter.tools 或 bind.minitools */
export function importSkill({ skill_path, name = null }) {
  if (!fs.existsSync(skill_path)) throw new Error('SKILL.md 读不到: ' + skill_path);
  const fm = parseFrontmatter(fs.readFileSync(skill_path, 'utf-8'));
  const raw = fm.tools || fm.bind?.minitools || [];
  const list = Array.isArray(raw) ? raw : [raw];
  const tools = list.map(entry => {
    if (entry && typeof entry === 'object') return { id: entry.id || entry.name, name: entry.name || entry.id, description: entry.description || fm.description || String(entry.id || entry.name), keywords: entry.keywords || [], implementation: entry.implementation || 'declared', depends_on: entry.depends_on || [], semif_checks: entry.semif_checks || [] };
    const s = String(entry); const colon = s.indexOf(':');
    const id = (colon > 0 ? s.slice(0, colon) : s).trim();
    return { id, name: id, description: (colon > 0 ? s.slice(colon + 1) : (fm.description || id)).trim(), keywords: tokens([fm.trigger, fm.name].filter(Boolean).join(' ')), implementation: 'declared', depends_on: [], semif_checks: [] };
  }).filter(t => t.id);
  if (!tools.length) throw new Error('未找到可转换的 tool：支持 frontmatter 的 tools: 列表或 bind.minitools:（本文件有 ' + Object.keys(fm).join(',') + '）');
  const tkName = slug(name) || slug(fm.name) || slug(path.basename(skill_path).replace(/\.(md|json)$/i, '')) || slug(path.basename(path.dirname(skill_path))) || 'skill';
  return registerToolkit({
    name: tkName + '-skill',
    source_skill: skill_path, version: fm.version || '1',
    capability_tags: tokens([fm.name, fm.trigger, fm.description].filter(Boolean).join(' ')).slice(0, 12),
    tools,
  });
}

/* modules/<x>/module.json 单向读入（不写回） */export function importModuleJson({ module_path }) {
  const m = readJSON(module_path, null); if (!m) throw new Error('module.json 读不到: ' + module_path);
  const ops = Object.entries(m.ops || m.tools || {});
  const tk = {
    name: (m.id || path.basename(path.dirname(module_path))) + '-module', source_skill: module_path, version: m.version || '1',
    capability_tags: tokens(m.id || '').concat(['module']),
    tools: ops.map(([id, o]) => ({ id, name: o.title || id, description: o.description || id,
      // 冷启动排序关键词面：op 无显式 keywords 时从标题+描述提取中文 bigram（否则中文查询恒 background）
      keywords: (o.keywords && o.keywords.length) ? o.keywords : tokens((o.title || '') + ' ' + (o.description || '')).slice(0, 12),
      implementation: o.implementation || 'planned', depends_on: o.depends_on || [], semif_checks: [] })),
  };
  if (!tk.tools.length) throw new Error('module.json 无 ops 可导入');
  return registerToolkit(tk);
}

/* 从一个 stdio MCP server 拉 tools/list → 注册成 toolkit（工具池唯一事实源=那个 server）。
 * 这是「MCP 化之后管住 MCP 池」的入口：内核/别的宿主服务只要说 MCP，就能进调度面。 */
export async function importFromMcp({ command, args = [], toolkit_name, env = {}, id_prefix = '' }) {
  if (!command) throw new Error('import_from_mcp 需要 command');
  const { spawn } = await import('node:child_process');
  const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...env } });
  const pend = new Map();
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d; let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      let j; try { j = JSON.parse(line); } catch { continue; }
      if (pend.has(j.id)) { pend.get(j.id)(j); pend.delete(j.id); }
    }
  });
  let err = ''; child.stderr.on('data', (d) => { err += d; });
  const rpc = (method, params, ms = 15000) => new Promise((res, rej) => {
    const n = pend.size + 1;
    pend.set(n, res);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n');
    setTimeout(() => { if (pend.has(n)) { pend.delete(n); rej(new Error('timeout ' + method + (err ? ' | stderr: ' + err.slice(0, 300) : ''))); } }, ms);
  });
  try {
    const init = await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'skillrouter-import', version: '0' } });
    const serverInfo = init.result?.serverInfo || {};
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n');
    const tl = await rpc('tools/list', {});
    const list = (tl.result?.tools || []).map(t => ({
      id: (id_prefix || '') + t.name, name: t.name,
      description: String(t.description || t.name).slice(0, 400),
      keywords: tokens(String(t.description || '') + ' ' + t.name).slice(0, 12),
      implementation: JSON.stringify({ command, args }),
      depends_on: [], semif_checks: [],
    }));
    if (!list.length) throw new Error('该 server tools/list 为空');
    const name = toolkit_name || slug(serverInfo.name) || slug(command);
    const out = registerToolkit({
      name, source_skill: `mcp:${command} ${args.join(' ')}`.trim(),
      version: serverInfo.version || '0', capability_tags: tokens(`${serverInfo.name || name} ${list.map(t => t.name).join(' ')}`).slice(0, 16),
      tools: list,
    });
    return { ...out, source_server: serverInfo, note: 'tools/list 快照导入；server 侧动词变更需重跑本导入（幂等覆盖同名 toolkit）' };
  } finally { child.kill(); }
}

/* ---------- deterministic scorer（cold-start / no-model fallback） ---------- */
function scoreTool(tool, qSet, ctxSet, priors, activatedKits) {
  const tagSet = new Set(tokens((tool._tk.capability_tags || []).join(' ')));
  const kwSet = new Set(tokens((tool.keywords || []).join(' ')));
  const descSet = new Set(tokens(tool.description + ' ' + tool.id));
  const hit = (set) => { let h = 0; for (const t of set) if (qSet.has(t)) h++; return h; };
  const tagScore = Math.min(1, (hit(tagSet) + hit(kwSet)) / 2);
  /* 查询侧归一：命中了几个查询词 ÷ 查询规模——长描述不再自带分母惩罚（否则中文长 desc 恒 0 分，
   * 实测内核 20 动词导入后全部跌进 background）。命中 1/4 即满分上限。 */
  let descScore = Math.min(1, hit(descSet) / Math.max(1, Math.min(qSet.size, 8) * 0.25));
  const idTok = tokens(tool.id); if (idTok.length && qSet.size && idTok.every(t => qSet.has(t) || ctxSet.has(t))) descScore = Math.max(descScore, 0.9);
  const hist = priors[tool.id] ?? 0.6;
  let s = 0.55 * tagScore + 0.3 * descScore + 0.15 * hist;
  if (activatedKits.has(tool.toolkit)) s += 0.15;
  return { score: +Math.min(1, s).toFixed(3), parts: { tag: +tagScore.toFixed(2), desc: +descScore.toFixed(2), hist: +hist.toFixed(2) } };
}

/* ---------- route：全候选排序，只分档不禁用 ---------- */
export async function route({ request, context = '', group_filter = null, engine = null }, llmRank, layaRank) {
  ensureSeed();
  const cfg = getConfig();
  const eng = engine || cfg.engine;
  const qSet = new Set(tokens(request)), ctxSet = new Set(tokens(context));
  const groups = readJSON(DIRS.groups, { groups: [] }).groups || [];
  const activatedKits = new Set();
  for (const g of groups) {
    const on = new Set(tokens((g.auto_activate_on || []).join(' ')));
    let hit = 0; for (const t of on) if (qSet.has(t) || ctxSet.has(t)) hit++;
    if (hit >= 1) for (const k of g.toolkits) activatedKits.add(k);
  }
  let tools = allTools();
  if (group_filter?.length) { const allow = new Set(group_filter.flatMap(g => (groups.find(x => x.name === g)?.toolkits) || [])); tools = tools.filter(t => allow.has(t.toolkit)); }
  const priors = histPriors();
  const scored = tools.map(t => ({ t, ...scoreTool(t, qSet, ctxSet, priors, activatedKits) }));

  /* conditional branch：命中只降权/升权，不隐藏 */
  const branchDemote = new Set(), branchBoost = new Set();
  for (const t of tools) for (const b of t._tk.orchestration?.conditional_branches || []) {
    const bt = tokens(b.condition); let h = 0; for (const x of bt) if (qSet.has(x)) h++;
    if (bt.length && h / bt.length >= 0.5) {
      (b.skip || []).forEach(s => branchDemote.add(`${t.toolkit}/${s}`));
      (b.use ? (Array.isArray(b.use) ? b.use : [b.use]) : []).forEach(u => branchBoost.add(`${t.toolkit}/${u}`));
    }
  }

  let llm = null, engine_note = '';
  if (eng === 'local-llm') {
    try { llm = await llmRank({ cfg, request, context, tools }); engine_note = `local-llm 排序，与确定性按 blend ${cfg.llm_blend} 混合`; }
    catch (e) { engine_note = `local-llm 失败，回落 deterministic-v0：${e.message}`; }
  } else if (eng === 'laya-v1') {
    try { llm = await layaRank({ cfg, request, context, tools }); engine_note = `laya-v1（typed 单前向）排序，与确定性按 blend ${cfg.llm_blend} 混合`; }
    catch (e) { engine_note = `laya-v1 失败，回落 deterministic-v0：${e.message}`; }
  } else engine_note = 'deterministic-v0（无模型冷启动口径）';

  const cands = scored.map(({ t, score: s, parts }) => {
    let final = s, llmScore = null;
    if (llm && llm[t.id] != null) { llmScore = llm[t.id]; final = cfg.llm_blend * llmScore + (1 - cfg.llm_blend) * s; }
    const key = `${t.toolkit}/${t.id}`;
    let reason = llmScore != null ? '小模型排序+确定性混合' : '确定性相关性';
    if (branchDemote.has(key)) { final = Math.min(final, 0.2); reason = '条件分支建议降权（仍可见可用）'; }
    if (branchBoost.has(key)) { final = Math.max(final, 0.55); reason = '条件分支建议优先'; }
    return { tool_id: t.id, toolkit: t.toolkit, relevance: +final.toFixed(3), score_parts: { ...parts, llm: llmScore }, rank: 0, tier: 'background', reason };
  });
  cands.sort((a, b) => b.relevance - a.relevance);
  const th = cfg.thresholds;
  cands.forEach((c, i) => { c.rank = i + 1; c.tier = c.relevance >= th.required ? 'primary' : c.relevance >= th.optional ? 'secondary' : 'background'; });
  const byId = new Map(scored.map(o => [o.t.id, o.t]));
  for (const c of cands.filter(x => x.tier !== 'background')) {
    for (const d of (byId.get(c.tool_id)?.depends_on) || []) {
      const dep = cands.find(x => x.tool_id === d); if (dep && dep.tier === 'background') { dep.tier = 'secondary'; dep.reason = '依赖拉入（被 ' + c.tool_id + ' 需要）'; }
    }
  }
  const suggestion = { primary: cands.filter(c => c.tier === 'primary').map(c => c.tool_id), secondary: cands.filter(c => c.tier === 'secondary').map(c => c.tool_id) };
  const sel = [...suggestion.primary, ...suggestion.secondary];
  const levels = []; let rest = new Set(sel);
  while (rest.size) { const lvl = [...rest].filter(id => ((byId.get(id)?.depends_on) || []).every(d => !rest.has(d))); if (!lvl.length) { levels.push([...rest]); break; } levels.push(lvl); lvl.forEach(i => rest.delete(i)); }
  return {
    request_id: rid(), at: nowISO(), engine: eng, engine_note,
    candidates: cands, suggestion,
    execution_dag: { levels },
    visibility: { total: cands.length, hidden: 0, note: '建议制调度：永不隐藏或禁用工具，只排序分档；agent 终裁' },
    groups_activated: [...activatedKits],
    disclaimer: '排序是建议不是裁决；false_negative 由 report 的 suggestion_vs_actual 回填，勿把本数字当准确率',
  };
}

/* ---------- evaluate：确定性信号；语义判决归 agent/判官 ---------- */
export function evaluate({ tool_id, output = '', expected_task = '', checks = [] }) {
  const nonEmpty = output && output.trim().length > 0 ? 1 : 0;
  let jsonOk = null; const trimmed = String(output).trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) { try { JSON.parse(trimmed); jsonOk = 1; } catch { jsonOk = 0; } }
  const et = new Set(tokens(expected_task)); let coverage = 0;
  if (et.size) { const oSet = new Set(tokens(output)); let h = 0; for (const t of et) if (oSet.has(t)) h++; coverage = +(h / et.size).toFixed(2); }
  const score = +(0.4 * nonEmpty + 0.3 * coverage + 0.3 * (jsonOk ?? 1)).toFixed(2);
  const feedback = [!nonEmpty && '输出为空', jsonOk === 0 && '声称 JSON 但解析失败', coverage < 0.3 && `与子任务词面覆盖率仅 ${coverage}（字面口径，非语义判决）`].filter(Boolean).join('；') || '确定性检查全过';
  return { tool_id, passed: nonEmpty === 1 && score >= 0.5, score, signals: { nonEmpty, jsonOk, coverage }, feedback, engine: 'deterministic-v0', semif_checks_deferred: checks, note: 'semantic quality 归主 agent/判官复核，此处仅确定性信号' };
}

/* ---------- report：落历史 + 建议vs实际（自进化燃料） ---------- */
export function report({ request_id = rid(), at = nowISO(), request = '', route_decision = null, results = [] }) {
  const all = allTools();
  const injectedChars = results.reduce((a, r) => a + (String(r.output || '').length + (all.find(t => t.id === r.tool_id)?.implementation || '').length), 0);
  const fullChars = all.reduce((a, t) => a + (t.implementation || '').length, 0) || 1;
  const tp = results.map(r => {
    const rd = (route_decision?.candidates || []).find(x => x.tool_id === r.tool_id);
    const q = r.evaluation?.score ?? null;
    return { tool: r.tool_id, relevance_prediction: rd?.relevance ?? null, predicted_tier: rd?.tier ?? null, quality_actual: q, prediction_accuracy: rd && q != null ? +(1 - Math.abs(rd.relevance - q)).toFixed(2) : null, used: r.used !== false, latency_ms: r.latency_ms ?? null, retries: r.retries ?? 0 };
  });
  const suggested = new Set(((route_decision?.suggestion?.primary) || []).concat(route_decision?.suggestion?.secondary || []));
  const used = new Set(results.filter(r => r.used !== false).map(r => r.tool_id));
  const adopted = [...used].filter(x => suggested.has(x));
  const suggestion_vs_actual = {
    suggested: suggested.size, used: used.size, adopted: adopted.length,
    adoption_rate: suggested.size ? +(adopted.length / suggested.size).toFixed(2) : null,
    overridden_in: [...used].filter(x => !suggested.has(x)),
    suggested_but_unused: [...suggested].filter(x => !used.has(x)),
    note: 'overridden_in 多=排序偏保守；suggested_but_unused 多=排序偏乐观。此为自进化训练信号，非考核分',
  };
  const obj = {
    request_id, at, request, tools_executed: results.length,
    tools_filtered: (route_decision?.candidates || []).filter(c => c.tier === 'background').length,
    tools_performance: tp, suggestion_vs_actual,
    filtering_effectiveness: { background_count: (route_decision?.candidates || []).filter(c => c.tier === 'background').length, hidden: 0, note: '建议制：收窄的是注入面不是可用性' },
    total_savings: { injected_chars: injectedChars, full_registry_chars: fullChars, saved_ratio_estimate: +(1 - injectedChars / fullChars).toFixed(2), basis: '字符量估算，非 token 实测' },
  };
  const file = path.join(DIRS.history, at.slice(0, 10).replace(/-/g, ''), request_id + '.json');
  writeJSON(file, obj);
  return { ...obj, file };
}

/* ---------- groups ---------- */
export function createGroup(a) { const g = readJSON(DIRS.groups, { groups: [] }); g.groups = g.groups.filter(x => x.name !== a.name); g.groups.push(a); writeJSON(DIRS.groups, g); return { ok: true, group: a.name }; }
export function listGroups() { return readJSON(DIRS.groups, { groups: [] }); }
export function listToolkitsView() { ensureSeed(); return { home: HOME, toolkits: loadRegistry().toolkits }; }
export function autoGroup({ threshold = 0.25, confirm = false } = {}) {
  ensureSeed();
  const tks = loadRegistry().toolkits.map(e => readJSON(path.join(DIRS.toolkits, e.name + '.json'), null)).filter(Boolean);
  const sets = tks.map(t => new Set(tokens((t.capability_tags || []).join(' ') + ' ' + t.name)));
  const parent = tks.map((_, i) => i);
  const find = i => parent[i] === i ? i : (parent[i] = find(parent[i]));
  for (let i = 0; i < tks.length; i++) for (let j = i + 1; j < tks.length; j++) {
    const A = sets[i], B = sets[j]; let h = 0; for (const x of A) if (B.has(x)) h++;
    const jac = h / (A.size + B.size - h || 1);
    if (jac >= threshold) parent[find(i)] = find(j);
  }
  const clusters = {};
  tks.forEach((t, i) => { const r = find(i); (clusters[r] ||= []).push(t.name); });
  const proposals = Object.values(clusters).filter(c => c.length > 1).map(c => ({ name: 'auto-' + c[0], toolkits: c, note: '标签 Jaccard≥' + threshold + '，未确认不落盘' }));
  if (confirm) { const g = readJSON(DIRS.groups, { groups: [] }); for (const p of proposals) if (!g.groups.some(x => x.toolkits.join() === p.toolkits.join())) g.groups.push({ name: p.name, toolkits: p.toolkits, auto_activate_on: [], description: 'auto_group 确认落盘' }); writeJSON(DIRS.groups, g); }
  return { proposals, written: !!confirm };
}
