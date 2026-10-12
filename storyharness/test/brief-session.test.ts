import assert from "node:assert/strict";
import { test } from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import path from "node:path";
import { buildProjectBrief, gatherBriefParts } from "../src/brief.js";

// 批次3e 改造（2026-10-12）：项目配置.json.sessionBrief 声明位 → 会话简报逐条注入。
// 无 flow 的改稿/协作会话靠它携带文风卡路径、协作纪律、外部资产库位置等项目专属上下文。
// 批次4 4.2 改造（2026-10-12）：openQuestions 冷启动询问未答项 → 简报尾部「【待询问（冷启动）】」段。

function tmpProject(cfg: Record<string, unknown>, state?: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "brief-sb-"));
  fs.writeFileSync(path.join(dir, "项目配置.json"), JSON.stringify(cfg), "utf-8");
  if (state) fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify(state), "utf-8");
  return dir;
}

const fakeKernel = (dir: string) => ({ projectDir: (_p: string) => dir }) as never;

test("sessionBrief：项目配置带 sessionBrief → 简报逐条注入（无 flow 也出简报）", () => {
  const dir = tmpProject({
    项目: "p-x",
    灵感: "梦核网文改稿",
    sessionBrief: ["文风卡：规则/文风-draft.md（draft 待审）", "外部原版库：D:\\写作\\Kit Project"],
  });
  const brief = buildProjectBrief(fakeKernel(dir), "p-x");
  assert.ok(brief, "有 direction 就应出简报（历史行为）");
  assert.match(brief, /题材方向：梦核网文改稿/);
  assert.match(brief, /- 文风卡：规则\/文风-draft\.md（draft 待审）/);
  assert.match(brief, /- 外部原版库：D:\\写作\\Kit Project/);
  assert.match(brief, /以上简报已覆盖盘面事实/);
});

test("sessionBrief：缺省（无该字段）→ 简报与历史行为一致（零回归）", () => {
  const dir = tmpProject({ 项目: "p-y", 灵感: "短剧" });
  const brief = buildProjectBrief(fakeKernel(dir), "p-y");
  assert.ok(brief);
  assert.doesNotMatch(brief, /文风卡/);
  assert.match(brief, /- 项目：p-y/);
  assert.match(brief, /- 题材方向：短剧/);
  const body = brief.split("\n").filter((l) => l.startsWith("- ") && !l.includes("以上简报已覆盖"));
  assert.equal(body.length, 2); // 项目行 + 题材方向行（历史口径，尾注行除外）
});

test("sessionBrief：非字符串项被过滤（声明位容错，坏项不进简报）", () => {
  const dir = tmpProject({ 项目: "p-z", 灵感: "x", sessionBrief: ["ok 条目", 42, null, "另一条"] });
  const parts = gatherBriefParts(fakeKernel(dir), "p-z");
  assert.deepEqual(parts.sessionBrief, ["ok 条目", "另一条"]);
});

test("sessionBrief：灵感与 flow 双缺 → 仍无简报（触发条件不变）", () => {
  const dir = tmpProject({ 项目: "p-w", sessionBrief: ["只有自述没有 direction"] });
  const brief = buildProjectBrief(fakeKernel(dir), "p-w");
  assert.equal(brief, null);
});

test("openQuestions：未答项 → 简报尾部「待询问（冷启动）」段逐条注入（无 flow 无 direction 也出简报）", () => {
  const dir = tmpProject({
    项目: "p-cold",
    openQuestions: [
      { key: "产物类型", question: "本项目的产物形态是哪种？", options: ["网文", "通俗小说", "剧本"] },
      { key: "题材", question: "题材/赛道是什么？" },
      { key: "mediaEndpoints", question: "涉及配图或视频吗？涉及则必须给出生图/视频接口", options: ["无（纯文字）"] },
      // 已答项（answer 非空）与坏项（缺 key/question / 非对象）都不注入
      { key: "频道", question: "目标频道是哪侧？", options: ["男频", "女频"], answer: "男频" },
      { question: "缺 key 不注入" },
      "not-an-object",
    ],
  });
  const brief = buildProjectBrief(fakeKernel(dir), "p-cold");
  assert.ok(brief, "冷启动例外：有未答 openQuestions 就应出简报（历史配置无此字段，零回归）");
  assert.match(brief, /【待询问（冷启动）】以下 3 项未答/);
  assert.match(brief, /- 〔产物类型〕本项目的产物形态是哪种？（选项：网文 \/ 通俗小说 \/ 剧本）/);
  assert.match(brief, /- 〔题材〕题材\/赛道是什么？$/m); // 无 options 不带括号段
  assert.match(brief, /- 〔mediaEndpoints〕.*（选项：无（纯文字））/);
  assert.doesNotMatch(brief, /频道/); // 已答项不注入
  assert.match(brief, /答案回填 项目配置\.json 的 openQuestions\[\]\.answer/);
  // 注入段在简报尾部（收尾注行之后）
  const lines = brief.split("\n");
  assert.ok(lines.findIndex((l) => l.includes("【待询问（冷启动）")) > lines.findIndex((l) => l.includes("以上简报已覆盖盘面事实")));
});

test("openQuestions：全部答完 → 不注入待询问段（简报回到历史形状；无 direction 无 flow 时回 null）", () => {
  const dir = tmpProject({
    项目: "p-done",
    openQuestions: [
      { key: "产物类型", question: "产物形态？", answer: "网文" },
      { key: "单章字数", question: "单章字数？", options: ["2000", "3000"], answer: "3000" },
    ],
  });
  const parts = gatherBriefParts(fakeKernel(dir), "p-done");
  assert.equal(parts.openQuestions, undefined); // 未答清单为空
  const brief = buildProjectBrief(fakeKernel(dir), "p-done");
  assert.equal(brief, null); // 全答完且无其他触发源 → 回到历史 null 行为
  // 有 direction 时：简报正常出、无待询问段
  const dir2 = tmpProject({
    项目: "p-done2",
    灵感: "题材已定",
    openQuestions: [{ key: "产物类型", question: "产物形态？", answer: "剧本" }],
  });
  const brief2 = buildProjectBrief(fakeKernel(dir2), "p-done2");
  assert.ok(brief2);
  assert.doesNotMatch(brief2, /待询问/);
  assert.match(brief2, /- 项目：p-done2/);
});
