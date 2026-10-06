// P1 口径统一：provider 注册表 / thinking 预算单源的行为钉（无网络——只验构造面）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { PROVIDER_PROFILES, THINKING_BUDGETS, makeModels } from "../src/llm.js";

test("dots profile 携带国产端点兼容旗标（自 pinax-adapter runner.ts 迁入）", () => {
  const compat = PROVIDER_PROFILES.dots?.compat;
  assert.equal(compat?.supportsDeveloperRole, false);
  assert.equal(compat?.supportsStore, false);
  assert.equal(compat?.supportsReasoningEffort, false);
  assert.equal(compat?.maxTokensField, "max_tokens");
});

test("minimax profile 缺省端点与建议思维档", () => {
  assert.equal(PROVIDER_PROFILES.minimax?.baseUrl, "https://api.minimaxi.com/v1");
  assert.equal(PROVIDER_PROFILES.minimax?.thinking, "off");
});

test("THINKING_BUDGETS 单源且漂移判决为 high.high=32768", () => {
  assert.deepEqual(THINKING_BUDGETS.off, {});
  assert.deepEqual(THINKING_BUDGETS.medium, { low: 2048, medium: 8192, high: 16384 });
  assert.equal(THINKING_BUDGETS.high?.high, 32768);
});

test("makeModels：dots 自定义端点注入 compat 旗标", () => {
  const models = makeModels({ provider: "dots", model: "dots3-note-prev", apiKey: "test-key", baseUrl: "https://example.invalid/v1" });
  const m = models.getModel("dots", "dots3-note-prev") as unknown as { compat?: unknown } | undefined;
  assert.ok(m, "dots 模型应可解析");
  assert.deepEqual(m.compat, { supportsDeveloperRole: false, supportsStore: false, supportsReasoningEffort: false, maxTokensField: "max_tokens" });
});

test("makeModels：generic 端点仅固定 max_tokens 兼容字段，不带 dots 全旗标", () => {
  const models = makeModels({ provider: "custom-relay", model: "m1", apiKey: "test-key", baseUrl: "https://example.invalid/v1" });
  const m = models.getModel("custom-relay", "m1") as unknown as { compat?: unknown } | undefined;
  assert.ok(m, "custom 模型应可解析");
  assert.deepEqual(m.compat, { maxTokensField: "max_tokens" }, "兼容面缺省：OpenAI 兼容中转普遍只认 max_tokens");
});

test("makeModels：minimax 未配 baseUrl 时用 profile 缺省端点", () => {
  const models = makeModels({ provider: "minimax", model: "MiniMax-Text-01", apiKey: "test-key" });
  const m = models.getModel("minimax", "MiniMax-Text-01") as unknown as { baseUrl?: string } | undefined;
  assert.ok(m, "minimax 模型应可解析");
  assert.equal(m.baseUrl, "https://api.minimaxi.com/v1");
});
