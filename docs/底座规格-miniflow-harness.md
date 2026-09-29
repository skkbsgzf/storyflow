# miniflow 底座规格 v1.0（Kernel & Plugin Contracts）

> **定位**：产品底座的唯一权威规格——内核、三层插件契约、双面 API、工作台、里程碑与验收。
> 上游愿景见《miniflow 产品蓝图 v2.1》（同目录）；本文回答「底座长什么样、怎么验收」。
> 日期：2026-09-16 ｜ 状态：M0 已执行，M1 待开工 ｜ 排查依据：sess_eae22520 尾部两轮事故复盘

---

## 0. 一句话定义

miniflow = 可被任意宿主 Agent 安装调用的**创作任务 harness**：宿主出脑子（token），miniflow 出结构（flow、校验、留痕、交付）。底座保证两条强约束：

1. **上下文不能乱**——任务包即宿主获得的全部工作上下文，磁盘真相永远优先于对话记忆；
2. **产物得纪律严明**——产物只有经注册、过契约、清断言、破门四个关卡才存在；`对外交付/` 只能由注册产物导出。

---

## 1. 分层架构与目录布局

| 层 | 内容 | 契约 | 可变性 |
| --- | --- | --- | --- |
| **内核**（M1） | 七动词、状态机、journal、任务包组装器、校验链 | `contracts/*.schema.json` + 本文档 §2 | **冻结**：API 变更须升内核版本 |
| **L1 能力插件** | minitool：确定性原子操作，零 token | `contracts/minitool.schema.json` | 随时增删 |
| **L2 领域包** | flows/ + skills/ + knowledge/ + templates/ 的打包分发单位 | `contracts/flow-pack.schema.json` | 随时增删 |
| **L3 宿主壳** | 同一内核绑定到不同宿主 | 内核动词绑定规范 | 每宿主一个壳 |

```text
D:\storymasterv4
├── AGENTS.md            行为协议（宿主引导，每轮注入，≤60 行）
├── contracts/           标准本体：六份 JSON Schema（L1/L2 插件与内核数据模型）
├── flows/               L2：flow@3 声明式图（v4.0 注：现 9 条，7 条 flow@2 只读待迁移）
├── skills/              L2：角色方法论 md（已有 18 个）
├── knowledge/           L2：原子知识库（断言表/梗库/美学条目）
├── templates/           L2：产物模板
├── tools/               L1：Python minitool（零依赖、可独立运行、子进程被内核调用）
├── core/                [M1] TS 内核：src/（纯逻辑）· mcp/（MCP 面）· http/（HTTP 面）
├── workbench/           [M3] 工作台前端（活面板）
├── projects/<id>/       运行时数据：state.json · journal.jsonl · registry/ · snapshots/ · 产物
└── docs/                蓝图 / 本规格 / 排查报告
```

---

## 2. 内核规格（M1）

### 2.1 七动词 API

| 动词 | 入参 | 出参 | 副作用 |
| --- | --- | --- | --- |
| `flow_list` | — | flow 清单 + 能力索引（供拆解协议用） | 无 |
| `flow_run` | flowId, projectId, inputs | runId + 首个任务包或 awaiting | 建 run 目录、journal 起事件 |
| `flow_next` | runId | **就绪批**：全部就绪认知步的任务包（`batch[]`，`parallelWith` 标注同批节点），单节点时字段向后兼容（或 suspended/gate/completed） | 推进 core/minitool 步（零 token 就地执行）；认知步按 AND-join 就绪集批量派发 |
| `flow_submit` | runId, nodeId, output | accept/reject + 原因 | 校验→落盘→注册→快照→journal→推进；reject 则节点计失败一次 |
| `flow_resume` | runId | 从断点重组的最新任务包 | 不从对话记忆续跑，一律重新组装 |
| `flow_gate` | runId, nodeId, verdict(过/打回+根因) | 下一步 | 记录人的裁决；打回仅回注**本阶段入口**（失效范围限本阶段，已验收阶段即定稿）；跨阶段回滚须 `force` 人工介入 |
| `flow_rerun` | runId, scope, dryRun | 受影响子图（指纹比对）或重跑结果 | stale 下游失效；dryRun 不动状态 |

（M4 追加 `flow_import`：Zod/Schema 校验的 flow 合成入口。）

### 2.2 状态模型（全文件、零 DB）

- `projects/<id>/state.json`——run 状态机，**原子写 + flock**；
- `projects/<id>/journal.jsonl`——append-only 事件流（submit/reject/advance/gate/verdict/rerun/snapshot/intake），可回放、可审计；
- `projects/<id>/registry/artifacts.json`——产物注册表：路径、节点、轮次、sha1、输入指纹、校验结果。**未注册 = 不存在 = 不可交付**；
- `projects/<id>/snapshots/<node>/r<N>/`——不可变内容副本 + `index.json`（沿用 tools/snapshot.py 模型：sha1 + 输入指纹 → 重跑缓存命中判定）。
- 现有 `run-state.json` 迁移为 `state.json`，字段兼容（nodes/status/round/gate/notes/presets）。

### 2.3 任务包组装器

任务包 = 宿主获得的**全部**工作上下文：`{ runId, nodeId, 指令(skill md + 变换参数), 上下文(哈希锚定的上游产物引用 + 有界摘录), 输出契约 }`。

- **预算裁剪顺序**：输出契约 > 上游产物 > 方法论细节（超预算先砍方法论）；
- **节点域隔离**：不携带其他项目、其他节点的任何内容；
- **每轮重组**：`flow_resume`/重试一律重新组装，禁止从对话续写。

### 2.4 提交校验链（产物纪律的执行点）

```text
flow_submit → ① JSON Schema 输出契约 → ② 硬断言：
   check_aesthetic_asserts（66 条美学/结构断言）
   完整性断言（源/导出计数一致、无 shell 残渣、集标题规范、分镜字段齐备）
   词汇表守卫（项目词汇表：他项目专名出现即 block）
→ 全过：落盘 + 注册 + 自动快照 + journal + 推进图
→ 任一不过：打回，附定位到条目的失败原因，不落盘
```

### 2.5 门（人工裁决权）

`quality.allow_agent_verdict: false` 由运行时强制：gate 节点没有 `flow_gate` 记录的人类裁决，图**不推进**；agent 无任何动词可以绕过。S1–S5 的 semi/manual 预设沿用现 state.json。

### 2.6 并行调度（dag-ready-batch）

流程图是数据依赖图，不是工序流水线——**并行是底座的执行语义，不是流程作者的负担**：

- **就绪条件（AND-join）**：节点就绪 = 全部活跃上游 `done`；多条入边缺一不派发。并行与否由依赖图决定，flow.json 里不需要（也不允许）手工标注「并行组」；
- **批量派发**：`flow_next` 一次返回全部就绪认知步（`batch[]`）。同批节点互不依赖，宿主用多 agent 并发执行（如 S1 找梗选梗 ∥ 实时热点扫描同时搜集材料）；每个任务包携带 `parallelWith` 提示；
- **core 步不进批**：minitool 零 token，内核就绪即就地执行（本轮内做完再派发下游）；
- **门 = 同步屏障**：验收门上游未齐不开启；门未 pass，下一阶段不派发——阶段间的串行是验收语义，阶段内的并行是调度语义，两者正交；
- **重跑同语义**：打回重跑范围内就绪批照常并行，缓存命中规则不变。

### 2.7 迭代节点（节点=任务定义，实例=一次执行）

节点图回答「有哪些工种」，不回答「干多少活」——**章节写 3 章还是 1000 章，节点数量不变**：

- **迭代声明**：节点携带 `iterate{unit, over, artifact, first}`（单位=章、来源=大纲逐章细纲、产物模板=章节正文/第{n}章.md、本期数量）；
- **实例语义**：实例 =（节点, 迭代键），每次迭代独立任务包、独立产物、独立快照——第 3 章和第 1 章是不同实例，但节点只有一个；
- **就绪与汇总**：下游以「全部迭代实例完成」为就绪（AND-join 的实例化）；断言/打磨类下游对每个实例分别执行或汇总执行，由其 iterate 声明决定；
- **画布呈现**：迭代节点渲染为单节点 + ⟲ 徽标（单位×数量），禁止为实例展开节点——为每章画一个节点是建模错误；
- **里程碑**：内核循环调度（按 over 来源逐实例派发）为 M2+ 项，当前流程/画布/快照层先行。

### 2.8 Stage 包（封装与分发单元）

**Stage 是标准化封装：带命名、带版本、可导入、可市场插件化分发。一个工作流由多个 Stage 拼接而成，按用户意愿执行。**

- **包契约**：`contracts/stage.schema.json`（stage@1）——id/name/version/applicability（适用品类：剧本/小说/通用）/entry/gate/nodes/edges/inputs/outputs；契约文件 `contracts/stage.schema.json`，管理工具 `tools/stage.py`；
- **适用品类**：选题 Stage 同时适用剧本与小说——封装粒度按「能力段」切，不按「品类」切，品类只是 applicability 标签；
- **拼接语义**：flow = Stage 的拼接清单（按用户意愿组合，一个 Stage 也可独立成线）；Stage 的 entry 接上游产物，gate pass 后交下游；跨 Stage 回注仅限用户强行介入（沿 §2.5 门语义）；
- **市场分发**：Stage 包 = 一个目录（stage.json + 产物模板 + 技能引用），对齐 flow-pack 的分发方式；「上架审核 / 格式规范 / 文笔润色 / 选题」为首批通用包；
- **里程碑**：flow 拼接编译器（stage@N → 内联 flow.json）为 M2+ 项；当前 Stage 包先作为作者侧封装单元与市场清单存在，内核仍执行内联 flow。

### 2.9 技术决策

- **内核 TypeScript**（`core/`，与 dsh/Cordis 生态、deepwrite、MCP SDK 同栈；复用 v3 运行时语义：suspended/awaiting_input/恢复推演）；
- **minitool 保持 Python 零依赖**，内核以子进程调用（stdin/stdout JSON）；
- 契约**以 JSON Schema 为准**（contracts/），TS 侧类型由 schema 生成，Python 侧 jsonschema 直读；
- MCP 面 + HTTP 面 + CLI 面**共享同一内核**，无第二套逻辑。

---

## 3. 插件契约（标准本体 = contracts/ 六份 Schema）

| Schema | 层 | 用途 | 使用者 |
| --- | --- | --- | --- |
| `minitool.schema.json` | L1 | 能力插件声明：exec + 输入/输出 Schema + 超时 | 内核校验链、拆解协议 |
| `flow-pack.schema.json` | L2 | 领域包 manifest：flows/skills/knowledge/templates/minitools 清单 + 内核兼容区间 | 分发与安装 |
| `task-package.schema.json` | 内核 | 宿主获得的工作上下文 | 全部宿主壳 |
| `run-state.schema.json` | 内核 | run 状态机 | 内核、工作台、whereami |
| `artifact.schema.json` | 内核 | 产物注册表条目 | 校验链、导出、工作台 |
| `journal-event.schema.json` | 内核 | 事件流条目 | 审计、工作台时间线 |

**第三方接入最小路径**：写 L1 = 一个带 schema 的可执行文件（任何语言）；写 L2 = 一个目录 + manifest。**不需要学任何框架。**

### 3.1 兼容级别（分级兼容策略，决策日志 #9）

标准中立（= contracts/ 六份 Schema）；兼容差异一律以 **additive profile** 表达，禁止反向进入规范本体。

| 级别 | 增量能力 | 典型宿主 | 定位 |
| --- | --- | --- | --- |
| `base@1` | 七动词（MCP/CLI）+ 任务包 + 断言交付 + 文件状态 | codex / zcode / 任意 agent | 普通兼容，广度拉新 |
| `workbench@1` | + HTTP 面：活面板、intake 回流、rerun API | deepwrite 等应用型宿主 | 应用内嵌 |
| `cordis@1` | + Cordis profile：原生插件挂载、`ctx.miniflow` 服务注入、flow pack 热插拔、门作为 Cordis 事件 | dsh 及 Koishi 系 | **强兼容**，深度留存 |

- **能力协商**：宿主声明所达级别，`flow_list` / `whereami` 返回；pack manifest 声明 `requires`，不满足 = 类型化报错（不静默降级）。
- **Conformance kit**（`miniflow-conformance`）：每级别一组一致性测试，宿主跑通即可宣称该级别——「兼容」必须可验证。
- **Cordis profile 红线**：保持薄映射（规范概念 → Cordis 惯用语，可再生成），不做「只有 Cordis 能表达」的独占能力；profile 可损失，标准不可损。
- **规范开源发布**：M1 冻结内核 API 后即可发 spec v0（contracts/ + SPEC.md + conformance kit + miniflow 领域包作为参考实现），不必等 M4。

---

## 4. 两条强约束 → 机制映射（事故复盘固化）

| 纪律 | 机制 | 杀死的事故类别（sess_eae22520 实证） |
| --- | --- | --- |
| 上下文 | AGENTS.md 引导 + whereami-first | 凭 865 条历史记忆盲干 |
| 上下文 | 任务包节点域 + 哈希锚定 | 守堤人词汇污染拍魂 |
| 上下文 | flow_resume 强制重组 | 「重试」从崩溃点记忆续写、heredoc 残渣入交付物 |
| 上下文 | AMBIGUOUS 类型化返回 | 「继续」多项目歧义静默猜错 |
| 产物 | 注册表唯一真相 + submit 自动注册 | 状态机 pending 与盘上产物脱节 |
| 产物 | 计数/残渣/标题硬断言 | 导出丢第十四集、87≠77、shell 残渣 |
| 产物 | 门由运行时强制 | agent 自行「接受现状」交付 9 集版 docx |
| 产物 | 编排表忠实性断言（M2） | 市联赛决赛整段被静默跳过 |

---

## 5. 宿主与界面

### 5.1 三张脸，一个内核

- **MCP 面**：zcode / codex 等宿主以 tools+resources 调七动词；
- **HTTP 面**：工作台与外部集成走 REST（GET state/artifacts/journal/snapshots + POST gate/rerun/intake）；
- **CLI 面**：无 MCP 宿主与人类直接使用（`miniflow <verb>`，M0 期由 tools/*.py 分担）。

### 5.2 两种 HTML

| | 工作台（Dashboard） | 交付页 / 快照页 |
| --- | --- | --- |
| 服务对象 | 用户本人，跟踪进展 | 客户 / 归档 / 分享 |
| 数据 | 活 API 实时读 registry+journal | 生成时烘焙的单文件静态 HTML |
| 生命周期 | 项目存在即存在（flow_run 即生效） | 冻结产物，入注册表 |

现有 `tools/workflow-page-template.html` 资产**继承**：拖拽画布/检查器四 tab（概览·快照·修改·重跑）/S1–S5 着色/md 渲染器；**改造三处**：数据源 `<script id="payload">` 烙死 → fetch REST API；「修改」tab → intake 批注回流（docx 单向为准，md 重新生成）；「重跑」tab → flow_rerun + scope 预览。静态生成器 `project-pages.py` 降级为「导出快照页」实现，与 `render_html`（交付页）构成完整静态出口。

---

## 6. 里程碑与验收

| 里程碑 | 内容 | 验收口径 | 状态 |
| --- | --- | --- | --- |
| **M0 止血包** | AGENTS.md · contracts/ 六 Schema · whereami.py（含 AMBIGUOUS）· export-doc 硬断言+自动快照 · git 化 | 断言机械拦下第二批小纲四类缺陷（编排偏离除外，其属 M2 词汇/忠实性断言） | ✅ 2026-09-16 |
| **M1 内核** | 七动词 / state.json+journal / 组装器（预算裁剪）/ 校验链骨架 / MCP+HTTP 双面 / flock+原子写 | 宿主全程零手工文件操作跑通短剧成稿生产线（id: topic-selection）全流程，journal 完整可回放；S1 双 agent（找梗选梗∥实时热点扫描）在同一就绪批中派发 | 待开工 |
| **M2 校验链** | 产物注册表全量 / 逐节点输出契约 / 词汇表守卫 / 编排表忠实性断言 / 门强制 | 注入复盘四类缺陷全部在门上被拦，对外交付零污染 | 排队 |
| **M3 工作台** | 活面板 / intake 批注回流 / rerun scope 预览 / 导出快照页 | 用户一整天不碰终端：看进展、批注、打回、重跑、导出全在页面完成 | 排队 |
| **M4 生态** | 规范开源发布（spec v0 + conformance kit）/ 需求拆解协议（flow_import）/ cordis@1 profile + dsh 壳 / deepwrite 壳（pi-runtime 夹持）/ 跨宿主续跑 | conformance 三级考卷发布且 miniflow 自身通过；同一 run 两个宿主接力无损失；dsh 内热插拔 flow pack | 排队 |

## 7. 决策日志

| # | 决策 | 日期 |
| --- | --- | --- |
| 1 | 内核 TS + minitool 保持 Python 子进程；契约以 JSON Schema 为准 | 2026-09-16 |
| 2 | docx 批注**单向**回流：以回传 docx 为准，md 重新生成，不做双向合并 | 2026-09-16 |
| 3 | whereami-first：任何创作动作（含「继续/重试」裸指令）前必查表 | 2026-09-16 |
| 4 | 多项目歧义 = 类型化 `AMBIGUOUS` 返回，禁止静默猜测 | 2026-09-16 |
| 5 | 工作区 git 化；journal append-only + 快照内容寻址天然友好 | 2026-09-16 |
| 6 | 任务包 = 宿主唯一上下文；磁盘真相 > 对话记忆 | 2026-09-16 |
| 7 | Cordis = 宿主壳 + 可选 DI 基座，**不是**插件标准；标准 = contracts/ | 2026-09-16 |
| 8 | 「重试」同走 kit：任何一轮开工先 whereami（AGENTS.md 强制） | 2026-09-16 |
| 9 | 分级兼容策略：标准中立（contracts/），兼容差异走 additive profile——`base@1`（普通，MCP/CLI）/ `workbench@1` / `cordis@1`（强，dsh 及 Koishi 系）；能力协商 + conformance kit 考卷；Cordis profile 薄映射可弃，标准不可损 | 2026-09-16 |
| 10 | 就绪批并行调度：`flow_next` 返回 AND-join 就绪批（dag-ready-batch），并行度由依赖图唯一决定；门为同步屏障。流程图里禁止手工并行标注——画出来是串行的边就是真依赖 | 2026-09-16 |
| 11 | 打回语义收敛：send-back 仅回注本阶段入口、失效范围限本阶段，已验收阶段即定稿；跨阶段回滚唯一入口 = 用户强行介入（`force` / `flow_rerun`）。每次打回的原因与范围属当次评审的具体记录，仅在查看对应门节点时按需呈现，不作常驻流程元素 | 2026-09-16 |
| 12 | kit vendor 模型：kit 提供 90% 创作者所需工具链，项目初始化时 `kit.py vendor` 拷贝进 `<project>/kit/`（kit.json 溯源账目 + flow.json 快照）；创作者拥有副本、自治版本，上游只提供 status/diff 不自动覆盖 | 2026-09-17 |
| 13 | Stage 包模型：Stage（命名/版本/可导入/市场插件化）为封装与分发单元，flow = Stage 拼接；选题/润色/格式规范/上架审核为首批通用包（适用品类为标签非边界） | 2026-09-17 |
