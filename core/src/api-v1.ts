// miniflow HTTP 面 · **v1 标准化**（工单 R4 第 3–4 条）：版本化前缀 + 统一包装 + 自生成 OpenAPI。
//
// 为什么要另起一张表而不是把 /api/v1 抄在 `http.ts` 里：
//   OpenAPI 文档必须**派生**于路由表（`scripts/gen-openapi.mjs` 直接读 `V1_ROUTES`），
//   而 `http.ts` 里的 legacy 面是「页面便利端点 + serve.py 语义」的历史集合，形状杂、
//   且被 `storyharness/`、`adapter/`、页面模板与 `tools/page-lint.mjs` 逐字段消费——动它等于动一片连接面。
//   所以 v1 是一张**新表**：注册、文档、对账三处读同一份，动词直通再读 `verbs.ts`。
//
// 旧路由怎么办（工单写的是「301」，这里是刻意偏离，理由要留在代码里）：
//   ① `POST /api/verbs/:verb` 走 301 会被 fetch/浏览器**降级成 GET**（RFC 9110 允许），
//      那是把写操作静默改语义，比 404 更糟；
//   ② legacy JSON 载荷被仓内 11 个文件按字段直读（adapter/、storyharness/、页面模板、page-lint），
//      重定向只是推迟断裂，不消除断裂；
//   ③ 版本化的正确姿势是**新面可用、旧面标注**：这里给所有 legacy `/api/*` 挂
//      `deprecation: true` + `successor-version: /api/v1` 响应头（IETF deprecation 草案口径），
//      载荷逐字节不变。旧面退场由消费方按头迁移，而不是由内核单方面 301。
// ── fastify 类型形状的本地结构化子集（R7-2）：库面不 import fastify ——
// 宿主传真 fastify 实例，结构相容即可指派（方法式声明的参数双向协变）。
// 成员面 = 本文件与 compat.ts 实际用到的成员，不预支 fastify 全 API。
export interface RawResponseLike {
  url?: string;
  once(event: string, listener: () => void): unknown;
  writeHead(status: number, headers: Record<string, string>): unknown;
  write(chunk: string): unknown;
  end(chunk?: string): unknown;
  destroyed?: boolean;
}
export interface RequestLike {
  readonly raw: RawResponseLike;
  readonly params: Record<string, unknown>;
  readonly query: Record<string, unknown>;
  readonly body: unknown;
}
export interface ReplyLike {
  readonly raw: RawResponseLike;
  code(status: number): unknown;
  header(name: string, value: unknown): unknown;
  type(contentType: string): unknown;
}
export interface RouteRegistrar {
  get(path: string, handler: (req: RequestLike, reply: ReplyLike) => unknown): unknown;
  post(path: string, handler: (req: RequestLike, reply: ReplyLike) => unknown): unknown;
  put(path: string, handler: (req: RequestLike, reply: ReplyLike) => unknown): unknown;
  delete(path: string, handler: (req: RequestLike, reply: ReplyLike) => unknown): unknown;
  addHook(name: string, hook: (req: RequestLike, reply: ReplyLike, done: () => void) => void): unknown;
}
import { Kernel, KernelError } from "./kernel.js";
import { LEDGER_POLL_DEFAULT_MS, projectEvents, PROJECT_EVENT_TYPES } from "./project-stream.js";
import { closeSignalOf, emitSseEvents, heartbeatMsOf, DEFAULT_HEARTBEAT_MS, HEARTBEAT_MIN_MS, HEARTBEAT_MAX_MS, SSE_FRAME_DONE, sseFrame, type SseEvent } from "./sse.js";
import { VERBS, VERB_BY_NAME, VERB_NAMES, verbArgIssues, verbJsonSchema } from "./verbs.js";

export const API_VERSION = "v1";

export interface ApiMeta {
  apiVersion: typeof API_VERSION;
  /** 声明这条响应来自哪张表的哪一行（`V1_ROUTES` 的 path 原样，含 `:id` 这类参数名）。 */
  route: string;
  at: string;
  /** 动词直通时回显动词名，让「面 = 表」在响应体里自证。 */
  verb?: string;
}

export interface ApiResponse<T = unknown> {
  ok: true;
  data: T;
  meta: ApiMeta;
}

export interface ApiErrorBody {
  ok: false;
  error: { code: string; message: string; detail?: string };
  meta: ApiMeta;
}

/** 端点自己抛的领域错误（内核错误由 `KernelError.http/code` 直接映射，不经这里）。 */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly http = 400,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface V1QuerySpec {
  name: string;
  required: boolean;
  desc: string;
}

export interface V1Ctx {
  params: Record<string, string>;
  query: Record<string, string>;
  body: Record<string, unknown>;
  /** 仅 `sse` 路由：客户端断开信号。源（`projectEvents` 的 stopSignal）与管道（`closeSignal`）共用这一把，
   *  否则断开只能递一个 `.return()`——生成器卡在静默 sleep 里不会到 yield 点，watchDir 就永远不取消。 */
  closeSignal?: Promise<unknown>;
}

export interface V1Route {
  method: "GET" | "POST" | "PUT" | "DELETE";
  /** 注册用的 Fastify 路径（`:id` 形式）——同时是 `meta.route` 与 OpenAPI 的寻源。 */
  path: string;
  summary: string;
  query?: V1QuerySpec[];
  /** 请求体必填键（文档口径；真正的类型约束由 handler/内核执行，不在此重复实现）。 */
  bodyRequired?: string[];
  bodyDesc?: string;
  /**
   * true = 这条路由是 SSE 流：`handler` 的返回值是**事件源**（异步可迭代），不套 JSON 信封。
   * 校验必须写在 handler 返回事件源**之前**——那时响应头还没发，错误仍能走统一信封；
   * 流开始之后再抛就只能补一帧 error，信封救不回来。
   */
  sse?: true;
  handler: (kernel: Kernel, ctx: V1Ctx) => unknown | Promise<unknown>;
}

const boolQ = (v: string | undefined): boolean => v === "1" || v === "true";
const intQ = (v: string | undefined): number | undefined => (v === undefined || v === "" ? undefined : Number(v));

/**
 * 项目当前 flow id：state.json 优先，缺省回落到 flows 下第一个可读 flow
 * （与 legacy `/api/projects/:id/graph`、workbench-payload 同策略——单点实现在这里，
 * 两个面共用，不再各写一份）。
 */
export function resolveProjectFlowId(kernel: Kernel, projectId: string): string {
  const stateFile = kernel.path.join(kernel.projectDir(projectId), "state.json");
  if (kernel.fs.exists(stateFile)) {
    try {
      const st = JSON.parse(kernel.fs.readText(stateFile)) as { flowId?: string };
      if (st.flowId) return st.flowId;
    } catch {
      /* 坏 state.json：走回落，让「读不到 flow」而不是「读不到 state」成为报出的那个错 */
    }
  }
  if (kernel.fs.exists(kernel.flowsDir)) {
    for (const d of kernel.fs.readDir(kernel.flowsDir)) {
      if (kernel.fs.exists(kernel.path.join(kernel.flowsDir, d, "flow.json"))) return d;
    }
  }
  return "";
}

/** 布尔型查询参数只认 1/true；其余一律 false（不做「给了值就算真」的模糊判定）。 */
const LATEST: V1QuerySpec = { name: "latest", required: false, desc: "1/true＝每个节点只留最新一版" };

export const V1_ROUTES: V1Route[] = [
  {
    method: "GET",
    path: `/api/${API_VERSION}`,
    summary: "v1 面自述：版本、路由清单、动词直通入口",
    handler: () => ({
      apiVersion: API_VERSION,
      routes: V1_ROUTES.filter((r) => r.path !== `/api/${API_VERSION}`).map(
        (r) => `${r.method} ${r.path} — ${r.summary}`,
      ),
      verbs: { count: VERBS.length, endpoint: `POST /api/${API_VERSION}/verbs/{verb}`, names: VERB_NAMES },
      openapi: `GET /api/${API_VERSION}/openapi.json`,
    }),
  },
  {
    method: "GET",
    path: `/api/${API_VERSION}/verbs`,
    summary: "动词表原样（三面同源的事实源：CLI/HTTP/MCP 都读这张表）",
    handler: () =>
      VERBS.map((v) => ({
        name: v.name,
        group: v.group,
        description: v.description,
        params: v.params.map((p) => ({
          name: p.name,
          type: p.type,
          required: !!p.required,
          desc: p.desc,
          ...(p.enum ? { enum: p.enum } : {}),
        })),
      })),
  },
  {
    method: "POST",
    path: `/api/${API_VERSION}/verbs/:verb`,
    summary: "动词直通：入参按 verbs.ts 的参数表前置校验（400 VALIDATION），执行与 CLI/MCP 同一条路径",
    bodyDesc: "各动词的入参见 GET /api/v1/verbs 或 OpenAPI 里逐动词的 requestBody",
    handler: async (kernel, { params, body }) => {
      const def = VERB_BY_NAME[params.verb ?? ""];
      if (!def) {
        throw new ApiError("UNKNOWN_VERB", `表里没有动词 ${params.verb}`, 404, `可用动词：${VERB_NAMES.join(", ")}`);
      }
      const issues = verbArgIssues(def, body);
      if (issues.length) {
        throw new ApiError("VALIDATION", `入参不合动词 ${def.name} 的表定义`, 400, issues.join("；"));
      }
      return await def.run(kernel, body);
    },
  },
  {
    method: "GET",
    path: `/api/${API_VERSION}/projects`,
    summary: "项目清单",
    handler: (kernel) => kernel.viewProjects(),
  },
  {
    method: "GET",
    path: `/api/${API_VERSION}/projects/:id/state`,
    summary: "项目运行态 state.json 原样",
    handler: (kernel, { params }) => {
      const file = kernel.path.join(kernel.projectDir(params.id ?? ""), "state.json");
      if (!kernel.fs.exists(file)) throw new ApiError("NO_RUN", `项目 ${params.id} 无 state.json（未开跑）`, 404);
      return JSON.parse(kernel.fs.readText(file)) as unknown;
    },
  },
  {
    method: "GET",
    path: `/api/${API_VERSION}/projects/:id/graph`,
    summary: "项目所用 flow 的描述符（flowId 取自 state，缺省回落首个可读 flow）",
    handler: (kernel, { params }) => {
      const flowId = resolveProjectFlowId(kernel, params.id ?? "");
      if (!flowId) throw new ApiError("NO_FLOW", "找不到可读的 flow（flows/ 下没有 flow.json）", 404);
      return kernel.loadFlow(flowId);
    },
  },
  {
    method: "GET",
    path: `/api/${API_VERSION}/projects/:id/artifacts`,
    summary: "已登记产物清单（registry/artifacts.json）",
    query: [{ name: "node", required: false, desc: "只看该节点的产物" }, LATEST],
    handler: (kernel, { params, query }) =>
      kernel.viewArtifacts(params.id ?? "", { node: query.node, latest: boolQ(query.latest) }),
  },
  {
    method: "GET",
    path: `/api/${API_VERSION}/projects/:id/artifacts/content`,
    summary: "产物正文：未注册＝读不到（登记表是唯一准入，路径穿越天然无效）",
    query: [{ name: "path", required: true, desc: "项目内相对路径（必须已在 registry 登记）" }],
    handler: (kernel, { params, query }) => {
      const rel = query.path ?? "";
      if (!rel) throw new ApiError("MISSING_PATH", "查询参数 path 必填", 400, "带 ?path=<项目内相对路径>；已登记清单见 GET /api/v1/projects/:id/artifacts");
      const text = kernel.viewArtifactContent(params.id ?? "", rel);
      if (text === undefined) {
        throw new ApiError("NOT_REGISTERED", "未注册产物不可读（未注册＝不存在）", 403, `${params.id}/${rel}`);
      }
      return { path: rel, content: rel.endsWith(".json") ? JSON.parse(text) : text };
    },
  },
  {
    method: "GET",
    path: `/api/${API_VERSION}/projects/:id/journal`,
    summary: "执行流水（journal.jsonl）",
    query: [
      { name: "since", required: false, desc: "起始 ISO 时间" },
      { name: "limit", required: false, desc: "条数上限" },
      { name: "node", required: false, desc: "只看该节点" },
    ],
    handler: (kernel, { params, query }) =>
      kernel.viewJournal(params.id ?? "", { since: query.since, limit: intQ(query.limit), node: query.node }),
  },
  {
    method: "GET",
    path: `/api/${API_VERSION}/projects/:id/live`,
    summary: "实时切片：state ⊕ 生效编排 ⊕ overlay ⊕ 提案 ⊕ 指标 ⊕ 诊断 ⊕ revision 指纹",
    query: [{ name: "files", required: false, desc: "1/true＝附产物正文（可能上 MB，轮询默认不带）" }],
    handler: (kernel, { params, query }) => kernel.viewLive(params.id ?? "", { files: boolQ(query.files) }),
  },
  {
    method: "GET",
    path: `/api/${API_VERSION}/projects/:id/stream`,
    summary: `项目事件流（SSE）：journal 台账投影为 ${PROJECT_EVENT_TYPES.join(" / ")} ＋ 空闲 heartbeat；watch 只作重读提示，正确性不依赖它`,
    query: [
      {
        name: "heartbeatMs",
        required: false,
        desc: `空闲补心跳间隔（缺省 ${DEFAULT_HEARTBEAT_MS}，钳制 ${HEARTBEAT_MIN_MS}–${HEARTBEAT_MAX_MS}）；台账重读节拍取 min(本值, ${LEDGER_POLL_DEFAULT_MS})，事件延迟上限由此决定`,
      },
    ],
    sse: true,
    handler: (kernel, { params, query, closeSignal }) => {
      // 校验在返回事件源之前：此刻还没写响应头，错误还能走统一 JSON 信封
      const projectDir = kernel.projectDir(params.id ?? "");
      if (!kernel.fs.exists(projectDir)) {
        throw new ApiError("NO_PROJECT", `项目 ${params.id} 不存在`, 404, "GET /api/v1/projects 看清单");
      }
      // 重读节拍与心跳分家：心跳是保活信号（可以慢），事件到达不该等满一个 10s 周期
      return projectEvents(kernel, params.id ?? "", {
        beatMs: Math.min(LEDGER_POLL_DEFAULT_MS, heartbeatMsOf(query.heartbeatMs)),
        stopSignal: closeSignal,
      });
    },
  },
  {
    method: "GET",
    path: `/api/${API_VERSION}/projects/:id/diagnostics`,
    summary: "项目级旁路诊断（有旁路失败＝证据链可能不完整）",
    handler: (kernel, { params }) => kernel.viewDiagnostics(params.id ?? ""),
  },
  {
    method: "GET",
    path: `/api/${API_VERSION}/diagnostics`,
    summary: "仓库级旁路诊断",
    handler: (kernel) => kernel.viewDiagnostics(),
  },
  {
    method: "GET",
    path: `/api/${API_VERSION}/projects/:id/snapshots/:node`,
    summary: "节点快照（交付即存档的历史层）",
    handler: (kernel, { params }) => kernel.viewSnapshots(params.id ?? "", params.node ?? ""),
  },
  {
    method: "GET",
    path: `/api/${API_VERSION}/projects/:id/config`,
    summary: "项目配置视图",
    handler: (kernel, { params }) => kernel.viewConfig(params.id ?? ""),
  },
  {
    method: "PUT",
    path: `/api/${API_VERSION}/projects/:id/config`,
    summary: "项目配置写入（内核校验，未识别键显式回显不静默）",
    bodyDesc: "配置键值对象",
    handler: (kernel, { params, body }) => kernel.writeConfig(params.id ?? "", body),
  },
  {
    method: "GET",
    path: `/api/${API_VERSION}/projects/:id/workbench-payload`,
    summary: "工作台整包（页面一次取齐）",
    handler: (kernel, { params }) => kernel.viewWorkbenchPayload(params.id ?? ""),
  },
  {
    method: "POST",
    path: `/api/${API_VERSION}/projects/:id/gate`,
    summary: "人工裁决（仅 kit 边界与显式 manual 门；陈旧轮次由内核 STALE_GATE 拒）",
    bodyRequired: ["nodeId", "verdict"],
    bodyDesc: "{ nodeId, verdict: pass|pass-with-conditions|send-back|reject, comment?, rootCauseStage?, force?, round?, token? }",
    handler: (kernel, { params, body }) =>
      kernel.flow_gate(params.id ?? "", body as unknown as Parameters<Kernel["flow_gate"]>[1]),
  },
  {
    method: "POST",
    path: `/api/${API_VERSION}/projects/:id/rerun`,
    summary: "改 done 节点产物的唯一正路（缺省 dryRun=true，先看影响面）",
    bodyRequired: ["nodeId"],
    bodyDesc: "{ nodeId, dryRun? }",
    handler: (kernel, { params, body }) =>
      kernel.flow_rerun(params.id ?? "", {
        nodeId: String((body.nodeId ?? "") as string),
        dryRun: body.dryRun === undefined ? true : !!body.dryRun,
      }),
  },
];

/** 表里没有的路径一律 404，且用同一份包装（避免「新面半成品」伪装成可用）。 */
export function v1RouteOf(path: string): V1Route | undefined {
  return V1_ROUTES.find((r) => r.path === path);
}

export function okEnvelope(route: V1Route, data: unknown, verb?: string): ApiResponse {
  const meta: ApiMeta = { apiVersion: API_VERSION, route: route.path, at: new Date().toISOString() };
  if (verb) meta.verb = verb;
  return { ok: true, data, meta };
}

export function errEnvelope(route: V1Route, e: unknown, verb?: string): ApiErrorBody {
  const meta: ApiMeta = { apiVersion: API_VERSION, route: route.path, at: new Date().toISOString() };
  if (verb) meta.verb = verb;
  if (e instanceof ApiError) {
    return { ok: false, error: { code: e.code, message: e.message, ...(e.detail ? { detail: e.detail } : {}) }, meta };
  }
  if (e instanceof KernelError) {
    return { ok: false, error: { code: e.code, message: e.message }, meta };
  }
  return { ok: false, error: { code: "INTERNAL", message: e instanceof Error ? e.message : String(e) }, meta };
}

/** 内核错误 → HTTP 状态码的既有映射（KernelError.http）；ApiError 自带。 */
function statusOf(e: unknown): number {
  if (e instanceof ApiError) return e.http;
  if (e instanceof KernelError) return e.http;
  return 500;
}

export function registerV1(app: RouteRegistrar, kernel: Kernel): void {
  for (const route of V1_ROUTES) {
    if (route.sse) {
      app.get(route.path, async (req: RequestLike, reply: ReplyLike): Promise<unknown> => {
        // 断开信号在调用 handler **之前**成型：handler 要把它接进事件源（取消 watchDir）
        const closeSignal = closeSignalOf(reply.raw);
        const ctx: V1Ctx = {
          params: (req.params ?? {}) as Record<string, string>,
          query: (req.query ?? {}) as Record<string, string>,
          body: {},
          closeSignal,
        };
        const heartbeatMs = heartbeatMsOf(ctx.query.heartbeatMs);
        let source: AsyncIterable<SseEvent>;
        try {
          source = (await route.handler(kernel, ctx)) as AsyncIterable<SseEvent>;
        } catch (e) {
          // 头还没发：仍然给统一信封（客户端按 ok/error 分支，不必为流单独写一套错误处理）
          reply.code(statusOf(e));
          return errEnvelope(route, e);
        }
        reply.raw.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
          connection: "keep-alive",
          "x-accel-buffering": "no",
        });
        const open: SseEvent = {
          type: "open",
          apiVersion: API_VERSION,
          route: route.path,
          projectId: ctx.params.id ?? "",
          ts: new Date().toISOString(),
          projected: [...PROJECT_EVENT_TYPES],
          heartbeatMs,
        };
        try {
          await emitSseEvents({ write: (t: string) => reply.raw.write(t) }, source, { open, heartbeatMs, closeSignal });
        } catch (e) {
          // 头已发出，信封救不回来：补一帧 error 再收口——认 `[DONE]` 为结束标记的客户端不许吊在半路
          reply.raw.write(sseFrame({ type: "error", message: e instanceof Error ? e.message : String(e) }));
          reply.raw.write(SSE_FRAME_DONE);
        }
        reply.raw.end();
        return reply;
      });
      continue;
    }
    const handler = async (req: RequestLike, reply: ReplyLike): Promise<unknown> => {
      const ctx: V1Ctx = {
        params: (req.params ?? {}) as Record<string, string>,
        query: (req.query ?? {}) as Record<string, string>,
        body: (req.body ?? {}) as Record<string, unknown>,
      };
      const verb = route.path.endsWith("/verbs/:verb") ? ctx.params.verb : undefined;
      try {
        const data = await route.handler(kernel, ctx);
        if (data === undefined) {
          reply.code(204);
          return "";
        }
        return okEnvelope(route, data, verb);
      } catch (e) {
        reply.code(statusOf(e));
        return errEnvelope(route, e, verb);
      }
    };
    if (route.method === "GET") app.get(route.path, handler);
    else if (route.method === "POST") app.post(route.path, handler);
    else if (route.method === "PUT") app.put(route.path, handler);
    else app.delete(route.path, handler);
  }

  // OpenAPI 文档本身**不套信封**：它是给工具读的文件，不是给页面读的数据。
  app.get(`/api/${API_VERSION}/openapi.json`, async (_req, reply) => {
    reply.type("application/json; charset=utf-8");
    return buildOpenApiV1();
  });
}

/** legacy `/api/*`（非 v1）挂弃用标记：载荷逐字节不变，迁移信号走响应头。 */
export function registerLegacyMarkers(app: RouteRegistrar): void {
  app.addHook("onRequest", (req, reply, done) => {
    const url = (req.raw.url ?? "/").split("?")[0] ?? "/";
    if (url.startsWith("/api/") && !url.startsWith(`/api/${API_VERSION}/`) && url !== `/api/${API_VERSION}`) {
      reply.header("deprecation", "true");
      reply.header("successor-version", `/api/${API_VERSION}`);
    }
    done();
  });
}

// ── OpenAPI 生成（表 = 文档，`scripts/gen-openapi.mjs` 与运行时端点共用本函数）──

const ENVELOPE_SCHEMA = {
  type: "object",
  required: ["ok", "data", "meta"],
  properties: {
    ok: { type: "boolean", enum: [true] },
    data: { description: "端点各自形状，见本操作 description；未规范化字段一律显式标出，不静默丢弃" },
    meta: {
      type: "object",
      required: ["apiVersion", "route", "at"],
      properties: {
        apiVersion: { type: "string", enum: [API_VERSION] },
        route: { type: "string", description: "来源路由（含参数名，等于 V1_ROUTES 的 path）" },
        at: { type: "string", description: "响应产生时刻（ISO 8601）" },
        verb: { type: "string", description: "动词直通时回显动词名" },
      },
    },
  },
};

const ERROR_SCHEMA = {
  type: "object",
  required: ["ok", "error", "meta"],
  properties: {
    ok: { type: "boolean", enum: [false] },
    error: {
      type: "object",
      required: ["code", "message"],
      properties: {
        code: { type: "string", description: "领域错误码（KernelError.code / ApiError.code，如 NO_RUN、STALE_GATE、VALIDATION、UNKNOWN_VERB）" },
        message: { type: "string" },
        detail: { type: "string", description: "找回路径（怎么改对），能给出时必须给" },
      },
    },
    meta: ENVELOPE_SCHEMA.properties.meta,
  },
};

const openApiPath = (p: string): string => p.replace(/:([A-Za-z_]+)/g, "{$1}");

function pathParamsOf(p: string): { name: string; in: "path"; required: true; schema: { type: "string" }; description: string }[] {
  return [...p.matchAll(/:([A-Za-z_]+)/g)].map((m) => ({
    name: m[1] as string,
    in: "path" as const,
    required: true as const,
    schema: { type: "string" },
    description: `路径参数 ${m[1]}`,
  }));
}

/**
 * 由 `V1_ROUTES` + `VERBS` 生成 OpenAPI 3.1 文档。
 * 逐动词各出一条路径（不是 `{verb}` 通配）是刻意的：`openapi 含全动词` 这条门禁要能被
 * grep 与脚本直接对账，通配符那条做不到。
 */
export function buildOpenApiV1(): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  const put = (p: string, method: string, op: Record<string, unknown>): void => {
    paths[p] = { ...(paths[p] ?? {}), [method.toLowerCase()]: op };
  };

  for (const r of V1_ROUTES) {
    const ok200 = r.sse
      ? {
          description:
            "SSE 流（不套信封）：data: 帧逐事件，事件的 type ∈ " +
            PROJECT_EVENT_TYPES.join(" / ") +
            " ＋ open / heartbeat；空闲按 heartbeatMs 补帧，结束写 [DONE]。订阅点之前的历史不重放，查 GET /api/v1/projects/{id}/journal",
          content: {
            "text/event-stream": {
              schema: {
                type: "object",
                required: ["type"],
                properties: {
                  type: { type: "string", enum: ["open", ...PROJECT_EVENT_TYPES, "heartbeat", "error"] },
                  event: { type: "string", description: "投影来源的台账 kind（node_*/gate_pending 才有）" },
                  ts: { type: "string" },
                  nodeId: { type: "string", description: "缺席＝项目级事件（台账该条没有节点归属）" },
                  detail: { type: "string" },
                  refs: { type: "array", items: { type: "string" } },
                },
              },
            },
          },
        }
      : {
          description: "统一包装：ok=true，业务数据在 data",
          content: { "application/json": { schema: ENVELOPE_SCHEMA } },
        };
    const op: Record<string, unknown> = {
      summary: r.summary,
      description: r.summary,
      tags: [r.path.includes("/verbs") ? "verbs" : r.sse ? "stream" : r.path.includes("/projects/:id/gate") || r.path.includes("/rerun") ? "run" : "read"],
      parameters: [
        ...pathParamsOf(r.path),
        ...(r.query ?? []).map((q) => ({
          name: q.name,
          in: "query",
          required: q.required,
          description: q.desc,
          schema: { type: "string" },
        })),
      ],
      responses: {
        "200": ok200,
        default: {
          description: r.sse ? "流开始**之前**的错误仍走统一信封（项目不存在等校验先于响应头）" : "统一错误包装：ok=false，错误码在 error.code",
          content: { "application/json": { schema: ERROR_SCHEMA } },
        },
      },
    };
    if (r.method !== "GET" && r.method !== "DELETE") {
      op.requestBody = {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              ...(r.bodyRequired?.length ? { required: r.bodyRequired } : {}),
              description: r.bodyDesc ?? "请求体",
            },
          },
        },
      };
    }
    put(openApiPath(r.path), r.method, op);
  }

  for (const v of VERBS) {
    put(`/api/${API_VERSION}/verbs/${v.name}`, "POST", {
      summary: `[${v.group}] ${v.description}`,
      description: `动词直通 · 三面同源（CLI/MCP/HTTP 同一条执行路径）。入参形状派生自 core/src/verbs.ts 的动词表。`,
      tags: ["verbs"],
      parameters: [],
      requestBody: {
        required: false,
        content: { "application/json": { schema: verbJsonSchema(v) } },
      },
      responses: {
        "200": {
          description: "统一包装：ok=true，动词返回在 data",
          content: { "application/json": { schema: ENVELOPE_SCHEMA } },
        },
        "400": {
          description: "入参不合表定义（VALIDATION：detail 逐条列出哪个键缺/哪种型不对）",
          content: { "application/json": { schema: ERROR_SCHEMA } },
        },
        default: {
          description: "统一错误包装",
          content: { "application/json": { schema: ERROR_SCHEMA } },
        },
      },
    });
  }

  put(`/api/${API_VERSION}/openapi.json`, "GET", {
    summary: "本文档自身（不套信封：它是文件，不是数据）",
    description: "由 core/src/api-v1.ts 的 V1_ROUTES 与 core/src/verbs.ts 的 VERBS 生成；对账脚本 scripts/gen-openapi.mjs --check",
    tags: ["meta"],
    parameters: [],
    responses: { "200": { description: "OpenAPI 3.1 文档", content: { "application/json": {} } } },
  });

  return {
    openapi: "3.1.0",
    info: {
      title: "miniflow 内核 HTTP 面 · v1",
      version: "1.0.0",
      description:
        "统一包装（ApiResponse/ApiError）+ 版本化前缀 /api/v1。事实源两张表：" +
        "路由 = core/src/api-v1.ts 的 V1_ROUTES，动词 = core/src/verbs.ts 的 VERBS。" +
        "legacy /api/*（冻结契约 contracts/http-openapi.json v1.2）继续可用，改由响应头 deprecation/successor-version 标弃用——" +
        "JSON 面不做 301（POST 重定向会被降级成 GET，写操作不能靠重定向搬家）。",
      "x-source": ["core/src/api-v1.ts", "core/src/verbs.ts"],
      "x-generated-by": "scripts/gen-openapi.mjs",
    },
    servers: [{ url: "http://127.0.0.1:8421", description: "内核同进程 HTTP 面（默认端口）" }],
    paths,
    components: { schemas: { ApiResponse: ENVELOPE_SCHEMA, ApiError: ERROR_SCHEMA } },
  };
}
