// LLM 绑定：pi-ai Models（provider 目录含 zai=GLM 全家族 / openai / anthropic / deepseek…）。
// 自定义端点（mock / Z.ai 自定义 baseUrl）走 createProvider + setProvider——仍是 pi 底座，非自研环。
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

export function makeModels(t: LlmTarget): Models {
  const models = createModels();
  if (t.baseUrl) {
    // 自定义 OpenAI 兼容端点（内联 key 走 headers；无 key 也允许——本地 mock/网关）
    models.setProvider(
      createProvider({
        id: t.provider,
        name: t.provider,
        baseUrl: t.baseUrl,
        auth: { apiKey: envApiKeyAuth("pi-agent key", ["MINIFLOW_AGENT_KEY", "ZAI_API_KEY"]) },
        models: [
          {
            id: t.model,
            provider: t.provider,
            api: "openai-completions",
            name: t.model,
            baseUrl: t.baseUrl,
            reasoning: true,
            input: ["text"],
            contextWindow: 128_000,
            maxTokens: 16_384,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
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
