# SSE 事件流参考 · miniflow

> 事实源三处，各有分工：**管道** = `core/src/sse.ts`（线格式、心跳、收口的唯一出口）；
> **对话流** = `core/src/http.ts` 的 `POST /api/projects/:id/agent/sessions/:sid/turn` ＋ `core/src/agent.ts` 的 `AgentEvent` 联合类型；
> **项目流** = `core/src/api-v1.ts` 的 `GET /api/v1/projects/:id/stream` ＋ `core/src/project-stream.ts`（台账投影表与投影器）。
> 现在有**两种流、一条管道**：对话回合（legacy 面）与项目事件（v1 面）。

## 一、请求与帧格式

```
POST /api/projects/{id}/agent/sessions/{sid}/turn?heartbeatMs=     body: { "text": "这一轮我想让 agent 做什么" }
GET  /api/v1/projects/{id}/stream?heartbeatMs=
```

响应头（由 `reply.raw.writeHead` 直接写，Fastify 侧不再接管）：

```
content-type: text/event-stream; charset=utf-8
cache-control: no-cache
connection: keep-alive
x-accel-buffering: no        # 仅项目流：本机隧道/反代不许缓冲事件
```

帧：**只用 `data:`，没有 `event:` 字段**，事件类型在 JSON 的 `type` 里。

```
data: {"type":"open",…}\n\n
data: {"type":"…"}\n\n
…（源静默期）data: {"type":"heartbeat","ts":"…"}\n\n
data: [DONE]\n\n
```

- 流首固定一帧 `open`：对话流 `{sid}`；项目流 `{apiVersion, route, projectId, ts, projected[], heartbeatMs}`（`projected` 就是这条流会发的事件类型全集，客户端据此自检版本）。
- 流尾固定 `data: [DONE]`（哨兵，不是 JSON）——但它只在**源自己走完**或**服务端补完 `error` 帧**时出现。
  客户端先断开时不写（对端已经走了）。中间抛错一律 `{type:"error"}` 帧 + `[DONE]`，**不会出现半截流**。
- **心跳**：空闲 `heartbeatMs` 补一帧，缺省 `10000`，钳制 `50`–`30000`（`sse.ts::heartbeatMsOf`，非正数/非数字回落到缺省）。
  工单 R5 的门禁「客户端 15s 内收到 heartbeat」由 `DEFAULT_HEARTBEAT_MS ≤ 15_000` 这条常量断言钉住
  （`core/test/sse-stream.test.ts`）——**改这个值就是改门禁**，别只改代码。
- `EventSource` 只支持 GET ⇒ 项目流能直接用它；对话流是 POST，客户端用 `fetch` + `ReadableStream` 自行按 `\n\n` 切帧。
- 断开信号挂**响应**（`reply.raw`），不是请求。Node 在请求体读完时就给 `IncomingMessage` 发 `close`，
  挂在请求上会让 POST 流「刚连上就断开」（实测只有 `open` 帧抵达对端）。唯一实现处 = `sse.ts::closeSignalOf`。
- 停流之后**句柄谁释放**：泵（`emitSseEvents`）只把关闭请求递进源，**不等**源收尾——异步生成器只在 yield 点处理
  `.return()`，卡在长 await 里的源会让那个 await 永挂。所以要确定性释放的源自己接同一把信号
  （`project-stream.ts::stopSignal` → `finally` 里取消 `watchDir`）。

## 二、事件字典（`AgentEvent` 全集 12 种；`open` 是传输帧，由 HTTP 层写、不在类型里）

对话流发下面 7 种，项目流发再下面 4 种，`heartbeat` 由管道发——**同族类型、同一条线格式**。
工单 R5 称这些扩展挂在 `FlowEvent` 上；盘上的类型名是 `AgentEvent`，扩的是那一个联合，**没有第二个事件类型**。

| `type` | 载荷 | 流 | 语义 / 产生点 |
| --- | --- | --- | --- |
| `open` | `{sid}` 或 `{apiVersion, route, projectId, ts, projected, heartbeatMs}` | 两条 | 流建立（HTTP 层写帧前） |
| `round` | `{n}` | 对话 | 第 n 轮工具循环开始（n 从 1 起，上限 10） |
| `delta` | `{text}` | 对话 | 正文增量（`choices[0].delta.content`） |
| `thinking_delta` | `{text}` | 对话 | 推理链增量（`delta.reasoning_content`，仅支持该字段的端点会有） |
| `tool_call` | `{id, name, args}` | 对话 | 工具调用发起；`args` 是 JSON **字符串** |
| `tool_result` | `{id, name, ok, content}` | 对话 | 工具返回；`content` 截断到 **800 字**（模型侧实收上限 16000） |
| `done` | `{text}` | 对话 | 本轮最终正文全文（无 tool_calls 时） |
| `error` | `{message}` | 两条 | 失败：空消息 / 未配模型 / 端点非 2xx / 超 10 轮未收敛 / 回合异常 / 泵故障 |
| `node_start` | `{event, ts, nodeId?, detail?}` | 项目 | 节点开始派发；台账 `advance` / `intake` 投影 |
| `node_complete` | `{event, ts, nodeId?, detail?, refs?}` | 项目 | 节点交卷；台账 `submit` / `deliver` 投影 |
| `node_error` | `{event, ts, nodeId?, detail?}` | 项目 | 节点被打回或变陈旧；台账 `reject` / `stale` 投影 |
| `gate_pending` | `{event, ts, nodeId?, detail?}` | 项目 | 门在等人裁决；台账 `gate-open` 投影 |
| `heartbeat` | `{ts}` | 两条 | 空闲保活信号，**不是业务事件**（别拿它计数） |

`error` 的 `message` 是**给人看的中文句子**（含排查提示），不要按文本分支；需要区分失败类别时看是否有前置 `round`/`tool_call` 帧，或直接查会话存档。

## 三、项目流的语义：台账投影，不是进程内总线

```
data: {"type":"open","apiVersion":"v1","route":"/api/v1/projects/:id/stream","projectId":"p-1","ts":"…","projected":["node_start","node_complete","node_error","gate_pending"],"heartbeatMs":10000}
data: {"type":"node_start","event":"advance","ts":"…","nodeId":"m1.topic"}
data: {"type":"node_complete","event":"submit","ts":"…","nodeId":"m1.topic","detail":"选题报告.md","refs":["选题报告.md"]}
data: {"type":"gate_pending","event":"gate-open","ts":"…","nodeId":"m2.plan","detail":"计划验收"}
data: {"type":"heartbeat","ts":"…"}
```

- **事件源是 `projects/{id}/journal.jsonl`**：内核每个节点动作本来就往台账追加，再加一层 in-process 总线就是第二套真相，
  而且跨进程宿主（CLI 起了 run、HTTP 在看）收不到。
- 每条投影都带 `event`（台账原 kind）：事件不许变成第二套真相，读的人能回 journal 逐条对账。
- `nodeId` 缺席＝项目级条目，内核**不编造**节点归属。
- **订阅点之前的历史不重放**（游标＝台账行数，用 ts 做游标会在同毫秒多条事件上要么漏要么重）；要历史查 `GET /api/v1/projects/{id}/journal`。
- 台账被整本重写（回滚/清场）时重新对齐末尾：中间那段确实丢了，但绝不重放旧事件。
- 事件延迟上限 = `min(1000ms, heartbeatMs)`（`project-stream.ts::LEDGER_POLL_DEFAULT_MS`——心跳是保活信号可以慢，重读节拍是延迟预算，两者分家）。
  `fs.watch` 命中即刻提前重读，但**正确性不依赖它**（规范 `docs/规范-FS抽象层-FS1.md` §五：跨平台事件合并/丢失行为不一致，watch 只能当提示）。
- 台账 16 种 kind 里 **9 种不投影**（`run-start` / `run-end` / `verdict` / `rerun` / `snapshot` / `note` / `warn` / `chain-out` / `chain-in`），
  在 `JOURNAL_TO_SSE` 里逐条标 `null`——是显式表态不是漏项；它们是 run 级与留痕类，扩词汇表归 owner 拍板。

## 四、时序示例（对话流）

```
data: {"type":"open","sid":"s-7f3a"}
data: {"type":"round","n":1}
data: {"type":"tool_call","id":"c1","name":"mf_flow_next","args":"{\"project\":\"p-1\"}"}
data: {"type":"tool_result","id":"c1","name":"mf_flow_next","ok":true,"content":"{…}"}
data: {"type":"round","n":2}
data: {"type":"delta","text":"当前停在"}
data: {"type":"done","text":"当前停在 m3-编剧。"}
data: [DONE]
```

## 五、工具环（帧里会出现的 `name`）

- `mf_<verb>` —— 动词白名单 **19 个**（`AGENT_VERBS`）：
  `flow_list / flow_next / flow_effect / flow_mine / flow_optimize / flow_init / flow_run /
  flow_resume / flow_submit / flow_rerun / flow_overlay / cfg_template / list_decisions /
  worldbook_search / whereami / quality_scan / skill_patch / ig_load / ig_propose`
- 项目文件系统：`fs_tree` / `fs_read` / `fs_write` / `fs_grep`（路径越出项目目录 → `INVALID_INPUT`）＋ `flow_lint`
  （改 `flows/*/flow.json` 后必跑）。
- 分析工具（都要走模型端点）：`mf_analyze_card`（**卡驱动诊断**：`card`=kb 卡 id（规则卡/方法论卡）＋
  `path|text`=正文，prompt 按卡组装，输出对齐 diagnosis-report@1 items 语义——
  `rule_ref/tier/severity/evidence/suggestion`，建议必须是卡内条款修复策略的反向表达；卡不存在报
  `CARD_NOT_FOUND`）；`mf_analyze_curve` 为其**薄别名**（card 固定 `kb/aesthetic/emotion-curve`，兼容历史点名）；
  `mf_analyze_character`（人物塑造三维）。注意：协议面（storyharness `src/analysis.ts`）自装同名单工具，
  其输出形状仍是各自专档 JSON——两个进程的工具环互不隶属。
- 改相工具（要走模型端点）：`mf_apply_repairs`（**修复改单→修订 diff**：`repair_plan`=改单 JSON 内联文本
  或项目内路径（契约 repair-plan@1，`contracts/repair-plan.schema.json`）＋`path|text`=目标正文，
  逐条款回卡取 `clauses[].repair` 原文产 unified diff，输出 repair-plan@1 骨架（diff 回填、
  `status=proposed`）。护栏：**只产 diff 绝不写盘**——应用归宿主拿 diff 走 batch-edit/自家写盘面，
  人裁后用 `tools/repair-apply.py status` 推进并落收据，回滚走 snapshots；B 级条款进单 `INVALID_INPUT`
  （B 级绝不自动改稿）、条款不存在 `CLAUSE_NOT_FOUND`、repair 与卡面不一致 `INVALID_INPUT`
  （同源铁律：改单不得发明卡外策略））。
- 拆相工具（要走模型端点）：`mf_deconstruct`（**样本片段→规则卡草稿**：`samples`=采样单元文本片段
  （以 `【单元id】` 行标注单元边界，≤6 单元——超限显式拒绝，抽样优先回 `tools/deconstruct.py sample`）
  ＋`dimension`=落卡域＋`hint`/`source_title` 选传，输出 deconstruct-report@1 findings 草稿
  （契约 `contracts/deconstruct.schema.json`，`status=draft`——**findings 不等于规则**）。护栏：
  每条 claim 必须带样本内 evidence 引文，无引文的 claim 不许产出（防编造）；provenance.refs 悬空拒绝；
  条款 rule_id 非 DC- 前缀拒绝（防搬运台账 id）；清单式 samples（只有元数据没有文本）显式拒绝。
  **本工具绝不落卡不写盘**——回流归人审后的 `tools/deconstruct.py land`（draft 拒绝、同 id 卡已存在拒绝覆盖；
  全局落 `knowledge/deconstruct/`、项目落 `projects/<id>/规则/`））。
- MCP 内联：仅当 `.external/agent-mcp.json` 配了外部 MCP server 时出现（`mcp__` 前缀）；
  连接失败时**塞一个 `mcp_unavailable` 占位工具**并说明原因，其余工具不受影响。

**故意不进环的动词**：`flow_gate`（人的裁决）、`set_decision`（决策登记面）、`ig_commit`、`ig_exclude`、
`ig_sync`（拍板与执行归人）。宿主接自动化时**不要绕过这层**——见 `docs/Agent.md` 第五节。

## 六、客户端注意事项

- 模型未配置时对话流**第一帧业务帧就是 `error`**，随后 `[DONE]`。
  配置来源：`MINIFLOW_AGENT_BASE_URL / _MODEL / _KEY` 环境变量 > `.external/agent-model.json`
  （`{baseUrl, model, apiKey}`，任何 OpenAI 兼容端点）。**密钥永不入 payload/journal**。
- 超过 10 轮工具循环未收敛 → `error` 帧提示「拆小问题」，会话状态保留，可再发一回合。
- 会话落盘在项目目录内，`GET .../agent/sessions/{sid}` 可回看含工具调用的完整消息。
- **未知 `type` 一律忽略**（向前兼容的底线，仓内两个消费方已按此实现：`adapter/storyflow-client.mjs` 逐帧转发、
  `storyharness/src/home.ts` 的 else-if 链落到默认分支）。R5 给对话流新增的 `heartbeat` 就是靠这条活下来的——
  老客户端收到它不会崩，只会当成不认识的帧跳过。
- 判活用 `heartbeat`，别拿「有没有业务帧」当活性信号：长回合（LLM 工具环、等人裁决的门）静默几十秒是正常的。

## 七、尚未实现（诚实面）

| 项 | 状态 |
| --- | --- |
| agent 会话面进 v1 契约（`/api/v1/projects/:id/agent/*`） | **未进**，还在 legacy `/api/*`。线格式已同源（见第一节），剩下的活是载荷形状与文档，不属 R5 卡面 |
| 台账 9 种 kind（`run-end` / `verdict` 等）投影 | **不投影**（见第三节）。要不要扩「节点/门」词汇表是拍板项，内核不替 owner 决定 |
| 断线重连的补漏（`?since=<ts>` 续传） | **未实现**。重连后从当前末尾继续，中间断掉那段的唯一找回路径是 `GET /api/v1/projects/:id/journal` |
| 多项目/仓库级聚合流（一条连接看全部项目） | **未实现**。当前一端点一流，`projectId` 在 `open` 帧里自证 |
