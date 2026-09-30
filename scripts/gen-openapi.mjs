// OpenAPI 生成器 —— **路由表与动词表是唯二事实源**，文档只允许派生（工单 R4 第 4 条）。
//
// 为什么要有这个脚本：`docs/Agent.md` 的动词表已经吃了「手写第四份必漂移」的教训
// （见 scripts/gen-verbs-doc.mjs 头部注释）。HTTP 面是同一味药：
// v1 文档里的每一条路径、每一个动词入参形状都必须能从 core/src/api-v1.ts 与
// core/src/verbs.ts 重生成出来，否则「文档说有、代码没有」就是接入门上最贵的那种坑。
//
// 用法：
//   node scripts/gen-openapi.mjs            # 打印生成的 OpenAPI JSON
//   node scripts/gen-openapi.mjs --write    # 写 contracts/http-openapi-v1.json
//   node scripts/gen-openapi.mjs --check    # 对账：漂移 / 漏动词 / 孤儿路径 / 必填参数缺账 ⇒ exit 1
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const REPO = path.resolve(import.meta.dirname, "..");
const OUT = path.join(REPO, "contracts", "http-openapi-v1.json");

/** 用 core 自带的 tsx 直接吃 .ts —— 不要求先 build（与 gen-verbs-doc.mjs 同法）。 */
async function loadTables() {
  const tsxApi = path.join(REPO, "core", "node_modules", "tsx", "dist", "esm", "api", "index.mjs");
  if (!fs.existsSync(tsxApi)) {
    throw new Error(`找不到 tsx：${tsxApi}\n先在 core/ 执行 npm install`);
  }
  const { tsImport } = await import(pathToFileURL(tsxApi).href);
  const entry = pathToFileURL(path.join(REPO, "core", "src", "api-v1.ts")).href;
  const mod = await tsImport(entry, pathToFileURL(path.join(REPO, "core", "noop.ts")).href);
  const verbs = await tsImport(pathToFileURL(path.join(REPO, "core", "src", "verbs.ts")).href, entry);
  return { buildOpenApiV1: mod.buildOpenApiV1, V1_ROUTES: mod.V1_ROUTES, VERBS: verbs.VERBS };
}

const stringify = (doc) => JSON.stringify(doc, null, 2) + "\n";

/** OpenAPI 的路径写法是 `{id}`，表里写的是 Fastify 的 `:id`——寻源时归一。 */
const toOpenApiPath = (p) => p.replace(/:([A-Za-z_]+)/g, "{$1}");

function reconcile(doc, V1_ROUTES, VERBS) {
  const problems = [];
  const paths = doc.paths ?? {};

  // ① 表里每条路由都得在文档里有对应条目（注册了却没文档 = 接入方看不见），
  //    且响应介质要和对流/对 JSON 的承诺一致（SSE 那条写成 application/json 就是骗接入方）
  for (const r of V1_ROUTES) {
    const key = toOpenApiPath(r.path);
    const item = paths[key];
    const op = item?.[r.method.toLowerCase()];
    if (!op) problems.push(`路由 ${r.method} ${r.path} 未进文档（paths.${key}${item ? ` 方法 ${r.method} 缺失` : " 缺失"}）`);
    else {
      const media = Object.keys(op.responses?.["200"]?.content ?? {});
      const want = r.sse ? "text/event-stream" : "application/json";
      if (!media.includes(want)) problems.push(`路由 ${r.method} ${r.path} 的 200 介质是 ${media.join("/") || "(空)"}，应为 ${want}`);
    }
  }

  // ② 文档里不许有表外的路径（孤儿文档 = 承诺了不存在的端点）
  const declared = new Set(V1_ROUTES.map((r) => toOpenApiPath(r.path)));
  for (const v of VERBS) declared.add(`/api/v1/verbs/${v.name}`);
  declared.add("/api/v1/openapi.json");
  for (const p of Object.keys(paths)) {
    if (!declared.has(p)) problems.push(`文档路径 ${p} 在 V1_ROUTES / VERBS 里都查无（孤儿条目）`);
  }

  // ③ 动词全覆盖 + 逐动词必填参数进 schema.required（表 = 文档的字段级对账）
  for (const v of VERBS) {
    const item = paths[`/api/v1/verbs/${v.name}`];
    if (!item) {
      problems.push(`动词 ${v.name} 未进文档`);
      continue;
    }
    const schema = item.post?.requestBody?.content?.["application/json"]?.schema ?? {};
    const required = schema?.required ?? [];
    for (const p of v.params.filter((x) => x.required)) {
      if (!required.includes(p.name)) problems.push(`动词 ${v.name} 的必填参数 ${p.name} 未进 schema.required`);
      if (!schema?.properties?.[p.name]) problems.push(`动词 ${v.name} 的参数 ${p.name} 未进 schema.properties`);
    }
  }
  // ④ 计数对账按**操作数**（同一 URL 的 GET/PUT 在 OpenAPI 里是一条 path、两个 method）
  const operations = Object.values(paths).reduce((n, item) => n + Object.keys(item).length, 0);
  const expected = V1_ROUTES.length + VERBS.length + 1; // ＋ openapi.json 自身
  if (operations !== expected) {
    problems.push(`操作数 ${operations} ≠ 路由 ${V1_ROUTES.length} + 动词 ${VERBS.length} + openapi 自身 1`);
  }
  return problems;
}

const arg = process.argv.slice(2);
const { buildOpenApiV1, V1_ROUTES, VERBS } = await loadTables();
const body = stringify(buildOpenApiV1());
const problems = reconcile(JSON.parse(body), V1_ROUTES, VERBS);

if (problems.length) {
  console.error(`FAIL: 文档与表对账不过（${problems.length} 处）`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

if (arg.includes("--write")) {
  fs.writeFileSync(OUT, body, "utf-8");
  console.log(`已写 contracts/http-openapi-v1.json（路由 ${V1_ROUTES.length} 条 ＋ 动词 ${VERBS.length} 个，对账 ${problems.length} 问题）`);
  process.exit(0);
}

if (arg.includes("--check")) {
  if (!fs.existsSync(OUT)) {
    console.error("FAIL: contracts/http-openapi-v1.json 不存在");
    console.error("修复： node scripts/gen-openapi.mjs --write");
    process.exit(1);
  }
  const cur = fs.readFileSync(OUT, "utf-8");
  if (cur === body) {
    console.log(`OK: contracts/http-openapi-v1.json 与生成结果逐字节一致（路由 ${V1_ROUTES.length} 条 ＋ 动词 ${VERBS.length} 个）`);
    process.exit(0);
  }
  const a = cur.split("\n");
  const b = body.split("\n");
  console.error(`FAIL: 文档漂移（磁盘 ${a.length} 行 / 生成 ${b.length} 行）`);
  let shown = 0;
  for (let n = 0; n < Math.max(a.length, b.length) && shown < 20; n++) {
    if (a[n] !== b[n]) {
      console.error(`  行 ${n + 1}\n  - ${a[n] ?? "(无)"}\n  + ${b[n] ?? "(无)"}`);
      shown++;
    }
  }
  console.error("修复： node scripts/gen-openapi.mjs --write");
  process.exit(1);
}

process.stdout.write(body);
