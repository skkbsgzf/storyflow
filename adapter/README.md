# adapter · 适配层

目标（v0.8 目标6）：**任何前端形态**——浏览器页面、Electron 桌面壳、移动 App——都只通过本层的同一个
接口协议与 agent runtime 交互。后端演进不破坏前端；前端换壳不碰后端。

## 同名辨析（三个 adapter 不是一回事）

| 名字 | 在哪 | 是什么 |
|---|---|---|
| `adapter/`（本目录） | kit 仓 | **协议契约 + 参考客户端**：宿主消费 harness 的唯一官方接缝 |
| `adapters/`（kit 仓根） | kit 仓 | FS 抽象层包（`@storyflow/adapters`）：内核的盘/路径/子进程注入件，与前端无关 |
| `adapters/pinax-adapter` | pinax-storyharness 仓 | 产品适配层：把 harness 能力接进 Pinax 写作软件（桥接层归产品仓，不属本仓） |

## 官方能力面（四能力 → 端点 → 客户端方法）

| 能力 | 端点 | client 方法 |
|---|---|---|
| 创作改写（会话） | `GET/POST/DELETE /api/projects/:id/agent/sessions[...]` · `POST .../turn`（SSE 回合流） | `sessions` `transcript` `stats` `turn` |
| 本地文件 | `GET /api/panel/files?project=[&file=]`（两层树 / 文本读取 ≤200KB）· `GET /api/panel/raw?project=&file=`（图/PDF/音频白名单字节流，25MB 上限 + Range）· `GET /api/panel/preview?project=&file=`（预览判定元数据） | `fileList` `fileRead` `fileRawUrl` `filePreview` |
| 世界书 | `POST /api/kernel-verb` `{verb:"worldbook_search", args:{project,q[,k]}}`（GraphHyperRAG 检索） | `worldbookSearch` |
| RAG | `POST /api/kernel-verb` `{verb:"kb_search", args:{q[,k]}}` / `{verb:"kb_read", args:{ref}}` | `kbSearch` `kbRead` |
| 运行控制 | `GET /api/hub` · `GET /status` · `POST /start` · `POST /stop` · `GET /events`（run 事件流） | `hub` `status` `start` `stop` `events` |

## 全端点表

| 通道 | 端点 | 用途 |
|---|---|---|
| REST | `GET /api/hub` | 工作区/项目/流程清单 |
| REST | `GET /status` · `POST /start` · `POST /stop` | 生产线运行控制 |
| REST | `GET/POST/DELETE /api/projects/:id/agent/sessions[...]` | 会话 CRUD / turn / pin / fork / archive |
| SSE | `GET /events`（run 事件流）· `POST .../turn`（回合事件流） | 实时流 |
| REST | `GET /api/panel/files` · `/raw` · `/preview` | 本地文件能力（见上表） |
| REST | `POST /api/kernel-verb` | 内核动词白名单代理（flow_init/run/next/effect · kb_search/kb_read · worldbook_search） |
| 内核 | `:8421 POST /api/verbs/:verb` | 高级消费方可直连编排内核（20 动词） |

> 退役面：`GET /api/panel/worldbook|telemetry|changes|canvas` 已退役，调用返回 **410 GONE**（`code:"RETIRED_FACE"`）；
> 世界书/RAG 数据面走 `/api/kernel-verb`（上表）或内核 `:8421` 的 `/api/v1`（19 条路由，见 `contracts/http-openapi-v1.json`）。

鉴权：默认仅本机绑定；设 `SH_PASSWORD` 后全端点走口令 + 限流。**审核/打回不是本运行时的职责**——
宿主如需审核，见 `docs/PROTOCOL-REVIEW.md` 的接入协议（gate 暂停点 + 动词代理）。

## 参考客户端

`storyflow-client.mjs` —— 零依赖 JS 客户端（浏览器/Electron/Node 通用）：

```js
import { StoryFlowClient } from './storyflow-client.mjs'
const c = new StoryFlowClient('http://127.0.0.1:8431', { password: '…' })
await c.hub()                                  // 项目清单
await c.start('p-demo1')                       // 跑一条生产线
for await (const e of c.events()) console.log(e)  // 实时事件流
await c.turn('p-demo1', 'sid-1', '把第三章改短一点')  // 对话回合（SSE 逐事件回调）
```

移动端：同一套 REST/SSE；iOS/Android 用各自 SSE 库按同一事件 schema 消费即可——
适配层契约 = 「一个 base URL + 一个口令 + 七个端点」，无隐藏握手。
