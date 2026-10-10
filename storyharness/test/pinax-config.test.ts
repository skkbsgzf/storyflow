// pinax 配置层（2026-10-08 去内置档后）：env > 文件 > 默认三级，配置层不携带任何厂商内置分支——
// MINIMAX_API_KEY 之类单独存在不再选中任何 provider 缺省（模型只由配置文件 / env 显式给出）。
// 无网络：只验 loadConfig 的取值判定。
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadConfig } from "../src/pinax/config.js";

const KEYS = [
  "MINIMAX_API_KEY", "MINIFLOW_AGENT_KEY", "ZAI_API_KEY",
  "PINAX_ADAPTER_CONFIG", "PINAX_ADAPTER_PROVIDER", "PINAX_ADAPTER_MODEL", "PINAX_ADAPTER_BASE_URL",
  "PINAX_ADAPTER_THINKING", "PINAX_ADAPTER_PORT", "PINAX_ADAPTER_HOST", "PINAX_ADAPTER_TASKS_DIR",
] as const;

const NO_FILE = path.join(os.tmpdir(), "pinax-config-nonexistent.json");

function withEnv(env: Record<string, string>, fn: () => void) {
  const saved = new Map(KEYS.map((key) => [key, process.env[key]]));
  for (const key of KEYS) delete process.env[key];
  Object.assign(process.env, env);
  try {
    fn();
  } finally {
    for (const key of KEYS) {
      const value = saved.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("MINIMAX_API_KEY 单独存在不再命中任何内置档（缺省回落 DEFAULTS，key 链不含它）", () => {
  withEnv({ MINIMAX_API_KEY: "sk-test-builtin", PINAX_ADAPTER_CONFIG: NO_FILE }, () => {
    const cfg = loadConfig();
    assert.equal(cfg.provider, "zai");
    assert.equal(cfg.model, "glm-5.3");
    assert.equal(cfg.baseUrl, undefined);
    assert.equal(cfg.thinking, "medium");
    assert.equal(cfg.apiKey, undefined);
  });
});

test("显式 agent key：MINIFLOW_AGENT_KEY 进 apiKey 链", () => {
  withEnv({ MINIFLOW_AGENT_KEY: "sk-agent", PINAX_ADAPTER_CONFIG: NO_FILE }, () => {
    const cfg = loadConfig();
    assert.equal(cfg.provider, "zai");
    assert.equal(cfg.model, "glm-5.3");
    assert.equal(cfg.apiKey, "sk-agent");
  });
});

test("ZAI_API_KEY 压过配置文件 apiKey（env > 文件）", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pinax-config-"));
  const file = path.join(dir, "pinax-adapter.json");
  fs.writeFileSync(file, JSON.stringify({ apiKey: "file-key" }));
  try {
    withEnv({ ZAI_API_KEY: "sk-zai", PINAX_ADAPTER_CONFIG: file }, () => {
      const cfg = loadConfig();
      assert.equal(cfg.apiKey, "sk-zai");
    });
    withEnv({ PINAX_ADAPTER_CONFIG: file }, () => {
      const cfg = loadConfig();
      assert.equal(cfg.apiKey, "file-key");
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("配置文件 provider/model/baseUrl 显式给出时原样生效；显式 env 再压过文件", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pinax-config-"));
  const file = path.join(dir, "pinax-adapter.json");
  fs.writeFileSync(file, JSON.stringify({ provider: "openai", model: "dots3-note-prev", baseUrl: "https://note3-prev-api.askdiandian.com/v1" }));
  try {
    withEnv({ MINIMAX_API_KEY: "sk-test-builtin", PINAX_ADAPTER_CONFIG: file }, () => {
      const cfg = loadConfig();
      assert.equal(cfg.provider, "openai");
      assert.equal(cfg.model, "dots3-note-prev");
      assert.equal(cfg.baseUrl, "https://note3-prev-api.askdiandian.com/v1");
    });
    withEnv({ MINIMAX_API_KEY: "sk-test-builtin", PINAX_ADAPTER_MODEL: "m-explicit", PINAX_ADAPTER_CONFIG: file }, () => {
      const cfg = loadConfig();
      assert.equal(cfg.model, "m-explicit");
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
