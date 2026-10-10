# Agent.md · miniflow 内核接入总览

> 读者：**要接这个内核的外部宿主**（AI Agent、前端面板、另一条进程内的服务）。
> 目标：一篇读完就知道「有哪些能力、从哪张脸进、什么还没做」。
> 本文是集成四件套的**入口**，细节在 `docs/integration/`：
> [MCP 参考](integration/mcp-reference.md) ｜ [REST 参考](integration/rest-api-reference.md) ｜ [SSE 事件](integration/sse-events.md) ｜ [嵌入模式](integration/embedding-modes.md)

## 一、一句话架构

**一张动词表，三张脸。** `core/src/verbs.ts` 里的 `VERBS` 是内核对外能力的**唯一**声明源；
CLI、HTTP、MCP 三面各自**遍历这张表派生**自己，任何一面都不许再手抄一份清单。

```
core/src/verbs.ts  （28 个动词 + 参数描述 + run 实现；R4 起还派生 zod 形状与 JSON Schema）
   ├─ CLI   core/src/cli.ts    →  usage() 由表生成，按表分派
   ├─ HTTP  core/src/http.ts   →  POST /api/verbs/:verb 按表分派（legacy 面，冻结载荷）
   │        core/src/api-v1.ts →  V1_ROUTES ⊕ VERBS ⇒ /api/v1/*（统一信封）＋ 自生成 openapi.json
   │  事件 core/src/project-stream.ts →  JOURNAL_TO_SSE（对台账 16 种 kind 穷举表态）⇒ GET /api/v1/projects/:id/stream
   │  线格式 core/src/sse.ts →  两条 SSE 流（对话 /turn ＋ 项目 stream）共用同一个写帧器与心跳
   └─ MCP   core/src/mcp.ts    →  逐条 registerTool ＋ MCP_RESOURCES（4 类只读资源）＋ MCP_PROMPTS（2 个提示模板）
```

历史病灶（写在这里是为了别让它回来）：动词表曾经有四份副本（CLI 13 / MCP 7 / HTTP 4 / Skill 文档），
互不同步，`flow_init` 恰好「CLI 有、MCP 无、HTTP 无」——初始化面板要用的动词在最不可达的那面上。

## 二、五分钟上手

```bash
cd core
npm install            # 依赖已在仓内（node_modules 随包管理）
npm run miniflow -- flow_list          # CLI 脸：动词 = 位置参数
npm run miniflow -- serve              # HTTP + 静态页面，默认 http://127.0.0.1:8421
npm run miniflow -- mcp                # MCP 脸（stdio，宿主拉起）
npm run serve / npm run mcp            # 等价快捷脚本
npx tsx src/cli.ts                     # 无参数 = 打印由表生成的 usage
```

选脸规则：

| 场景 | 走哪张脸 | 为什么 |
| --- | --- | --- |
| 宿主要在会话里直接动内核（推进流程、提交产物） | **MCP** | 无进程启动税；参数即 schema |
| 前端/面板/跨语言取数 | **HTTP** | CORS 全开，REST + 静态页同端口 |
| 人在终端、脚本化、CI | **CLI** | 退出码 + stdout JSON |
| 同进程嵌入（把内核当库） | **in-process** | `new Kernel(opts)`，见[嵌入模式](integration/embedding-modes.md) |

> 实测过一次冷启动税：CLI 脸每次 `npx tsx` ≈103s，所以宿主侧默认走 MCP。

## 三、动词表（生成的，不手写）

本块由 `node scripts/gen-verbs-doc.mjs --write` 从 `core/src/verbs.ts` 生成，
`--check` 用于对账（门禁之一）。

<!-- GEN:VERBS:BEGIN 由 scripts/gen-verbs-doc.mjs 从 core/src/verbs.ts 生成，勿手改 -->
动词共 **28** 个，分 8 组：`内核动词（七动词）` ｜ `生成式编排（R5）` ｜ `选择面（R8）` ｜ `知识库（KB 只读）` ｜ `世界书（GraphHyperRAG）` ｜ `立意图（决策桥）` ｜ `底座工具桥（挂表）` ｜ `快诊断（批次3a）`。

| 动词 | 组 | 入参（★=必填，其余可缺省） | 说明 |
| --- | --- | --- | --- |
| `flow_list` | 内核动词（七动词） | — | 列出全部 flow（描述符） |
| `flow_run` | 内核动词（七动词） | `--flow <string>` ★ · `--project <string>` · `--inputs <json>` · `--config <string>` | 为项目开跑一条 flow（自动迁移 run-state.json；未指定项目时按灵感自动命名。CLI：其余 --k=v 自动作为 inputs，如 --题材/--灵感） |
| `flow_init` | 内核动词（七动词） | `--project <string>` ★ | 生成项目初始化配置模板（项目配置.json）——初始化面板的落点 |
| `cfg_template` | 内核动词（七动词） | `--action <list\|save\|apply\|delete>` ★ · `--project <string>` · `--name <string>` · `--flow <string>` · `--overwrite <boolean>` · `--force <boolean>` | 项目配置模板库：列出 / 自存 / 套用 / 删除（套用「从零新建」= 只写必填「项目」的空白配置）。模板落在 <root>/templates/项目配置/<flow>/<名>.json（项目之外，跨项目可复用）；官方示例读 demos/<flow>/项目配置.json（只读） |
| `flow_next` | 内核动词（七动词） | `--project <string>` ★ · `--spawn-prompt <boolean>`（键 spawn_prompt） | 推进到下一停靠点（awaiting_input / suspended / blocked / completed） |
| `flow_submit` | 内核动词（七动词） | `--project <string>` ★ · `--node <string>` ★ · `--content <string>` · `--file <string>` · `--notes <string>` · `--seal <boolean>` | 提交认知步产物（完整性断言不过 = rejected 打回；iterate 节点逐实例提交，seal 收口置 done。CLI：--content-file <path> 读文件当 content） |
| `flow_resume` | 内核动词（七动词） | `--project <string>` ★ | 崩溃/失败/停机后恢复（恢复不读图，沿用快照内计划） |
| `flow_gate` | 内核动词（七动词） | `--project <string>` ★ · `--node <string>`（键 nodeId） ★ · `--verdict <pass\|pass-with-conditions\|send-back\|reject>` ★ · `--comment <string>` · `--root-cause-stage <string>`（键 rootCauseStage） · `--round <number>` · `--token <string>` | 提交人工裁决（pass / pass-with-conditions / send-back / reject；send-back 级联失效） |
| `flow_rerun` | 内核动词（七动词） | `--project <string>` ★ · `--node <string>`（键 nodeId） ★ · `--dry-run <boolean>`（键 dryRun） | 重跑范围推演/执行（缓存命中语义：未变上游不重做） |
| `flow_effect` | 生成式编排（R5） | `--project <string>` ★ | 生效编排 + 指标汇总（tool 效率 / 上下文命中率 / 诊断汇总） |
| `flow_mine` | 生成式编排（R5） | `--project <string>` ★ | 组装编排挖掘包（journal/指标/中间文件），交编排挖掘师产出 findings@1 |
| `skill_patch` | 生成式编排（R5） | `--action <add\|approve\|reject\|list>` · `--id <string>` · `--target <string>` · `--text <string>` · `--reason <string>` · `--section <string>` · `--op <append\|replace>` · `--origin <user\|miner\|agent>` | 提示词补丁（默认 proposed 不生效；须显式 approve 才装载） |
| `flow_optimize` | 生成式编排（R5） | `--project <string>` ★ · `--apply <boolean>` · `--actor <string>` | 由指标产出编排调优提案；--apply 落 overlay（低风险自动，其余待批） |
| `flow_overlay` | 生成式编排（R5） | `--project <string>` ★ · `--patches <json>` · `--approve <a,b>` · `--actor <string>` · `--reason <string>` · `--replan <boolean>` | 改写运行时编排（tool 的位置与内容配置）；--replan 立即重编译计划 |
| `set_decision` | 选择面（R8） | `--project <string>` ★ · `--key <string>` ★ · `--picked <a,b>` ★ · `--by <string>` ★ · `--evidence <string>` ★ · `--excluded-tags <a,b>`（键 excludedTags） · `--confidence <number>` · `--actor <string>` | 落一条决策事实（decision@1 → <项目>/decisions/<key>.json）。选择面的唯一写入口：by/evidence 必填，无来源的决策=猜即拒（R8 铁律 3） |
| `list_decisions` | 选择面（R8） | `--project <string>` ★ | 读项目全部决策事实（坏条目进 issues 不静默）——回答「这一步凭什么这么选」 |
| `kb_search` | 知识库（KB 只读） | `--q <string>` ★ · `--dir <string>` · `--k <number>` · `--cluster <string>` · `--project <string>` | 检索知识库（95 张方法论/标尺卡：aesthetic/craft/market/structure/rules/trope…）——标题/标签/正文打分排序。带编译期聚类的产物（kit-compile ≥ R2）走两段式：查询先匹配最相关簇（簇名+簇内卡词面），簇内有词面命中即簇锚定优先排序（同簇成员含零词面卡一并进场），簇内无命中回落全局排序；cluster 参数可显式指定簇过滤（全名如 簇#03[钩子,开篇,悬念] 或前缀 簇#03；产物无聚类数据时忽略）。带 project 时双根合并：全局 kit 图 + projects/<id>/kit/hypergraph.rag.json 项目档一起查，命中带 source=global\|project。合并口径：同一卡两根都命中只留项目侧（source=project）；分数为主、同分项目排前；总量仍守 k（各根 top-k 合并去重后截回 k） |
| `kb_read` | 知识库（KB 只读） | `--ref <string>` ★ · `--max-chars <number>`（键 max_chars） · `--project <string>` | 读知识卡正文（ref = 卡片 id 如 kb/aesthetic/character，或相对 knowledge/ 的路径；带 project 时全局未命中回落读 projects/<id>/ 项目卡，返回体 source=project\|global 标记读自哪根） |
| `worldbook_search` | 世界书（GraphHyperRAG） | `--project <string>` ★ · `--q <string>` ★ · `--cat <string>` · `--k <number>` | GraphHyperRAG 世界书检索（创作时 agent 直调）：标题/tag/摘要打分 + 一跳关系扩展。归纳层 = 世界书/graph.json（tools/worldbook-index.py 重建，world-forge 交卷即刷新）；查看层 = projects/<id>/worldbook.html（pedia 页） |
| `ig_load` | 立意图（决策桥） | `--universe <string>` ★ | 读宇宙立意图（intent-graph@1：节点+候选+剪枝排序分+committed/excluded 证据）。存储 universes/<uid>/intent-graph.json，项目经 项目配置.json.universeId 绑定 |
| `ig_propose` | 立意图（决策桥） | `--universe <string>` ★ · `--node <string>` ★ · `--id <string>` ★ · `--title <string>` · `--content <string>` · `--scorer <semif-4b\|laya-student\|jev-api>` ★ · `--p <number>` · `--evidence <string>` | 向立意图节点追加候选提案（status=proposed，不 commit）。红线：带 p 必须带有效 scorer（semif-4b/laya-student/jev-api；untested 禁带 p——不编造概率）；excluded/commit 归人（ig_commit/ig_exclude 不进 agent 环） |
| `ig_commit` | 立意图（决策桥） | `--universe <string>` ★ · `--node <string>` ★ · `--candidate <string>` ★ · `--reason <string>` ★ | 拍板：候选置 committed（节点随之 committed）。必须带 reason（拍板留痕，R8）；决策落盘另走 ig_sync |
| `ig_exclude` | 立意图（决策桥） | `--universe <string>` ★ · `--node <string>` ★ · `--candidate <string>` ★ · `--reason <string>` ★ | 排除候选（必须带理由——「为什么没选 X」不许哑，R8） |
| `ig_sync` | 立意图（决策桥） | `--universe <string>` ★ · `--project <string>` ★ | 立意图 → 项目决策单向桥：committed 候选落 decisions/<decision_key>.json（setDecision 单源；已存在不回填；证据带 scorer+p 明示「剪枝排序分，禁当放行闸」） |
| `whereami` | 底座工具桥（挂表） | `--project <string>` · `--json <boolean>` | 我在哪：项目/当前节点/必读输入/应产输出（tools/whereami.py 转发；开工定位） |
| `snapshot` | 底座工具桥（挂表） | `--action <capture\|diff>` ★ · `--flow <string>` · `--project <string>` ★ · `--node <string>` ★ · `--files <a,b>` · `--note <string>` · `--a <string>` · `--b <string>` | 交付快照 capture / 两版 diff（tools/snapshot.py 转发；铁律 7：产物落盘后留档） |
| `quality_scan` | 底座工具桥（挂表） | `--project <string>` ★ · `--file <string>` ★ · `--budget <json>` · `--no_receipt <boolean>` | 确定性质量扫描：证据聚合器（tools/quality-scan.py 转发 = core quality-cli 桥 aesthetic 真身，禁止第二份计数逻辑）；只出证据+收据，裁决归 agent/人裁 |
| `diag_scan` | 快诊断（批次3a） | `--project <string>` ★ · `--text <string>` · `--path <string>` · `--dims <a,b>` · `--proposal <boolean>` | 快诊断：对一段文本/一个文件做确定性体检，产出 diagnosis-report@1（机器只出证据不裁决，零 LLM）。S 级=aesthetic 引擎真身进程内直调（quality-cli 同一实现，毫秒级）；消费 项目配置.validation 声明位（tierThreshold 通道门槛 / cardScope 装卡范围 / severityFloor 优先级下限，缺省 S+A·both·minor）；items 由规则卡条款机械投影（建议=条款 repair 反向表达）；A 级 laya 学生头仅在 proposal=true 显式开启时跑，venv/权重缺失显式报 LAYA_UNAVAILABLE 带回填指引（绝不回落 4B/API） |

> 三面同源（表即面）：CLI `core/src/cli.ts` ｜ HTTP `POST /api/verbs/:verb` ｜ MCP stdio 注册 28 个同名工具。改动词只需改 `core/src/verbs.ts` 一处。
<!-- GEN:VERBS:END -->

## 四、数据与目录契约

内核认两个根，**不许合成一处**（历史上混用过，导致临时数据根下注册表解析为空且静默）：

| 根 | 缺省 | 装什么 |
| --- | --- | --- |
| `repoRoot` | 仓库根（`core/` 的上一级） | `flows/ modules/ knowledge/ contracts/ skills/ assertion-presets/ presets/ templates/` |
| `root`（数据根） | 同上 | `projects/<id>/`（运行数据：`state.json`、产物、journal、decisions、snapshots） |

契约（磁盘快照的合法形状）在 `contracts/*.schema.json`，HTTP 面冻结契约在 `contracts/http-openapi.json`，
环境变量只有两个：`MINIFLOW_CONTRACTS_DIR`（换契约根）、`MINIFLOW_STATIC_DENY_PREFIX`（追加静态面黑名单前缀）。

## 五、模型档位与人工边界（接入方必须知道的语义）

- **`flow_gate` 是人的动词**。agent 工具环里刻意不放它，也不放 `set_decision`、`ig_commit`、`ig_exclude`——
  门与边界裁决由人做出，机器不得代裁。宿主把 agent 接到自动循环时，交卷后必须停下来推人裁卡片。
- **提示词补丁是提案制**：`skill_patch` 默认 `proposed` 不生效，需显式 `approve`。
- **决策必须有来源**：`set_decision` 的 `by` + `evidence` 必填，缺了进 issues 不进 values（R8）。
- **质量扫描只出证据，不出裁决**：`quality_scan` 返回 findings + 收据文件路径；
  数值线不构成提交闸（2026-09-24 清剿口径）。

## 六、现状与未实现（诚实面，接入前必读）

| 项 | 状态 |
| --- | --- |
| MCP resources / prompts | **已实现**（R4）：4 类只读资源（世界书全图 / 单词条＋一跳关系 / 运行态切片 / **仅已登记**产物正文）＋ 2 个提示模板（世界书体检 / 裁决辅助）。清单即表（`MCP_RESOURCES`/`MCP_PROMPTS`），in-memory 真握手有测试。细节见 [MCP 参考](integration/mcp-reference.md) |
| REST `/api/v1` 版本化 + 统一响应包装 | **已实现**（R4 立面，R5 增第 19 条）：19 条路由（`V1_ROUTES`）+ `ApiResponse`/`ApiError` 同形信封（两个不套信封的例外：`openapi.json` 与 SSE 流） + 动词入参前置校验（400 `VALIDATION`）。legacy `/api/*` **载荷逐字节不变**，改挂 `deprecation` 响应头——不做 301（POST 重定向会被降级成 GET，写操作不能靠重定向搬家）。细节见 [REST 参考](integration/rest-api-reference.md) |
| OpenAPI 由表生成 | **已实现**（R4）：`contracts/http-openapi-v1.json` 派生自 `V1_ROUTES` ⊕ `VERBS`，运行时 `GET /api/v1/openapi.json` 同一份，对账 `node scripts/gen-openapi.mjs --check`。legacy `contracts/http-openapi.json` 冻结在 v1.2 不回改；**agent 会话端点仍未入任何契约**（存在但查不到；SSE 的 v1 表达已由 R5 定型为 `V1Route.sse`，剩下的活只是载荷迁移） |
| 项目级 SSE（`node_start` / `node_complete` / `node_error` / `gate_pending` / `heartbeat`） | **已实现**（R5）：`GET /api/v1/projects/:id/stream`。事件源是 `journal.jsonl` 台账（不是进程内总线，跨进程宿主同一份磁盘真相），`watchDir` 只作重读提示、正确性不依赖它；缺省 10s 心跳（工单门禁「15s 内必达」由常量断言钉住）。细节与「9 种 kind 不投影」见 [SSE 事件流参考](integration/sse-events.md) |
| MCP 资源变更通知（`list_changed` / 订阅） | **未实现**（待排，不属 R5 卡面）。R5 已把 `watchDir` 接在项目流上，资源侧可复用同一形状 |
| 台账 `run-end` / `verdict` 等 9 种 kind 上屏 | **不投影**（`JOURNAL_TO_SSE` 逐条显式 `null`，不是漏）。扩「节点/门」词汇表归 owner 拍板，历史随时查 `GET /api/v1/projects/:id/journal` |
| FS 抽象层**接线** | **已接线**（R3 内核核心 33 文件 → R5 补运行时证据 → **R6 宿主面 9 文件清零** → **R7-1 缺省改走注册表**）：`KernelOptions` 有 `fs/path/proc` 注入位，`Kernel` 上 `readonly fs/path/proc`；内存盘端到端冒烟（`flow_run`→`flow_submit`）已过。R6 后 `core/src`（除 `abstraction/`）**零 `node:fs`/`node:path`/`node:child_process`**，agent 会话面（`agent-mcp` 的 `fs_*` 工具、系统提示、`flow_lint` 子进程、HTTP 静态面）全部可在注入盘上跑（证据 `core/test/r6-host-free.test.ts`，口径见 FS1 §3.2「R6 收口」）。R7-1 再进一步：尾参默认（R7-1 时 166 处，R2.2 后 168 处，逐数锁在 `core/test/defaults-registration.test.ts`）的「缺省」不再指向 Node 实现，而是查 `core/src/abstraction/defaults.ts` 的注册表，core 侧除豁免区与七个宿主入口件（死表锁在 `core/test/defaults-registration.test.ts`）外不 import 任何适配器实现——**宿主忘登记不再静默写宿主盘，而是抛错点名**。**仍留宿主面的只剩六处非 FS 族**：`cli.ts`（`node:net`/`node:process`）、`export-cli.ts`/`quality-cli.ts`（`node:process`）、`ids.ts`（`node:crypto`）、`kernel.ts`（`node:module`）——FS1 v1 只管「盘＋路径＋子进程」三面，env/熵/注册属宿主面，归 R7-2 议题 |
| 浏览器/WASM 嵌入 | **代码前置已就位，发布前置剩 R7-2 净身与 R7-3 拆包**：宿主侧要做的事现在只有一行——`registerAdapters({ fs, path, proc })`（Node 宿主 import `abstraction/adapters/node.js` 即自动登记；样例见 `core/test/setup-adapters.ts`）。剩下的门槛是上表的六处非 FS 族宿主绑定与 `@storyflow/core` + `@storyflow/adapters` 拆包（R7-3）；未注册前浏览器宿主请照 §4.1 的抛错信息补齐登记，不要指望回落 |

## 七、本文档的维护纪律

- 改 `core/src/verbs.ts` → 跑 `node scripts/gen-verbs-doc.mjs --write`，**不要手改第三节表格**。
- 改 `core/src/api-v1.ts` 的 `V1_ROUTES` 或 `core/src/verbs.ts` 的 `VERBS` → 跑 `node scripts/gen-openapi.mjs --write`，
  **不要手改 `contracts/http-openapi-v1.json`**（它是生成物；运行时端点与它同源）。
- 改 MCP 资源/提示 → 改的是 `mcp.ts` 里的 `MCP_RESOURCES`/`MCP_PROMPTS` 两张表本身，注册与测试自动跟上；不要在注册处硬写 URI 字符串。
- 改任一面（CLI/HTTP/MCP 的路由、工具名、参数）→ 同步 `docs/integration/` 对应文件。
- 门禁两条都要 OK：`node scripts/gen-verbs-doc.mjs --check`、`node scripts/gen-openapi.mjs --check`（不一致 = exit 1）。
