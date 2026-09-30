## Unreleased · 工单 R7-1（FS Phase 4 前置：平台缺省适配器注册面，2026-10-01）

**一句话**：`@storyflow/core` 侧**不再 import 任何宿主实现**——R3 立下的 166 处尾参默认 `fs: IFileSystem = nodeFs`
的「缺省」从一个实例改成**一次查找**（新增 `core/src/abstraction/defaults.ts`：注册表＋转发代理）。
拆包（R7-3）的硬前置就此解开，而**调用点一行没动**：名字保留、含义换掉，Node 宿主注册进去的正是原来那三家。

**行为变更一处**（其余为等价换管道）：**未注册就用 = 抛错点名**，不再有静默回落。以前宿主忘了注入会悄悄写真宿主盘、
编译照过；现在跨包消费者在 Node 上跑必须先登记（实测抓到 `storyharness/test/kit-wiring.test.ts`，
补一行 side-effect import 后 storyharness 套件 94/94 绿）。这是 R7-1 唯一的**外溢面**，也是这张表的价值：
「core 不依赖宿主」这件事从此在运行时也成立，而不只是 grep 上成立。

1. **注册表**（`core/src/abstraction/defaults.ts`，零 `node:*`、不 import 适配器实现）：`registerAdapters({fs,path,proc})`
   / `currentAdapters()` / 三个 `Proxy` 转发对象。逐次调用查表 ⇒ 注册时机不受 import 顺序约束；转发对象身份稳定
   ⇒ FS1 D4 的「按适配器身份分桶」缓存语义与 R6-4 的 `mcpFor` WeakMap 分桶都不变；重复注册以后者为准、只登记引用不复制。
2. **Node 侧登记**：`abstraction/adapters/node.ts` 末行 side-effect 注册自家三家（入口件 import 它即完成）；
   新增 `core/vitest.config.ts` 把 `test/setup-adapters.ts` 挂成 `setupFiles`——这份 setup 同时是浏览器/WASM 宿主
   该照抄的那一行（换成自家实现即可）。
3. **28 个文件的 import 行改指 `defaults.js`**：一次 `tools/batch-edit.py --manifest`（该工具本轮升 v2，支持多文件同批：
   逐文件字面校验、任一处不成立整批拒绝零写入、per-file sha256 前/后收据），收据 `.receipt-r7-1-imports.json`（仓库根，与 R4 那批收据同一处）。
   仍直连 Node 适配器的只剩**七个宿主入口件**（`cli.ts` `mcp.ts` `export-cli.ts` `quality-cli.ts` `http.ts` `schema.ts` `cfg-template.ts`）。
4. **`http.ts` 显式登记**：HTTP 面本就跑 Node，靠 `schema.ts` 的传递 import 侥幸拿到实现的话，断在哪天是运行时启动即抛、
   编译期拦不住——那一行写成显式副作用 import 并在注释里点名理由。
5. **新门 `core/test/defaults-registration.test.ts`（8 例）**：双向死表（豁免区之外只剩七件）／`defaults.ts` 自身干净
   （只查 import 形态——未注册那句错误消息里必然写着该 import 哪一件，按裸文本匹配会把自己的指路消息判成违规，
   本轮自测就被绊过一次）／尾参默认去向普查逐数（**166 总 / 156 经注册表 / 10 在 `cfg-template.ts` / 27 个文件**）／
   未注册抛／注册即转发＋宿主盘零泄漏／后注册覆盖（含 `sep` getter）／只登记引用／setup 后身份稳定。
6. **规范同步改写**（不留第二套真相）：FS1 §四第 1、2、4 条按注册语义重写 ＋ 新增 **§4.1 注册面** ＋ §六 追加
   D-R7-1…D-R7-4。第 4 条顺手纠正 R7 门禁的写法：工单字面那条「core 包在无 `@types/node` 下 tsc 通过」**跑起来是空转的**
   （fastify／MCP SDK 的 d.ts 带 `/// <reference types="node" />`，传递性把 `@types/node` 拉回类型图，`types: []` 拦不住），
   能落地的门是「import 普查双向死表」＋「依赖出包」。

**门禁实测**：`tsc --noEmit` 0 error；`npx vitest run` **38 文件 / 421 用例**全绿（R6 交付基线 37/413 ⇒ ＋1 文件 ＋8 用例）；
`gen-openapi --check`／`gen-verbs-doc --check` OK（19 路由＋27 动词）；漏传门复跑 **TS2554 = 0 / TS1016 = 8**（`.leakcheck` 已删）；
入口冒烟复验 `flow_list` 0、`quality-cli` 3 项 0、`export-cli mermaid` 0、`up --port 8498`：`GET /` 200 text/html 2200 字节／
`/.git/config` 404／`/api/v1/projects` 200／`/api/v1/verbs` `ok:true`（冒烟进程按 CommandLine 核验后自杀，端口已释放）；
`storyharness` 套件 94/94。**提交状态（2026-10-01 01:19 的实况，不是本会话的动作）**：验收方 ZCode 出的
`docs/验收回执-R1-R6-20261001.md` 建议「R7 落地前先分轮提交」，随后落了四个切片提交
（`7b20668e` R1-R3 ／ `97395502` R4 ／ `8be82859` R5 ／ `f48dadf7` R6）——**R7-1 的代码当时正在盘面上，被同一批
`git add` 一起扫进了切片 1/4 与 4/4**：注册表、两个新测试件、`core/vitest.config.ts`、`tools/batch-edit.py` 与
28 个 import 换向现在都在 HEAD 里，而提交信息写的是 R1-R3/R6。仍在盘面的只有本轮四份文档改动、
`storyharness/test/kit-wiring.test.ts` 那一行登记，以及五张收据/回执（untracked）。
**审计提示**：按提交信息找 R7-1 会找错地方，用 `git log -- core/src/abstraction/defaults.ts`。
邻会话交接回执：`docs/交接回执-注册面R7-1-20261001.md`（写集逐件 sha256＋mtime、最短验收三命令、行为变更一处、未决 N1–N7）。

**未做/挂账（诚实面）**：① **R7-2 core 包净身**——非 FS 族 `node:*` 六处（`kernel.ts:577-578` 的 `createRequire` 疑似死码，
先验尸再处置）、`ids.ts::sha12` 同步 sha1、`api-v1.ts`/`compat.ts` 的 fastify 类型形状、`process.env` ×5 文件／`Buffer` ×1／`console` ×1；
② **R7-3 物理拆包**——`@storyflow/core` ＋ `@storyflow/adapters` 目录拆分与旧路径 re-export，红线是
`core/dist/cli.js`／`core/dist/mcp.js` 不能断（宿主 MCP 注册指着它们）；③ 模块级求值两件（`schema.ts::ROOT` 即 FS1 D3、
`cfg-template.ts` 的 10 处尾参默认）本轮**故意没动**——它们在宿主入口死表里，硬推只会把注册表写成第二个真相；
④ 注册表是**进程级单表**，多宿主并存（同进程两家盘）需要的是显式传 `kernel`，不是靠这张表兜——这一点与 D4 同源，写进 §4.1。

---

## Unreleased · 工单 R6（FS Phase 3：宿主面清零，2026-09-30）

**一句话**：R3 收口时挂着的那 9 个宿主面文件全部改吃注入，`core/src` 除 `abstraction/adapters/*` 外
**零 `node:fs` / `node:path` / `node:child_process`**——工单 R6 的出口判据达成，M3 的前半（全内核零 `node:fs`）成立。
证据不是 grep，是**跑**：会话面、`fs_*` 工具族、系统提示、`flow_lint`、静态面 `GET /` 整条跑在内存盘上，
跑完宿主盘一条都不许多（`core/test/r6-host-free.test.ts`，与 R5 的 `fs-call-matrix.test.ts` 同一把尺）。

**行为变更四处**（其余为等价换管道）：
① `agent.ts` 七个公开函数的首参由路径字符串改 `kernel`（`loadModelConfig` / `saveModelConfig` /
`listSessions` / `createSession` / `getSession` / `deleteSession` / `renameSession`）——**破坏性签名变更**，
但全仓直接 import 者只有 `core/test/agent.test.ts`（已同步改），`storyharness/` 用自有副本、`adapter/` 走 HTTP，外溢面实测为零；
② `export const agentMcp` 单例下架，改 `mcpFor(kernel)` 按注入盘分桶（默认 Node 盘仍是同一实例 ⇒ 现网 HTTP 逐字节不变）；
③ `flow_lint` 的子进程 cwd 由「projectDir 上跳两级」改 `kernel.repoRoot`——默认盘面（`root === repoRoot`）同值，
分离数据根的宿主上这才是对的（只有仓库根有 `tools/flow-lint.py`）；
④ 静态面读盘改 `kernel.fs.stat` + `readBuffer`，出口按 Fastify 惯例包一层 `Buffer.from(…)`——发出字节不变。

1. **接口扩容两件**（§四第 5 条走的普查，不是加偏好）：`IFsPath.fromFileUrl(url)`（唯一调用点 `schema.ts:15`
   用 `import.meta.url` 定位包根，此前是宿主件里最后一条 `node:url`）、`IProcessLauncher.detach(cmd, args)`
   （`cli.ts` 的 `up --open`，不返回结果、失败只以抛错表达）。Node＋Mock 双实现，对表测试进 `abstraction-mock.test.ts`。
2. **`agent.ts` 整件零 `node:*`**：内部件（`readSession` / `writeSession` / `sessionFile` / `withinProject` / `fsTools` /
   `analysisTools`）与公开件一律从 `kernel.fs` / `kernel.path` / `kernel.proc` 取管道；`analysisTools` 里那份
   抄自 `withinProject` 的「resolve + sep」越界判定收编成单点调用（两套真相必然漂移）。
3. **`flow_lint` 走 `proc.runAsync`，四态返回各有测试**：有输出（截断透传）／启动层错误（`执行失败: …` ＋ stderr）／
   退出非零且无输出（`退出码 N（无输出）` ＋ stderr）／退出零无输出（`exit=0` 占位）。特意补了第三态：
   把它折叠进「执行失败」会把 flow-lint 的 stderr 诊断缩成一句干巴巴的 `exit=1`。
4. **`http.ts` 静态面与 openapi 读取吃 kernel**：`resolveStaticPath(kernel.root, url, kernel.fs, kernel.path)`、
   `contentTypeOf(abs, kernel.path)`、`Buffer.from(kernel.fs.readBuffer(abs))`；白名单判定（敏感段/敏感前缀/穿越）
   在内存盘上照样 404，有测试。
5. **入口件按纪律显式用 Node 适配器**（不是漏网）：`cli.ts` `mcp.ts` `quality-cli.ts` `export-cli.ts` `schema.ts`
   的 BETA 留痕、包根定位、CLI 进程面本就属宿主职责（§四第 1/2 条），改吃注入反倒会把台账写进内存盘。
   `cli.ts` 的 `openBrowser` 因此收 `proc: IProcessLauncher` 形参——平台选命令留在入口，起进程交给抽象层。
   （**R7-1 起本条口径更新**：core 侧那 28 个文件的 `nodeFs`/`nodePath` 改从注册表取，本条列的入口件才是直连 Node 实现的一方；
   名册以 `core/test/defaults-registration.test.ts` 的死表为准，此处不抄第二遍。）
6. **普查门写成双向测试**：`r6-host-free.test.ts` 走 `core/src/**/*.ts`（排除 `abstraction/`），
   `import` 与 `import("node:x")` 两种形态都算。剩余**非 FS 族**宿主绑定钉成死表六处：
   `node:process` ×3（`cli.ts` `export-cli.ts` `quality-cli.ts`）、`node:net` ×1（`cli.ts` 端口探测）、
   `node:crypto` ×1（`ids.ts`）、`node:module` ×1（`kernel.ts` 的 `createRequire`）——多一处=新尾巴，少一处=表过期，
   两样都当场红。这六处属宿主面（FS1 D7 同族），完整达成在 R7 拆包。
7. **漏传门（§四第 7 条）在 R6 实抓两处**：剥掉类型标注形态的尾参默认后 `TS2554` 点名 `mcp.ts` 的 R4 资源面
   两处 `contentTypeOf(rel)` 没传 `kernel.path`——正是「尾参默认漏传也编译通过」的现行犯，已修，复跑 TS2554 = **0**。
   顺带纠正该门的复现命令：按字面 ` = nodeFs` 粗剥会把常量初始化一起削掉，满屏 TS1005 假语法错反倒埋掉真漏传，
   剥离必须按 `: IFileSystem = nodeFs` 这种**类型标注形态**做（命令已写进 FS1 §四第 7 条）。
8. **门禁数字**：`npx tsc --noEmit` **0 error**；`vitest run` **37 文件 / 413 用例**全绿（R5 交付基线 36/397 ⇒ ＋1 文件 ＋16 用例）；
   本轮两件单独跑：`r6-host-free` **15 用例**、`abstraction-mock` **18 用例**（R6 补 `fromFileUrl` 对表与 `detach` 两条）；
   `gen-openapi --check` OK（**19 路由 ＋ 27 动词**）；
   `gen-verbs-doc --check` OK（27 动词）；漏传门 TS2554 = 0（TS1016 = 8，剥离副产物，同 R3 口径）。
   真机冒烟：`cli.ts flow_list` 退 0、`quality-cli` 对临时项目退 0、`export-cli --flow novel --target mermaid` 退 0、
   `cli.ts up` 起服务后 `GET /` = 200 `text/html` 2200 字节、`/api/projects` 与 `/api/v1/projects` = 200、
   `/.git/config` = 404（白名单在真盘上照样拦）。
9. **未做/挂账（诚实面）**：① 非 FS 族 `node:*` 六处仍在宿主件，「core 包在无 `@types/node` 下 tsc 通过」归 R7；
   ② `schema.ts::ROOT` 仍是宿主字符串（FS1 D3 未解，R7 的真活）；③ `AgentMcp` 的连接缓存仍是进程级
   （按盘分桶只解决「读哪张盘的配置」，跨宿主复用连接的条件归 R7）；④ 工单卡面 P1/P2 的 15 个文件本轮无写集
   （R3 已消化），按卡面重跑就是重复施工；⑤ **R7 那道门禁按字面跑是空转的**——`types: []` 编整个 `src` 实测 0 error，
   因为 fastify／MCP SDK 一路的 d.ts 带 `/// <reference types="node" />`，`@types/node` 传递性进场照样解析 `node:*`；
   六处里 `kernel.ts:577` 的 `createRequire` 还查无调用点（疑似死码）。R7 的门禁已就地改写为
   「import 普查双向死表 ＋ core 包把 fastify/MCP SDK 留在包外做真无 node 编译」，实测三条见工单 R7 段。

**偏离记录**：卡面 vs 盘面共七条（D-R6-1…D-R6-7），全文口径见 `docs/规范-FS抽象层-FS1.md` §六表，此处不抄第二遍
（同一件事在两处各写一遍是本仓的漂移病根）。摘要：P1/P2 无写集／接口扩容两件／`agent.ts` 签名改 kernel／
`agentMcp` → `mcpFor` 分桶／`flow_lint` cwd 与四态返回／非 FS 族六处留 R7／静态面 Buffer 包装。

---

## Unreleased · 工单 R5（FS Phase 2 核验 ＋ SSE 通用化，2026-09-30）

**行为变更两处**（其余为新增面）：① 两条 SSE 流在静默期都会补一帧 `{"type":"heartbeat","ts":…}`——对旧的对话流客户端是
**纯增量**，前提是「未知 `type` 忽略」这条兼容底线不破（仓内两个消费方 `adapter/storyflow-client.mjs`、`storyharness/src/home.ts` 实测都忽略）；
② 对话流的断线检测改挂**响应**（`reply.raw`）而非请求：Node 在请求体读完时就给 `IncomingMessage` 发 `close`，
旧写法让 POST 回合「刚连上就断开」，实测只有 `open` 帧抵达对端——这是 R5 迁管道时实踩并修掉的既有缺陷，不是新引入的行为。

1. **新增 `core/src/sse.ts`（内核 SSE 的唯一出口）**：`sseFrame` / `SSE_FRAME_DONE` / `emitSseEvents(sink, source, opts)`
   ＋ 心跳常量与钳制（`DEFAULT_HEARTBEAT_MS = 10_000`、可调区间 `50`–`30_000`、`heartbeatMsOf()` 非正数/非数字回落缺省）
   ＋ `closeSignalOf(res)`。线格式（`data:` 单字段帧 ＋ `[DONE]` 收口）只在这里抄一份，两条流共用。
2. **新增 `core/src/project-stream.ts`（台账 → 事件投影）**：`JOURNAL_TO_SSE` 是对 `JournalEventKind` 的**穷举** `Record`
   （加第 17 种 kind 不补表就编译不过）；`PROJECT_EVENT_TYPES` 是投影出的 4 种；`projectEvents()` 是事件源。
   投影保留 `event`（台账原 kind）与 `refs`，**不编造 `nodeId`**——事件不许变成第二套真相。
3. **`AgentEvent` 扩 5 种**（`node_start` / `node_complete` / `node_error` / `gate_pending` / `heartbeat`）：
   扩的是盘上已有的那一个联合，**没有新建 `FlowEvent`**（工单卡面的名字，见下方偏离 D-R5-①）。
4. **v1 第 19 条路由 `GET /api/v1/projects/:id/stream`**：`V1Route` 新增 `sse?: true`（handler 返回事件源而非数据），
   `V1Ctx` 新增 `closeSignal`。**流开始前的校验仍回 JSON 信封**（此刻头未发）——项目不存在 ⇒ `404 NO_PROJECT` 带 `meta.route`，
   客户端按 `ok` 分支即可，不必为流写第二套错误处理。`buildOpenApiV1()` 为 `sse` 行产 `text/event-stream` 响应与逐字段事件 schema。
5. **legacy 对话流 `/turn` 迁到统一管道**（卡面第 5 条「行为不变」）：写帧/收口/钳制全部改由 `sse.ts` 承担，
   线格式逐字节不变（`open` 帧在前、`[DONE]` 收口、错误补一帧 `error`），并由 `test/sse-stream.test.ts` 真握手锁住。
6. **台账是事件源，不是进程内总线**：内核每个节点动作本来就追加 `journal.jsonl`，加一层 in-process 事件总线等于第二套真相，
   且跨进程宿主（CLI 起 run、HTTP 在看）收不到。订阅点之前的历史不重放（游标＝台账**行数**，用 ts 会在同毫秒多条事件上漏或重）；
   台账被整本重写（回滚/清场）时重新对齐末尾。重读节拍与心跳**分家**（`LEDGER_POLL_DEFAULT_MS = 1_000`）：心跳保活可以慢，
   事件延迟上限 = `min(1s, heartbeatMs)`；`watchDir` 命中只提前唤醒，**正确性不依赖它**（FS1 §五）。
7. **句柄不泄漏的形状**：泵 `finally` 里只把 `it.return()` **递进**源、**不等**它——异步生成器只在 yield 点处理关闭请求，
   卡在长 await（LLM 请求、节拍 sleep）里的源会让那个 await 永挂并把 HTTP 连接钉死。需要确定性释放的源自己接同一把信号
   （`projectEvents({stopSignal})` ⇒ `finally { cancel() }`），HTTP 面在调用 handler **之前**成型信号并共用。
   回归锁：`watch`/`cancel` 计数各 1（含真 HTTP 握手那条）。
8. **对账脚本扩容**：`scripts/gen-openapi.mjs --check` 现在按 `V1_ROUTES` 逐行校验 200 响应的 **media**
   （`sse` 行必须 `text/event-stream`，其余 `application/json`）——「文档说有、代码没有」的那类坑，面/表/文档三方对账多一根轴。
9. **门禁数字**：`npx tsc -p tsconfig.json --noEmit` **0 error**；`vitest run` **36 文件 / 397 用例**全绿（+2 文件 +13 用例：
   `sse-stream` 10、`fs-call-matrix` 3）；`gen-verbs-doc --check` OK（27 动词）；`gen-openapi --write/--check` OK
   （**19 路由 ＋ 27 动词**，47 个操作）；宿主面普查仍 **9 个文件**，与 R3 收口时逐字相同——R5 两个新文件零 `node:*`。
   卡面门禁「worldbook_search / continuity_slice / kb_search verb 全通」的落点＝`fs-call-matrix.test.ts` 在 `MockFsAdapter` 上跑通三条链并断言宿主盘无泄漏目录。
10. **未做/挂账（诚实面）**：① agent 会话面（含 `/turn`）仍未进 v1 契约，剩下的活是载荷形状（线格式已同源）；
    ② 断线重连的续传（`?since=`）未做，中间断掉那段只能回查 `GET /api/v1/projects/{id}/journal`；
    ③ `run-start`/`run-end`/`verdict`/`rerun`/`snapshot`/`note`/`warn`/`chain-out`/`chain-in` 九种 kind **不投影**，
    是 `JOURNAL_TO_SSE` 里逐条 `null` 的显式表态，扩词汇表归 owner 拍板；④ 多项目聚合流未做。

**偏离记录（工单卡面 vs 盘面）**：

| # | 卡面 | 盘面 | 为什么 |
|---|---|---|---|
| D-R5-① | 「`FlowEvent` 增 5 种」 | 扩的是 `agent.ts::AgentEvent` | 盘上没有 `FlowEvent` 这个类型；`docs/integration/sse-events.md` 早在 R4 前就写了这条提醒。建第二个类型 = 两套事件词汇表必然漂移 |
| D-R5-② | 写集含 `verbs.ts`（VerbContext） | **未动** `verbs.ts` | 事件源选了 journal 台账（见第 6 条），不需要把「发事件的能力」塞进动词执行上下文；真那么做就是内存总线，跨进程宿主收不到 |
| D-R5-③ | 写集含 `kb.ts`（全 FS 化）/`kernel-view.ts`/`minitools.ts` | 三者在 **R3 已迁完**（复普查查无它们） | 卡面按 R1 时的 44 文件普查排的批次，R3 提前合并 P0+P1+P2 已覆盖。R5 补的是**运行时证据**（`fs-call-matrix.test.ts`），不是重复劳动 |
| D-R5-④ | 门禁「规范 §3.2/§4.2 调用矩阵全销账」 | FS1 **没有 §4.2** | 章节号到 §3.3 语义对表，其后是「四、注入纪律」（无子节）。口径按 §3.2 ＋ §3.3，已在 §3.2 末补 R5 复核段说明 |
| D-R5-⑤ | 写集只列 6 个文件 | 新增 2 个文件（`sse.ts` `project-stream.ts`）＋改 4 个（`agent.ts` `api-v1.ts` `http.ts` `gen-openapi.mjs`） | 卡面第 4 条要求「emitSseEvents 通用 helper」——通用件必须有家；投影表与 FS1 §3.2 同理由放独立文件，`http.ts` 排在 R6 批三，塞进去等于把要退役的宿主面当新家的地基 |
| D-R5-⑥ | 「pi-agent SSE 迁到统一 helper（行为不变）」 | 行为不变，但**多修了两处既有缺陷** | ① `req.raw` 的 `close` 在 POST 上过早触发（连接被静掐）；② 源收尾靠 `await it.return()` 会永挂。两处都是迁管道时暴露的，留着不叫「行为不变」，叫「行为不变地坏着」 |
| D-R5-⑦ | — | `worldbookSearch` 的 `expansion[].via` 恒等于同条目的 `id` | 顺手发现、**未改**（载荷形状不属本卡）。语义看着应是「经由哪个命中词条扩展」，而那个信息已在 `from` 里；`via` 目前是冗余字段。归 owner 裁定是修字段还是改文档 |

## Unreleased · 工单 R4（四件套：MCP 资源/提示 + REST 标准化，2026-09-30）

**行为变更两处**（其余为新增面）：① `core/src/mcp.ts` 的自启动守卫由 `/mcp\.(ts|js)$/` 改为 `/(^|\/)mcp\.(ts|js)$/`
——旧正则把 `agent-mcp.ts` 也算成自己，任何以该名运行的入口都会误抢 stdout；② OpenAPI 的形状派生点从 `mcp.ts` 上移到 `verbs.ts`
（`mcp.ts` 转出保持旧 import 面，`core/test/r8-*.test.ts` 的引用不因此断裂）。

1. **MCP 资源面 ×4（新增 `MCP_RESOURCES` 表）**：`wb://{project}/graph`（世界书归纳图全图）、
   `wb://{project}/entry/{id}`（单词条＋全部一跳关系，按 weight 降序、带证据 `src`）、
   `flow://{project}/state`（运行态切片，与 HTTP `/api/projects/<id>/live` 同源同形，走 `kernel.viewLive`）、
   `artifact://{project}/{+path}`（**只读 `registry/artifacts.json` 登记过的**产物正文）。
   注册、`resources/list`、文档、测试四处读同一张表；`LIST_CAP = 300` 超限**不静默裁**，`truncated` 如实标注。
2. **MCP 提示面 ×2（新增 `MCP_PROMPTS` 表）**：`review-worldbook`（分类分布／孤儿词条／缺摘要词条／检索命中＋一跳扩展）、
   `gate-assist`（门悬置时长与凭据、被裁节点生效编排声明、本轮登记产物与完整性结果、旁路诊断、四种裁决后果）。
   两个模板**只摆事实不下结论**（语义判决归评审者对照 `knowledge/rules/`，数值证据只记账不构成打回闸）；
   未开跑的项目返回一行说明而不是抛错。
3. **偏离记录（工单卡面 vs 盘面）**：① 卡面写 SDK 1.7，实装 **1.30.0**（`package.json` 声明 `^1.7.0`），
   API 按 1.30 真实签名落（`registerResource` 四参重载、`ResourceTemplate` 的 `list` 必填位、`registerPrompt` 的 `argsSchema`）；
   ② 卡面写 `wb://graph` 这类前缀名，落地为**按项目寻址的 URI 模板**（世界书/运行态/产物全是项目级数据），
   变量进出走 `encodeURIComponent`，中文项目 id 往返有测试；③ `{path}` 匹配不到带 `/` 的产物路径，改用 RFC 6570 保留展开 `{+path}`。
4. **REST v1（新增 `core/src/api-v1.ts`）**：`V1_ROUTES` 18 条路由 ＋ 统一信封
   `ApiResponse {ok,data,meta{apiVersion,route,at,verb?}}` / `ApiError {ok:false,error{code,message,detail?},meta}`，
   状态码源于错误本体（`ApiError.http` / `KernelError.http`，兜底 500）。
   动词直通 `POST /api/v1/verbs/:verb` 执行前跑 `verbArgIssues()`（zod，派生自动词表）⇒ `400 VALIDATION` 逐条点名；
   legacy `/api/verbs/:verb` **不加校验**（形状已冻结）。
5. **偏离记录（旧路由不做 301）**：legacy `/api/*` 载荷**逐字节不变**，改由 `registerLegacyMarkers` 挂
   `deprecation: true` ＋ `successor-version: /api/v1` 响应头。理由：`POST` 走 301 会被降级成 GET（写操作静默改语义），
   且 legacy 载荷被仓内 **11 个文件**按字段直读（`grep '/api/projects|/api/verbs|/api/openapi'` 命中：`adapter/storyflow-client.mjs`、
   `storyharness/` 多处、`tools/workflow-page-template.html`、`tools/page-lint.mjs`）。
6. **OpenAPI 生成（新增 `scripts/gen-openapi.mjs` ＋ `contracts/http-openapi-v1.json`）**：文档派生自 `V1_ROUTES` ⊕ `VERBS`，
   27 个动词各出一条 `/api/v1/verbs/{name}`（通配符那条做不到 grep 对账），运行时 `GET /api/v1/openapi.json` 同一函数产出。
   `--check` 查四件事：生成物与提交文件逐字节一致／每条路由有对应 method／无表外孤儿路径／动词必填参数进 `schema.required`。
   legacy `contracts/http-openapi.json` 冻结 v1.2 不回改。
7. **修一处共用单点**：legacy `/api/projects/:id/graph` 的 flowId 寻源（state 优先、回落首个可读 flow）上移为
   `resolveProjectFlowId()`，两个面共用；顺带把「state.json 损坏 → 500」改为「回落 → 报 NO_FLOW」，
   让报出来的错是**能修的那个**（记为偏离 D-R4-④）。
8. **文档同步**：`docs/Agent.md`（§一 派生图加 v1/资源/提示；§六 诚实面五行改写；§七 加 gen-openapi 门禁），
   `docs/integration/mcp-reference.md`（新增 六 资源面／七 提示面／八 握手，纪律补两条「不在注册处硬写 URI」），
   `docs/integration/rest-api-reference.md`（新增 二 v1 面四小节，错误形状拆 legacy/v1 两套，九 诚实面），
   `docs/integration/embedding-modes.md`（**销 R3 欠账**：接线状态表 5 行改 ✅，"可嵌入只是接口就位"一句改写为「核心已能在假 FS 上跑通整条 flow，但换宿主仍未齐」）。
9. **测试**：34 文件 / **384 用例**（+16：`r8-verbs` +9 MCP in-memory 真握手，`r8-server` +7 v1 信封与 legacy 零回归）。
   `npx tsc --noEmit` 0 error；`gen-verbs-doc --check` OK（27 动词）；`gen-openapi --check` OK（18 路由＋27 动词）。
   宿主 API 普查仍为 **9 个文件**（R4 新增的 `api-v1.ts` 只经 `kernel.fs/path`，未进名单）。
10. **未做/挂账（诚实面）**：① agent 会话面（含 SSE `/turn`）未进 v1 也不在任何契约——补它要先定 SSE 的 v1 表达，属 R5；
    ② 资源变更通知 `list_changed`/订阅未做（R5 走 `watchDir`）；③ `zod` 被 `verbs.ts`/`mcp.ts` 直接 import，
    但仍是 MCP SDK 的**传递依赖**、未列入 `core/package.json`——拆包（R7）与外部依赖轮（R8）必须显式处理，否则新环境 `npm ci` 后可能悬空。

## Unreleased · 工单 R3（FS 抽象层 Phase 1：内核核心迁移，2026-09-30）

**行为变更**：内核的读写管道全面改走注入适配器（缺省 = Node 适配器 ⇒ 宿主使用路径不变）；
`extractCtxUsage` 新增一条抛错（给了 `root` 没给 `io`）；`decisions`/`journal`/`diag`/`metrics` 的公开签名
由「尾参默认」改为「必传首参 `io`」——**这是 breaking 的内部签名变更**，仓内调用点已全量透传，外部消费者需同步。

1. **注入位落位**：`KernelOptions` 增 `fs?: IFileSystem` / `path?: IFsPath` / `proc?: IProcessLauncher`，
   `Kernel` 上 `readonly fs/path/proc` 三件套；`Kernel` 结构上即满足 `FsIo = { fs, path }`，故台账调用写成 `journalAppend(kernel, dir, …)`。
2. **语义件收编**：新增 `core/src/abstraction/jsonio.ts`（`readJson` / `writeJsonAtomic` / `appendJsonl` / `readJsonl` / `LockDir`，
   尾参 `fs`/`path`），退役件 `core/src/fsio.ts` 删除（无 import 者，`git rm`）——「原子写 + 锁目录」只留一个家。
3. **写集 = P0 + P1 + P2 共 33 个源文件**（工单原排 R3 只做 P0 18 个，提前合并的理由与后果记在 `docs/规范-FS抽象层-FS1.md` §3.2）：
   `kernel*.ts` `state` `registry` `asserts` `minitools` `compat` `kb` `project-config` `assertion-preset/*`
   ＋ `modules` `overlay` `assembler` `aesthetic` ＋ `metrics` `diag` `decisions` `skills` `kits` `optimize` `selection`
   `intent` `cfg-template` `profiles` `production-preset` `journal` `verbs`。三面（CLI/HTTP/MCP）与两个入口桥的动词调用一并改为显式适配器。
4. **台账 io 束化（FS1 §四 第 6 条）**：写路径函数改必传首参 `io: FsIo`，`src`（除 `abstraction/`）内 **104 处调用**全量透传——
   `journalAppend/journalQuery` 58、`recordDiag/readDiags/summarizeDiags/diagPath` 27、
   `readMetrics/recordMetric/metricsPath` 8、`setDecision/listDecisions/decisionsMap/decisionsDir` 11，外加 `syncIntentDecisions`。理由写在 fs.ts 头注：
   尾参默认漏传**编译照过**、台账静默写进真宿主盘；必传首参把这件事交给编译器。
5. **`runAsync` 进 v1**（FS1 §2.2 追加）：`minitools.ts` 脚本壳本就是 `promisify(execFile)`（超时 60s + SIGTERM），
   同步化会冻住 HTTP/MCP 宿主；`ProcResult` 的 `signal`/`timedOut` 与「退非零」分开建模，`verbs.ts` 的 `bridge()` 改吃 `kernel.proc.exec`。
6. **可复现的漏传门**（FS1 §四 第 7 条）：临时剥掉 `src`（除 `abstraction/`）全部 ` = nodeFs` / ` = nodePath` 尾参默认后跑
   `tsc --noEmit`，`TS2554` 即全部漏传点。R3 首轮报 **28 处 / 9 个文件**（`kernel` 6、`verbs` 7、`export-cli` 4、
   `kernel-optimize` 3、`kernel-run` 3、`minitools` 2、`assertion-preset/registry` 1、`kernel-view` 1、`quality-cli` 1），收口时 **0 处**。
   其中 `kernel.ts::ctx` 的 `loadState(projectDir)` 是内存盘冒烟第一条逼出来的——它让 `flow_submit` 直接报「项目无 state.json」。
7. **内存盘端到端冒烟**（新增 `core/test/abstraction-smoke.test.ts`，4 用例）：`flow_run`→`flow_submit` 全程跑在 `MockFsAdapter`
   ＋ `MockProcLauncher` 上——①任务包来自内存语料、②产物/注册表/journal/metrics 全落内存盘且宿主盘无泄漏目录、
   ③跑完语料逐字节不变（只读承诺）、④改内存里的技能卡任务包跟着变（证明**读**也走注入适配器）。假进程 `calls` 为空 = agent 步没起子进程。
8. **规范同步**：`docs/规范-FS抽象层-FS1.md` §2.2（`runAsync` 与 `signal/timedOut`）、§3.1（R3 复普查：`node:(fs|path|child_process)` 文件 44 → **9**）、
   §3.2（实际写集口径）、§3.3（新增 6 行语义对表：`runAsync`/`writeTextAtomic`/`exists+stat` 合并/`remove`/`stat()` 布尔字段/`path.posix`）、
   §四（第 6、7 条注入纪律）、**新增 §六 偏离清单 D1–D8**（含 `schema.ts::ROOT` 仍是宿主字符串、缓存按适配器身份分桶、
   `node:crypto`/`process.env`/console 不在 v1 范围）。
9. 测试 **34 文件 / 368 用例**（+1 文件 +4 用例；`r8-verbs` 的 `fromFlags` 负样本改为真内核——它现在真的读盘）。
   tsc 严格模式全绿；`node scripts/gen-verbs-doc.mjs --check` OK（27 动词逐行一致）。

## Unreleased · 工单 R2（AP1 收尾：断言覆盖 + 预设三级链 + 诊断注入，2026-10-01）

**行为变更三处**（其余为新增声明面）：门点取挂载改走 `Kernel.assertionMount()` 单点；
`applyGatePreset` 的诊断行追加现场证据；`policy.defaultPreset` 参与 `overlayHash` 因而可触发 replan。

1. **三类断言覆盖 patch 进 overlay**（`set-assertion-preset` / `disable-assertion` / `insert-assertion`）：
   契约 `contracts/flow-overlay.schema.json` kind 枚举 14→17 ＋ 新字段 `presetId/assertions/assertion/patch/group`；
   解析 `core/src/modules.ts::effectiveFlow3`（`FLOW3_KINDS` 同步，形状非法→`unsupported`，存在性判定推迟到挂载期）；
   合成 `core/src/assertion-preset/executor.ts::applyAssertionOverrides`——深复制派生挂载（原挂载干净 = 跨项目不污染），
   progressive 计数与原挂载共享同一个 Map，四类「引用不到」全落 `ignored` 并进诊断通道。
   `disable-assertion` 语义定为**免拦人不免检查**：证据留、status 降 warn、不计数。
2. **预设选择三级链**（§九）：`KernelOptions.assertionPreset` > `flow.policy.defaultPreset` ⊕ `set-policy:defaultPreset`
   > `novel-fanqie`；`POLICY_KEYS` 增 `defaultPreset`（非空串校验），`contracts/flow.schema.json` 同步声明。
   坏 id 仍静默不激活 = **无调制**，确定性完整性照拦（预设是调制器，不是闸门总开关）。
3. **诊断摘要注入**（§十）：两处门点写 `state.diagnosticSummary`/`diagnosticFrom`（`run-state.schema.json` 同步），
   `buildTaskPackage` 随任务包下发 `pkg.diagnosticSummary`（`task-package.schema.json` 同步）；
   check_\* 节点摘要按产物前缀路径并落检查报告 `gateSummary`（收据）。摘要行含现场证据，
   三态口径分明：缺省=没走过门点 / 空串=走过但无调制 / 非空=有事实。
4. **规范补写**：`docs/规范-断言预设-AP1.md` 增 §七/§九/§十（设计稿编号，实现先于成文；§八 工单未要求、磁盘无实现，
   编号留空不虚构），并显式标注两处偏离设计稿：`applyAssertionOverrides` 返回 `OverrideReceipt` 而非裸挂载、
   `defaultPreset` 走既有 `overlayHash` 指纹不豁免 replan。
5. 测试 33 文件/364 用例（+20：`core/test/ap1-override.test.ts` —— 执行器合成 8 项、编排解析 5 项、
   端到端三级链与注入 7 项；验收线「阈值提高后同输入不再 block」在 e2e 可见）。
   tsc 严格模式全绿；R1 四门禁复跑不变（`gen-verbs-doc --check` OK；`abstraction/` 外 `node:*` 仍 44 文件）。

## Unreleased · 工单 R1（FS 抽象层 Phase 0 + 集成文档四件套，2026-10-01）

**零行为变更**：本轮全部为新增文件，内核现有代码一行未改。

1. **FS/进程抽象层接口落库**（`core/src/abstraction/`）：`fs.ts`（`IFileSystem`/`IFsPath`）、`proc.ts`（`IProcessLauncher`）、
   `adapters/node.ts`（原子写沿用 `fsio.ts` 语义）、`adapters/mock.ts`（内存实现，带 errno 形状异常）。
   接口方法集由调用面普查反推，规范：`docs/规范-FS抽象层-FS1.md`（含 §3.2 迁移矩阵——修正了工单 R3/R6 的文件计数，
   并点名工单未列的 `agent-mcp.ts` `export-cli.ts` `journal.ts` `quality-cli.ts`）。
2. **`IFileSystem.watchDir` 进 v1**（拍板点①）：为 R5 的项目级 SSE 预留，缺省 `persistent:false`，正确性不得依赖 watch。
3. **集成文档四件套**：`docs/Agent.md`（入口 + 生成动词表）与 `docs/integration/{mcp-reference,rest-api-reference,sse-events,embedding-modes}.md`。
   三份文档如实标注现状缺口：MCP 无 resources/prompts、REST 无 `/api/v1` 与统一包装、SSE 只有 agent 对话流、
   **抽象层尚未接线**（`KernelOptions` 无 `fs/path/proc` 注入位，R3 才注入）——"可嵌入"目前是接口就位，不是能力。
4. **动词表文档生成器** `scripts/gen-verbs-doc.mjs`（`--write` / `--check`）：文档成为动词表的第四个派生面，
   `--check` 入门禁。经 core 自带 tsx 直读 `core/src/verbs.ts`，无需先 build（`MINIFLOW_VERBS_FROM_DIST=1` 走 dist）。
5. 测试 32 文件/344 用例（+17：`core/test/abstraction-mock.test.ts` —— mock 自测 + Node/mock 同语义对表 + proc 脚本化），
   tsc 严格模式全绿；`abstraction/` 之外 `node:fs|path|child_process` 文件数不变（44）。

## 0.10.0 · 断言预设 AP1 + 生产线预设 PP1 + 跨流水线级联（2026-09-30）

1. **kernel.ts 拆分**：2280 行单文件 → 489 行门面 + kernel-run/optimize/view/config/base 五文件（free function + kernel 显式传参，公开 API 零变化；KernelError 独立 kernel-base.ts 防运行时环）。
2. **Assertion Preset（AP1）**：断言预设四层架构（discovery/registry/mount/composition，core/src/assertion-preset/）——gate-preset.yml 声明断言分组、gate 行为（warn-only/block-critical/strict）、progressive 渐进阈值与条件启用；接入 doSubmit 提交链与 check_* 节点两处门点；随包 4 个系统预设（novel-fanqie 缺省/screenplay-audio/prose-light/minimal）；when 条件求值器为无 new Function 的安全子集。
3. **Production Preset（PP1）**：生产线预设 presets/<id>/（manifest + overlay.<flowId>.json）——flow_run(opts.preset) 选线、state.preset 持久、生效编排 = flow ⊕ 出厂 overlay ⊕ 预设 overlay ⊕ 项目 overlay；set-module 新增 remove 语义（模块实例裁剪，连接按剩余序重派生）；drama 模块注册 render-prompt-seedance op；随包 5 个预设（web-novel/screen-play/world-bible/comfyui-script/short-story）。
4. **flow_chain 跨流水线级联**：源项目产物确定性搬运到新项目 00-素材/（sourceMaterials「在盘即声明」语义），显式输入开跑目标流水线，双边 journal 接力留痕（chain-out/chain-in 新契约枚举）。
5. 新依赖：core +js-yaml（预设文件解析）。测试 31 文件/325 用例（+27），tsc 严格模式（含 noUncheckedIndexedAccess）全绿。规范文档：docs/规范-断言预设-AP1.md、docs/规范-生产线预设-PP1.md。

## 0.9.0 · 推演回归 + 两条运行时接线（2026-09-30）

1. **推演模式随包回归**：packs/deduce（galgame 点点点剧情推演，engine/pages/templates/tools 四件）——挂载表自动装载，/deduce 即玩；模板项目 template-推演 随包（首写落地）。
2. **Skill 即 Tool 装载**：执行环读 kit/skills.tools.json，40 技能以 skill_<slug> 工具进 agent（版本+约束在描述，调用返回源卡全文；缺卡报缺）。
3. **HyperGraphRAG 装载**：kbSearch/kbRead 优先走 kit/hypergraph.rag.json 编译图（115 词条/5998 边）；缺图回落扫盘；缺源卡带指引报缺。
4. 行为修复：配置内联 apiKey 优先于环境变量；模型侧 stopReason=error 透出为 error 事件（不再空气泡）。
5. core 测试套迁移收口（flows 用途化/acceptance 可选化/夹具 test-dual），298/298；storyharness 94/94（+packgate 11、kit-wiring 3）。

## 0.8.0 · 故事 Kit 重构（2026-09-29）

定位改版：**轻量、可玩性高的故事 kit 提供者**，与创作工作区彻底解耦。

1. flows 按用途归一：screenplay / novel / prose / topic 四条（删除主题流与项目细节）；demos 全删。
2. 运行时精简：判官层（judge.ts + 证据/回喂链路 + judge 子命令 + 配置段）整体移除；
   module io.acceptance 验收约束层移除；detect 检测模块移除——审核归宿主（docs/PROTOCOL-REVIEW.md 三通道接入）。
3. Skill 即 Tool：kit/skills.tools.json（40 技能 → skill.* 工具：名称即功能+版本+约束），tools/kit-skills.py 编译。
4. knowledge 层改为发布编译产物 kit/hypergraph.rag.json（115 词条/5998 边 HyperGraphRAG）；源 md 不进 git（本地可插拔），tools/kit-compile.py 重建。
5. 新增 adapter/ 适配层：REST+SSE 接口协议 + 零依赖参考客户端 storyflow-client.mjs（浏览器/Electron/移动端同构）。
6. flow id 变更：drama-flow→screenplay、novel-longform→novel、novel-prose→prose、topic-selection→topic（headless 默认 screenplay）。

# Changelog · miniflow harness

版本唯一事实源：仓库根 `VERSION`。格式参考 Keep a Changelog；R1..R8 历史代际摘要附于 4.0.0 条目。

## [5.0.0] · 2026-09-21 · v5.0 工单：断言体系退役与规则语料化（agent-only 执行模型）

拍板（2026-09-21 用户指令）：「确认不用的全部干掉，疑似有用的喂给 orchestrator 当做语料，未来我只用 agent，不用断言。」宣告文档：`docs/版本宣告-v5.0.0.md`（含 90 条去向总表 = 工单 §二 正式版；批0 盘账：全库 journal 真正打回过东西的断言只有 2 个 id 共 7 次，25 条以「无机器校验器」名义空转 170 次 warn）。**废除对象 = 断言协议（声明式提交闸 + pass/block/unverified 三态裁决 + node/op `asserts` 字段），不是检查能力**：可数的 27 条转扫描器证据（T 轨），不可数的 50 条转规则语料（C 轨），13 条随红蓝对抗/监管残族删除（X 轨）。

### Added（批A · 先立）
- **`knowledge/rules/` 规则语料库**：C 轨 50 条 → 16 张域卡（hook/pacing/curve/character/conflict/scene/reversal/dialogue/visual/ending/ai-trace/deconstruct/continuity/meme/setting/platform），`tools/rules-init.py` 从台账生成、原文零改动、卡头 `provenance.refs` 记来源 id 可回溯；措辞去闸化（「判 block」读作优先级，不构成拦截）。
- **质量扫描工具链**：`tools/quality-scan.py` + `core/src/quality-cli.ts` 桥（复用 `aesthetic.ts` 全量扫描器，JSON findings + 退出码恒 0——证据工具无权裁决）；内核 minitool `scan_quality`（原 `check_aesthetic_asserts` 改造：照跑全量、只出 `内部/质量扫描-*.json` 收据不拦截；空扫描 journal 显式留痕「非质量通过」）。
- **module@1 验收面新契约**：`io.acceptance.{scans,rules}`（扫描器 id + 规则卡 id），取代已退役的 `io.acceptance.asserts`。
- 演练：p-yaomo-fx-001 agent-only 验收样例（批A-3）。

### Changed（批B · 后破）
- **提交链无断言闸**：`core/src/kernel.ts::flow_submit` 删除 `runDeclaredAsserts` 三态派发与 对外交付/ 引擎全量闸——唯一残留闸 = 确定性完整性（`runIntegrityAsserts` 存在性/空文/残渣/计数 + `runHeaderAsserts` 头部 + 词汇表守卫）；`core/src/asserts.ts` 三态裁决层整层下架（`checks_via` 别名转译随之消失——扫描器直接报真名）。
- **指标更名**：`RunMetric.asserts` → `checks`；汇总 `assertPass/assertBlock` → `checkPass/checkBlock`。打回成本口径（block×溢价+retries×2）算术不变，只是打回只剩完整性来源。
- **数据层清扫**（一次性迁移器 `tools/asserts-retire.py`，逐条回显）：`flows/*/flow.json` 与 `modules/*/module.json` 全部 `asserts` 字段/引用删除，`check_aesthetic_asserts`→`scan_quality` 改名（9 条 flow / 9 个模块）；`contracts/flow.schema.json` asserts 出白名单。
- **守门反转**：flow-lint `E-ASSERTS-RETIRED`（flow.json/出厂 overlay 出现 asserts/add_asserts/remove_asserts = error）、module-lint 同名规则 + kit-lint `E11`（overlay 补丁带退役断言字段即 error）；kit-lint「断言覆盖」账改挂「规则语料与扫描器台账」（v5.0 台账：规则卡 16 张 / C 轨 50 条全覆盖 = error 级；T 轨 26/27 有实现，缺口 W4 点名 AE-NAT-HIT 不静默）。
- **前端 v5.0 面**：`tools/workflow-page-template.html` 验收区改「扫描/规则」证据 chips +「机器只出证据，裁决归 agent 与端尾验收」；历史项目数据只在生成器单点归一（`tools/project-pages.py`：`assert`→`check`、`unverified`→`warn`、标 `legacy` 并在页面显式标出历史口径——面板零双名兜底，R4 §5.3 不破）；`tools/page-lint.mjs` 新增四账（op 带 asserts / acceptance 形状非 `{scans,rules}` / 非 legacy 模块报告检查名以 AE- 开头 / nodeInfoPaper 泄 asserts = FAIL）。
- **测试改写**（批B-4）：`r5-generative.test.ts`「声明断言必须被执行」套件换 v5.0 回归锁（扫描器 block 级产物提交照收；残渣违规照样打回且 problems 零 AE- 名、落 `checks.block`；`scan_quality` 收据 `mode:quality-evidence`、无 declared/unverified 口径、有 block 证据不判败本步）；WO-A 五用例改 `runAestheticAsserts` 直调（密度真名/章末钩三态/伏笔逾期/纯净度/禁不可拍摄）；`kits.test.ts` 断言台账套件改锁归档（90 条无重复、引擎 id 全在册、`io.acceptance.scans` 逐条可回溯归档、checks_via 目标在册）。

### Removed
- X 轨 13 条：红蓝对抗残族 6（AE-RED-*/AE-PR-*）＋监管/评审步残族 3（AE-OVER-*/AE-ROUTE-EXCLUSIVE）＋随协议作废元条款 4。`unverified` 态自此不存在。
- **断言台账退役归档**：`knowledge/aesthetic/assertions.json` → `projects/_archived/assertions-ledger-v5.0.0/`（只读原件 + README，规则卡与 kit-lint 台账都从它回溯）。
- 一次性迁移器 `tools/asserts-retire.py`、`tools/asserts-retire-kb.py`（批C 收口退役；幂等复跑实证仅 1 处命中 = minitools.json 里「原 check_aesthetic_asserts」溯源注记，非活引用）。

### 记账（批C · 文档与版本）
- `AGENTS.md`：版本治理行 + 铁律 3/9 去「断言」措辞、K1 补「质量条款的家 = 规则语料 + 激活制」、能力注册表工具链改口径、新增「质量证据工具链（v5.0）」条、前端消费纪律字段清单更新（`io.acceptance{scans,rules}`）、R5「声明即契约」→「证据即收据（报数必附收据，铁律10 升级）」、「R5 存量记账」→「v5.0 断言退役收口」。模型档位纪律、人工裁决边界未动（工单 §三 明令）。
- `docs/规范-生成式flow与运行时编排-R5.md` §4.1 就地标退役 + §十 销账；新增 `docs/规范-规则语料与orchestrator激活-v6.md`（编号顺延）；`flows/README.md` 断言口径清扫；`docs/版本宣告-v5.0.0.md`（90 条去向总表由 lintlib 口径单点生成）。

### 门禁（v5.0.0 收口实测）
- vitest **281/281** 全绿 + `tsc --noEmit` 0 错；flow-lint 9 flow **0E**/7W；module-lint 9 模块 **0E**/34W；kit-lint **0E**/41W（含 W4×1 AE-NAT-HIT 显式账）；page-lint 70/70（p-yaomo-fx-001 重生成页）。
- 工单 §四 批B 验收口径：`flow_submit` 链上 grep 不到任何 AE- 字样（kernel.ts/asserts.ts 源码 0 命中；打回回归锁断言 problems 无 AE- 名）；flows JSON 残余 AE- 全部 confined 于 changelog 历史条目与 0.3.0/3.1.0/6.0.1 口径声明（逐文件 JSON 路径核账）。

## [4.2.0] · 2026-09-21 · 工单批D：kit@1 清场（能力唯一事实源 = modules/）

宣告文档 §五 批D 落地：`kits/` 四域 kit.json 删除、kit-lint 由「只提示迁移」转阻断门禁、三个 kit 迁移器退役。module@1 自此是能力的唯一之家（铁律11），协议字段名 `kit`（节点 `kit`+`op`、`ResolvedOp.kit`、`kitRef`）保留不动——已冻结的引用协议，值域现为模块 id。

### Changed
- **装载器单源化** `core/src/kits.ts::KitRegistry`：删除 `kits/` 目录扫描块（原「kits 先装、modules 按 id 合并、kit 为既有权威」的双源逻辑连同 WO-03 同 id op 级补缺一并消失）；`modules/*/module.json` 成唯一装载源，模块即权威。归一化补 `minitools`（数组，此前只认单数遗留键致 30 个机器件的执行体声明被静默丢弃）与 `exclude_knowledge`。
- **kit-lint 转阻断 + 事实源切换** `tools/kit-lint.py`：数据源 `kits/*/kit.json` → `modules/*/module.json`，删 legacy 对照模式的 E 级降级（error 自此真阻断、exit 1）；删 format/domain 轴检查（模块无 kit@1 四域轴）与 assist 校验（该字段随 kit@1 退役，内核无消费方）。
- **跨模块重复技能 E6→W8**：`scene-breakdown` 合法双家（plot 骨架步 + drama 主工具）。铁律11 是「必有 ≥1 家」而非「至多 1 家」，flow@3 派生节点一律携 kit+op 显式引用、bySkill 反查仅兜底，歧义无害但须记账。
- `core/src/schema.ts`：`"kit"` 从 `SCHEMA_IDS` 除名（`contracts/kit.schema.json` 只读留档）；`tools/project-pages.py::kits_summary_build` 去 kits glob。
- 7 个 flow 无改动（flow@3 派生节点早已引用模块 id，批B 起 `kits/` 对活流程即惰性遗产）。

### Added
- **`planned` 占位契约**（`contracts/module.schema.json` + `tools/module-lint.py`）：铁律11「能力必须有家」的诚实形态——`planned:true` 豁免 `E-MINITOOL-IMPL`、显式记 `W-PLANNED`（占位可见，不冒充有实现）。三件落位：`docx_ingest`→delivery（批注回流）、`continuity_check`→base（连续性校验）、`meme_harvest`→topic。planned 件用**独立 capability**，绝不与现役 agent 步共享 cap（否则 caps 自动拉入生产编排并在首节点 block 整条流——meme_harvest 曾误挂「时代情绪锚」致 topic-selection e2e 全红，已改判为「热点采集」）。
- 三个悬空 cap 自此有主：delivery「批注回流」、base「连续性校验」、topic「热点采集」。
- `exclude_knowledge` 迁入 module@1 契约（module-lint E-KB-UNKNOWN 核对 + 装载器消费）。

### Fixed
- **find-trope 注入收窄回归**（批D 排查中定位并修复，非「报告后搁置」）：批A 前真正生效的标尺装载源是 `kits/search`，其 find-trope 带 D1-D5 落地的 `kb/market/brief-four-questions` + 三张 `na-*` 海外梗卡剔除；`modules/topic` 副本无这两字段。清场使 modules 转唯一权威 = D1-D5 收窄静默回归。修复：字段随迁 `modules/topic`（`caliber.test.ts` D4 断言转绿，改指 `topic`）。
- **装载器丢机器件执行体**：`ops.*.minitools` 数组此前不被读取（只认单数 `minitool`），30 个机器件的执行体声明在装载层被吞；补数组形态与 `script`。
- **`project-pages.py` 陈旧 effective 崩页**：`registry/effective.json` 的 composition 实例不在 `flow.modules`（如 drama-flow 的 m4 delivery 已收）时 `next()` 抛 StopIteration → 整页崩。改为按「无 caps 请求」渲染该实例工具箱并显式回显 stale 警告（p-slj-002/003 复跑实证）。

### Removed
- `kits/` 五域 kit.json；`tools/kit-migrate.py`、`tools/kit-config-init.py`、`tools/flow-kit-apply.py`（kit@1 迁移三件套，仅自身与 AGENTS/R5 文档引用）；`modules/base` 的 `flow-kit-apply`/`kit-config-init` 两个已退役脚本壳 op。`assist` 字段口径退役（记账）。

### 记账
- 权威规格就地改写：`AGENTS.md`（版本治理行 / 铁律11 / K1 装载 / 能力注册表工具链 / R5 工具链 / R5 配置可调条款，`kits/` 字样清零）；`docs/版本宣告-v4.0.0.md`（§二 工种工具箱行、§三 规则3、§四 处决清单#9、§五 批D 全标闭合，含 spine-less 落位定案）；`docs/规范-生成式flow与运行时编排-R5.md`（状态行去 kit-config-init、适用范围/§二 配置源切 modules、§九 工具表补 planned/W8）；`docs/规范-模块化flow与工具箱-R6.md`（§十一 勘误新增 #17 无骨架工具箱落位口径、#18 planned 占位契约、#19 kit@1 清场回写）。
- **base 无骨架模块落位口径定案**（原记「缺口归批D」）：`spine=[]` 工具箱模块不靠 caps 落位（无锚=module-lint E-PLACE），改用实例 `insert:{"end":[…]}` 显式有序启用；`expandFlow3` 的 `explicitInsert` 路径本就支持，内核零改动。
- 门禁：tsc 0 错；**vitest 271/271**（含 kernel.e2e / r5-generative / r7-runtime 三套内核端到端——modules 单源装载下 flow_run/link 门/buildTaskPackage 全绿，即批D 运行时验收）；flow-lint 0E/2W；kit-lint 0E/42W（阻断口径）；module-lint 0E/34W（含 3 条 W-PLANNED）；validate-kb 通过（90 断言）；12 个项目工作台页重生成 + page-lint 全 exit 0。

## [4.1.1] · 2026-09-21 · 工单批C：断言台账收敛

宣告文档 §五 批C（断言台账收敛）落地；权威规格行同步销账（R5 §十 #2/#3/#4/#5）。

### Changed
- **断言标识字段统一单名**：`knowledge/aesthetic/assertions.json` 条目 `asserts[].id` → `name`（与引擎 `Validation.name` 同名；「两套命名=漂移」就地根除）。方向选择：引擎侧字段不动——`name` 已持久化进各项目 `registry/artifacts.json` 与 metrics，改名即旧数据静默变 unverified，双名兜底又违 R4 §5.3。消费方三处随迁：`core/src/asserts.ts::checksVia`、`tools/kit-lint.py`、`tools/validate-kb.py`。台账版本 1.0.0→1.1.0（90 条）。
- `kit-lint.py`：AE-EXISTS/AE-SKIP-NON-BEAT 不再从引擎集 discard（已作为 dim=meta 路由裁决入册）；「断言缺口」分母改质量条款集（meta 不摊派 op 覆盖）。

### Added
- 补登引擎 3 个 id：`AE-CH-LEN`（多章正文每章 CJK 下限，prose/block）、`AE-EXISTS`（产物缺失入口守卫，meta/block）、`AE-SKIP-NON-BEAT`（非拍级豁免显式回显，meta/minor）——引擎 14 个 id 自此全量在册。
- `kits.test.ts` 台账体检 3 项：标识字段只有 `name` 且无重复；引擎发出 id 全在台账；`checks_via` 别名目标必须真实在册（别名指虚空=声明链静默降级）。

### Fixed
- `tools/validate-kb.py` 读 `asserts[].id` 随字段更名失联（KeyError→改 `name`）。

### 记账
- AGENTS.md「R5 存量残留」行改写为 v4.1.1 收口口径（活账只指 kit-lint 实时输出，文档不抄数）；`docs/规范-生成式flow与运行时编排-R5.md` §十 #2/#3/#4/#5 销账（划线+闭合依据）；`docs/版本宣告-v4.0.0.md` 断言台账行转「已收敛」。
- 门禁：tsc 0 错；vitest 270/270；kit-lint 0E（「未登记断言」警告清零，42W→41W）；flow-lint 0E/2W；module-lint 0E/34W；validate-kb 通过（90 断言）。

## [4.1.0] · 2026-09-21 · 工单批A+批B：flow@3 唯一格式落地

宣告文档 §五 工单批A（存量迁移，commit 6768c0a）与批B（代码层处决）合入本版本；flow@1/@2 手画图与兼容分支自此彻底退场，flow@3 成为唯一可执行 flow 格式。

### Added
- 内核修复：`advance` 全部调用点（flow_next / submit / gate / rerun / resume）改为只吃盘上原始描述符（flow@3 `raw`），不再把派生图当 bootstrap——修复了每推进一次读模型便静默降级一次的系统性错位（links 清空、项目/出厂 overlay 丢失、link 门被 itb-* 边界假门顶替）。
- 回归测试 `kernel.e2e.test.ts`：读模型不因推进动词降级（推进后 registry/effective.json 仍含 4 links、5 composition、无 itb-* 假门）。
- `format.test.ts`：flow@1 字符串谓词处决断言（非对象谓词一律不活跃、不解析嗅探；嵌套 any/all 内层字符串同样拒绝；role 单值判别）。

### Changed
- 7 个 flow 存量迁移至 flow@3；7 处残留 `gate` 评审步随批A拆除（人工裁决收敛到 `gate_role:"kit-boundary"` 跨域交接门）。
- `core/src/cond.ts`：`edgeRole` 只看 `role`（flow@1 optional/loop 布尔折算删除）；`evalWhen` 非对象谓词直接判不活跃并给出「已处决」理由，`evalLegacy`（32 行字符串求值）与 `isLoopEdge` 别名删除。`core/src/types.ts`：`WhenPredicate = StructuredWhen`，`FlowEdge` 不再声明 transform/optional/loop。
- `tools/flow-lint.py`：E-FORMAT 文案改为处决公告（指向 R6 §八 手工重建，不再指向迁移工具）；`skeleton-lint.py` 口径同步。
- 前端镜像 `tools/workflow-page-template.html`：edgeRole/evalWhen/whenText/LEGACY_CANVAS 与内核同语义；`page-lint.mjs` 新增「边 when 全部结构化」探针。
- `contracts/flow.schema.json`、AGENTS.md（版本治理 / R4 工具链 / R5 工具链）口径同步：flow@2 手画形态已处决，一次性转换工具退役。

### Removed
- `tools/flow-normalize.py`（796 行）、`tools/flow-v3-migrate.py`、`tools/r5-migrate.py` 三个一次性迁移器删除；`modules/base/module.json` 与 `kits/tool/kit.json` 中对应 op 登记同步移除（flow 工具能力仍由 flow-lint/flow-verify 承载）。
- 测试契约随迁：`flows.test.ts` 断言唯一合法格式为 flow@3；`plan.test.ts`/`kits.test.ts` 夹具改标 flow@2→派生只读。

## [4.0.1] · 2026-09-21 · 远端兜底落地

### Added
- 远端 `origin`（github.com/skkbsgzf/storyflow，私有）＋ 镜像工具 `tools/push-mirror.py`：断链历史经确定性重写后推远端（本地 ref 不动，新旧 SHA 映射表在 rescue 目录）；机制与硬事实见事故留档 §7.4。
- replace 桥 #2：`f424b336 → 990352c9`（替身根提交），本地 `log --all` 全量遍历不再中断。

### Fixed
- 缺失 blob `187bb1eb` 定位为 R6 规范文档 09-18 17:20 版；镜像行以诚实占位符替代，本地原状保留。

## [4.0.0] · 2026-09-21 · 协议基线（宣告文档：`docs/版本宣告-v4.0.0.md`）

### Added
- 全局版本治理首次落地：根 `VERSION` + 本 `CHANGELOG.md` + git tag 三件套；此前唯一版本指纹是 dist 目录名 `release-<sha>-dirty-<date>`。
- decision@1 / catalog-entry@1（R8-S1..S4b，候选库与选择面）随基线入库为核心面。

### Changed
- **协议基线固定**：flow@3 为唯一 flow 格式；module@1 接替 kit@1；flow@1/@2 与 `kits/` 转只读遗产（改动先迁移，工单批A..D 见宣告文档 §五）。
- 文档口径修复：AGENTS.md（铁律11 / R4 工具链 / R5 残留段）、flows/README、contracts/README、contracts/flow-pack.schema.json、docs/底座规格 中滞后的 flow@1 / kit@1 表述就地更新。

### Removed
- worktree `storymasterv4-d1d5` 与杂支 `metrics-caliber-d1d5`（was `be6ade4`；内容已重放 `4f3029b`，另存内容级快照）。

### Fixed
- be6ade4 快照树闭包：自 d1d5 索引重建 274 棵树（根树逐字节吻合）＋补回 2 个 blob；`git fsck` 缺失 10 → 4（残余属永久丢失提交的闭包，不可恢复）。复盘增量见 `docs/事故-2026-09-18-git目录误删与恢复.md` §七。

### 运维
- 备份三件套落盘 `D:/storymasterv4-rescue-20260921/`；git bundle 形态在本仓断链修复前不可用（walk 必踩 `f424b33 → d3bf007` 断点）。
- 加远端仍为第一优先待办：断链未愈 ＋ 无远端 = 再出事故仍然丢历史。

### 历史代际摘要（R1..R8 → 4.0.0）
R1 kit化 · R2 外部对照＋绕流事故复盘 · R3 kit底座落地 · R4 项目文件与流程配置 · R5 生成式flow与运行时编排 · R6 模块化flow（flow@3/module@1） · R7 开源部署与可调面 · R8 候选库与选择面。逐代规范见 `docs/规范-*.md`。
