// LLM 绑定：pi-ai Models（provider 目录含 zai=GLM 全家族 / openai / anthropic / deepseek…）。
// 自定义端点（mock / Z.ai 自定义 baseUrl）走 createProvider + setProvider——仍是 pi 底座，非自研环。
// Provider 注册表（2026-10 agent 口径统一 P1）：具名 provider 的兼容旗标/缺省端点集中在此，
// storyharness 执行环与 pinax-adapter（vendor 副本）共用同一份；新增 provider = 加一条 profile。
import {
  createModels,
  createProvider,
  envApiKeyAuth,
  type Model,
  type Models,
} from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { zaiProvider } from "@earendil-works/pi-ai/providers/zai";
import type { StreamFn } from "@earendil-works/pi-agent-core";

export interface LlmTarget { provider: string; model: string; apiKey?: string; baseUrl?: string }

/** OpenAI 兼容端点的兼容旗标（pi-ai openai-completions 语义）。
 *  dots.ai 等国产端点实测：拒绝 developer 角色（400 provider.client_bad_request）、不发 reasoning_effort；
 *  思维链以 reasoning_content 增量返回（pi-ai 原生解析）。 */
export interface ProviderCompat {
  supportsDeveloperRole?: boolean;
  supportsStore?: boolean;
  supportsReasoningEffort?: boolean;
  maxTokensField?: "max_tokens" | "max_completion_tokens";
}

/** 具名 provider profile：compat 旗标与缺省端点/建议思维档的唯一登记处。 */
export interface ProviderProfile {
  /** OpenAI 兼容旗标（仅自定义 baseUrl 分支消费；generic 端点不带旗标） */
  compat?: ProviderCompat;
  /** 未配 baseUrl 时的缺省端点 */
  baseUrl?: string;
  /** 建议思维档（调用方自行取用；makeModels 不改写调用方配置） */
  thinking?: "off" | "low" | "medium" | "high";
}

export const PROVIDER_PROFILES: Record<string, ProviderProfile> = {
  dots: {
    compat: { supportsDeveloperRole: false, supportsStore: false, supportsReasoningEffort: false, maxTokensField: "max_tokens" },
  },
  minimax: {
    baseUrl: "https://api.minimaxi.com/v1",
    thinking: "off",
  },
};

/** thinking 档 → reasoning token 预算（单源：executor 与 chat 都从这里取）。
 *  历史漂移：storyharness 两份 32768 与 pinax-adapter 一份 32384 并存——统一取 32768。 */
export const THINKING_BUDGETS: Record<string, { minimal?: number; low?: number; medium?: number; high?: number }> = {
  off: {},
  low: { low: 1024, medium: 2048, high: 4096 },
  medium: { low: 2048, medium: 8192, high: 16384 },
  high: { low: 4096, medium: 16384, high: 32768 },
};

export function makeModels(t: LlmTarget): Models {
  const models = createModels();
  const profile = PROVIDER_PROFILES[t.provider];
  const baseUrl = t.baseUrl ?? profile?.baseUrl;
  // 兼容面缺省：OpenAI 兼容中转/网关（含国产与本地 mock）普遍只认 max_tokens——generic 也固定该字段，
  // 仅具名 profile 能再加旗标（dots 全量）。此前 kit 不发旗标、adapter 无差别发 dots 全旗标，都不精确。
  const compat = profile?.compat ?? { maxTokensField: "max_tokens" as const };
  if (baseUrl) {
    // 自定义 OpenAI 兼容端点（内联 key 走 headers；无 key 也允许——本地 mock/网关）
    models.setProvider(
      createProvider({
        id: t.provider,
        name: t.provider,
        baseUrl,
        auth: {
          apiKey: {
            // 配置内联 apiKey 优先，环境变量兜底——自定义端点不再依赖进程 env
            name: t.apiKey ? "端点 key（配置内联）" : "pi-agent key",
            resolve: async (input: Parameters<NonNullable<ReturnType<typeof envApiKeyAuth>["resolve"]>>[0]) =>
              t.apiKey
                ? { auth: { apiKey: t.apiKey }, source: "配置内联 apiKey" }
                : envApiKeyAuth("pi-agent key", ["MINIFLOW_AGENT_KEY", "ZAI_API_KEY"]).resolve(input),
          },
        },
        models: [
          {
            id: t.model,
            provider: t.provider,
            api: "openai-completions",
            name: t.model,
            baseUrl,
            reasoning: true,
            input: ["text"],
            contextWindow: 128_000,
            maxTokens: 16_384,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            // 兼容旗标：generic 固定 max_tokens 字段，具名 profile（dots 等）叠加完整旗标
            ...(compat ? { compat } : {}),
          },
        ],
        api: openAICompletionsApi(),
        headers: t.apiKey ? { authorization: `Bearer ${t.apiKey}` } : undefined,
      }),
    );
    return models;
  }
  // 内置 provider 目录默认为空——按需注册（zai=GLM 全家族，ZAI_API_KEY 鉴权，coding 端点）
  if (t.provider === "zai") {
    // zaiProvider 走 envApiKeyAuth(ZAI_API_KEY)——配置文件的内联 key 落本进程 env，行为等同（不落盘）
    if (t.apiKey) process.env.ZAI_API_KEY = t.apiKey;
    models.setProvider(zaiProvider());
  }
  return models;
}

export function resolveModel(models: Models, t: LlmTarget): Model<any> {
  const m = models.getModel(t.provider, t.model);
  if (!m) {
    const available = models.getModels(t.provider).map((x) => x.id).join(", ");
    throw new Error(
      `模型不可解析：${t.provider}/${t.model}` +
        (available ? `（该 provider 可用：${available}）` : "（provider 未注册；自定义端点需配 baseUrl）"),
    );
  }
  return m;
}

/** pi-agent-core 的 StreamFn = pi-ai Models.streamSimple（同一目录、同一鉴权、同一流协议）。
 *  maxTokens 显式拉高：zai 全是推理模型，max_tokens 含 reasoning——默认值会被思维链吃光致 content 为空。
 *  timeoutMs 显式 900s：OpenAI SDK 默认 10 分钟——全量档（glm-5.3 非 flash）带思维链的大节点会撞线
 *  （p-sh-final 实测 structure-design "Request timed out."）。 */
export function makeStreamFn(models: Models, maxTokens = 32_768, timeoutMs = 900_000): StreamFn {
  return (model, context, options) =>
    models.streamSimple(model, context as never, { ...(options as Record<string, unknown> | undefined), maxTokens, timeoutMs } as never) as never;
}
