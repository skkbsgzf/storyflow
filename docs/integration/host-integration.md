# 宿主适配篇 · StoryFlow

> 读者：要把 StoryFlow 接进自己产品的宿主软件（如 Pinax 写作软件）。
> 立场先行：**kit 不做前端**（2026-10-10 决议，[`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) §0）——
> kit 只出三样：**文档、自包含可视化 HTML、契约数据包**。页面的绘制、交互、审核流程全部归宿主。
> 本文是接入总纲；协议细节在既有参考文档里，不在此重复。

## 一、接入面总览

| 面 | 在哪 | 从哪进 | 细节文档（事实以此为准） |
| --- | --- | --- | --- |
| 协议面（七端点） | storyharness `:8431` | `adapter/` 协议 + `adapter/storyflow-client.mjs` 零依赖客户端 | [`adapter/README.md`](../../adapter/README.md) |
| 动词面（/api/v1） | core `:8421` | 19 路由统一信封 + `POST /api/v1/verbs/{verb}` 直通动词表 | [`rest-api-reference.md`](rest-api-reference.md) |
| 事件流（SSE） | core `:8421` ＋ storyharness `:8431` | 项目流（journal.jsonl 台账投影）、会话回合流、run 事件流 | [`sse-events.md`](sse-events.md) |
| MCP 面 | core（stdio） | 宿主拉起 `node dist/mcp.js`，与 HTTP 同一张动词表 | [`mcp-reference.md`](mcp-reference.md) |
| 进程内嵌入 | 宿主进程 | `new Kernel(opts)` + FS 抽象层注入 | [`embedding-modes.md`](embedding-modes.md) |
| 审核接入 | 宿主侧 | gate 暂停点 + 三通道 | [`docs/PROTOCOL-REVIEW.md`](../PROTOCOL-REVIEW.md) |

选脸规则与冷启动税实测见 [`docs/Agent.md`](../Agent.md) §二（宿主自动化默认走 MCP，脚本化才用 CLI）。

## 二、三种消费形态（kit 输出只有这三种）

| 形态 | 适用 | 宿主要做什么 | 契约 / 产物 |
| --- | --- | --- | --- |
| ① 纯数据 | 有自己的 UI | REST/SSE 取数，自绘 UI | `contracts/*.schema.json` ＋ `contracts/http-openapi-v1.json`（生成物） |
| ② 半成品 HTML | 要可视化但不想画页 | 嵌链接 / iframe kit 生成的自包含页 | `tools/worldbook*.py`（世界书）、`tools/render-flow.py`（流程图）、`tools/journal-page.py`（大事记时间轴）、`tools/diagnosis-page.py`（诊断报告） |
| ③ 契约数据包 | 想复用 kit 页面数据形状自渲染 | 按 page-payload@2 冻结五键消费，自绘渲染 | [`contracts/page-payload.schema.json`](../../contracts/page-payload.schema.json)（`DATA/EFF/OVERLAY/OPTIMIZE/METRICS`） |

**形态②的铁律**（`docs/ARCHITECTURE.md` §9 不变量 6）：HTML 只读数据、零运行时依赖、
不请求外部资源、**不得反向调用 kit 接口**——双击即开，断网完整，数据全部生成时内联。
模板组织照 worldbook 既有模式：模板文件（`tools/*-template.html`）＋ 生成器填充占位符；
新页面件照 `tools/journal-page.py` / `tools/diagnosis-page.py` 的样子做（stdlib、确定性、幂等、退出码约定）。

## 三、宿主适配工程范式（pinax-bridge 实测提炼）

storyharness 的 pinax 桥是把 kit 能力接进 Pinax 写作软件的**活样板**（`storyharness/src/pinax/`，
默认 `127.0.0.1:8451`，`npx tsx src/pinax/serve.ts` 启动）。四条可复用范式，宿主自建桥时逐条对表：

| 范式 | 代码出处 | 做法 |
| --- | --- | --- |
| **任务化接口** | `src/pinax/server.ts`（端点）＋ `src/pinax/store.ts`（状态仓） | 一切交互收敛为任务：`POST /v1/pinax/tasks`（开跑＋SSE）、`:id/resume`、`:id/cancel`、`GET :id`（状态）。任务快照 JSONL 追加＋末行快照落盘，坏行跳过不炸整读——崩溃可恢复、取消有据、恢复按快照重放 |
| **契约镜像** | `src/pinax/contract.ts` | 上游（宿主）SSE 契约**单点镜像**：schemaVersion、事件类型表、限额全部 freeze 在一个文件；适配器发出的帧必须能被上游解析器原样解析。改镜像 = 改上游契约，须两侧同步——契约只有一份，镜像不产出第二语义 |
| **预算归属** | `src/pinax/config.ts`（`AdapterBudget`）＋ `src/pinax/runner.ts`（守护） | 预算显式分三层：配置缺省（`AdapterBudget`：超时/步数/每轮调用数/结果截断）→ 请求体 `budget.*` 逐项覆盖 → 运行时守护（镜像宿主 RUNTIME_LIMITS）。超限 = **强制收敛**（收工具＋要正文），不静默截断 |
| **工具环桥** | `src/pinax/tools.ts` | 宿主五个 lookup 工具接入 pi-agent 工具环；**数据源 = 请求携带的资源快照**（宿主从自己的索引现建带上来），解决「数据在宿主 stores、Node fs 看不见」的一致性缺口；action 枚举与限额语义镜像宿主契约 |

一句话：**任务化保证可恢复，契约镜像保证不漂移，预算归属保证不失控，数据随请求走保证一致性。**

## 四、边界声明（立场，不是缺口）

- **kit 无审核 / 打回 / 合规**：宿主自己写，接入协议见 `docs/PROTOCOL-REVIEW.md`；执行环交卷到 manual gate 必须停下等人裁。
- **kit 无前端**：三输出立场见 `docs/ARCHITECTURE.md` §0；`/api/panel/*` 已 410 退役（`adapter/README.md`），panel/kitapp 存量冻结（`panel/FROZEN.md`）。
- **人的动词不进机器工具环**：`flow_gate` / `set_decision` / `ig_commit` / `ig_exclude` 刻意不给 agent（`AGENTS.md` 红线 4）。
- **HTML 页零反向调用**：kit 生成的页只消费生成时内联的数据，不 fetch kit、不带 CDN/字体等运行时依赖；宿主要新可视化 = 走新数据包契约，不是给页面开 API。
- **运行数据不入库**：`projects/` 运行数据与 `.external/` 的 apiKey 一律不进 git，宿主侧同步遵守（`AGENTS.md` 发布口径）。

## 五、最小接入路径

1. 拉 runtime：`cd storyharness && npx tsx src/cli.ts web`（内核 8421 ＋ 协议面 8431）。
2. 用 `adapter/storyflow-client.mjs` 打通 `hub / status / start / events` 四件，先能跑通一条生产线。
3. 按 `docs/PROTOCOL-REVIEW.md` 挂审核（gate 暂停点 ＋ 裁决回传）。
4. 可视化：直接嵌 kit 自包含页（形态②），或按 page-payload@2 自渲染（形态③）。
5. 深度适配：照第三节四条范式建自己的桥，逐文件读 `storyharness/src/pinax/`。

## 六、项目阶段动作（宿主/人随项目进展的确定性动作约定）

仓库根跑 `python tools/<工具>`（全部零 token、幂等、退出码约定见各工具 docstring）：

| 项目节点 | 动作 | 工具命令 | 产出物 |
| --- | --- | --- | --- |
| 项目 init（`project-init` / `--upgrade`）后 | 建全量索引 | `python tools/project-index.py build <id>` | `projects/<id>/project-index.json` |
| 世界书/文风/规则 大改后 | 重编项目 RAG 档（可先 `--check` 干跑比对） | `python tools/kit-compile.py --project <id>` | `projects/<id>/kit/hypergraph.rag.json` |
| 交付/验收门后 | 增量对账（报数必附收据） | `python tools/project-index.py diff <id> --receipt` | 三态清单 ＋ `registry/receipts/project-index-diff-*.json` |
| 会话段落结束后 | 会话 JSONL → 记忆卡 | `python tools/project-index.py memory <id> [--session <sid>]` | `世界书/记忆卡-<sid>.md`（建议随后重跑 build） |
| 阶段收口 | 卡↔消费者亲和对账 | `python tools/kb-affinity.py --project <id>` | `projects/_reports/kb-affinity-<id>.json`（非门禁） |

> 记忆卡是可重建派生物，重建整卡覆盖；`kit/` 产物在索引里属 generated 角色，diff 按 hash 记账。
