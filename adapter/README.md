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
| 本地文件 | `GET /api/panel/files?project=[&file=]`（两层树 / 文本读取 ≤200KB，回服务端 sha256 指纹）· `PUT /api/panel/files?project=&file=`（**写文本**，W4.2 通道 B：临时件 → 回读校验 → 原子替换 + 乐观锁 `expectHash`）· `GET /api/panel/raw?project=&file=`（图/PDF/音频白名单字节流，25MB 上限 + Range）· `GET /api/panel/preview?project=&file=`（预览判定元数据） | `fileList` `fileRead` `fileWrite` `fileRawUrl` `filePreview` |
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
| REST | `PUT /api/panel/files?project=&file=` | 本地文件·写文本（W4.2 通道 B，纪律见下） |
| REST | `POST /api/kernel-verb` | 内核动词白名单代理（flow_init/run/next/effect · kb_search/kb_read · worldbook_search） |
| 内核 | `:8421 POST /api/verbs/:verb` | 高级消费方可直连编排内核（20 动词） |

> 退役面：`GET /api/panel/worldbook|telemetry|changes|canvas` 已退役，调用返回 **410 GONE**（`code:"RETIRED_FACE"`）；
> 世界书/RAG 数据面走 `/api/kernel-verb`（上表）或内核 `:8421` 的 `/api/v1`（19 条路由，见 `contracts/http-openapi-v1.json`）。

鉴权：默认仅本机绑定；设 `SH_PASSWORD` 后全端点走口令 + 限流。**审核/打回不是本运行时的职责**——
宿主如需审核，见 `docs/PROTOCOL-REVIEW.md` 的接入协议（gate 暂停点 + 动词代理）。

鉴权的两条通道（`PUT` 写端点同此，无豁免）：`POST /api/login {password}` 换 **HttpOnly cookie `sh_token`**（连错 5 次锁 30s），
或每次请求带 `Authorization: Bearer <token>`。响应体只有 `{ok,ttlHours}`，token 不在体内——浏览器靠 cookie 自动随请求走
（跨源宿主需带 `credentials:'include'`，服务端只在回显了具体 loopback 源时给 `allow-credentials`）；Node/Electron 主进程的
`fetch` 没有 cookie 罐，参考客户端 `login()` 从 `Set-Cookie` 抠出 token 转走 Bearer，返回值里 `tokenVia` 记的是哪条路。
未过闸：页面导航 302 到 `/login`，API 一律 **401**（写端点 401 时盘上零改动）。

写端点纪律（`PUT /api/panel/files`，W4.2 通道 B）：body `{content, expectHash?}`。写只收 `.md/.txt`——**`.json` 排除**，
派生件由工具独占写（红线），面板代写会养出两套真相；doc/docx 只读（转 md 走 `tools/export-doc.py`）；单次上限 200 万字符（超限 413）。
落盘走临时件 → 回读校验 sha256 与长度 → `renameSync` 原子替换，任何一步失败即删临时件并 500，绝不半截写。
乐观锁：目标已存在而不带 `expectHash` → **409 `EXPECT_HASH_REQUIRED`**；带了但与盘上不符 → **409 `CONFLICT`** 并交回当前指纹，零写入。
路径逐段校验，越出项目根 → **403 `OUT_OF_PROJECT`**（`../` 逃逸用例已测）；隐藏件与带分隔符的文件名 → 400。
所有写端错误路径（400/403/405/409/413/415）一律 `cache-control: no-store`（缓存投毒红线）。
写入成功后回执只**提示**重跑 `python tools/project-index.py diff` 与 `kit-compile --check`，服务端不代跑。
客户端 `fileWrite()` 对 4xx **不抛**，原样交回 `{status, ...payload}`（冲突是预期状态，调用方要拿 `payload.hash` 重读合流），5xx 才抛。

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
