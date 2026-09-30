// v0.8 目标3/4 接线单测：
//   ① skillTools——kit/skills.tools.json 注册表 → skill_<slug> 工具装载（点号映射/缺卡报缺/空注册表）
//   ② kb 图模式——kit/hypergraph.rag.json 在场时 kbSearch 走编译图；kbRead 对未安装源卡带指引报缺
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import path from "node:path";
import { KernelClient } from "../src/kernel.js";
import { buildTools } from "../src/tools.js";
import { kbSearch, kbRead } from "../../core/src/kb.js";
// R7-1 起 core 不 import 宿主实现：本测试跑在 Node 上，须自己登记平台缺省适配器（storyharness 是宿主）
import "../../core/src/abstraction/adapters/node.js";
import type { CorpusLayout } from "../src/config.js";

const CORPUS: CorpusLayout = {
  projectsDir: "projects",
  receiptsDir: path.join("内部", "收据"),
  quarantineDir: path.join("内部", "backup"),
  sessionsDir: path.join("内部", "sessions"),
  telemetryDir: path.join("内部", "telemetry"),
  lintTool: path.join("tools", "flow-lint.py"),
  lintCommand: "python",
};

function tmpWorkspace(): { root: string; kernel: KernelClient } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kit-"));
  fs.mkdirSync(path.join(root, "projects", "p-k"), { recursive: true });
  fs.mkdirSync(path.join(root, "kit"), { recursive: true });
  fs.mkdirSync(path.join(root, "skills"), { recursive: true });
  return { root, kernel: new KernelClient("http://127.0.0.1:1", root, CORPUS) };
}

test("skillTools：注册表 → skill_<slug> 工具装载（点号映射），调用返回源卡全文", async () => {
  const { root, kernel } = tmpWorkspace();
  fs.writeFileSync(path.join(root, "kit", "skills.tools.json"), JSON.stringify({
    format: "storyflow-skill-tools@1", count: 1,
    tools: [{ tool: "skill.dialogue_polish", version: 2, title: "对白打磨", summary: "对白级精修",
      constraints: { stage: "polish", inputs: "正文", outputs: "打磨后正文", trigger: null }, source: "skills/dialogue-polish.md" }],
  }), "utf-8");
  fs.writeFileSync(path.join(root, "skills", "dialogue-polish.md"), "# 对白打磨\n\n打磨纪律全文。", "utf-8");
  const tools = buildTools(kernel, "p-k");
  const t = tools.find((x) => x.name === "skill_dialogue_polish") as any;
  assert.ok(t, "注册表工具必须以 skill_<slug>（点号→下划线）装载");
  assert.match(t.description, /\[skill v2\] 对白打磨/);
  assert.match(t.description, /stage: polish/);
  const r = await t.execute("id", {});
  assert.match(r.content[0].text, /打磨纪律全文/, "调用即返回源卡全文");
});

test("skillTools：源卡未安装显式报缺（md 是本地可插拔层）；无注册表 = 空装载不阻塞", async () => {
  const { root, kernel } = tmpWorkspace();
  fs.writeFileSync(path.join(root, "kit", "skills.tools.json"), JSON.stringify({
    tools: [{ tool: "skill.ghost", version: 1, title: "幽灵技能", summary: "无源卡", constraints: {}, source: "skills/ghost.md" }],
  }), "utf-8");
  const t = buildTools(kernel, "p-k").find((x) => x.name === "skill_ghost") as any;
  const r = await t.execute("id", {});
  assert.match(r.content[0].text, /源卡未安装/);
  // 无注册表：不阻塞工具环
  const empty = tmpWorkspace();
  const tools2 = buildTools(empty.kernel, "p-k");
  assert.ok(!tools2.some((x) => x.name.startsWith("skill_")));
});

test("kb 图模式：kit/hypergraph.rag.json 在场时检索走编译图（标题/标签/域打分）", () => {
  const { root, kernel } = tmpWorkspace();
  const kbDir = path.join(root, "knowledge");
  fs.mkdirSync(kbDir, { recursive: true });
  fs.writeFileSync(path.join(root, "kit", "hypergraph.rag.json"), JSON.stringify({
    format: "storyflow-hypergraph@1",
    entries: [
      { id: "kb/craft/curve", title: "情绪曲线标准", domain: "craft", path: "knowledge/craft/curve.md", tags: ["曲线", "节奏"] },
      { id: "kb/market/x", title: "无关词条", domain: "market", path: "knowledge/market/x.md", tags: [] },
    ],
    relations: [],
  }), "utf-8");
  const r = kbSearch(kbDir, { q: "情绪曲线" });
  assert.equal(r.hits[0].id, "kb/craft/curve");
  assert.ok(r.hits[0].score > 0);
  assert.match(r.hits[0].excerpt, /标签/);
  // 源卡未安装：kbRead 报缺带指引（不裸抛「不存在」）
  assert.throws(() => kbRead(kbDir, "kb/craft/curve"), /本地可插拔层|源文件未安装/);
});
