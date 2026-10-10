# 设计 · 官方 panel 演示形态（pi-web 侵入式改造）（2026-10-02）

> 口径（用户拍板）：**前端直接侵入式修改 pi-web 代码，不自己写**。零构建纪律就此作废（panel 工具链跟随上游 Next.js）。
> 本文 = 演示形态 PM 方案 + spike 事实 + 待拍板项（默认值已按推荐填，可改）。

## 一 · 演示定位（PM 视角）

**一句话**：一个「作家工作台」，5 分钟演示脚本走完 kit 的全部卖点。

| 演示动作 | 看到什么 | 对应卖点 |
|---|---|---|
| 选项目（水浒测试项目） | 会话分组、成本、上下文占用 | 会话 JSONL 落盘 + 遥测 |
| 问「林冲和鲁智深什么关系」 | 工具环透明：看得见 agent 调 worldbook_search、翻卡片、再作答 | agent-only 执行模型 |
| 切「世界书」搜「豹子头」 | 词条卡 + 一跳关系 | GraphHyperRAG |
| 切「知识」读一张规则卡 | 去 AI 味条款检索与阅读 | knowledge 本地语料层 |
| 切「文件」读水浒第一回 | md 渲染排版 + 图/PDF 预览 | 本地文件即真相 |

## 二 · 信息架构

```
顶栏：项目切换器 ｜ harness 状态徽章（/status 只读，不做启停）
导航：会话（默认）｜ 文件 ｜ 世界书 ｜ 知识 ｜ 设置
  · 世界书与 RAG 合并为「知识」一页，内部两栏：本书设定（世界书）/ 写作方法论（kb）
  · 文件树服务端 IGNORE 名单加 内部/（会话 jsonl、遥测等运行件不出现在作家面前）
```

三个默认拍板（未确认，按推荐执行中）：① 世界书+RAG 合并「知识」页；② 批B/C 零构建组件与插件壳**退役**，pi-web fork 为唯一官方面（协议样本价值由 adapter/README + storyflow-client.mjs 承担）；③ 生产线只放状态徽章。

## 三 · spike 事实（D:\pi-web-upstream @ 0.9.3，MIT，tarball 经 codeload 拉取——github.com 直连不通）

- **体量**：lib + app + components + hooks ≈ **6.0 万行 TS/TSX**；Next.js App Router + Tailwind，Node ≥ 22.19
- **架构关键**：UI（components/hooks）只跟**自己的 Next API 层**（`app/api/*` 约 25 组路由）说话；
  Next 层才真正干活——session-reader 直读 pi 的会话 JSONL、rpc-manager 连 pi agent 进程、file/git/terminal 各自成库
- **UI 端点面**（改造时要保留的形状）：`/api/sessions`（列表/详情/搜索）、`/api/agent/[id]`（命令 + 事件流）、
  `/api/files/*`（list/read/stream/watch）、`/api/models*`、`/api/cwd`、`/api/auth`
- **格式差**：pi-web 读 pi 原生会话 JSONL；kit 回放面是 OpenAI 族（role/content/tool_calls + role:"tool"，
  chat.ts 有意为之「工作台回放零渲染改动」）——同族不同形，需一层会话格式适配（机械活）
- **pi-web 自带而我们直接继承的硬货**：markdown/代码渲染、工具调用卡、流式回合、会话分支、
  成本/上下文统计、md·图·PDF·DOCX 预览、zh-CN i18n

## 四 · 改造方案（v2 定稿：demo 架构克隆，非 Next 路由改写）

**关键发现**：pi-web 仓自带 `demo/`（GitHub Pages 版），其 README 明示——demo 用**真组件**，
靠浏览器内 `window.fetch` 拦截（/api/*）+ EventSource 垫片应答所有 API 请求。即上游已把
「非 pi 后端接缝」做好了：`demo/mock/` = 每个服务端 seam 的参考实现（agent.ts 自述
「rpc-manager 的替身，事件序列与真实 pi 运行一致」）。

**故方案从「改写 Next 路由」转为：`panel/kitapp/` = demo 的克隆（已落位），数据源从罐头换 kit**：

| kitapp/mock 文件 | 改造内容 | kit 端点 |
|---|---|---|
| `sessions/store.ts`（水合） | 启动时从 kit 拉会话清单+transcript，转 SessionEntry[] 灌入 store | `/api/projects/:p/agent/sessions[/...]` |
| `agent.ts`（prompt） | composeReply 罐头 → 开 kit turn SSE（**raw=1**），逐帧 emit pi 事件；abort → kit /stop | `.../turn?raw=1`、`.../stop` |
| `files.ts` | 仓库快照 → kit panel 文件树/读取/预览（IGNORE 加 `内部/`） | `/api/panel/files\|raw\|preview` |
| `settings-routes.ts`/models | → kit `/api/agent/model` GET/POST | 同左 |
| 新增 router 分支 | 世界书/知识两个视图的检索与读卡 | `/api/kernel-verb` worldbook_search / kb_search / kb_read |
| 保留不动 | event-source 垫片、router 派发、components/hooks/lib 全部 | — |

**kit 侧已就位的配套（本轮落地，84/84 绿）**：`chatTurn` 新增 `opts.raw` —— pi 会话事件
（message_update/message_end/tool_execution_*/turn_end）全保真透传为 `{type:"raw",event}` 帧，
`/api/projects/:p/agent/sessions/:sid/turn?raw=1` 启用。pi-web 的 UI 本来就吃 pi 事件，桥几乎 1:1。

**形状事实（写桥时直接用）**：会话条目 = `SessionEntry`（lib/types.ts，pi JSONL 条目联合）；
demo `mock/sessions/builder.ts` 的 `buildSession` 展示 Script→entries 的转换（id/parentId/timestamp/
usage/cost 全套）；`mock/agent.ts` 的 `emit/attachAgentStream` 展示事件帧协议
（`{type:"connected",sessionId,isStreaming}` + `message_start` + 更新流）。
kit transcript 消息（role/content/tool_calls/usage/model）→ SessionEntry 的转换是桥的主要写作面。

**运行形态**：kitapp 自己的 Next（dev 或 build），静态导出后即插件壳本体——fetch 直连 127.0.0.1:8431
（MV3 host_permissions 放行），无需任何服务端。旧零构建组件已退役留底 `D:\storyflow-extracts\panel-lite-batchBC`。

**已知风险**：① kit turn raw 帧与 pi-coding-agent JsonAgentSessionEvent 的字段差——动工第一步
「事件对照表」仍有效，以 demo/mock/agent.ts 的事件序列为验收基准；② 双 npm 安装慢（本机网络），
装完前不阻塞文档与 kit 侧工作。

## 五 · 测试数据（已就位）

- 项目 `p-sh-202609291020aye`：世界书 109 卡（108将+总览，图 109 词条/69 边，检索已验）、正文《水浒传-第一回.md》
- 乱码会话已全部清除（此前为 curl GBK 编码所致，浏览器操作不会复现）

## 六 · 深度适配蓝图（v3 · 2026-10-02 用户拍板「pi-web 为官方适配仓库」）

> 口径：pi-web fork 不是借壳 demo，是**官方适配仓库**——kit 能力长进面板、运行时彻底换成 kit。
> 蓝本 = pinax-adapter 的五个适配模式（`D:\pinax-storyharness\adapters\pinax-adapter`），逐一映射：

| pinax-adapter 模式 | 面板侧落地 | 状态 |
|---|---|---|
| 任务化接口（tasks/resume/cancel/快照/list/contract 自探针） | turn 桥已覆盖 prompt/abort/流式；**补**：设置页 kit 自探针（hub/model/files 三连，对齐 pinax `/v1/pinax/contract` 思路） | 桥✓ 探针待做 |
| 事件契约镜像件（contract.ts，schemaVersion 超限即拒 + 往返测试钉住） | 桥消费 kit `raw` 帧（pi 事件本形），无 schema 漂移面 | ✅ |
| 预算归属（budget.* 逐项执行 + AbortController 竞速硬落账） | 用量/费用/上下文已真渲染（9,333 in · 72 out · $0.0014 · 3%/272k）；**补**：context window 取 kit modelInfo 真值（1M），换掉 demo 常量 272k | 部分 |
| toolManifest/tools.ts（宿主资源桥成工具环） | 面板「工具」「技能」页签接 kit 真工具环：kit 侧新增 `GET /api/panel/tools`（读 kit/skills.tools.json 40 工具 + 内核 27 动词），替换 captured/tools.json 罐头 | 端点本批落 |
| beatPlan 规划轮（kit 独有能力的面板化） | **生产线页签**：/status 盘面 + start/stop——pinax 没有的能力，kit 的差异化卖点 | 待做 |
| （pinax 无对应）世界书/知识 | 独立检索视图（worldbook_search + 关系、kb_search + 读卡）；短期文件面板已可浏览 世界书/*.md | 待做 |

**运行时替换语义**：桥即运行时替换——pi-web 的 agent 层（rpc-manager → pi 子进程）已被
「kit turn?raw=1 事件泵」顶掉，模型/工具/技能/会话存储全部来自 kit；pi-web 仅剩 UI 壳与交互。
