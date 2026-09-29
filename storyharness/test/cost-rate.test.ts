// C7 · 成本价率源（波11）：
//   · .external 价率表（cfg.pricing，USD/1M tokens）——供应商 usage 行没回报 cost 时按表估算
//   · 未配置/未命中/全 0 价 → 照旧「查无」（costKnown=false，面板不许报 $0 冒充）
//   · 混合轮次（provider 行 + rate 行）totals.costBasis='mixed'，逐行口径总额=已知轮求和
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import path from "node:path";
import { KernelClient } from "../src/kernel.js";
import { sessionStats } from "../src/chat.js";
import { rateOf, rateCost } from "../src/metrics.js";
import type { CorpusLayout, HarnessConfig } from "../src/config.js";

const CORPUS: CorpusLayout = {
  projectsDir: "projects",
  receiptsDir: path.join("内部", "收据"),
  quarantineDir: path.join("内部", "backup"),
  sessionsDir: path.join("内部", "sessions"),
  telemetryDir: path.join("内部", "telemetry"),
  lintTool: path.join("tools", "flow-lint.py"),
  lintCommand: "python",
};

const PID = "p-rate";

function makeProject(files: Record<string, string>): { root: string; kernel: KernelClient } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rate-"));
  const dir = path.join(root, "projects", PID, "内部", "sessions");
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body, "utf-8");
  return { root, kernel: new KernelClient("http://127.0.0.1:1", root, CORPUS) };
}

function cfgWith(pricing: HarnessConfig["pricing"]): HarnessConfig {
  return {
    harnessVersion: "0.0.0", workspaceRoot: ".", corpusName: "test", corpus: CORPUS,
    serve: {} as HarnessConfig["serve"], kernelBase: "http://127.0.0.1:1", project: PID,
    provider: "zai", model: "glm-test", maxParallel: 1, thinking: "medium",
    pricing,
  } as HarnessConfig;
}

// 无 cost 字段的 usage 行（B9 前的旧形态 / 不回报成本的供应商）
const SESSION = [
  JSON.stringify({ ts: "2026-09-29T00:00:00Z", kind: "session_start", meta: { project: PID, mode: "chat", title: "t" } }),
  JSON.stringify({ ts: "2026-09-29T00:00:01Z", kind: "message", role: "user", content: "问" }),
  JSON.stringify({ ts: "2026-09-29T00:00:02Z", kind: "message", role: "assistant", content: "答", usage: { input: 1_000_000, output: 500_000, cacheRead: 0, cacheWrite: 0, totalTokens: 1_500_000 } }),
].join("\n") + "\n";

test("C7：命中价率表 → cost=输入×2 + 输出×8（每百万），costBasis=rate", () => {
  const { kernel } = makeProject({ "s1.jsonl": SESSION });
  const s = sessionStats(kernel, cfgWith({ "zai/glm-test": { input: 2, output: 8 } }), PID, "s1");
  assert.equal(s.turns[0].costKnown, true);
  assert.equal(s.turns[0].costBasis, "rate");
  assert.equal(s.turns[0].cost, 6, "(1M×$2 + 0.5M×$8)/1M = $6");
  assert.equal(s.totals.costKnown, true);
  assert.equal(s.totals.cost, 6);
  assert.equal(s.totals.costBasis, "rate");
});

test("C7：未配置价率 → 照旧查无（costKnown=false，cost 不许冒充 0 之外还装真）", () => {
  const { kernel } = makeProject({ "s1.jsonl": SESSION });
  const s = sessionStats(kernel, cfgWith(undefined), PID, "s1");
  assert.equal(s.turns[0].costKnown, false);
  assert.equal(s.totals.costKnown, false);
  assert.equal(s.totals.costBasis, "none");
});

test("C7：裸 model id 键兜底命中；全 0 价视为未配置", () => {
  assert.ok(rateOf({ "glm-test": { input: 1, output: 2 } }, "zai", "glm-test"), "裸 id 命中");
  assert.equal(rateOf({ "zai/glm-test": { input: 0, output: 0 } }, "zai", "glm-test"), null, "全 0 价=没配");
  assert.equal(rateOf(undefined, "zai", "glm-test"), null);
  // rateCost 纯函数：cacheRead 未配价不计
  assert.equal(rateCost({ input: 10, output: 10, cacheRead: 5, cacheWrite: 0, totalTokens: 25 } as never, { input: 1, output: 2 }), 30 / 1e6, "(10×1+10×2)/1M=0.00003，cacheRead 不计");
});
