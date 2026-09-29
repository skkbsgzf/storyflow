// 工单 D-B2 · 红队判官校准抽样：同题面同文本，强模型（glm-5.3）逐条款独立打分 vs 判官 flagged 对照。
// 用法：node runs/cali-check/calibrate.mjs  → 退出码 0 = 脚本跑通；报告人工落 docs/。
// 额度纪律：强模型调用 ≤4 次（本脚本 2 次：plot-redline + 分镜剧本各一次）。
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PY = `${ROOT}/tools/_vendor/laya-venv/Scripts/python.exe`;
const BRIDGE = `${ROOT}/tools/storyharness/glm_chat.py`;
const SPEC = JSON.parse(fs.readFileSync(`${ROOT}/tools/laya-ft/questions.spec.json`, "utf-8"));
const strongCfg = JSON.parse(fs.readFileSync(`${ROOT}/.external/storyharness.json`, "utf-8")).tiers?.high
  ? { baseUrl: "https://api.z.ai/api/coding/paas/v4", model: "glm-5.3", apiKey: JSON.parse(fs.readFileSync(`${ROOT}/.external/storyharness.json`, "utf-8")).apiKey }
  : (() => { throw new Error("缺 tiers.high 配置"); })();

// 抽样对象：判官 flagged 最重的两份产物（p-sh-final 实测 plot-redline 7/7、分镜 6/7）
const SAMPLES = [
  { file: `${ROOT}/projects/p-sh-final/02-编剧/plot-redline.md`, label: "plot-redline", clauses: ["slop.ai-trace.v2.noul", "craft.sensory-concrete.v1.noul", "aesthetic.dialogue-push.v1.noul", "slop.neg-pattern.v1.noul", "slop.reveal-stack.v1.noul", "craft.daisy-chain.v1.noul", "craft.simile-suspend.v1.noul"] },
  { file: `${ROOT}/projects/p-sh-final/03-成剧/分镜剧本.md`, label: "分镜剧本", clauses: ["slop.ai-trace.v2.noul", "craft.sensory-concrete.v1.noul", "aesthetic.dialogue-push.v1.noul", "slop.neg-pattern.v1.noul", "slop.reveal-stack.v1.noul", "craft.simile-suspend.v1.noul"] },
];

const clauseInstr = (qid) => {
  const q = SPEC.questions[qid];
  return q ? q.instructions : `（条款 ${qid} 题面缺失）`;
};

function strongJudge(text, clauses) {
  const dir = os.tmpdir();
  const cfgFile = path.join(dir, `cali-cfg-${Date.now()}.json`);
  const bodyFile = path.join(dir, `cali-body-${Date.now()}.json`);
  fs.writeFileSync(cfgFile, JSON.stringify(strongCfg), "utf-8");
  const clauseList = clauses.map((c, i) => `${i + 1}. [${c}] ${clauseInstr(c)}`).join("\n\n");
  const bodyText = text.length > 9000 ? text.slice(0, 9000) + "\n…（后文截断）" : text;
  fs.writeFileSync(bodyFile, JSON.stringify({
    messages: [
      { role: "system", content: "你是独立质量评审。只按给出的条款定义逐条判断文本是否违反，不发散。输出严格 JSON。" },
      { role: "user", content: `对下面的文本逐条判断是否违反条款（violates: true/false，confidence: 0-1，reason: ≤40 字）：\n\n${clauseList}\n\n=== 文本 ===\n${bodyText}\n\n输出：{"verdicts":[{"clause":"<qid>","violates":bool,"confidence":number,"reason":"…"}]}` },
    ],
    max_tokens: 32768, temperature: 0.2,
  }), "utf-8");
  const p = spawnSync(PY, [BRIDGE, "--body", bodyFile, "--config", cfgFile], { encoding: "utf-8", timeout: 900_000, maxBuffer: 64 << 20, env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
  for (const f of [cfgFile, bodyFile]) { try { fs.rmSync(f, { force: true }); } catch { /* */ } }
  if (p.error || !p.stdout?.trim()) throw new Error(`桥调用失败：${p.error?.message ?? "空返回"}`);
  const line = p.stdout.trim().split("\n").filter((l) => l.trim().startsWith("{")).pop() || "{}";
  let content = "";
  try { content = JSON.parse(line).content || ""; } catch { /* */ }
  const m = content.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("强模型输出无 JSON：" + content.slice(0, 120));
  return JSON.parse(m[0]).verdicts;
}

const report = [];
for (const s of SAMPLES) {
  const text = fs.readFileSync(s.file, "utf-8").replace(/^---\n[\s\S]*?\n---\n/, "");
  console.error(`[calibrate] ${s.label}：${s.clauses.length} 条款 → glm-5.3 强判…`);
  const verdicts = strongJudge(text, s.clauses);
  const rows = s.clauses.map((c) => {
    const v = verdicts.find((x) => x.clause === c || x.clause?.includes(c)) ?? {};
    return { clause: c, judge: "flagged", strong: v.violates === true ? "violates" : v.violates === false ? "clean" : "no-answer", confidence: v.confidence ?? "", reason: String(v.reason ?? "").slice(0, 60) };
  });
  report.push({ label: s.label, rows });
  console.log(`\n=== ${s.label} ===`);
  for (const r of rows) console.log(`${r.judge} vs ${r.strong} | ${r.clause} | ${r.reason}`);
}
fs.writeFileSync(`${ROOT}/runs/cali-check/last-result.json`, JSON.stringify(report, null, 1), "utf-8");
console.log("\nCALIBRATE-DONE（结果 runs/cali-check/last-result.json）");
