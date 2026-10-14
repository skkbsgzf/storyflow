# 决议 · flow 出清与 skill 主推（2026-10-14）

> 状态：**已裁定，批1 已执行（见第八节回执，工作树未提交）**；批2–批4 未开工，四票（第六节）未拍。
> 用户 2026-10-14 裁定三原则：
> ① 保留 `module@1` 的集成能力　② 干掉 flow 运行时　③ 主推 skill。
> 本文档给删除面清单、保留面、skill 形态规范、外部精华件引入评估、分批推进与待裁票。
> 证据一律 `path:line`；标注「不可考」处为未取证，勿当结论用。

---

## 一 · 判据（先把尺子立住，理由不是「skill 更好」）

删 flow 的正当性来自三条，与 skill 形态无关。**这个区别很重要**：若以「skill 更好」为理由，下一步会顺手把 `module@1` 也 skill 化，那一步会踩坑（见第三节）。

| # | 判据 | 依据 |
|---|---|---|
| A | 结构可以编死，**判断不许编死在 kit 里** | 顺序/依赖/落位是结构（合法）；何时挂门、何时算 completed、失效范围是判断（现编死在 `kernel-run.ts:941`/`1013`/`rejectedScope`） |
| B | 改错要付的代价应是**改一行声明**，不该让引擎冒重放风险 | 仓内自证：`kernel-run.ts:872-887`「快照计划与生效编排不一致→重编译」的注释记录了曾发生「节点凭空消失而状态照打 done」 |
| C | 引擎的抽象成本要被**消费者数量**摊薄 | 5 条 flow，`projects/` 12 个项目里只有 `p-burnheart-ep1` 一个有 `state.json`；引擎 4154 行 vs 知识面 2632 行 |

与既有立场的一致性：`docs/ROADMAP.md:136`（2026-10-11 用户裁决）「kit 纯粹化——不参与流程/契约/裁断，只提供知识」。同一条尺子当时判死了 T6 交付对账技能。

---

## 二 · 删除面清单（26 个动词里 12 个是 `flow_*`）

标记：**纯删** = 无迁移；**转形** = 能力保留但摘掉调度权；**需裁** = 见第七节。

### 2.1 状态机与推进（纯删）

- `core/src/kernel-run.ts` `advance` 主循环（908-1000 就绪批派发）、`flow_next`（264）、`flow_submit`/`doSubmit`（288-323）、`flow_gate`/`doGate`（631）、`flow_rerun`/`doRerun`（800-850）、`flow_resume`（471）、`blockedStop`/`markStalled`
- `core/src/plan.ts`（compilePlan）、`core/src/cond.ts`（evalWhen）、`core/src/state.ts`（RunState + `legacyStatePath:12` + migrate）
- `core/src/kernel.ts` `acquireLock`（455，LockDir 串行化）与 `ctx`（271，读路径带写盘）
- `core/src/kernel-run.ts:286` 注释所指的「多 subagent 并发提交守卫」随状态机一起走

### 2.2 编排自调优（纯删，判据 B 最直接命中）

- `core/src/overlay.ts`（608 行：applyOverlay / injectKitBoundaries / `effectiveFlow` legacy 面 / `BOUNDARY_PREFIX="itb-"`）
- `core/src/optimize.ts`（473 行：per-link 提案、低风险自动落地 255-272）
- `core/src/metrics.ts`（432 行，编排指标口径）、`flow_mine` 的 mine-package（`kernel-optimize.ts:270-274`）
- 动词 `flow_overlay` / `flow_optimize` / `flow_mine` / `flow_effect`（`verbs.ts:307-412`，G_ORCH 全组）

> **批1 执行状态**：`optimize.ts` 与 `flow_overlay`/`flow_optimize`/`flow_mine` 已出清；`overlay.ts`（看板读模型与 `presets/` 的宿主）与 `metrics.ts`（module-report 与票① 的记账面）**顺延**，`flow_effect` 降级为只读效果视图。详见 §八.2。

### 2.3 版本遗留与迁移（纯删）

- flow@2 分支：`kernel.ts:233` 的 `return effectiveFlow(...)` else 路径；盘上 `flows/` 零 flow@2 描述符，仅 8 个测试用合成 fixture
- `run-state.json` 迁移：`state.ts:12`、`kernel-run.ts:100`、`http.ts:40-43`、`kernel-view.ts:81,354`
- `core/src/types.ts` @deprecated 字段面：`file`（20-23）、`kb`（29-30）、`deliverables`（144-145）
- flow@1：仅存注释判定（`types.ts:63`、`cond.ts:21,56`），随代码删除自然消失

> **批1 执行状态**：`run-state.json` 迁移整层已出清（`state.ts` 迁移段＋四处兜底＋`migrate.test.ts`，盘上 legacy 文件计数 0 为据）；flow@2 分支因 7 份测试夹具依赖**顺延批2**（见 §八.2 第 3 条）。

### 2.4 级联件与派生（转形，非纯删）

- `flow_chain`（`kernel.ts:430-436`，PP1 跨流水线搬运）：搬运逻辑是确定性件，可转形成独立 `chain` 工具；**需裁**
- `expandFlow3`（`modules.ts:153`）：从「派生可执行图」转形为「展开只读工序表」→ 见第四节与批4
- `renderSpawnPrompt`（`spawn.ts:8`）+ `buildTaskPackage`（`assembler.ts`）：派发头渲染件**保留**，从 `flow_next` 摘出成独立动词（见 5.3）
- `flows/*/overlay.default.json` 与 `presets/`：**耦合警告**——生产线预设的实体就是 overlay 层（`production-preset.ts:100-110` loadPresetOverlay；`presets/short-story/overlay.topic.json` 等 4 份）。删 overlay 面必须同时裁 preset 命运，不能默认它活着

### 2.5 storyharness 侧（纯删 / 转形）

- `scheduler.ts`（批调度、AND-join、flow_next 重试 104-115）、`headless.ts`（47 flow_run 冷启动）、`executor.ts:368` run-node 兼容入口
- `tools.ts` 六个 `mf_flow_*` 工具（198-258）、`chat.ts:46-50` 立项引导语、`serve.ts:331` 动词白名单
- **保留**：`executor.ts` 的收据制与会话落盘（`内部/sessions/`、`内部/收据/`）、`chat.ts` 会话环、`brief.ts`、`packs/packgate/packctx` 扩展包三件
- 说明：`projects/p-burnheart-ep1/内部/sessions/` 实测 5+ 个会话文件，首条记录含 `node:"m1.topic-report"` 与逐轮全文——**复盘线吃 executor 产物，不吃 `state.json`**（`executor.ts:4` 注释钉住）。删状态机不断思维链/cot-analyst 那条线。

### 2.6 连动面（改动清单，不含决策）

- 动词文档与契约：`node scripts/gen-verbs-doc.mjs --write`（→ `docs/Agent.md` 第三节生成物）、`node scripts/gen-openapi.mjs --write`（→ `contracts/http-openapi-v1.json`）；legacy `contracts/http-openapi.json` 冻结 v1.2 不回改
- Schema：`contracts/flow.schema.json` 及 flow@3/run-state 相关契约出清或降级为文档件
- 文档 15 份带 `flow@3`/`flow_` 字样：`docs/ARCHITECTURE.md`、`docs/Agent.md`、`docs/contracts.md`、`docs/integration/{mcp-reference,rest-api-reference,sse-events,embedding-modes,host-integration}.md` 等（红线 11：改任一接入面必须同步 `docs/integration/`）
- 测试：`core/test/` 48 个文件里 18 个 flow 相关；`storyharness/test/` 23 个里含 scheduler/executor 面（**具体出清/改写清单待批1 逐一点名**，本文不预先给数）
- Python 工具：`tools/flow-lint.py`（校验的是 flow.json）、`flow-verify.py`（被 `minitools.ts`/`modules.ts` 引用）、`flow-export.py`（被 `export-cli.ts` 引用）、`module-lint.py`（**留**，校验的是 module@1）
- `core/src/compat.ts`（上一轮已判：`tools/workflow-page-template.html` 不存在，页面兼容面无消费者）——顺带出清

---

## 三 · 保留面：`module@1` 的四张机器面（不许 skill 化）

判据：**只给人和模型读的进 md；程序要据它做决策、校验、排序或改写的必须结构化。**

`modules/plot/module.json` 的 15 个 op 元数据键（实测：`skill,title,kind,desc,knowledge,minitools,config,capability,slot,also_fits,requires,adds,knowledge_pools,output`），按消费方切分：

| 面 | 键 | 现在的机器消费方 | 变散文的后果 |
|---|---|---|---|
| 选型 | `capability` / flow 的 `caps` | `loadModule`+`expandFlow3` 的 caps 裁剪、面板下拉、preset 裁剪 | 能力勾选 UI 失效 |
| 排序 | `slot` / `also_fits` / `requires` | 骨架展开与锚位回退 | **已发生过的真 bug 复发**：`docs/ROADMAP.md` 批次3a P7——`dialogue-polish` 缺首锚回退到 `after:novel-deai`，致 topic 流 m4 打磨早于成稿，靠静态锚位才扫得出来 |
| 调参 | `config{type,default,min,max,enum,unit,effect,tunable_by}` | `set-tool` 的唯一落点、`tunable_by` 权限判定 | 任何"每 tool 内容可调"的通道消失 |
| 交接 | `io.input.shape` / `output` | 跨模块断料检查、`对外交付/NN-` 定序 | `screenplay.inputs.sourceMaterials` 那种「在盘即切档」的声明失效 |

注：这四张面在 `modules/` 目录里，**不在 `flows/` 里**。删 `flows/*/flow.json` 的模块序列与 link 门，不动 `module.json`。

---

## 四 · skill 主推的形态规范

现状：`skills/` 40 个 md，39 个被 `op.skill` 引用；`kit/skills.tools.json`（`storyflow-skill-tools@1`）是编译产物，note 明写「用户自导 skill 另册（不进本表）」。

**4.1 分工定稿**——skill md 管内容与读（方法论、判定标尺、示例、渐进披露正文），`module@1` 的 op 管装配与排（四张机器面）。`op.skill` 是两者唯一引用通道。

**4.2 双声明收口（待裁票②）**——同一件事在两处声明：`skills/*.md` frontmatter 的 `bind.knowledge`（实测 `render-prompt-seedance.md` 有 `bind: {knowledge:[...], minitools:[...]}`）与 `op.knowledge`。仓内既有立场是 `types.ts:29`「知识依据收编进 `module.json` 的 `op.knowledge`（批D 起事实源唯一）」。建议：**事实源 = `op.knowledge`**，skill frontmatter 的 `bind` 降为自述注释或摘除；否则删 flow 后装载面会同时存在两个真相。

**4.3 对外标准**——Hermes/Claude Skills 走 agentskills.io 与 progressive disclosure（先 name+description，按需读全文）。建议 skill frontmatter 保留 `name`/`description` 两个对外键的**严格语义**（description 必须一句话可判相关性），kit 特有键（`stage`/`bind`）声明为扩展位、不参与对外兼容。

**4.4 导入件待遇（待裁票③）**——外部 skill 目录是否进 `skills.tools.json` 注册表。建议：给一个 import 动词落「待审」态，复用 `skill_patch` 的提案制（红线 7：默认 proposed 不生效，须显式 approve），不进注册表 = 只能被读、不能被装配。

---

## 五 · 外部精华件引入评估

先例出处见文末链接。每条给：引入什么 / 我们已有底子 / 落点 / 代价 / 是否撞红线 / 优先级。

### 5.1 【P0】Hooks 事件闸——这是替代 flow 门的正确形态

Claude Code 的分工判据很清楚：hooks 用在「**必须在固定时刻发生**」的事上，零 token 成本、强制生效；skills 是 ad-visory 知识，不能承担硬强制。它的挂点是 `PreToolUse` / `PostToolUse` / `Stop` 三族事件。

对 kit 的意义是决定性的：flow 删除后「纪律去哪」有了答案——**从流程图搬到事件点**。门不再是"节点挂起等人"，而是"宿主在某事件点必须过一次检查"。裁决权天然留在宿主，红线 4 不再需要额外解释。

- 已有底子：无（`packctx.ts:5` 的 AsyncLocalStorage 只是上下文传递，不是事件钩子）
- 落点：`storyharness/src/executor.ts` 工具调用点与会话收口点；kit 侧只提供**检查件与挂点契约**，策略文件归用户/宿主
- 代价：要定义事件面与阻断语义（新增一面，不是纯减法）
- 红线：**不撞**。红线 9 说运行时不含审核/合规逻辑——所以 kit 交挂点和证据，不交策略
- 优先级 P0：它直接补 flow 删除留下的空洞

### 5.2 【P0】Just-in-time 检索——顺手治 N1 装载饥饿

Anthropic 的上下文工程立场：优先「用标识符按需取（just-in-time）」而非「预推理嵌入全部」；文件式笔记外置。

我们仓里**已经有这个模式的实证**：`assembler.ts:124-142` 创作思维段的做法是「内联浓缩 + 卡在库时附『全文见 kb_read <id>』指针 + 卡缺失降级不崩」。而知识标尺走的是另一条路：`assembler.ts:352-353` 总量 9000 字 / 单卡 1600 字封顶，`:231` 「总量封顶未装载」进 `missing`，`:388-390` 显式回标尺缺口。`docs/ROADMAP.md:111` 的 N1 判定：28 卡对标库纸面只被一处 glob 消费，声明序 first-fit + 封顶 ⇒ **纸面消费、饥饿装载**。

- 引入：把「浓缩段 + `kb_read` 全文指针」从特例升为**缺省装载策略**——任务包给卡目录（id + 一句话 + 字数），全文由模型按 id 取
- 已有底子：`kb_read` 动词在面（MCP 侧 `mcp__miniflow__kb_read`）、指针模式已验证
- 代价（如实）：装载证据链语义变化——从「本次装了哪几张卡」变成「模型读了哪几张卡」。`assembler.ts` 的 `missing`/`excluded` 回显要重定义，`metrics.ts` 的上下文命中率口径随之失效或改造（`kernel-run.ts` 派发时记的 `offered/ids`）
- 红线：**不撞**，且与红线 5「只出证据」同向
- 优先级 P0：纯策略改、治一个已知问题

### 5.3 【P1】Subagent 隔离上下文 + 浓缩返回契约

Claude Code：子代理起独立上下文、跑自己的循环，**返回 1k–2k token 的浓缩摘要**，默认最多三层嵌套；简单任务不该用它（约 20k 固定开销）。

- 已有底子：`spawn.ts:8` `renderSpawnPrompt`（含项目背景卡的规范派发头，`verbs.ts:222-229`）、`executor.ts` 已有隔离执行与会话落盘
- 引入：①派发头从 `flow_next` 摘出成独立只读动词；②给「返回面」定契约（摘要 + 产物路径 + 证据引用，不许回传全文）；③嵌套深度显式化
- 代价：需要一个不经状态机的「渲染某节点任务包」入口——即 `buildTaskPackage` 要能脱离 `state.json` 工作（现在它经 `kernel.ctx` 拿 state，见 `kernel-run.ts:288-310` 路径）
- 红线：**不撞**。它给的是能力，决策权在宿主
- 优先级 P1：删 flow 后「谁来派发」的答案

### 5.4 【P1】有界两层记忆 + 满则整批蒸馏

Hermes：`USER.md` 1375 字符 / `MEMORY.md` 2200 字符，agent 自维护，**无自动过期**，写满**必须整批替换**（防静默丢弃）；有界层在会话首注入，无界层走 FTS5 全文检索。

- 已有底子：`brief.ts`（项目简报面）、`decisions.ts`（`set_decision` 带 `by`+`evidence`）、`projects/<id>/内部/`
- 引入：给项目「最小自我」设**硬字符上限**，超了就要求蒸馏改写；历史事实全部退回按需检索（`kb_search` + 会话 JSONL）
- 代价：小。主要是定义上限值与"满了怎么办"的显式失败态（与红线「不许静默降级」同形）
- 优先级 P1：与 5.2 同判据的两面
- 注：我本机（Qoder harness）的记忆系统就是这个形态的实践版，可作为手感参照，但不构成 kit 的实现依据

### 5.5 【P2】Compaction 三档

Claude Code：约 92–95% 触发，分三档——清工具输出 → 摘要对话 → 手动 `/compact`。

- 已有底子：`storyharness/src/chat.ts`/`metrics.ts`/`sessions.ts`/`serve.ts:17` 已有「压缩压力」与会话指标
- 引入：把压缩从单策略改成**分档可指**（先清工具输出再摘要正文），并把档位选择交给宿主
- 优先级 P2：底子已在，属精化

### 5.6 【不引入，只写契约】权限分级

Claude Code 的 `deny > ask > allow` 序与分类器兜底（分类器的安全检查不吃工具结果）。我们 `serve.ts:138-151` 只有 CORS 名单 + 口令全闸。

裁定建议：**不引入**——权限是宿主域（红线 9）。但批次4 看板要 token 分发时，`docs/PROTOCOL-REVIEW.md` 该补一节分级契约，让宿主有参照。

### 5.7 【已有，无需引入】分层持久指令

`CLAUDE.md` 的定位是「每次会话都要在场的事实，advisory only，膨胀即付费」。我们对应件已存在：`AGENTS.md`（仓级）+ 任务包项目背景卡（`spawn.ts`）+ `项目配置.json`。只需在删 flow 后确认这三层各自职责没被抽空。

---

## 六 · 待裁票（4 票，每条都可一句话否掉）

| # | 票 | 选项 | 我的建议 |
|---|---|---|---|
| ① | **台账命运** | A 全交宿主 / B kit 留被动记录（节点跑过什么、产物、指纹、谁裁决——无推进权） / C kit 只定义台账 schema | **B**。`内部/sessions/` 与 `内部/收据/` 已在盘且不经 `state.json`；顺 `journal.jsonl` 只记账不裁决 |
| ② | **knowledge 双声明** | A 事实源=`op.knowledge`（承批D 立场 `types.ts:29`）/ B 事实源=skill `bind` | **A**。否则删 flow 后两处真相并存 |
| ③ | **自导 skill 待遇** | A 维持「另册、只读」/ B 走提案进注册表 | **B**，复用 `skill_patch` 提案制（红线 7） |
| ④ | **改名与发布口径** | 仓名 `storyflow-kit`、README 第 3 行「模块化 flow 编排」卖点、CHANGELOG 版本轴（6.0.0 对外基线后的大版本） | 需你定：改名影响 GitHub 地址与外部文档链接，**建议与批2 同期一次做完**，别分两次对外解释 |

---

## 七 · 分批推进（每批单独点头，批与批之间不自动续）

**批1 · 纯减法（已执行，范围按第八节回执修正）**
出清 `flow_mine` / `flow_optimize` / `flow_overlay` 三动词 + `optimize.ts` + `compat.ts` + `run-state.json` 迁移 + `kernel-run` 两处收口自动调优触发。
**`overlay.ts` 与 `metrics.ts` 不在本批**（耦合见 §八.2，随批2/批4 与 `presets/` 一起裁）；**flow@2 legacy 分支不在本批**（7 个测试夹具依赖，随批2 状态机一起走）。验收见 §八.4。

**批2 · 状态机出清 + 连动重写**
2.1 + 2.5 全量；文档 15 份、两份生成物、README 与仓名（票④）。验收：动词表与 `docs/Agent.md` 一致、`/api/v1` 面收敛、`storyharness` typecheck 过。

**批3 · 引入件（P0 先走）**
5.2 JIT 装载（先跑一次真实装载出收据，把 N1 从推断转成实测）→ 5.1 hooks 挂点契约 → 5.3 派发头独立动词 → 5.4 有界记忆。
验收：N1 有收据；hooks 有 3 个事件点的最小实现与测试；派发头可脱离 `state.json` 渲染。

**批4 · skill 主推定稿**
4.1–4.4 形态规范落地；`expandFlow3` 转形成只读工序表编译进 `kit/hypergraph.rag.json`（`kit-compile.py` 扩一步）；`flows/` 目录退役为 `docs/` 参考件。
验收：`kb_search` 能查到"写短剧分镜前先装哪些卡、各档配置改了会怎样"，且零可执行面。

**回归靶子（贯穿四批）**：`projects/p-burnheart-ep1`——现成 15 个 done 节点、20 节点计划、m2.link 人工门留痕（`gate.note:"user override: run to end, skip gates"`）。每批都拿它取证"信息没丢"。

---

## 八 · 批1 执行回执（2026-10-14，工作树未提交）

### 8.1 出了什么

| 件 | 动作 | 证据 |
|---|---|---|
| `flow_mine` / `flow_optimize` / `flow_overlay` | 动词下架（台账 28 → **25**，G_ORCH 只剩 `flow_effect` + `skill_patch`） | `core/src/verbs.ts`；生成物已重跑：`docs/Agent.md`、`contracts/http-openapi-v1.json` |
| `core/src/optimize.ts`（473 行） | 整件出仓 | 提案规则引擎（R1–R7）、`overlayFromProposals` 自动落地 |
| `core/src/kernel-optimize.ts`（351 行） | 拆剩只读视图，改名 `core/src/kernel-effect.ts`（79 行） | `flowOptimize`/`flowMine`/`flowOverlay` 三函数删除；`viewEffect` 摘掉 `mine` 游标与 `overlay` 回显两块，保留指标/诊断/悬置门（纯只读） |
| `core/src/compat.ts`（263 行） | 整件出仓 + `http.ts` 摘除 `registerCompat` | 消费者查无：`tools/workflow-page-template.html` 已不存在，八端点仅 `core/test/r8-server.test.ts` 引用（同批删除 3 例）；写盘正途仍是 `/api/panel/files` |
| `run-state.json` 迁移 | `state.ts` 迁移段（原 63–176）+ `legacyStatePath` + `kernel-run` 分支（原 98–117）+ `http.ts` legacy 回读 + `kernel-view` 三处兜底 全摘 | `projects/*/run-state.json` 盘上计数 0（实测 `ls`），迁移器无对象；`core/test/migrate.test.ts` 随删 |
| **收口自动调优两处** | `kernel-run.ts` 原 733–734（srd 裁决通过）与原 1140–1141（全部节点 done）的 `flowMine + flowOptimize` 自动触发删除 | 这是判据 B 的实体：引擎不再在收口时自己组挖掘包、自己刷提案池、自己把提案落成 overlay |
| `AGENT_VERBS` | 19 → **16**（三个动词工具自然消失） | `core/src/agent.ts:147`；`docs/integration/sse-events.md` §五 同步 |

### 8.2 三处耦合，批1 范围因此收窄（不是偷懒，是刀口会砍到活件）

1. **`overlay.ts` 删不得**——`kernel.ts:174 effectiveOf` 用它合成生效编排，而 `registry/effective.json` 是看板 v3 的只读事实源（`storyharness/src/serve.ts:786-793` `/api/plan`、`brief.ts:113-117` 的 kind 事实源）；`presets/` 五套生产线预设的实体就是 overlay 文件（`production-preset.ts:82-110`，实测 4 份 `overlay.<flow>.json`）；`项目配置.json` 的阈值预算也是「造一个派生 overlay 插进叠加序」（`kernel.ts:176-202`）。删它=同时裁预设＋预算面＋看板读模型，那是连动重写，不是减法。
   **修正后的裁决**：overlay 的**运行时改写入口**（`flow_overlay`）已出清，overlay **文件面**（人写／声明层）留到批2 与状态机同删——`presets/` 的命运随之在批2 前拍。
2. **`metrics.ts` 删不得**——`kernel.ts:471-560 persistModuleReports` 的模块粒度指标（submits/tokens/latency/hitRate）吃 `readMetrics`，module-report@1 是交付台账件；且票①（台账命运）未拍，被动记账先留。批1 只切掉「指标 → 自动提案 → 自动改编排」这条判断链。
3. **flow@2 legacy 分支删不得（本批）**——`kernel.ts:232` 的 else 路径被 7 个测试文件用作夹具形（creative-mindset / kits / m15 / plan / r5-generative / r7-runtime / r8-os02cd）。批2 摘 `plan.ts`/`cond.ts`/`state.ts` 时这些夹具会连带重写，届时一并出清；本批强行删要改 7 份测试的形状，风险与减法不符。

### 8.3 连动同步（红线 11）

`docs/integration/mcp-reference.md`（25 工具 + 出清说明）、`rest-api-reference.md` §五（compat 面退役陈情）、`sse-events.md` §五（白名单 16）；`docs/Agent.md` 与 `contracts/http-openapi-v1.json` 由门禁重生成。`core/test/defaults-registration.test.ts` 的死表普查数字复算更新：默认点 **170→150**、计数文件 **27→25**（cfg-template 的 10 处不变）。

### 8.4 验收回执

- `cd core && npm test`：**47 files / 487 tests 全绿**（批前 48/503；差值＝`migrate.test.ts` 出仓 + 优化器/挖掘 e2e 用例删除）。
- `cd core && npm run build`（tsc 全量）：无错。
- `cd storyharness && npm test`：**166/166**；`npm run typecheck` 无错。
- 门禁：`gen-verbs-doc.mjs --check` OK（25 动词）、`gen-openapi.mjs --check` OK（路由 19 ＋ 动词 25）。
- 三 lint：flow-lint 5 flow 0 error、module-lint 8 模块 0 error/33 warn（warn 均为批前既存）、kit-lint 0 error/3 warn。
- 回归靶子 `p-burnheart-ep1` 只读面实测：`viewEffect` 回 `{flowId: screenplay, overlayHash/planHash 有值, applied: 0, metrics.events: 30, diagnostics.count: 0, gatesDue: 0}`，字段表已无 `mine`/`overlay`；`registry/effective.json` 与 `metrics-summary.json` 正常重派生——盘面照旧可解读。

### 8.5 挂账（不装作已处理）

- `skills/orchestration-miner.md` 与 `modules/base/module.json:529` 的 `orchestration-mine` op **失去装配动词**：包不再由内核组，只有宿主自己攒证据才能跑。批4（skill 形态定案）裁它的去留。
- `core/src/kernel-view.ts:134` 仍读 `registry/optimize.json`：生产者已没，旧项目文件原样可读（读不到就是 null，不静默谎报）。批2 随 workbench 载荷一起清。
- `tools/worldbook_history.py:136` 读 `registry/miner-findings.json`，缺失回落空对象——不会炸，但那段「复盘与建议」从此只在使用者手工跑过挖掘 skill 时才有内容。
- CHANGELOG 与版本轴未动：等这一批点头提交时一起落笔。

---

## 附 · 先例出处

- Anthropic，[Building Effective Agents](https://www.anthropic.com/engineering/building-effective-agents)——workflow＝预定义代码路径、agent＝自导过程；编死的理由是一致性，代价是灵活性
- Anthropic，[Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)——compaction、结构化笔记外置、just-in-time 标识符检索、子代理返回浓缩
- Anthropic，[Equipping agents for the real world with Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills) + [Agent Skills 文档](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)——progressive disclosure
- Claude Code 机制分工（第三方综述）：[CLAUDE.md/Skills/Subagents/Hooks 怎么选](https://www.buildthisnow.com/blog/tools/claude-code-skills-vs-subagents-vs-hooks)、[Anatomy of a Claude Code Session](https://codewithmukesh.com/blog/anatomy-claude-code-session/)（单线程循环、≈8700 token 开销、92–95% 三档压缩、子代理 1–2k 返回、三层嵌套、`PreToolUse/PostToolUse/Stop`、`deny>ask>allow`）
- LangGraph，[Interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts) / [Persistence](https://docs.langchain.com/oss/python/langgraph/persistence)——图编死、停与不停交还调用方
- Temporal，[determinism 与 event history](https://community.temporal.io/t/what-is-missing-in-my-understanding-of-determinism-and-event-history-of-a-workflow-receiving-signals/16565)、[Replay Bugs Hide in Plain Sight](https://medium.com/@Nexumo_/temporal-replay-bugs-hide-in-plain-sight-7e436f4b3ea4)——最小编死换最强恢复，代价是改图要过 versioning
- 综述：[From Static Templates to Dynamic Runtime Graphs](https://arxiv.org/html/2603.22386v1) / [IBM awesome-agentic-workflow-optimization](https://github.com/IBM/awesome-agentic-workflow-optimization)——自调优是研究前沿，非生产框架缺省
- Hermes：[Architecture](https://hermes-agent.nousresearch.com/docs/developer-guide/architecture)、[Persistent Memory](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory)、[Skills System](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills)、[hermes-agent-self-evolution](https://github.com/NousResearch/hermes-agent-self-evolution)（DSPy+GEPA，改内容不改结构，测试+人审双闸，从不更新权重）
- 未取证项：Hermes 的 `soul`/`crons` 细节仅见于第三方转述（[mindstudio](https://www.mindstudio.ai/blog/hermes-agent-5-pillar-architecture-memory-skills-soul-crons)），官方 docs 未核；Claude Code 的 memory tool 官方文档在本机区域不可达（307 → app-unavailable-in-region），其行为描述仅取自 context-engineering 一文。
