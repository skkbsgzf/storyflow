#!/usr/bin/env node
/**
 * 命中率口径重检 · 诊断工具（不落产物，只读）
 *
 * 用法：node tools/hitrate-recheck.mjs --project <id> [--root <repoRoot>]
 *
 * 对项目 registry/metrics.jsonl 里每个 submit/core 事件的注入清单，
 * 找到同 node 同 round 的产物，分别用两套口径重算：
 *   旧口径 = 纯字面（头部/正文出现 id 或短 id）
 *   新口径 = 字面 + 概念词（kb 卡签名词落入正文）
 * 输出逐事件对照、kb 卡族汇总、双零名单（新旧口径都命不中的卡 = 真实的改写型漏计）。
 */
import fs from "node:fs";
import path from "node:path";
import { extractCtxUsage, conceptTermsOf } from "../core/dist/metrics.js";

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const repoRoot = path.resolve(opt("root") ?? process.cwd());
const projectId = opt("project");
if (!projectId) {
  console.error("用法: node tools/hitrate-recheck.mjs --project <id> [--root <repoRoot>]");
  process.exit(1);
}
const projectDir = path.join(repoRoot, "projects", projectId);
const metricsPath = path.join(projectDir, "registry", "metrics.jsonl");
if (!fs.existsSync(metricsPath)) {
  console.error(`无 metrics.jsonl: ${metricsPath}`);
  process.exit(1);
}

// ---- 产物索引：解析 artifact@1 头部（KV 行格式：node: xxx / round: n）----
function parseHeader(text) {
  if (!text.startsWith("---")) return null;
  const end = text.indexOf("\n---", 3);
  if (end < 0) return null;
  const head = {};
  for (const line of text.slice(4, end).split("\n")) {
    const m = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (m) head[m[1]] = m[2].trim();
  }
  return head;
}

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["registry", "snapshots", "node_modules", "internal"].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (/\.(md|markdown|txt)$/i.test(e.name)) yield p;
  }
}

const byNodeRound = new Map(); // "node|round" -> Set<file>
const byNode = new Map();      // node -> Set<file>
for (const p of walk(projectDir)) {
  let text;
  try { text = fs.readFileSync(p, "utf-8"); } catch { continue; }
  const head = parseHeader(text);
  if (!head || head.artifact !== "1" || !head.node) continue;
  const key = `${head.node}|${parseInt(head.round ?? "1", 10) || 1}`;
  if (!byNodeRound.has(key)) byNodeRound.set(key, new Set());
  byNodeRound.get(key).add(p);
  if (!byNode.has(head.node)) byNode.set(head.node, new Set());
  byNode.get(head.node).add(p);
}

const events = fs.readFileSync(metricsPath, "utf-8").split("\n")
  .filter(Boolean).map((l) => JSON.parse(l))
  .filter((e) => (e.phase === "submit" || e.phase === "core") && e.ctx?.ids?.length);

let oldKbUsed = 0, newKbUsed = 0, kbOffered = 0;
const kbOfferedIds = new Set();
const oldKbHit = new Set(), newKbHit = new Set();
const kbFamily = new Map(); // family -> {offered, old, new}
const bothZero = new Map(); // id -> 卡标题线索

console.log(`== ${projectId} · ${events.length} 个 submit/core 事件 ==\n`);
for (const e of events) {
  const key = `${e.nodeId}|${e.round ?? 1}`;
  const files = byNodeRound.get(key) ?? byNode.get(e.nodeId);
  if (!files?.size) continue;
  const oldHits = new Set(), newHits = new Set();
  const newOnly = [];
  for (const f of files) {
    const text = fs.readFileSync(f, "utf-8");
    for (const id of extractCtxUsage(text, e.ctx.ids).hitIds) oldHits.add(id);
    for (const id of extractCtxUsage(text, e.ctx.ids, { root: repoRoot }).hitIds) newHits.add(id);
  }
  for (const id of newHits) {
    if (!oldHits.has(id)) {
      newOnly.push(`${id} ← [${conceptTermsOf(repoRoot, id).slice(0, 8).join(" ")}]`);
    }
  }
  const kbIds = e.ctx.ids.filter((i) => i.startsWith("kb/"));
  kbOffered += kbIds.length;
  for (const id of kbIds) {
    kbOfferedIds.add(id);
    const fam = id.split("/")[1] ?? "?";
    const f = kbFamily.get(fam) ?? { offered: 0, old: 0, new: 0 };
    f.offered += 1;
    if (oldHits.has(id)) { f.old += 1; oldKbHit.add(id); }
    if (newHits.has(id)) { f.new += 1; newKbHit.add(id); }
    kbFamily.set(fam, f);
  }
  oldKbUsed += kbIds.filter((i) => oldHits.has(i)).length;
  newKbUsed += kbIds.filter((i) => newHits.has(i)).length;
  if (newOnly.length) {
    console.log(`[${e.nodeId} r${e.round ?? 1}] 概念层新命中 ${newOnly.length} 张:`);
    for (const l of newOnly) console.log(`   ${l}`);
  }
}

console.log(`\n== kb 标尺卡汇总（去重 ${kbOfferedIds.size} 张，事件摊开 ${kbOffered} 卡次）==`);
const oldU = oldKbHit.size, newU = newKbHit.size, total = kbOfferedIds.size;
console.log(`旧口径（纯字面）: ${oldU}/${total} = ${(oldU / total * 100).toFixed(0)}%`);
console.log(`新口径（字面+概念）: ${newU}/${total} = ${(newU / total * 100).toFixed(0)}%`);
console.log(`事件摊开口径: 旧 ${oldKbUsed}/${kbOffered} → 新 ${newKbUsed}/${kbOffered}`);
console.log("\n按知识族:");
for (const [fam, f] of [...kbFamily.entries()].sort()) {
  console.log(`  ${fam.padEnd(12)} 旧 ${f.old}/${f.offered}  新 ${f.new}/${f.offered}`);
}
const zero = [...kbOfferedIds].filter((id) => !newKbHit.has(id));
if (zero.length) {
  console.log(`\n新口径仍为 0 的卡（改写型漏计，真实噪声下限）:`);
  for (const id of zero) console.log(`  ${id}  签名词: [${conceptTermsOf(repoRoot, id).slice(0, 6).join(" ")}]`);
}
