#!/usr/bin/env node
/**
 * method-brief · 编排交底件生成器（格式契约 kb/formats/method-brief 的执行体，注册为 delivery/method-brief）
 *
 * 甲方口径 2026-09-23：交付故事大纲时要随件说清「用了哪些工具 / 用了哪些手法 / 情节曲线是怎么设计的」。
 * 本工具存在的理由：这三件事**只从磁盘台账汇总**。agent 手写就成了自述，自述不可核对。
 * 缺账处直书「查无：<原因> + 怎么补齐」，禁止拿形容词填空（对齐铁律 10「报数必附收据」）。
 *
 * 用法：
 *   node tools/method-brief.mjs --project <id> --artifact <项目内相对路径>
 *       [--node <nodeId>]      缺省取产物头部 node；无头部时必须显式给
 *       [--no-upstream]        只交底本节点，不展开直接上游
 *       [--out <相对路径>]      缺省 交付/编排交底-<产物名去扩展名>.md
 *       [--route-home <dir>]    SkillRouter 数据家，缺省 $SKILLROUTER_HOME 或 ~/.skillrouter
 *       [--quote-cap <n>]       曲线账正文回指行数上限，缺省 16（= op config.quoteCap）
 *       [--root <repoRoot>]     缺省本仓库根
 *
 *   内核 script 壳口径（flow 节点自动跑本件时）：
 *     node tools/method-brief.mjs projects/<id>/<上游md> projects/<id>/<本节点output> \
 *          --title <标题> --node <节点id> --flow <flowId> --config '<节点config json>'
 *   两条入口读同一套台账、出同一份账；--config 里 "@default:key" 视为未调，回落默认。
 *
 * 交底范围 = 本产物 + 其头部 `upstream:` 直接列出的上游产物（R6：upstream 是依赖的唯一真相，不另猜）。
 * 命中判据**不在此处重新发明**：调内核 core/dist/metrics.js 的 extractCtxUsage（字面 id + 概念签名词），
 * 与 metrics.jsonl 落盘的 hitIds 同一套口径——两套口径必漂移。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const argv = (() => {
  const out = { _: [] };
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith("--")) {
      const k = a[i].slice(2);
      if (i + 1 < a.length && !a[i + 1].startsWith("--")) out[k] = a[++i];
      else out[k] = true;
    } else out._.push(a[i]);
  }
  return out;
})();

const ROOT = path.resolve(argv.root || path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
/** 内核 script 壳口径：位置参数 `<项目内 src> <项目内 out>`（见 core/src/minitools.ts 调用约定）。
 *  与手工口径 --project/--artifact 并存，两条入口读同一套台账、出同一份账。 */
const POS = (() => {
  if ((argv._ || []).length < 2) return null;
  const relOf = (p) => path.relative(ROOT, path.resolve(ROOT, p)).split(path.sep).join("/");
  const m = /^projects\/([^/]+)\/(.+)$/.exec(relOf(argv._[0]));
  if (!m) return null;
  const inProj = (p) => (p.startsWith(`projects/${m[1]}/`) ? p.slice(`projects/${m[1]}/`.length) : p);
  return { project: m[1], artifact: m[2], out: inProj(relOf(argv._[1])) };
})();
const PROJECT = argv.project || POS?.project;
const ARTIFACT = argv.artifact || POS?.artifact;
/** 内核 JS 壳追加 --config <json>：节点旋钮表。取值优先级 = 命令行 > config > 默认；
 *  "@default:key" 是 expandFlow3 未覆盖时的哨兵值，等同「没调过」→ 回落本件默认，不冒充生效。 */
const CFG = (() => {
  try { return typeof argv.config === "string" ? JSON.parse(argv.config) : {}; } catch { return {}; }
})();
const knob = (name, cli, dflt) => {
  const v = cli !== undefined && cli !== true && cli !== false ? cli : CFG[name];
  return v === undefined || (typeof v === "string" && v.startsWith("@default:")) ? dflt : v;
};
const QUOTE_CAP = (() => {
  const n = Number(knob("quoteCap", argv["quote-cap"], 16));
  if (!Number.isFinite(n) || n < 1) {
    console.error(`config.quoteCap 非法：${JSON.stringify(knob("quoteCap", argv["quote-cap"], 16))}（须 ≥1 的整数）——拒绝按 0 出行数静默出空表。`);
    process.exit(2);
  }
  return Math.floor(n);
})();
/** 交底闭包开关：--no-upstream 显式关；config.upstream=false 同样关（内核派发时无 flag） */
const EXPAND_UPSTREAM = argv["no-upstream"] ? false : knob("upstream", undefined, true) !== false;
if (!PROJECT || !ARTIFACT) {
  console.error("用法：node tools/method-brief.mjs --project <id> --artifact <项目内相对路径> [--node <id>] [--no-upstream] [--quote-cap <n>]");
  process.exit(2);
}
const PROJ_DIR = path.join(ROOT, "projects", PROJECT);
const ART_PATH = path.join(PROJ_DIR, ARTIFACT);
const METRICS_FILE = path.join(PROJ_DIR, "registry", "metrics.jsonl");
if (!fs.existsSync(ART_PATH)) { console.error(`产物不存在：${path.relative(ROOT, ART_PATH)}`); process.exit(1); }
if (!fs.existsSync(METRICS_FILE)) {
  console.error(`查无可读的编排台账：projects/${PROJECT}/registry/metrics.jsonl 不存在——本件拒绝凭记忆成文。`);
  process.exit(1);
}

const { extractCtxUsage, conceptTermsOf } = await import(pathToFileURL(path.join(ROOT, "core", "dist", "metrics.js")).href);
const { sha12, bodyOf } = await import(pathToFileURL(path.join(ROOT, "core", "dist", "ids.js")).href);
const ROUTE_HOME = (() => {
  const v = knob("routeHome", argv["route-home"], null) ?? process.env.SKILLROUTER_HOME
    ?? path.join(process.env.USERPROFILE || process.env.HOME || "", ".skillrouter");
  return path.isAbsolute(v) ? v : path.join(ROOT, v);
})();

/* ---------------- 读数小件 ---------------- */
function readJsonl(file) {
  if (!fs.existsSync(file)) return null;
  const out = [];
  for (const line of fs.readFileSync(file, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* 半行不炸账 */ }
  }
  return out;
}
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, "utf-8")); } catch { return null; } }
function exists(p) { return fs.existsSync(p); }
function cell(s) { return String(s ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim(); }
function trunc(s, n) { s = String(s ?? ""); return s.length > n ? s.slice(0, n) + "…" : s; }
/** KV 头部解析（与 tools/artifact-lint.py::parse_header 同语义，只取本工具需要的键） */
function parseHeader(text) {
  const norm = String(text).replace(/^﻿/, "");
  if (!norm.startsWith("---")) return null;
  const end = norm.indexOf("\n---", 3);
  if (end < 0) return null;
  const head = {};
  let pending = null;
  for (const raw of norm.slice(norm.indexOf("\n") + 1, end).split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("- ")) { if (pending) (head[pending] ||= []).push(line.slice(2).trim().replace(/^"|"$/g, "")); continue; }
    const m = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!m) continue;
    const k = m[1], v = m[2];
    if (v === "") { pending = k; head[k] = []; }
    else { pending = null; head[k] = /^\d+$/.test(v) ? Number(v) : v.replace(/^"|"$/g, ""); }
  }
  return head;
}
function nowStamp() {
  const d = new Date();
  const p = (x) => String(x).padStart(2, "0");
  return {
    human: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`,
    file: `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`,
  };
}

/* ---------------- 交底范围：本产物 + 直接上游 ---------------- */
const ART_TEXT = fs.readFileSync(ART_PATH, "utf-8");
const ART_SHA = sha12(bodyOf(ART_TEXT));
const HEAD = parseHeader(ART_TEXT) || {};
/** 被交底件（主产物）的产出节点：交底就是交这个节点的账 */
const SUBJECT_NODE = HEAD.node || (typeof argv.node === "string" ? argv.node : null);
if (!SUBJECT_NODE) {
  console.error(`产物无 artifact 头部（缺 node），且未给 --node：交底件必须绑到具体流程节点，不接受"整个项目"这种含混口径。`);
  console.error(`补齐：--node <实例id>.<tool>（该产物的产出节点，见 registry/metrics.jsonl 的 nodeId）`);
  process.exit(1);
}
/** 本交底件自己的落位节点：内核 script 壳传 --node <本步节点>；手工跑时按被交底件的模块实例位派生 */
const STEP_NODE = typeof argv.node === "string" && argv.node !== HEAD.node
  ? argv.node
  : `${SUBJECT_NODE.split(".")[0]}.method-brief`;
const MODULE_INST = STEP_NODE.split(".")[0];

/** 交底单元 = 一份产物 + 产它的节点。upstream 里 kb/ 开头的是知识卡，不是产物。 */
const units = [{ rel: ARTIFACT, node: SUBJECT_NODE, text: ART_TEXT, sha: ART_SHA }];
const upstreamChecks = [];
if (EXPAND_UPSTREAM) {
  for (const entry of HEAD.upstream || []) {
    const s = String(entry);
    if (s.startsWith("kb/")) continue;
    const at = s.lastIndexOf("@");
    if (at < 0) continue;
    const rel = s.slice(0, at), declaredSha = s.slice(at + 1);
    const abs = path.join(PROJ_DIR, rel);
    if (!exists(abs)) { upstreamChecks.push({ rel, declaredSha, actualSha: "文件不存在", ok: false }); continue; }
    const text = fs.readFileSync(abs, "utf-8");
    const sha = sha12(bodyOf(text));
    upstreamChecks.push({ rel, declaredSha, actualSha: sha, ok: sha === declaredSha || sha.startsWith(declaredSha) });
    const h = parseHeader(text);
    if (h?.node && !units.some((u) => u.node === h.node)) units.push({ rel, node: h.node, text, sha });
  }
}
const unitNodes = [...new Set(units.map((u) => u.node))];

/* ---------------- 一、工具账 ---------------- */
const METRICS = readJsonl(METRICS_FILE) || [];
const rowsInScope = METRICS.filter((e) => unitNodes.includes(e.nodeId));

const opAgg = new Map();
for (const e of rowsInScope) {
  const key = `${e.nodeId}｜${e.kit || "?"}.${e.op || "?"}`;
  const r = opAgg.get(key) || { key, nodeId: e.nodeId, kit: e.kit, op: e.op, dispatches: 0, submits: 0, rounds: new Set(), checks: { pass: 0, block: 0, warn: 0 }, config: {}, retries: 0 };
  if (e.phase === "dispatch") r.dispatches += 1;
  if (e.phase === "submit") {
    r.submits += 1; r.rounds.add(e.round ?? 1);
    for (const k of ["pass", "block", "warn"]) r.checks[k] += e.checks?.[k] ?? 0;
    r.retries = Math.max(r.retries, e.retries ?? 0);
  }
  if (e.config) for (const [k, v] of Object.entries(e.config)) if (!(k in r.config)) r.config[k] = v;
  opAgg.set(key, r);
}
const opList = [...opAgg.values()].sort((a, b) => a.key.localeCompare(b.key)).map((o) => ({ ...o, rounds: [...o.rounds] }));
const configRows = opList.flatMap((o) => Object.entries(o.config).map(([k, v]) => ({ op: o.key, k, v })));
const silentNodes = unitNodes.filter((n) => !opList.some((o) => o.nodeId === n));

/* 内核动词留痕（BETA 门控旁路：CLI 写自 core/src/cli.ts，MCP 写自 core/src/mcp.ts） */
const allTraceRows = readJsonl(path.join(ROOT, "trace", "cli.jsonl")) || [];
const traceRows = allTraceRows.filter((r) => r.project === PROJECT || (r.argv || []).includes(PROJECT));
const verbAgg = new Map();
for (const r of traceRows) {
  const v = r.verb || "?";
  const t = verbAgg.get(v) || { verb: v, n: 0, fail: 0, ms: 0, last: "", via: new Set() };
  t.n += 1; t.ms += r.ms ?? 0; if (r.exit) t.fail += 1;
  if (r.ts && r.ts > t.last) t.last = r.ts;
  t.via.add(r.via || "cli");
  verbAgg.set(v, t);
}
const verbList = [...verbAgg.values()].sort((a, b) => b.n - a.n).map((t) => ({ ...t, via: [...t.via].sort() }));
const betaOn = exists(path.join(ROOT, "BETA"));

/* SkillRouter 调度账：route 不落盘，report 才写 execution_history */
const ROUTE_DIR = path.join(ROUTE_HOME, "execution_history");
const routeReports = [];
if (exists(ROUTE_DIR)) {
  for (const day of fs.readdirSync(ROUTE_DIR)) {
    const d = path.join(ROUTE_DIR, day);
    if (!fs.statSync(d).isDirectory()) continue;
    for (const f of fs.readdirSync(d)) { const j = readJson(path.join(d, f)); if (j) routeReports.push(j); }
  }
}
routeReports.sort((a, b) => String(a.at).localeCompare(String(b.at)));
const subjectStem = path.basename(ARTIFACT).replace(/\.[^.]+$/, "");
const projectRoutes = routeReports.filter((r) => {
  const s = JSON.stringify(r);
  return s.includes(PROJECT) || s.includes(subjectStem) || /大纲|剧本|编排|story-outline|script|structure/i.test(String(r.request || ""));
});
const SR_REGISTRY = readJson(path.join(ROUTE_HOME, "registry.json"));
const srToolkits = (SR_REGISTRY?.toolkits || []).map((e) => {
  const t = readJson(path.join(ROUTE_HOME, "toolkits", e.name + ".json"));
  return { name: e.name, tools: (t?.tools || []).length, groups: (t?.groups || []).length };
});

/* ---------------- 二、手法账 ---------------- */
const moduleCache = new Map();
function moduleOf(kit) {
  if (!kit) return null;
  if (!moduleCache.has(kit)) moduleCache.set(kit, readJson(path.join(ROOT, "modules", kit, "module.json")));
  return moduleCache.get(kit);
}
/** 逐单元算命中：装载清单取该节点的派发事件，判据用该单元正文——谁吃的饭算谁的 */
const craftUnits = units.map((u) => {
  const ids = new Set();
  for (const e of rowsInScope) if (e.nodeId === u.node) for (const id of e.ctx?.ids || []) ids.add(id);
  const offered = [...ids].sort();
  const usage = offered.length ? extractCtxUsage(u.text, offered, { root: ROOT }) : { hitIds: [] };
  return { ...u, offered, hit: usage.hitIds, unused: offered.filter((id) => !usage.hitIds.includes(id)) };
});
const allOffered = [...new Set(craftUnits.flatMap((u) => u.offered))].sort();
const allHit = new Set(craftUnits.flatMap((u) => u.hit));
const unusedCards = allOffered.filter((id) => !allHit.has(id));
const declared = new Set();
for (const o of opList) for (const k of moduleOf(o.kit)?.ops?.[o.op]?.knowledge || []) declared.add(k);
const declaredNotOffered = [...declared].filter((id) => !allOffered.includes(id)).sort();
/** 漂移只判 kb 卡：ctx.ids 里的 `01-编剧/x.md` 是内核按 flow.io 注入的上游文件，本就不在 op.knowledge 名下 */
const offeredNotDeclared = allOffered.filter((id) => id.startsWith("kb/") && !declared.has(id));
const kitsInScope = [...new Set(opList.map((o) => o.kit).filter(Boolean))];
const usedOps = new Set(opList.map((o) => o.op));
const siblings = kitsInScope.flatMap((kit) => {
  const m = moduleOf(kit);
  return Object.entries(m?.ops || {}).filter(([id]) => !usedOps.has(id)).map(([id, op]) => ({
    kit, id, title: op.title || "", kind: op.kind || "", capability: (op.capability || []).join("、"), planned: op.planned === true,
  }));
});

/* ---------------- 三、情节曲线账 ---------------- */
const CURVE_CARD_RE = /emotion-curve|pacing-density|reversal|barbell|ascent|dual-line|save-the-cat|episodic|structure\/|catalog|hook|thrill|beat/;
const curveCards = allOffered.filter((id) => CURVE_CARD_RE.test(id));
const CURVE_LINE_RE = /曲线|换轨|主型|螺旋|层层递进|回升|节拍|爆点|沙漠段|反转|合家欢|压迫|爽点/;
const curveQuotes = [];
for (const u of units) {
  const lines = u.text.split(/\r?\n/);
  for (let i = 0; i < lines.length && curveQuotes.length < QUOTE_CAP; i++) {
    if (CURVE_LINE_RE.test(lines[i])) curveQuotes.push({ src: path.basename(u.rel), line: i + 1, text: trunc(lines[i].trim(), 150) });
  }
}
const DECISION_DIR = path.join(PROJ_DIR, "decisions");
const decisions = exists(DECISION_DIR)
  ? fs.readdirSync(DECISION_DIR).filter((x) => x.endsWith(".json")).map((f) => {
      const d = readJson(path.join(DECISION_DIR, f)) || {};
      return {
        key: f.replace(/\.json$/, ""), picked: d.picked ?? d.value ?? d.selected ?? null,
        by: d.by ?? null, evidence: Array.isArray(d.evidence) ? d.evidence.length : (d.evidence ? 1 : 0),
        excluded: Array.isArray(d.excluded) ? d.excluded.length : 0,
      };
    })
  : [];

/* ---------------- 装配人读件 ---------------- */
const stamp = nowStamp();
const OUT_REL = argv.out || POS?.out || `交付/编排交底-${subjectStem}.md`;
const L = [];
const push = (s = "") => L.push(s);

push(`---`);
push(`artifact: 1`);
push(`id: ${MODULE_INST}.method-brief`);
push(`module: ${MODULE_INST}`);
push(`node: ${STEP_NODE}`);
push(`state: final`);
push(`at: ${stamp.human}`);
push(`by: module/delivery.method-brief`);
push(`upstream:`);
push(`  - kb/formats/method-brief`);
push(`  - ${ARTIFACT}@${ART_SHA}`);
push(`review: null`);
push(`---`);
push();
push(`# 编排交底 · ${PROJECT} ／ ${subjectStem}`);
push();
push(`> 本件由 \`tools/method-brief.mjs\` 从磁盘台账机器汇总，每个数字可追到台账行；追不到处直书「查无」。`);
push();
push(`交底范围：主件 \`${ARTIFACT}\`（节点 \`${SUBJECT_NODE}\`）+ 其头部 upstream 列出的 ${units.length - 1} 份直接上游产物。`);
push(`节点：${unitNodes.map((n) => `\`${n}\``).join(" ")}。闭包只展开一层——更上游的账由那一份交付件自己交。`);
push();

push(`## 一、工具账：这一轮按了哪些工具`);
push();
if (opList.length) {
  push(`### 1.1 流程内 tool（\`registry/metrics.jsonl\`，范围内 ${rowsInScope.length} 行事件）`);
  push();
  push(`| 节点｜tool | 派发 | 交卷 | 轮次 | 完整性 pass/block/warn | 重试 |`);
  push(`| --- | --- | --- | --- | --- | --- |`);
  for (const o of opList) push(`| \`${cell(o.key)}\` | ${o.dispatches} | ${o.submits} | ${o.rounds.join(",") || "—"} | ${o.checks.pass}/${o.checks.block}/${o.checks.warn} | ${o.retries} |`);
  push();
} else {
  push(`- **查无**：交底范围内的节点在 metrics.jsonl 里没有任何事件行——这份交付件不是流程跑出来的，本件不替它编 tool 账。`);
  push();
}
if (silentNodes.length) {
  push(`- **查无（逐节点）**：${silentNodes.map((n) => `\`${n}\``).join("、")} 零事件行。人工定稿件就是这个形状——内容是人裁决定的，`);
  push(`  没有派发、没装载标尺、没有完整性检查。要这笔账就得让它真跑一次节点（没有执行就没有账，本工具不代跑、也不代猜）。`);
  push();
}
if (configRows.length) {
  push(`### 1.2 旋钮实际取值（\`@default:x\` = 未覆盖、走 op 默认；其余 = 节点/overlay 覆盖）`);
  push();
  push(`| tool | 旋钮 | 取值 | 来源 |`);
  push(`| --- | --- | --- | --- |`);
  for (const r of configRows) {
    const v = String(r.v), isDef = v.startsWith("@default:");
    push(`| \`${cell(r.op)}\` | \`${cell(r.k)}\` | ${cell(trunc(isDef ? v.replace("@default:", "默认·") : v, 40))} | ${isDef ? "op 默认" : "**覆盖**"} |`);
  }
  push();
  push(`未出现在本表的旋钮 = 台账未记那次派发的生效值，不等于「没生效」。`);
  push();
}
push(`### 1.3 内核动词调用（\`trace/cli.jsonl\`）`);
push();
if (!betaOn) push(`注：repo 根 \`BETA\` 标记当前不在位，留痕通道已关——下表止于最后一次开启期间。`);
if (verbList.length) {
  push(`| 动词 | 次数 | 失败 | 累计墙钟 ms | 通道 | 最近一次 |`);
  push(`| --- | --- | --- | --- | --- | --- |`);
  for (const v of verbList) push(`| \`${cell(v.verb)}\` | ${v.n} | ${v.fail} | ${v.ms} | ${cell(v.via.join("+"))} | ${cell(v.last)} |`);
  push();
  push(`口径：留痕总 ${allTraceRows.length} 行，按 \`project\` 字段归属 ${PROJECT} 的 ${traceRows.length} 行。`);
  push(`通道列 \`cli\`/\`mcp\` = 该次调用来自命令行还是 MCP 面；两面同写一处台账，不另立账本。`);
} else {
  push(`- **查无**：trace/cli.jsonl 里没有归属 ${PROJECT} 的动词行。可能原因：留痕当时未开（BETA 门控），或动作全走了未留痕通道。`);
  push(`  补齐：BETA 在位时内核 CLI 与 MCP 两面都自动留痕（\`core/src/cli.ts\` / \`core/src/mcp.ts\` 的旁路）。`);
}
push();
push(`### 1.4 SkillRouter 调度建议 vs 实际采纳`);
push();
push(`账本位置：\`${cell(ROUTE_DIR)}\`（全盘 ${routeReports.length} 笔 report；与本项目/本产物相关的 ${projectRoutes.length} 笔）`);
push();
if (projectRoutes.length) {
  push(`| 时间 | 请求 | 建议数 | 实调 | 采纳 | adoption_rate | 越权改用（建议外） | 建议未用 |`);
  push(`| --- | --- | --- | --- | --- | --- | --- | --- |`);
  for (const r of projectRoutes) {
    const s = r.suggestion_vs_actual || {};
    push(`| ${cell(String(r.at || "").slice(0, 19))} | ${cell(trunc(r.request, 36))} | ${s.suggested ?? "—"} | ${s.used ?? "—"} | ${s.adopted ?? "—"} | ${s.adoption_rate ?? "—"} | ${cell((s.overridden_in || []).join("、") || "—")} | ${cell((s.suggested_but_unused || []).join("、") || "—")} |`);
  }
  push();
  push(`口径：\`route\` 只出建议不落盘，**只有收口调 \`report\` 才产生这一笔**。历史件存的是 suggested 计数而非名单原文，`);
  push(`所以本表能给「采纳几件 / 越权改用了哪几件」，逐位次对照要在 route 当时另存决策快照——包侧格式限制，写在这不藏。`);
} else {
  push(`- **查无**：本轮一笔 SkillRouter 调度账都没有。这正是它该有的样子：**没调 \`route\` 就没有建议，没调 \`report\` 就没有对照**，`);
  push(`  本件不拿「其实我考虑过工具池」冒充记账。补齐两步：`);
  push(`  ① 开工前 \`mcp__skillrouter__route\`（\`request\` = 本轮任务描述，\`context\` = 当前节点），把返回的 \`request_id\` + \`suggestion\` 抄进思维链注记；`);
  push(`  ② 交卷后 \`mcp__skillrouter__report\` 回填 \`route_decision\`（①的返回）与 \`results\`（实际用了哪些 tool / 是否 used / 耗时），`);
  push(`     账落到 \`execution_history/<日期>/<request_id>.json\`，本表自动出数（含 adoption_rate 与越权改用清单）。`);
}
if (srToolkits.length) {
  push();
  push(`调度池规模（\`registry.json\` + \`toolkits/\`，只报数，不当能力上限）：`);
  push();
  push(`| toolkit | 注册 tool 数 | 分组数 |`);
  push(`| --- | --- | --- |`);
  for (const t of srToolkits) push(`| \`${cell(t.name)}\` | ${t.tools} | ${t.groups} |`);
}
push();

push(`## 二、手法账：装了哪些标尺、产物真吃进了哪些`);
push();
if (allOffered.length) {
  push(`装载（去重）${allOffered.length} 张 → 范围内命中 ${allHit.size} 张 = **命中率 ${((allHit.size / allOffered.length) * 100).toFixed(0)}%**。`);
  push(`口径：内核 \`extractCtxUsage\`（字面 id + 概念签名词），与 metrics 落盘的 hitIds 同源；逐单元算——谁吃的饭算谁的。`);
  push();
  push(`| 产物（节点） | 装载 | 命中 | 未命中 |`);
  push(`| --- | --- | --- | --- |`);
  for (const u of craftUnits) {
    push(`| \`${cell(path.basename(u.rel))}\`（\`${cell(u.node)}\`） | ${u.offered.length} | ${u.hit.length} | ${u.unused.length}${u.offered.length ? "" : "（零事件）"} |`);
  }
  push();
  push(`| 标尺卡 | 命中 | 装载处 | 判定依据（该卡签名词样例） |`);
  push(`| --- | --- | --- | --- |`);
  for (const id of allOffered) {
    const where = craftUnits.filter((u) => u.offered.includes(id)).map((u) => path.basename(u.rel));
    const terms = id.startsWith("kb/") ? conceptTermsOf(ROOT, id).slice(0, 6) : [];
    push(`| \`${cell(id)}\` | ${allHit.has(id) ? "命中" : "—"} | ${cell(trunc(where.join("、"), 40))} | ${cell(terms.join(" / ") || "（非 kb 卡：路径类上游）")} |`);
  }
  push();
} else {
  push(`- **查无**：交底范围内没有任何派发事件带标尺清单（\`ctx.ids\` 全空）——即这一轮没有可交底的装载面。`);
  push(`  补齐：在产出节点的 \`modules/<kit>/module.json\` → \`ops.<op>.knowledge\` 里把判定标尺声明出来（K1 单点装载）。`);
  push();
}
if (unusedCards.length) {
  push(`### 2.1 装了没用的（禁哑：逐条列名，不许「都用上了」糊过去）`);
  push();
  for (const id of unusedCards) {
    const terms = id.startsWith("kb/") ? conceptTermsOf(ROOT, id).slice(0, 5) : [];
    push(`- \`${cell(id)}\` 未命中。签名词样例：${cell(terms.join(" / ") || "—")}——范围内这些词一次没出现。`);
  }
  push();
  push(`两种解释都要摆着，本工具不替谁选：①卡装了但本轮确实用不上（该摘，走 \`op.knowledge\` 收窄或 \`exclude_knowledge\`）；`);
  push(`②手法用了但换了一套说法（词面口径的结构性漏计）。**两者从台账分不开，故此处不下结论。**`);
  push();
}
if (declaredNotOffered.length || offeredNotDeclared.length) {
  push(`### 2.2 声明与实装的漂移（\`op.knowledge\` vs 派发 \`ctx.ids\`）`);
  push();
  for (const id of declaredNotOffered) push(`- 声明了却没进任务包：\`${cell(id)}\`——被 \`exclude_knowledge\`/9000 字封顶裁掉，或声明已过期。`);
  for (const id of offeredNotDeclared) push(`- 进了任务包但 op 未声明：\`${cell(id)}\`——查 overlay 的 \`adds.knowledge\` 或节点级覆盖（第二处真相的嫌疑）。`);
  push();
}
if (siblings.length) {
  push(`### 2.3 同域可用而本轮没用上的手法`);
  push();
  push(`| kit.op | 名义 | 类型 | 能力 | 状态 |`);
  push(`| --- | --- | --- | --- | --- |`);
  for (const s of siblings) push(`| \`${cell(s.kit + "." + s.id)}\` | ${cell(s.title)} | ${cell(s.kind)} | ${cell(s.capability)} | ${s.planned ? "**planned 占位（内核无执行体）**" : "可执行未用"} |`);
  push();
  push(`「为什么没用某某编排技巧」只能落在这张表 + 1.2 的旋钮取值上：可执行而未用 = 本轮取舍（理由须进思维链注记）；`);
  push(`占位 = 内核没有执行体，谈不上用没用（铁律 11 的 planned 台账）。`);
  push();
}

push(`## 三、情节曲线账：曲线是按哪张标尺定的`);
push();
if (curveCards.length) {
  push(`### 3.1 曲线/节拍类标尺（装载面里的曲线口径）`);
  push();
  push(`| 卡 | 命中 | 签名词样例 |`);
  push(`| --- | --- | --- |`);
  for (const id of curveCards) push(`| \`${cell(id)}\` | ${allHit.has(id) ? "命中（正文有其特征词）" : "未命中"} | ${cell(trunc((conceptTermsOf(ROOT, id) || []).slice(0, 8).join(" / "), 70))} |`);
  push();
} else {
  push(`- **查无（当红档看待）**：装载面里没有一张曲线/节拍类标尺。没装曲线标尺的编排，「曲线怎么设计的」就没有可核对的答案。`);
  push(`  补齐：产出节点 \`op.knowledge\` 声明 \`kb/aesthetic/emotion-curve\` + 所用结构母型卡（\`kb/structure/*\`）。`);
  push();
}
if (curveQuotes.length) {
  push(`### 3.2 交付件原文回指（照抄正文行，行号可核；本工具不改写、不概括）`);
  push();
  push(`| 出处 | 行 | 原文（截 150 字） |`);
  push(`| --- | --- | --- |`);
  for (const q of curveQuotes) push(`| ${cell(q.src)} | L${q.line} | ${cell(q.text)} |`);
  push();
  push(`上限 ${QUOTE_CAP} 行。本表只证明「曲线设计写在交付件正文里」，不等于「设计得好」——语义判决照旧归人与判官（P 值不当闸）。`);
} else {
  push(`### 3.2 交付件原文回指`);
  push();
  push(`- **查无**：范围内搜不到曲线/节拍/换轨/反转类行文——交付件本身没把曲线设计写进正文，本件不替它补写。`);
  push(`  补齐：按大纲交卷格式的「情绪曲线对账」段，把主型·换轨点·代价写进正文，本表自动有数。`);
}
push();
push(`### 3.3 影响走向的决策账（\`decisions/*.json\`；R8：缺 \`by\`+\`evidence\` 不进 values）`);
push();
if (decisions.length) {
  push(`| 决策 | 取值 | by | evidence 条数 | excluded |`);
  push(`| --- | --- | --- | --- | --- |`);
  for (const d of decisions) push(`| \`${cell(d.key)}\` | ${cell(d.picked ?? "—")} | ${cell(d.by ?? "—")} | ${d.evidence || "**0（无据）**"} | ${d.excluded || "—"} |`);
} else {
  push(`- **查无**：\`projects/${PROJECT}/decisions/\` 不存在或为空——走向类取舍没有决策级依据可交，只存在于对话里（对话会蒸发，磁盘不会）。`);
  push(`  补齐：\`mcp__miniflow__set_decision\`（带 \`by\` + \`evidence\`）逐条记账，例如「决战提前到 2/3 处」「中段欢快段用上元灯会」。`);
}
push();

push(`## 四、上游指纹对账（交付件引用的上游：头部声明 vs 磁盘现状）`);
push();
if (upstreamChecks.length) {
  const drifted = upstreamChecks.filter((c) => !c.ok);
  push(`| 上游 | 头部声明 sha1 前 12 | 磁盘实测 | 结论 |`);
  push(`| --- | --- | --- | --- |`);
  for (const c of upstreamChecks) push(`| \`${cell(c.rel)}\` | \`${cell(c.declaredSha)}\` | \`${cell(c.actualSha)}\` | ${c.ok ? "一致" : "**漂移：上游已改，本件未跟进重编**"} |`);
  push();
  push(drifted.length
    ? `有 ${drifted.length} 处漂移。按铁律 10：上游漂了要改本件就得走 \`flow_rerun\`（或 \`tools/amend-artifact.py\` 单命令绕流），不许静默沿用。`
    : `全部一致：交底时的依赖闭包与磁盘现状同指纹。`);
} else {
  push(`- **查无**：主件头部 \`upstream\` 未列出可核对的上游产物（或全为知识卡 id）。`);
  push(`  补齐：交卷格式要求上游依赖写进头部（R4 §5.3），否则依赖关系只有 agent 一张嘴。`);
}
push();

push(`## 五、账根（每个数字的回查路径）`);
push();
push(`| 账 | 磁盘位置 | 读数 |`);
push(`| --- | --- | --- |`);
push(`| 节点事件 | \`projects/${PROJECT}/registry/metrics.jsonl\` | 全项目 ${METRICS.length} 行 / 范围内 ${rowsInScope.length} 行 |`);
push(`| 动词留痕 | \`trace/cli.jsonl\`（BETA 门控${betaOn ? "，在位" : "，当前不在位"}） | 总 ${allTraceRows.length} 行 / 本项目 ${traceRows.length} 行 |`);
push(`| 调度建议 | \`${cell(ROUTE_DIR)}\` | ${routeReports.length} 笔 report（相关 ${projectRoutes.length}） |`);
push(`| 标尺声明 | \`modules/{${kitsInScope.join(",") || "?"}}/module.json\` | op.knowledge 去重 ${declared.size} 张 |`);
push(`| 决策 | \`projects/${PROJECT}/decisions/\` | ${decisions.length} 条 |`);
push(`| 主件指纹 | \`projects/${PROJECT}/${ARTIFACT}\` | 正文 sha1 前 12 = \`${ART_SHA}\` |`);
push(`| 格式契约 | \`knowledge/formats/method-brief.md\` | 三账字段与查无口径 |`);
push();
push(`复现：\`node tools/method-brief.mjs --project ${PROJECT} --artifact ${ARTIFACT}${HEAD.node ? "" : ` --node ${SUBJECT_NODE}`}\`（本件落位节点 \`${STEP_NODE}\`）`);
push();
push(`## 六、补充说明（留言区，工具不填）`);
push();
push(`本件五个数字区全部由 \`tools/method-brief.mjs\` 从台账汇总，工具不代替人下判断。要在此追加解释的，一行一条、必须署名并指回上表某一行账根：`);
push();
push(`<!-- - [${stamp.human}] by <名字/角色>：<说明，须注明依据「五、账根」第 N 行> -->`);
push();
push(`未署名、或指不到账根的留言 = 无效，视同自述（铁律 10）。`);
push();

const MD = L.join("\n") + "\n";
const OUT_ABS = path.join(PROJ_DIR, OUT_REL);
fs.mkdirSync(path.dirname(OUT_ABS), { recursive: true });
fs.writeFileSync(OUT_ABS, MD, "utf-8");

const RECEIPT_REL = `内部/收据/method-brief-${subjectStem}-${stamp.file}.json`;
const RECEIPT = {
  format: "method-brief-receipt@1",
  generator: "tools/method-brief.mjs",
  at: new Date().toISOString(),
  project: PROJECT,
  scope: { subject: { path: ARTIFACT, node: SUBJECT_NODE, sha12_body: ART_SHA }, units: units.map((u) => ({ path: u.rel, node: u.node, sha12_body: u.sha })) },
  tool_ledger: {
    metrics_rows_total: METRICS.length, metrics_rows_in_scope: rowsInScope.length,
    nodes_without_rows: silentNodes,
    ops: opList.map((o) => ({ node: o.nodeId, op: `${o.kit}.${o.op}`, dispatches: o.dispatches, submits: o.submits, rounds: o.rounds, checks: o.checks, retries: o.retries })),
    config: configRows,
    verbs: { beta_trace_on: betaOn, trace_rows_total: allTraceRows.length, trace_rows_project: traceRows.length, list: verbList.map((v) => ({ verb: v.verb, n: v.n, fail: v.fail, ms: v.ms, via: v.via })) },
    skillrouter: { home: ROUTE_HOME, reports_total: routeReports.length, related: projectRoutes.length, ledger_empty: routeReports.length === 0, toolkits: srToolkits },
  },
  craft_ledger: {
    offered: allOffered, hit: [...allHit], unused: unusedCards,
    hit_rate: allOffered.length ? +(allHit.size / allOffered.length).toFixed(3) : null,
    per_unit: craftUnits.map((u) => ({ path: u.rel, node: u.node, offered: u.offered.length, hit: u.hit, unused: u.unused })),
    drift: { declared_not_offered: declaredNotOffered, offered_not_declared: offeredNotDeclared },
    sibling_ops_unused: siblings,
  },
  curve_ledger: { cards: curveCards, cards_hit: curveCards.filter((id) => allHit.has(id)), quotes: curveQuotes, decisions },
  upstream_checks: upstreamChecks,
  config_used: { from_kernel_config: CFG, node_flag: argv.node ?? null, expand_upstream: EXPAND_UPSTREAM, quote_cap: QUOTE_CAP, route_home: ROUTE_HOME, out: argv.out ?? null },
  gaps: [
    ...(silentNodes.length ? [`tool-ledger: ${silentNodes.join("、")} 零事件行`] : []),
    ...(allOffered.length ? [] : ["craft: 装载面为空（无 ctx.ids）"]),
    ...(routeReports.length === 0 ? ["skillrouter: execution_history 为空（route 未调或未 report 回填）"] : []),
    ...(verbList.length === 0 ? ["verbs: trace 无本项目行"] : []),
    ...(curveCards.length === 0 ? ["curve: 未装载曲线标尺"] : []),
    ...(curveQuotes.length === 0 ? ["curve: 正文无曲线声明回指"] : []),
    ...(decisions.length === 0 ? ["decisions: 无决策账"] : []),
    ...(upstreamChecks.some((c) => !c.ok) ? ["upstream: 指纹漂移（上游已改，本件未跟进）"] : []),
  ],
};
fs.mkdirSync(path.join(PROJ_DIR, "内部", "收据"), { recursive: true });
fs.writeFileSync(path.join(PROJ_DIR, RECEIPT_REL), JSON.stringify(RECEIPT, null, 1), "utf-8");

console.log(`编排交底件已生成（机器汇总，未代 agent 写作文）：`);
console.log(`  人读件：projects/${PROJECT}/${OUT_REL}`);
console.log(`  收据　：projects/${PROJECT}/${RECEIPT_REL}`);
console.log(`  工具账：tool ${opList.length} 项｜动词 ${verbList.length} 类 ${traceRows.length} 行｜调度账 ${projectRoutes.length} 笔｜零事件节点 ${silentNodes.length} 个`);
console.log(`  手法账：装载 ${allOffered.length} → 命中 ${allHit.size}（${allOffered.length ? ((allHit.size / allOffered.length) * 100).toFixed(0) + "%" : "n/a"}）｜未用 ${unusedCards.length}｜漂移 ${declaredNotOffered.length}+${offeredNotDeclared.length}`);
console.log(`  曲线账：标尺 ${curveCards.length} 张｜正文回指 ${curveQuotes.length} 行｜决策 ${decisions.length} 条｜上游核对 ${upstreamChecks.length} 处（漂移 ${upstreamChecks.filter((c) => !c.ok).length}）`);
if (RECEIPT.gaps.length) console.log(`  缺口（诚实写在件上）：${RECEIPT.gaps.join("；")}`);
