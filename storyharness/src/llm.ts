// LLM 绑定：pi-ai Models（provider 目录含 zai=GLM 全家族 / openai / anthropic / deepseek…）。
// 自定义端点（mock / Z.ai 自定义 baseUrl）走 createProvider + setProvider——仍是 pi 底座，非自研环。
// Provider 注册表（2026-10 agent 口径统一 P1）：具名 provider 的兼容旗标/缺省端点集中在此，
// 执行环（executor/chat）与 pinax 任务面配置层（src/pinax/config.ts）共用同一份；
// 新增 provider = 加一条 profile。
import {
  createModels,
  createProvider,
  envApiKeyAuth,
  type Model,
  type Models,
} from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { zaiProvider } from "@earendil-works/pi-ai/providers/zai";
import type { StreamFn } from "@earendil-works/pi-agent-core";

/** 传输协议轴：pi-ai 原生两条线，自定义端点按配置/profile 择一，缺省 openai-completions。 */
export type LlmApi = "openai-completions" | "anthropic-messages";

export interface LlmTarget { provider: string; model: string; apiKey?: string; baseUrl?: string; api?: LlmApi }

/** OpenAI 兼容端点的兼容旗标（pi-ai openai-completions 语义）。
 *  dots.ai 等国产端点实测：拒绝 developer 角色（400 provider.client_bad_request）、不发 reasoning_effort；
 *  思维链以 reasoning_content 增量返回（pi-ai 原生解析）。 */
export interface ProviderCompat {
  supportsDeveloperRole?: boolean;
  supportsStore?: boolean;
  supportsReasoningEffort?: boolean;
  maxTokensField?: "max_tokens" | "max_completion_tokens";
}

/** 具名 provider profile：兼容旗标、缺省端点、传输协议与建议思维档的唯一登记处。 */
export interface ProviderProfile {
  /** OpenAI 兼容旗标（仅 openai-completions 线消费；anthropic 线的 compat 面不同，不套用） */
  compat?: ProviderCompat;
  /** 未配 baseUrl 时的缺省端点 */
  baseUrl?: string;
  /** 传输协议。anthropic-messages 线把 system 拆到顶层 params.system，
   *  messages 内不存在独立 system 轮——foldSystemIntoUser 对它是天然 no-op，不要置真。 */
  api?: LlmApi;
  /** 建议思维档（调用方自行取用；makeModels 不改写调用方配置） */
  thinking?: "off" | "low" | "medium" | "high";
  /** 端点域名（命中即取本 profile）。
   *  provider id 是设置面的厂商预设（openai / custom…），用户手填 baseUrl 指向别家端点后
   *  预设 id 表达不了真实端点——此时按域名兜住。与 pi-ai detectCompat 的
   *  `provider === X || baseUrl.includes(域名)` 同轴（pi-ai/api/openai-completions.js detectCompat）。 */
  hosts?: string[];
  /** 独立 system 轮不兼容：点对点实测（dots 系端点）——systemPrompt 独立轮或 messages 内
   *  system/developer 轮一律空补全/400，与 tools、流式无关；折进首条 user 后全通。
   *  makeModels 出口据此挂 onPayload 钩子（请求发出前改写），消费方零改动。 */
  foldSystemIntoUser?: boolean;
}

export const PROVIDER_PROFILES: Record<string, ProviderProfile> = {
  dots: {
    compat: { supportsDeveloperRole: false, supportsStore: false, supportsReasoningEffort: false, maxTokensField: "max_tokens" },
    hosts: ["askdiandian.com"],
    foldSystemIntoUser: true,
  },
  // Anthropic 协议端点（原生 api.anthropic.com，以及各家 /anthropic 兼容路径——
  // 与 pi-ai 自带 providers/minimax-cn.js 同一条线：baseUrl 直用、鉴权走 x-api-key）
  anthropic: {
    api: "anthropic-messages",
    hosts: ["/anthropic", "api.anthropic.com"],
  },
};

/** provider id 优先（用户显式选择压过推断）；未登记时按 baseUrl 域名兜底。 */
function resolveProfile(provider: string, baseUrl?: string): ProviderProfile | undefined {
  const byId = PROVIDER_PROFILES[provider];
  if (byId) return byId;
  if (!baseUrl) return undefined;
  return Object.values(PROVIDER_PROFILES).find((p) => p.hosts?.some((h) => baseUrl.includes(h)));
}

/** OpenAI 兼容请求体的独立 system 折叠（foldSystemIntoUser 行为体）：
 *  把 messages 里全部 system/developer 轮文本并入首条 user（无 user 则前置一条），其余顺序不变。
 *  content 形状随 pi-ai 组装（user 为 text 块数组、assistant 为字符串）——两种都处理。
 *  无 system 轮返回 undefined（pi-ai onPayload 语义：保持 payload 原样）。 */
export function foldSystemIntoUserPayload(payload: unknown): unknown | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const body = payload as { messages?: unknown };
  if (!Array.isArray(body.messages)) return undefined;
  const isSystemRole = (message: unknown): boolean => {
    const role = (message as { role?: string } | undefined)?.role;
    return role === "system" || role === "developer";
  };
  const textOf = (content: unknown): string => {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .filter((block) => (block as { type?: string })?.type === "text")
        .map((block) => String((block as { text?: string }).text ?? ""))
        .join("");
    }
    return "";
  };
  const systemText = body.messages
    .filter(isSystemRole)
    .map((message) => textOf((message as { content?: unknown }).content))
    .filter(Boolean)
    .join("\n\n");
  if (!systemText) return undefined;
  const rest = body.messages
    .filter((message) => !isSystemRole(message))
    .map((message) => ({ ...(message as Record<string, unknown>) }));
  const firstUser = rest.find((message) => message.role === "user");
  if (firstUser) {
    firstUser.content = typeof firstUser.content === "string"
      ? `${systemText}\n\n${firstUser.content}`.trim()
      : [{ type: "text", text: systemText }, ...(Array.isArray(firstUser.content) ? firstUser.content : [])];
  } else {
    rest.unshift({ role: "user", content: [{ type: "text", text: systemText }] });
  }
  return { ...body, messages: rest };
}

/** makeModels 出口包装：命中 foldSystemIntoUser 的 profile 时给三个请求方法注入 onPayload 折叠。
 *  一处安装覆盖全部消费方（runner Agent 循环 / planningAgent / modelFunnel complete+stream / makeStreamFn）。
 *  调用方自带 onPayload 时链式保留（先调用方后折叠）；非命中 profile 原样返回零开销。 */
function withSystemFolding(models: Models, profile: ProviderProfile | undefined): Models {
  if (!profile?.foldSystemIntoUser) return models;
  const record = models as unknown as Record<string, unknown>;
  const composeOptions = (options: unknown): Record<string, unknown> => {
    const base = (options && typeof options === "object" ? options : {}) as Record<string, unknown>;
    const previous = base.onPayload as ((payload: unknown, model: unknown) => unknown | Promise<unknown>) | undefined;
    return {
      ...base,
      onPayload: async (payload: unknown, model: unknown) => {
        const next = (previous ? await previous(payload, model) : payload) ?? payload;
        return foldSystemIntoUserPayload(next);
      },
    };
  };
  for (const method of ["streamSimple", "complete", "completeSimple"] as const) {
    const original = record[method];
    if (typeof original !== "function") continue;
    const bound = (original as (...args: unknown[]) => unknown).bind(models);
    record[method] = (...args: unknown[]) => {
      args[2] = composeOptions(args[2]);
      return bound(...args);
    };
  }
  return models;
}

/** thinking 档 → reasoning token 预算（单源：storyharness executor/chat 与 pinax runner/funnel 都从这里取）。
 *  历史漂移已收口：曾三份并存（storyharness 两份 32768、pinax-adapter 一份 32384，随 vendor 副本退役）；
 *  32768 由 test/llm-profiles.test.ts 钉住。 */
export const THINKING_BUDGETS: Record<string, { minimal?: number; low?: number; medium?: number; high?: number }> = {
  off: {},
  low: { low: 1024, medium: 2048, high: 4096 },
  medium: { low: 2048, medium: 8192, high: 16384 },
  high: { low: 4096, medium: 16384, high: 32768 },
};

export function makeModels(t: LlmTarget): Models {
  const models = createModels();
  const profile = resolveProfile(t.provider, t.baseUrl);
  const baseUrl = t.baseUrl ?? profile?.baseUrl;
  const api = t.api ?? profile?.api ?? "openai-completions";
  // 兼容面缺省：OpenAI 兼容中转/网关（含国产与本地 mock）普遍只认 max_tokens——generic 也固定该字段，
  // 仅具名 profile 能再加旗标（dots 全量）。此前 kit 不发旗标、adapter 无差别发 dots 全旗标，都不精确。
  // 这些旗标是 openai-completions 传输的语义（Anthropic 有自己的 compat 面），anthropic 线不套。
  const compat = api === "anthropic-messages" ? undefined : (profile?.compat ?? { maxTokensField: "max_tokens" as const });
  if (baseUrl) {
    // 自定义端点（内联 key；无 key 也允许——本地 mock/网关），传输按 api 二选一
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
            api,
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
        api: api === "anthropic-messages" ? anthropicMessagesApi() : openAICompletionsApi(),
        // openai-completions 线自己带 Bearer 头；anthropic 线交回传输层按 x-api-key 组装
        // （两个头同发会被 Anthropic 拒，key 也已在 auth.resolve 里给到 pi-ai）
        headers: api === "anthropic-messages" || !t.apiKey ? undefined : { authorization: `Bearer ${t.apiKey}` },
      }),
    );
    return withSystemFolding(models, profile);
  }
  // 内置 provider 目录默认为空——按需注册（zai=GLM 全家族，ZAI_API_KEY 鉴权，coding 端点）
  if (t.provider === "zai") {
    // zaiProvider 走 envApiKeyAuth(ZAI_API_KEY)——配置文件的内联 key 落本进程 env，行为等同（不落盘）
    if (t.apiKey) process.env.ZAI_API_KEY = t.apiKey;
    models.setProvider(zaiProvider());
  }
  return withSystemFolding(models, profile);
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
