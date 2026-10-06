// 运行配置：优先级 env > 配置文件（.external/pinax-adapter.json 或 PINAX_ADAPTER_CONFIG 指定路径）> 默认。
// 口径与 storyharness/config.ts 一致：密钥只活在 gitignore 的文件或环境变量里。
import * as fs from "node:fs";
import path from "node:path";

export interface AdapterBudget {
  agentTimeoutMs: number;
  maxModelSteps: number;
  maxCallsPerTurn: number;
  maxToolResultChars: number;
}

export interface AdapterConfig {
  port: number;
  host: string;
  /** 任务快照目录（相对包根或绝对路径） */
  tasksDir: string;
  /** LLM 绑定（OpenAI 兼容端点 / zai 目录内置） */
  provider: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  thinking: "off" | "low" | "medium" | "high";
  /** 预算守护默认值（请求体 budget.* 可逐项覆盖） */
  budget: AdapterBudget;
  /** CORS 允许来源；空 = 反射 *（开发态） */
  allowedOrigins: string[];
}

const DEFAULTS: AdapterConfig = {
  port: 8451,
  host: "127.0.0.1",
  tasksDir: "tasks",
  provider: "zai",
  model: "glm-5.3",
  thinking: "medium",
  budget: {
    agentTimeoutMs: 240_000,
    maxModelSteps: 8,
    maxCallsPerTurn: 6,
    maxToolResultChars: 4200,
  },
  allowedOrigins: [],
};

type FileConfig = Partial<Omit<AdapterConfig, "budget">> & { budget?: Partial<AdapterBudget> };

function pkgRoot(): string {
  return path.resolve(import.meta.dirname, "..", "..");
}

export function loadConfig(explicit?: Partial<AdapterConfig>): AdapterConfig {
  let fileCfg: FileConfig = {};
  const candidates = [
    process.env.PINAX_ADAPTER_CONFIG,
    path.join(pkgRoot(), ".external", "pinax-adapter.json"),
  ].filter(Boolean) as string[];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) {
        fileCfg = JSON.parse(fs.readFileSync(c, "utf-8"));
        break;
      }
    } catch { /* 坏配置回落下一候选 */ }
  }

  const env = process.env;
  const pick = <T>(envVal: string | undefined, fileVal: T | undefined, def: T): T =>
    (envVal !== undefined ? (envVal as unknown as T) : fileVal !== undefined ? fileVal : def);

  const builtinMiniMax = Boolean(env.MINIMAX_API_KEY && !env.MINIFLOW_AGENT_KEY && !env.ZAI_API_KEY && !fileCfg.apiKey);
  const cfg: AdapterConfig = {
    port: Number(env.PINAX_ADAPTER_PORT ?? fileCfg.port ?? DEFAULTS.port),
    host: pick(env.PINAX_ADAPTER_HOST, fileCfg.host, DEFAULTS.host),
    tasksDir: path.resolve(pkgRoot(), env.PINAX_ADAPTER_TASKS_DIR ?? fileCfg.tasksDir ?? DEFAULTS.tasksDir),
    provider: pick(env.PINAX_ADAPTER_PROVIDER, fileCfg.provider, builtinMiniMax ? "minimax" : DEFAULTS.provider),
    model: pick(env.PINAX_ADAPTER_MODEL, fileCfg.model, builtinMiniMax ? "MiniMax-Text-01" : DEFAULTS.model),
    apiKey: env.MINIFLOW_AGENT_KEY ?? env.ZAI_API_KEY ?? fileCfg.apiKey ?? env.MINIMAX_API_KEY,
    baseUrl: env.PINAX_ADAPTER_BASE_URL ?? fileCfg.baseUrl ?? (builtinMiniMax ? "https://api.minimaxi.com/v1" : undefined),
    thinking: pick(env.PINAX_ADAPTER_THINKING, fileCfg.thinking, builtinMiniMax ? "off" : DEFAULTS.thinking),
    budget: { ...DEFAULTS.budget, ...(fileCfg.budget || {}), ...(explicit?.budget || {}) },
    allowedOrigins: Array.isArray(fileCfg.allowedOrigins)
      ? fileCfg.allowedOrigins
      : String(fileCfg.allowedOrigins ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  };
  if (explicit) {
    for (const [k, v] of Object.entries(explicit)) {
      if (k === "budget") continue;
      if (v !== undefined) (cfg as unknown as Record<string, unknown>)[k] = v;
    }
  }
  return cfg;
}
