# REST 面参考 · miniflow

> 两张事实源：`core/src/api-v1.ts` 的 `V1_ROUTES`（**v1 面**，路由即文档）与 `core/src/http.ts` + `core/src/compat.ts`（legacy `/api/*`，页面便利面）。
> 契约两份：`contracts/http-openapi-v1.json`（**生成物**，`scripts/gen-openapi.mjs --write`）、`contracts/http-openapi.json`（手写冻结 v1.2，只读不回改）。
> Fastify 5 ＋ CORS 全开。
> 启动：`cd core && npm run serve`（= `tsx src/http.ts [--port 8421]`），或 `npm run miniflow -- serve --port 8421`。
> CLI 另有一个 `up` 子命令：选端口后可 `--open` 直接拉起浏览器，其余同 serve。
> 缺省监听 `127.0.0.1:8421`；**同一个端口既发 API 也发静态页面**（`/` 入口页，白名单见 `static.ts`）。

## 一、legacy 端点总表 `/api/*`（页面便利面）

新接入方请看第二节；这一节留着是因为 `storyharness/`、`adapter/`、`tools/workflow-page-template.html`、`tools/page-lint.mjs` 按字段直读这些载荷，
R4 的纪律是**载荷逐字节不变、只在响应头标弃用**：所有 legacy `/api/*` 响应都带
`deprecation: true` ＋ `successor-version: /api/v1`（v1 面自身与静态面不带）。

### 读面（无副作用）

| 方法 | 路径 | 说明 | 失败 |
| --- | --- | --- | --- |
| GET | `/api/openapi.json` | 回 `contracts/http-openapi.json` 内容（不存在时回空 paths 骨架） | — |
| GET | `/api/projects` | 项目列表（`kernel.viewProjects()`） | — |
| GET | `/api/projects/{id}/state` | `state.json`；**旧项目回落 `run-state.json` 并附 `_legacy:true`** | 404 `NO_RUN` |
| GET | `/api/projects/{id}/graph` | flow 图（`flowId` 取自 state；无 state 时取 flows 下第一个可读 flow） | 404 `NO_FLOW` |
| GET | `/api/projects/{id}/artifacts?node=&latest=` | 产物清单（`latest=true\|1` 只回每节点最新） | — |
| GET | `/api/projects/{id}/artifacts/content?path=<相对>` | 产物正文，`text/plain; charset=utf-8` | 400 `MISSING_PATH`；403 `NOT_REGISTERED`（未注册=不存在） |
| GET | `/api/projects/{id}/journal?since=&limit=&node=` | journal 事件切片 | — |
| GET | `/api/projects/{id}/snapshots/{node}` | 某节点的快照列表 | — |
| GET | `/api/projects/{id}/config` | `项目配置.json` 读面 | — |
| GET | `/api/projects/{id}/live?files=1` | 实时切片（状态/生效编排/overlay/提案/指标/诊断），带 `revision` + `filesRevision` 两个正交指纹；**`files=1` 才回产物正文**（否则每轮轮询搬 MB 级包） | — |
| GET | `/api/projects/{id}/diagnostics` | 项目级诊断（指标/词汇表类旁路失败） | — |
| GET | `/api/diagnostics` | 仓库级诊断（知识库索引/台账类） | — |
| GET | `/api/projects/{id}/workbench-payload` | 与旧 `workflow.html` 的 `DATA` payload 同构（`{flow, files, runstate, project, snapshots}`），供渐迁 | — |
| GET | `/api/agent/model` | 模型配置回显（`configured/source/baseUrl/model/keyMasked`，**密钥只出掩码**） | — |
| GET | `/api/projects/{id}/agent/sessions` | 会话列表 | — |
| GET | `/api/projects/{id}/agent/sessions/{sid}` | 单会话（含消息） | 404 `{error:<msg>}` |

### 写面

| 方法 | 路径 | body | 说明 |
| --- | --- | --- | --- |
| PUT | `/api/projects/{id}/config` | 配置对象 | 带 schema 校验；run 已绑定字段的修改只对重跑/下次 `flow_run` 生效（响应含 `boundWarning`） |
| POST | `/api/projects/{id}/gate` | `{nodeId, verdict, comment?, rootCauseStage?, round?, token?}` | 人工裁决便利端点（与动词表同源同语义；`verdict` ∈ pass / pass-with-conditions / send-back / reject） |
| POST | `/api/projects/{id}/rerun` | `{nodeId, dryRun?}` | **`dryRun` 缺省 `true`**（不传 = 只推演不落盘） |
| POST | `/api/verbs/{verb}` | 归一化入参对象 | **动词直通：27 个动词全部可从此进入**（见下） |
| POST | `/api/agent/model` | `{baseUrl, model, apiKey?, maxTokens?, temperature?}` | 落 `.external/agent-model.json`；缺 baseUrl/model → 400 |
| POST | `/api/projects/{id}/agent/sessions` | `{title?}` | 项目不存在 → 404 `NO_PROJECT` |
| POST | `/api/projects/{id}/agent/sessions/{sid}/rename` | `{title}` | 404 会话不存在 |
| POST | `/api/projects/{id}/agent/sessions/{sid}/turn` | `{text}` | **SSE 流**，见 [sse-events.md](sse-events.md) |
| DELETE | `/api/projects/{id}/agent/sessions/{sid}` | — | `{ok:true}` |

## 二、v1 面 `/api/v1/*`（新接入方从这里进）

### 2.1 统一包装

每一个 v1 的 **JSON** 响应都是同一个信封，成功与失败同形（页面上不必再写两套分支）。
两个**不套信封**的例外都在路由表里显式标出：`GET /api/v1/openapi.json`（它是文件，不是数据）与
`GET /api/v1/projects/:id/stream`（`text/event-stream`，见 [sse-events.md](sse-events.md)）——后者的**流开始前**校验（项目不存在等）仍回信封，此刻头还没发：

```jsonc
// 2xx
{ "ok": true,  "data": <端点各自的业务数据>, "meta": { "apiVersion": "v1", "route": "/api/v1/projects/:id/state", "at": "2026-09-30T12:00:00.000Z" } }
// 非 2xx（状态码由错误本体决定：ApiError.http / KernelError.http，兜底 500）
{ "ok": false, "error": { "code": "NO_RUN", "message": "项目 p1 无 state.json（未开跑）", "detail": "找回路径，能给就必须给" }, "meta": { … } }
```

- `meta.route` 回显**路由表里那一行的 path 原样**（含 `:id` 这类参数名），所以响应能自证来自 `V1_ROUTES` 的哪一行；
- 动词直通额外带 `meta.verb`；
- 按 `error.code` 分支，不要嗅探 `message` 文本；`detail` 是人读的找回路径。

### 2.2 入口总表（20 个：`V1_ROUTES` 的 19 条路由 ＋ 文档自身）

| 方法 | 路径 | 路径参数 | 查询参数（★＝必填） | 说明 |
| --- | --- | --- | --- | --- |
| GET | `/api/v1` | — | — | v1 面自述：版本、路由清单、动词入口 |
| GET | `/api/v1/verbs` | — | — | 动词表原样（CLI/HTTP/MCP 共用的事实源） |
| POST | `/api/v1/verbs/{verb}` | verb | — | 动词直通：先按表校验入参（400 `VALIDATION`），执行与 CLI/MCP 同一条路径 |
| GET | `/api/v1/openapi.json` | — | — | OpenAPI 3.1 文档（**不套信封**：它是文件，不是数据） |
| GET | `/api/v1/projects` | — | — | 项目清单 |
| GET | `/api/v1/projects/{id}/state` | id | — | `state.json` 原样（**不做 `run-state.json` 回落**：旧项目归 legacy 面） |
| GET | `/api/v1/projects/{id}/graph` | id | — | flow 描述符（flowId 取自 state，缺省回落首个可读 flow） |
| GET | `/api/v1/projects/{id}/artifacts` | id | node, latest | 已登记产物清单 |
| GET | `/api/v1/projects/{id}/artifacts/content` | id | path★ | 产物正文（`data` = `{path, content}`；`.json` 已解析） |
| GET | `/api/v1/projects/{id}/journal` | id | since, limit, node | 执行流水 |
| GET | `/api/v1/projects/{id}/live` | id | files | 实时切片（与 MCP 资源 `flow://{project}/state` 同源同形） |
| GET | `/api/v1/projects/{id}/stream` | id | heartbeatMs | **SSE 事件流**（不套信封）：`journal.jsonl` 台账投影为 `node_start`/`node_complete`/`node_error`/`gate_pending`，空闲补 `heartbeat`，`[DONE]` 收口 |
| GET | `/api/v1/projects/{id}/diagnostics` | id | — | 项目级旁路诊断 |
| GET | `/api/v1/diagnostics` | — | — | 仓库级旁路诊断 |
| GET | `/api/v1/projects/{id}/snapshots/{node}` | id, node | — | 节点快照 |
| GET | `/api/v1/projects/{id}/config` | id | — | 项目配置视图 |
| PUT | `/api/v1/projects/{id}/config` | id | — | 项目配置写入（未识别键显式回显不静默） |
| GET | `/api/v1/projects/{id}/workbench-payload` | id | — | 工作台整包 |
| POST | `/api/v1/projects/{id}/gate` | id | — | 人工裁决（body: `nodeId`★ `verdict`★ …；陈旧 `round`/`token` 由内核 `STALE_GATE` 拒） |
| POST | `/api/v1/projects/{id}/rerun` | id | — | 改 done 节点产物的唯一正路（`dryRun` 缺省 `true`） |

**agent 会话面（`/turn` 等）尚未进 v1**——它还在 legacy `/api/*` 上，且不在 v1 契约里（诚实面见第九节）。
但两条流的**线格式已同源**：`/turn` 与 `/api/v1/projects/:id/stream` 都经 `core/src/sse.ts::emitSseEvents` 写帧，
所以迁面时不必重设计 SSE，只补载荷形状（R5 的 heartbeat 对 `/turn` 是纯增量，旧客户端忽略未知 `type` 即可）。

### 2.3 为什么旧路由不是 301

工单卡面上写的是「旧路由 301」，这里刻意偏离，理由钉在 `api-v1.ts` 头注：

1. `POST /api/verbs/{verb}` 走 301 会被 fetch/浏览器**降级成 GET**（RFC 9110 允许），那是把写操作静默改语义，比 404 更难查；
2. legacy JSON 载荷被仓内 11 个文件按字段直读（`adapter/`、`storyharness/`、页面模板、`page-lint`），重定向只推迟断裂、不消除断裂；
3. 版本化的正确姿势是**新面可用、旧面标注**：弃用信号走响应头，退场节奏由消费方按头迁移决定，不由内核单方面改写请求。

### 2.4 入参前置校验（400 `VALIDATION`）

`POST /api/v1/verbs/{verb}` 在执行前用 `verbArgIssues(def, body)`（zod，形状派生自 `verbs.ts`）校验：
必填缺失/型不符/枚举越界一律 `400`，`error.detail` **逐条点名**（`flow: Required`；多键以「；」分隔）。
legacy `/api/verbs/{verb}` **不加校验**——它的载荷与错误形状是冻结契约的一部分，加校验就是改语义。

## 三、动词直通（这一行就是「表即面」）

```
POST /api/verbs/<verb>     body = 归一化入参（键名用 VerbParam.name，即 camelCase）
```

`http.ts` 按 `VERB_BY_NAME` 分派 ⇒ **表里有几个动词，这里就能收几个**，专用端点只是便利面。
历史上这里只有 4 个 case，`flow_init` / `effect` / `mine` / `skill_patch` / `optimize` / `overlay`
在 HTTP 面上根本不可达——同一个事实抄四份的病，别再犯。

- 未知动词：`404 {error:"UNKNOWN_VERB", detail:"可用动词：…"}`
- 入参折平：`flagsToArgs` 之外的脏值由动词自己的 `S/B/N` 归一化吃平（`"true"`/`"1"`/空串都有确定语义）
- **这一面不收 zod 前置校验**（形状冻结）；要严格校验走 `POST /api/v1/verbs/{verb}`（见 2.4）

## 四、错误响应形状（两套：legacy 冻结、v1 统一）

**legacy `/api/*`（三种形状并存，按冻结契约保留）**：`KernelError` 经 `httpError()` → 状态码取 `e.http`、体为 `{error:<code>, message:<msg>}`；
非 `KernelError` → `500 {error:"INTERNAL", message}`；部分读面端点直接 `return {error:"NO_RUN"}`，校验类再带 `detail`。
接入方按 `error` 字段分支即可，`message`/`detail` 只用于展示。

**v1（一种）**：`{ok:false, error:{code,message,detail?}, meta}`，状态码同源于错误本体
（`ApiError.http` 或 `KernelError.http`，未知异常 `500 INTERNAL`）。v1 的错误码是**开放集合**（跟着内核走），
当前会遇到的：`VALIDATION` 400、`MISSING_PATH` 400、`UNKNOWN_VERB` 404、`NO_RUN` 404、`NO_FLOW` 404、
`NOT_REGISTERED` 403，以及内核侧全部 `KernelError.code`（码表见 MCP 参考第四节）。

## 五、legacy 兼容面（`compat.ts`，新前端请勿使用）

`/_kit/save`、`/api/save`、`/_kit/history`(GET/POST)、`/api/archive-project`、`/api/import-flow`、
`/api/regen`、`/api/import-demo`、`/_kit/tunnel.json`——原 `tools/serve.py` 的语义并入内核，契约里均标 deprecated。

## 六、静态面

同端口最末优先级注册 `/` 与 `/*`：白名单托管页面，**不会**把 `.external/`、`.git`、源码目录发出去
（旧 serve.py 会）。追加黑名单走 `MINIFLOW_STATIC_DENY_PREFIX`。

## 七、CORS 与安全

`@fastify/cors` 以 `origin: true` 注册 ⇒ 所有 `/api/*` 与页面跨域开放（本机开发场景）。
监听在 `127.0.0.1`；**要出本机请先自行加认证/反代**，仓库默认不提供鉴权。

## 八、生成与对账（门禁怎么跑）

```bash
node scripts/gen-openapi.mjs          # 打印由 V1_ROUTES + VERBS 生成的 OpenAPI
node scripts/gen-openapi.mjs --write  # 写 contracts/http-openapi-v1.json
node scripts/gen-openapi.mjs --check  # 对账：漂移 / 漏动词 / 孤儿路径 / 必填参数缺账 ⇒ exit 1
```

`--check` 查四件事：①提交的文件与生成结果**逐字节**一致；②`V1_ROUTES` 每条都在文档里有对应 method；
③文档里没有表外的孤儿路径；④27 个动词逐个有 `/api/v1/verbs/{name}` 条目，且其必填参数进了该条 `schema.required`。
运行时 `GET /api/v1/openapi.json` 与提交文件同一份（`core/test/r8-server.test.ts` 断言三方相等）。

## 九、尚未实现（诚实面）

| 项 | 状态 |
| --- | --- |
| agent 会话面（`/api/agent/*`、`/api/projects/{id}/agent/*`，含 SSE `/turn`）进 v1 契约 | **未进**。它现在只在 legacy `/api/*` 上，且 `contracts/http-openapi.json` v1.2 里也查不到（存在但无契约）。SSE 的 v1 表达已由 R5 的 `stream` 端点定型（`sse?: true` 路由行 ⇒ `text/event-stream` 响应 + 同一套心跳/收口），补进来的活只剩载荷形状 |
| 台账里 `run-start` / `run-end` / `verdict` / `rerun` / `snapshot` / `note` / `warn` / `chain-out` / `chain-in` 九种 kind 进事件流 | **不投影**（`project-stream.ts::JOURNAL_TO_SSE` 逐条标 `null`，不是漏）。它们是 run 级与留痕类，不在工单点名的「节点/门」词汇表内；要扩词汇表归 owner 拍板。历史随时可查 `GET /api/v1/projects/{id}/journal` |
| 旧路由 301 | **不做**（理由见 2.3；改由响应头标弃用） |
| legacy 载荷套 v1 信封 | **不做**（仓内 11 个文件按字段直读） |
