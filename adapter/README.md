# adapter · 适配层

目标（v0.8 目标6）：**任何前端形态**——浏览器页面、Electron 桌面壳、移动 App——都只通过本层的同一个
接口协议与 agent runtime 交互。后端演进不破坏前端；前端换壳不碰后端。

## 接口面（runtime 暴露的全部交互面）

| 通道 | 端点 | 用途 |
|---|---|---|
| REST | `GET /api/hub` | 工作区/项目/流程清单 |
| REST | `GET /status` · `POST /start` · `POST /stop` | 生产线运行控制 |
| REST | `GET/POST/DELETE /api/projects/:id/agent/sessions[...]` | 会话 CRUD / turn / pin / fork / archive |
| SSE | `GET /events`（run 事件流）· `POST .../turn`（回合事件流） | 实时流 |
| REST | `GET /api/panel/worldbook?project=` · `/files` · `/telemetry` | 只读面板数据 |
| REST | `POST /api/kernel-verb` | 内核动词白名单代理（flow_run/flow_next/flow_effect/flow_init） |
| 内核 | `:8421 POST /api/verbs/:verb` | 高级消费方可直连编排内核（20 动词） |

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
