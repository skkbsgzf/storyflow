// 动词表文档生成器 —— `core/src/verbs.ts` 是动词的唯一台账，文档只允许派生（FS1/工单 R1）。
//
// 为什么要有这个脚本而不是手写表格： verbs.ts 的注释已经立了「三面只允许派生」的规矩，
// 文档是**第四面**。手写第四份必然漂移（历史上 CLI/MCP/HTTP 就漂过三次）。
// 门禁用法： `node scripts/gen-verbs-doc.mjs --check` —— 生成结果与 docs/Agent.md 标记块逐行对账。
//
// 用法：
//   node scripts/gen-verbs-doc.mjs            # 打印生成的 markdown 块
//   node scripts/gen-verbs-doc.mjs --write    # 就地重写 docs/Agent.md 的标记块
//   node scripts/gen-verbs-doc.mjs --check    # 对账，漂移则 exit 1
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const REPO = path.resolve(import.meta.dirname, "..");
const AGENT_DOC = path.join(REPO, "docs", "Agent.md");
const BEGIN = "<!-- GEN:VERBS:BEGIN 由 scripts/gen-verbs-doc.mjs 从 core/src/verbs.ts 生成，勿手改 -->";
const END = "<!-- GEN:VERBS:END -->";

/** 用 core 自带的 tsx 直接吃 .ts —— 不要求先 build（build 产物 dist/ 默认不存在）。 */
async function loadVerbs() {
  const tsxApi = path.join(REPO, "core", "node_modules", "tsx", "dist", "esm", "api", "index.mjs");
  if (!fs.existsSync(tsxApi)) {
    throw new Error(`找不到 tsx：${tsxApi}\n先在 core/ 执行 npm install（或 npm run build 后设置 MINIFLOW_VERBS_FROM_DIST=1 走 dist）`);
  }
const distMode = process.env.MINIFLOW_VERBS_FROM_DIST === "1";
  const target = distMode
    ? path.join(REPO, "core", "dist", "verbs.js")
    : path.join(REPO, "core", "src", "verbs.ts");
  if (distMode) {
    const mod = await import(pathToFileURL(target).href);
    return { VERBS: mod.VERBS };
  }
  const { tsImport } = await import(pathToFileURL(tsxApi).href);
  const mod = await tsImport(pathToFileURL(target).href, pathToFileURL(path.join(REPO, "core", "noop.ts")).href);
  return { VERBS: mod.VERBS };
}

const cell = (s) => String(s).replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();

/** CLI 入参列：显示「敲什么」（flag），flag 与归一化键不同名时补注键名。 */
function paramsCell(p) {
  const flag = p.flag ?? p.name;
  const shape = p.enum
    ? `<${p.enum.join("|")}>`
    : p.type === "record"
      ? "<json>"
      : p.type === "string[]"
        ? "<a,b>"
        : `<${p.type}>`;
  const key = p.flag && p.flag !== p.name ? `（键 ${p.name}）` : "";
  return `\`--${flag} ${shape}\`${key}${p.required ? " ★" : ""}`;
}

function render(VERBS) {
  const groups = [];
  for (const v of VERBS) if (!groups.includes(v.group)) groups.push(v.group);
  const lines = [];
  lines.push(`动词共 **${VERBS.length}** 个，分 ${groups.length} 组：${groups.map((g) => `\`${g}\``).join(" ｜ ")}。`);
  lines.push("");
  lines.push("| 动词 | 组 | 入参（★=必填，其余可缺省） | 说明 |");
  lines.push("| --- | --- | --- | --- |");
  for (const v of VERBS) {
    const ps = v.params.length ? v.params.map(paramsCell).join(" · ") : "—";
    lines.push(`| \`${v.name}\` | ${cell(v.group)} | ${cell(ps)} | ${cell(v.description)} |`);
  }
  lines.push("");
  lines.push(`> 三面同源（表即面）：CLI \`core/src/cli.ts\` ｜ HTTP \`POST /api/verbs/:verb\` ｜ MCP stdio 注册 ${VERBS.length} 个同名工具。改动词只需改 \`core/src/verbs.ts\` 一处。`);
  return lines.join("\n");
}

const arg = process.argv.slice(2);
const { VERBS } = await loadVerbs();
const body = render(VERBS);
const block = `${BEGIN}\n${body}\n${END}`;

if (arg.includes("--write")) {
  const cur = fs.readFileSync(AGENT_DOC, "utf-8");
  const i = cur.indexOf(BEGIN);
  const j = cur.indexOf(END);
  if (i < 0 || j < 0) throw new Error("docs/Agent.md 找不到 GEN:VERBS 标记块");
  fs.writeFileSync(AGENT_DOC, cur.slice(0, i) + block + cur.slice(j + END.length), "utf-8");
  console.log(`已重写 docs/Agent.md 动词表（${VERBS.length} 个动词）`);
  process.exit(0);
}

if (arg.includes("--check")) {
  const cur = fs.readFileSync(AGENT_DOC, "utf-8");
  const i = cur.indexOf(BEGIN);
  const j = cur.indexOf(END);
  if (i < 0 || j < 0) {
    console.error("FAIL: docs/Agent.md 缺少 GEN:VERBS 标记块");
    process.exit(1);
  }
  const have = cur.slice(i, j + END.length);
  if (have === block) {
    console.log(`OK: docs/Agent.md 动词表与 verbs.ts 逐行一致（${VERBS.length} 个动词）`);
    process.exit(0);
  }
  const a = have.split("\n");
  const b = block.split("\n");
  console.error(`FAIL: 动词表漂移（文档 ${a.length} 行 / 生成 ${b.length} 行）`);
  for (let n = 0; n < Math.max(a.length, b.length); n++) {
    if (a[n] !== b[n]) console.error(`  行 ${n + 1}\n  - ${a[n] ?? "(无)"}\n  + ${b[n] ?? "(无)"}`);
  }
  console.error("修复： node scripts/gen-verbs-doc.mjs --write");
  process.exit(1);
}

console.log(block);
