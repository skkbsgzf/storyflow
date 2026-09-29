// 波14 批1/批2 · 包门禁（S4）与模板落地（S5）单测。
// 与 serve-auth.test.ts 同谱：mkdtemp 隔离工作区 + 真包目录（含 .storyharness.json + entry），
// 经 loadPacks 成表后逐条打验收线——不用真 LLM、不依赖 8421/8431。
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { loadPacks, PackRuntime } from "../src/packs.js";
import {
  cloneTemplateProject, packAllowed, packGateReport, projectFromRequest, readDeclaredPacks, setPackGate,
  PROJECT_CONFIG_FILE,
} from "../src/packgate.js";
import { KernelClient } from "../src/kernel.js";
import type { CorpusLayout, HarnessConfig } from "../src/config.js";

const CORPUS: CorpusLayout = {
  projectsDir: "projects",
  receiptsDir: path.join("内部", "收据"),
  quarantineDir: path.join("内部", "storyharness", "backup"),
  sessionsDir: path.join("内部", "sessions"),
  telemetryDir: path.join("内部", "telemetry"),
  lintTool: path.join("tools", "flow-lint.py"),
  lintCommand: "python",
};

/** 造一个最小可装载包：一个 api 前缀 + 一个模板项目（template-<pack>）。 */
function writePack(packsRoot: string, name: string, opts: { defaultEnabled?: boolean; withTemplate?: boolean } = {}) {
  const root = path.join(packsRoot, name);
  fs.mkdirSync(path.join(root, "api"), { recursive: true });
  fs.writeFileSync(path.join(root, "api", "handle.mjs"), "export async function handle(){ /* 占位：本测不派发 */ }\n", "utf-8");
  const mf: Record<string, unknown> = {
    pack: { name, version: "0.0.1", ...(opts.defaultEnabled === undefined ? {} : { defaultEnabled: opts.defaultEnabled }) },
    extensions: { apis: [{ prefix: `/api/${name}/`, entry: "api/handle.mjs", export: "handle" }] },
  };
  fs.writeFileSync(path.join(root, ".storyharness.json"), JSON.stringify(mf, null, 2) + "\n", "utf-8");
  if (opts.withTemplate !== false) {
    const tpl = path.join(root, "templates", `template-${name}`);
    fs.mkdirSync(path.join(tpl, "内部"), { recursive: true });
    fs.writeFileSync(path.join(tpl, "剧本.md"), "# 出厂剧本\n", "utf-8");
    fs.writeFileSync(path.join(tpl, "内部", "mock-llm.py"), "# 出厂留档\n", "utf-8");
  }
  return root;
}

function tmpWorkspace(): { root: string; cfg: HarnessConfig } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sh-gate-"));
  const packsRoot = path.join(root, "packs");
  writePack(packsRoot, "alpha", { withTemplate: true });            // 出厂档缺省 = 可用
  writePack(packsRoot, "beta", { defaultEnabled: false, withTemplate: false }); // 出厂即关
  const cfg = {
    harnessVersion: "0.7.3", workspaceRoot: root, corpusName: "tmp", corpus: CORPUS,
    serve: { hostname: "127.0.0.1", password: "", tokenTtlHours: 72, allowedOrigins: [] },
    kernelBase: "http://127.0.0.1:9", project: "alpha", provider: "zai", model: "test",
    maxParallel: 1, thinking: "low", pkgRoot: root,
  } as unknown as HarnessConfig;
  return { root, cfg };
}

/** 装载层点名停用后用：返回「带 packsOff 的配置 + 按它装载的表」——门禁报告读的是配置里的 packsOff，
 *  只换表不换配置＝测了个寂寞（本条测试第一版就是这么失败的）。 */
async function runtimeFor(cfg: HarnessConfig, packsOff?: string[]) {
  const withOff = packsOff ? ({ ...cfg, packsOff } as HarnessConfig) : cfg;
  return { cfg: withOff, rt: await loadPacks(withOff) };
}

test("S4 · 未声明 = 按包出厂档（alpha 可用 / beta 出厂即关），依据来源如实标注", async () => {
  const { cfg } = tmpWorkspace();
  fs.mkdirSync(path.join(cfg.workspaceRoot, "projects", "p1"), { recursive: true });
  const { rt } = await runtimeFor(cfg);
  const rep = packGateReport(cfg, rt, "p1");
  const a = rep.items.find((i) => i.pack === "alpha")!;
  const b = rep.items.find((i) => i.pack === "beta")!;
  assert.equal(a.enabled, true); assert.equal(a.declared, false); assert.equal(a.source, "pack-default");
  assert.match(a.reason, /出厂档/);
  assert.equal(b.enabled, false); assert.equal(b.defaultEnabled, false);
  assert.equal(packAllowed(cfg, rt, "p1", "alpha").enabled, true);
  assert.equal(packAllowed(cfg, rt, "p1", "beta").enabled, false);
  // 未装载的包名：无从判定 → 不放行（不静默兜底）
  assert.equal(packAllowed(cfg, rt, "p1", "gamma").enabled, false);
});

test("S4 · 项目表态覆盖出厂档，且只动 presets.packs 一段（其余键原样保留）", async () => {
  const { cfg } = tmpWorkspace();
  const dir = path.join(cfg.workspaceRoot, "projects", "p1");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, PROJECT_CONFIG_FILE), JSON.stringify({ brief: "留住我", presets: { style: "deai" } }, null, 2), "utf-8");
  const { rt } = await runtimeFor(cfg);

  const on = setPackGate(cfg, rt, "p1", "beta", true);
  assert.equal(on.enabled, true); assert.equal(on.source, "project"); assert.equal(on.declared, true);
  const off = setPackGate(cfg, rt, "p1", "alpha", false);
  assert.equal(off.enabled, false);

  const j = JSON.parse(fs.readFileSync(path.join(dir, PROJECT_CONFIG_FILE), "utf-8"));
  assert.equal(j.brief, "留住我");                       // 读—改—写：无关键不许掉
  assert.equal(j.presets.style, "deai");
  assert.equal(j.presets.packs.beta, true);
  assert.equal(j.presets.packs.alpha, false);
  assert.equal(packAllowed(cfg, rt, "p1", "beta").enabled, true);
});

test("S4 · 拒绝形态：未装载的包 / 不存在的项目 / 坏 JSON 配置 / 模板项目本体", async () => {
  const { cfg } = tmpWorkspace();
  const dir = path.join(cfg.workspaceRoot, "projects", "p1");
  fs.mkdirSync(dir, { recursive: true });
  const { rt } = await runtimeFor(cfg);
  assert.throws(() => setPackGate(cfg, rt, "p1", "gamma", true), /未装载/);
  assert.throws(() => setPackGate(cfg, rt, "nosuch", "alpha", true), /项目不存在/);
  assert.throws(() => setPackGate(cfg, rt, "../bad", "alpha", true), /非法/);
  fs.writeFileSync(path.join(dir, PROJECT_CONFIG_FILE), "{ 坏掉的 json", "utf-8");
  assert.throws(() => setPackGate(cfg, rt, "p1", "alpha", false), /读不动/);
  assert.equal(fs.readFileSync(path.join(dir, PROJECT_CONFIG_FILE), "utf-8"), "{ 坏掉的 json"); // 坏文件上零写入
  // 模板项目（工作区无档、解析落在包 templates/）：不落开关，指路复制
  assert.throws(() => setPackGate(cfg, rt, "template-alpha", "alpha", false), /模板项目（只读）/);
});

test("S4 · 装载层 packsOff：整包不挂载，但门禁报告仍出条目并写清「没装载、怎么恢复」（面板不许哑）", async () => {
  const { cfg } = tmpWorkspace();
  fs.mkdirSync(path.join(cfg.workspaceRoot, "projects", "p1"), { recursive: true });
  const { cfg: off, rt } = await runtimeFor(cfg, ["beta"]);
  assert.equal(rt.loaded.some((p) => p.name === "beta"), false);
  assert.ok(rt.warnings.some((w) => w.includes("beta") && w.includes("packsOff")));
  const rep = packGateReport(off, rt, "p1");
  assert.deepEqual(rep.items.map((i) => i.pack), ["alpha", "beta"]);
  const b = rep.items.find((i) => i.pack === "beta")!;
  assert.equal(b.source, "not-loaded");
  assert.equal(b.enabled, false);
  assert.match(b.reason, /未装载[\s\S]*重启 serve/);
  // 点名了一个盘上不存在的包：也出一条（不静默吞掉拼错的包名）
  const ghost = packGateReport({ ...cfg, packsOff: ["nosuchpack"] } as HarnessConfig, rt, "p1");
  assert.ok(ghost.items.some((i) => i.pack === "nosuchpack" && i.source === "not-loaded"));
});

test("S4 · projectFromRequest：query 优先，POST body 兜底，判不出=空串（交回包自己的校验）", () => {
  assert.equal(projectFromRequest("/api/alpha/state?project=p1", "GET", ""), "p1");
  assert.equal(projectFromRequest("/api/alpha/state", "POST", JSON.stringify({ project: "p2" })), "p2");
  assert.equal(projectFromRequest("/api/alpha/state?project=p1", "POST", JSON.stringify({ project: "p2" })), "p1");
  assert.equal(projectFromRequest("/api/alpha/state?project=../etc", "GET", ""), "");
  assert.equal(projectFromRequest("/api/alpha/state", "POST", "{坏 body"), "");
  assert.equal(projectFromRequest("/api/alpha/state", "GET", ""), "");
});

test("S5 · 读轴回落：工作区无档时 projectDir 指向包 templates/，有档后稳定指向副本", async () => {
  const { cfg } = tmpWorkspace();
  const { rt } = await runtimeFor(cfg);
  const tpl = path.join(cfg.workspaceRoot, "packs", "alpha", "templates", "template-alpha");
  assert.equal(rt.projectDir(cfg, "template-alpha"), tpl);
  const primary = path.join(cfg.workspaceRoot, "projects", "template-alpha");
  fs.mkdirSync(primary, { recursive: true });
  assert.equal(rt.projectDir(cfg, "template-alpha"), primary);  // 工作区在档优先
  assert.equal(rt.projectDir(cfg, "nosuch"), path.join(cfg.workspaceRoot, "projects", "nosuch")); // 交回缺省位显式报错
});

test("S5 · 首写落地：整目录真复制进工作区，包内容物保持只读，二次调用幂等", async () => {
  const { cfg } = tmpWorkspace();
  const { rt } = await runtimeFor(cfg);
  const tpl = path.join(cfg.workspaceRoot, "packs", "alpha", "templates", "template-alpha");
  const dst = rt.materialize(cfg, "template-alpha");
  assert.equal(dst, path.join(cfg.workspaceRoot, "projects", "template-alpha"));
  assert.equal(fs.readFileSync(path.join(dst, "剧本.md"), "utf-8"), "# 出厂剧本\n");
  assert.ok(fs.existsSync(path.join(dst, "内部", "mock-llm.py")));
  fs.writeFileSync(path.join(dst, "剧本.md"), "# 被我改过了\n", "utf-8");
  const again = rt.materialize(cfg, "template-alpha");                       // 幂等：不再覆盖
  assert.equal(again, dst);
  assert.equal(fs.readFileSync(path.join(again, "剧本.md"), "utf-8"), "# 被我改过了\n");
  assert.equal(fs.readFileSync(path.join(tpl, "剧本.md"), "utf-8"), "# 出厂剧本\n"); // 包未被写脏
  assert.equal(rt.materialize(cfg, "nosuch"), path.join(cfg.workspaceRoot, "projects", "nosuch")); // 查无模板：交回缺省位
});

test("S5 · 显式复制：可换名、已存在不覆盖、非模板源拒绝", async () => {
  const { cfg } = tmpWorkspace();
  const { rt } = await runtimeFor(cfg);
  const r = cloneTemplateProject(cfg, rt, "template-alpha", "my-copy");
  assert.equal(r.ok, true); assert.equal(r.to, "my-copy");
  assert.ok(fs.existsSync(path.join(cfg.workspaceRoot, "projects", "my-copy", "剧本.md")));
  assert.throws(() => cloneTemplateProject(cfg, rt, "template-alpha", "my-copy"), /不覆盖/);
  assert.throws(() => cloneTemplateProject(cfg, rt, "my-copy"), /已在工作区/);
  assert.throws(() => cloneTemplateProject(cfg, rt, "nosuch"), /查无/);
  assert.equal(rt.inPackTemplates(path.join(cfg.workspaceRoot, "projects", "my-copy", "剧本.md")), false);
});

test("S5 · 内核单点解析：KernelClient 装了 packDirs 后读写两轴同源，未装时行为不变", async () => {
  const { cfg } = tmpWorkspace();
  const { rt } = await runtimeFor(cfg);
  const k = new KernelClient(cfg.kernelBase, cfg.workspaceRoot, CORPUS);
  const bare = k.projectDir("template-alpha");
  assert.equal(bare, path.join(cfg.workspaceRoot, "projects", "template-alpha")); // 未装钩子=旧行为（回落缺省位）
  k.packDirs = { lookup: (p) => rt.templateProjectDir(p), land: (p) => rt.materialize(cfg, p) };
  const tpl = path.join(cfg.workspaceRoot, "packs", "alpha", "templates", "template-alpha");
  assert.equal(k.projectDir("template-alpha"), tpl);
  const landed = k.materializeProject("template-alpha");
  assert.equal(landed, path.join(cfg.workspaceRoot, "projects", "template-alpha"));
  assert.equal(k.projectDir("template-alpha"), landed);   // 落地后读轴跟着换到副本，两轴不分离
  assert.ok(fs.existsSync(path.join(tpl, "剧本.md")));     // 包内容物未被写脏
});

test("S5 · EMPTY 表（无包）不炸：模板查询与落地都按缺省位回显", () => {
  const rt = PackRuntime.EMPTY;
  const cfg = { workspaceRoot: "C:/tmp/ws", corpus: CORPUS } as unknown as HarnessConfig;
  assert.equal(rt.templateProjectDir("template-x"), null);
  assert.equal(rt.projectDir(cfg, "template-x"), path.join("C:/tmp/ws", "projects", "template-x"));
  assert.equal(rt.inPackTemplates("C:/tmp/ws/packs/a/templates/t"), false);
  assert.equal(rt.materialize(cfg, "template-x"), path.join("C:/tmp/ws", "projects", "template-x"));
});

// 真仓形态回归：包名/模板名/内层目录全是中文（packs/deduce/templates/template-推演/推演/script.json）。
// 这条测试的存在理由：本机 Node v24.14.0 的 fs.cpSync 源路径含非 ASCII 会直接打死进程（exit 127 无栈），
// 上面用 ASCII 名的用例全绿也照不出——2026-09-29 冒烟就是这样把 serve 进程弄没的（见收据）。
test("S5 · 中文名模板项目：落地必须真复制（cpSync 在本机对 CJK 源必崩，故走可移植复制）", async () => {
  const { cfg } = tmpWorkspace();
  const packsRoot = path.join(cfg.workspaceRoot, "packs");
  const root = path.join(packsRoot, "推演包");
  fs.mkdirSync(path.join(root, "templates", "template-推演", "推演"), { recursive: true });
  fs.writeFileSync(path.join(root, "templates", "template-推演", "README.md"), "# 出厂说明\n", "utf-8");
  fs.writeFileSync(path.join(root, "templates", "template-推演", "推演", "script.json"), "{\"幕\":[]}\n", "utf-8");
  fs.writeFileSync(
    path.join(root, ".storyharness.json"),
    JSON.stringify({ pack: { name: "推演包", version: "0.0.1" }, extensions: { apis: [{ prefix: "/api/x/", entry: "api/handle.mjs", export: "handle" }] } }, null, 2),
    "utf-8",
  );
  fs.mkdirSync(path.join(root, "api"), { recursive: true });
  fs.writeFileSync(path.join(root, "api", "handle.mjs"), "export async function handle(){}\n", "utf-8");

  const { rt } = await runtimeFor(cfg);
  const tpl = rt.templateProjectDir("template-推演");
  assert.equal(tpl, path.join(root, "templates", "template-推演"));
  const dst = rt.materialize(cfg, "template-推演");
  assert.equal(dst, path.join(cfg.workspaceRoot, "projects", "template-推演"));
  // 落地要「真复制」：整棵树带中文内层目录都在，内容一致
  assert.equal(fs.readFileSync(path.join(dst, "README.md"), "utf-8"), "# 出厂说明\n");
  assert.equal(fs.readFileSync(path.join(dst, "推演", "script.json"), "utf-8"), "{\"幕\":[]}\n");
  // 包内容物保持只读（复制出去，不是搬走）
  assert.ok(fs.existsSync(path.join(tpl!, "推演", "script.json")));
  // 反斜杠项目名：拒绝（Windows 路径分隔符不能当单段目录名）
  assert.equal(rt.templateProjectDir("a\\b"), null);
});
