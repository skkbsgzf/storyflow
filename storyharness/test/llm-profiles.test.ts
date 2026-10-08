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

test("minimax profile 已移除（2026-10-08 去写死：模型由调用方显式配置，注册表不带厂商内置档）", () => {
  assert.equal(PROVIDER_PROFILES.minimax, undefined);
});

test("anthropic profile：协议轴登记（api=anthropic-messages + /anthropic 与原生域兜底）", () => {
  const p = PROVIDER_PROFILES.anthropic;
  assert.equal(p?.api, "anthropic-messages");
  assert.ok(p?.hosts?.includes("/anthropic"), "各家 /anthropic 兼容路径应命中");
  assert.ok(p?.hosts?.includes("api.anthropic.com"), "Anthropic 原生域应命中");
  assert.equal(p?.foldSystemIntoUser, undefined, "Anthropic 线 system 在顶层 params，折叠层不适用");
});

test("makeModels：baseUrl 命中 /anthropic → 模型走 anthropic-messages 且不套 OpenAI 兼容旗标", () => {
  const models = makeModels({ provider: "minimax", model: "MiniMax-Text-01", apiKey: "test-key", baseUrl: "https://api.minimaxi.com/anthropic" });
  const m = models.getModel("minimax", "MiniMax-Text-01") as unknown as { api?: string; compat?: unknown } | undefined;
  assert.ok(m, "Anthropic 端点模型应可解析");
  assert.equal(m.api, "anthropic-messages");
  assert.equal(m.compat, undefined, "maxTokensField/supportsDeveloperRole 是 openai-completions 语义，不跨线套用");
});

test("makeModels：显式 api 压过端点推断，缺省仍是 openai-completions", () => {
  const forced = makeModels({ provider: "custom-relay", model: "m1", apiKey: "test-key", baseUrl: "https://example.invalid/v1", api: "anthropic-messages" });
  assert.equal((forced.getModel("custom-relay", "m1") as unknown as { api?: string }).api, "anthropic-messages");
  const dflt = makeModels({ provider: "custom-relay", model: "m1", apiKey: "test-key", baseUrl: "https://example.invalid/v1" });
  assert.equal((dflt.getModel("custom-relay", "m1") as unknown as { api?: string }).api, "openai-completions");
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

test("makeModels：未登记 profile 的端点仅固定 max_tokens 兼容字段，不带厂商旗标", () => {
  const models = makeModels({ provider: "vendor-x", model: "vendor-x-chat", apiKey: "test-key", baseUrl: "https://api.vendor-x.invalid/v1" });
  const m = models.getModel("vendor-x", "vendor-x-chat") as unknown as { baseUrl?: string; compat?: unknown } | undefined;
  assert.ok(m, "未登记 profile 的模型应可解析");
  // 去写死后确保：未登记 provider 一律走 generic 回落（此前 minimax 缺省端点在此被断言删除）
  assert.deepEqual(m.compat, { maxTokensField: "max_tokens" });
});

// 设置面的 provider 是厂商预设（openai / custom…），用户把 baseUrl 手填到别家端点后预设 id 表达不了真实端点。
// 只按 id 查表会漏掉 dots profile，端点就收到它明确拒绝的 developer 角色（见 llm.ts ProviderCompat 注释）。
test("makeModels：provider 预设不是 dots 但 baseUrl 命中 dots 域名——仍取 dots 旗标", () => {
  const models = makeModels({
    provider: "openai",
    model: "dots3-note-prev",
    apiKey: "test-key",
    baseUrl: "https://note3-prev-api.askdiandian.com/v1",
  });
  const m = models.getModel("openai", "dots3-note-prev") as unknown as { compat?: unknown } | undefined;
  assert.ok(m, "模型应可解析");
  assert.deepEqual(m.compat, { supportsDeveloperRole: false, supportsStore: false, supportsReasoningEffort: false, maxTokensField: "max_tokens" });
});

test("makeModels：域名也不命中时仍走 generic 回落（不误伤新增能力）", () => {
  const models = makeModels({ provider: "openai", model: "gpt-x", apiKey: "test-key", baseUrl: "https://api.example.invalid/v1" });
  const m = models.getModel("openai", "gpt-x") as unknown as { compat?: unknown } | undefined;
  assert.ok(m, "模型应可解析");
  assert.deepEqual(m.compat, { maxTokensField: "max_tokens" });
});

test("makeModels：provider id 命中时压过域名推断", () => {
  const models = makeModels({ provider: "dots", model: "m", apiKey: "test-key", baseUrl: "https://api.example.invalid/v1" });
  const m = models.getModel("dots", "m") as unknown as { compat?: unknown } | undefined;
  assert.ok(m, "模型应可解析");
  assert.equal((m.compat as { supportsDeveloperRole?: boolean })?.supportsDeveloperRole, false);
});

test("dots profile 标记独立 system 不兼容（foldSystemIntoUser——空补全/400 兼容折叠）", () => {
  assert.equal(PROVIDER_PROFILES.dots?.foldSystemIntoUser, true);
});
