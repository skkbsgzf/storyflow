# miniflow · 产品蓝图 v2.1（Harness Toolkit 版）

> 源项目：`D:\storymasterv3`（StoryMaster v3）→ 新产品：**miniflow**
> 参照会话：`sess_aa829e9e-8fb3-43f9-b776-0bea0cb5c042`（智能选题工作流全链路迭代）
> v2 修订：确立 **harness 模式**——toolkit 不自持模型 Key、不烧自己的 token，创作认知由宿主 Agent 用自己的 token 完成；toolkit 负责"拆解、流转、校验、留痕、交付"。
> v2.1 修订：确立 **能力三层模型**——Skill（方法论）× 知识库（原子知识）× minitool（原子操作）绑定成 flow 的原子步；flow 的原子性精确到知识对象粒度（拆某个人物、拆某个桥段）。

---

## 一、产品定义

**miniflow = 可被任意 Agent 安装调用的创作任务 harness（Toolkit）。**

用户对宿主 Agent（dsh / codex / zcode / workbuddy / 任意 MCP 宿主）说出创作需求；宿主 Agent 调用 miniflow，miniflow 把需求**灵活拆解成分配为一条 flow**（flow@1 声明式图），然后**逐步**驱动宿主 Agent 完成每一步——每一步的任务包由 toolkit 组装（注入技能、知识条目、对标、模板、输出契约），宿主 Agent 用**自己应用的 token** 执行并回交结果；toolkit 校验、落盘、推进图，最终以**报告**形式输出产物（分析报告 / 方案 / 对照验证 / HTML 交付页）。

一句话分工：

> **宿主 Agent 出脑子（token），miniflow 出流程（结构）。**

| | 宿主 Agent（dsh/codex/zcode/workbuddy…） | miniflow Toolkit |
| --- | --- | --- |
| 认知 | 所有 LLM 推理（自己的模型、自己的 token 计费） | 不调用任何模型（harness 模式） |
| 结构 | 按任务包指令干活 | 需求拆解 → flow 合成；图调度；状态机 |
| 质量 | 生成内容 | 硬断言校验、输出契约（Zod）、验收门、A/B 基线对照 |
| 记忆 | 会话上下文 | durable 状态（state.json 原子写）、journal 事件流、产物注册表 |
| 交付 | 把报告呈现给用户 | 组装报告包 + 单文件 HTML 交付页（界面即产物） |

四个核心命题：

1. **没有固定前端——界面即产物。** 每次运行按需渲染的单文件 HTML 交付页就是本次需求的"专属界面"（原型：v3 `sm.topic-delivery` 零 LLM 确定性渲染，实物样板 `deliver/topic-selection/run2-20260914/选题交付页.html`）。
2. **flow 按需合成，且原子到知识粒度。** flow 不是"写大纲""做分析"这类粗粒度阶段，而是"拆某个人物""拆某个桥段"级别的原子步——原子性由知识库的条目粒度支撑（§三）。出厂 flow 降级为模板/样例；一等入口是"需求 → 拆解分配 → 合成 flow@1 → 逐步执行"。
3. **harness 即形态。** toolkit 是宿主 Agent 之外的脚手架：不抢宿主的模型与 token，不自带界面，装进哪个宿主就用哪个宿主的脑子和额度；跨宿主行为一致，因为结构和校验全在 toolkit 侧。
4. **能力三层绑定。** Skill（怎么做）× 知识库（用什么）× minitool（怎么绑定与校验），缺一不可（§三）。

---

## 二、Harness 执行模型

### 2.1 任务 yielding 循环

v3 的运行时里已有"挂起等外部决策"的成熟语义（`sm.review` 验收门：run 转 suspended，等人裁决）。harness 模式把这个语义**泛化到每一个认知步**：

```text
flow_run / flow_resume
   │
   ▼
运行时沿图推进：core 步 / minitool（确定性，零 token）就地执行
   │
   ├─ 碰到认知步（llm/skill/agent 语义）→ run 转 awaiting_input
   │     返回【任务包】：{ runId, nodeId, kind,
   │                      指令（prompt = skill 方法论 + 变换参数）,
   │                      上下文（知识条目引用 + 输入产物引用）,
   │                      输出契约（格式/结构/断言点） }
   │
   ▼
宿主 Agent 用自己的 token 执行任务包 → flow_submit { runId, nodeId, output }
   │
   ▼
toolkit 校验（Zod 输出契约 + 硬断言 + 输出守卫）
   ├─ 不过 → 退回（附失败原因，宿主重试，重试语义在 toolkit 侧记账）
   └─ 通过 → 落盘、journal 记事件、产物进注册表 → 继续推进图
   │
   ▼
循环，直到：completed（产出报告包）
          / suspended（sm.review 人工验收门，等用户裁决）
          / awaiting_input（下一个任务包，等宿主继续）
```

关键性质：

- **跨会话可续**：状态逐任务边界原子写 `runs/<runId>/state.json`，宿主 Agent 重启/换宿主都能 `flow_resume` 接上（v3 已验证的恢复语义：已完成集合 + 图计划推演）。
- **换宿主无损**：任务包是自足的（指令 + 上下文引用 + 输出契约），codex 干到一半，zcode 可以接着干——因为脑力在任务包里，不在宿主会话里。
- **重试记账**：失败退回不计为完成；journal 记 source/tags/summary，复盘回流（参照会话第③轮"基于最新工单挖优化"）。

### 2.2 步型语义重排（相对 v3）

| 步型 | v3 语义 | miniflow harness 语义 |
| --- | --- | --- |
| `core` / **minitool** | TS 内建确定性处理器 | **不变并扩容**：minitool 即原子化后的 core 步（§三），零 token |
| `llm` | toolkit 直连模型端点（key-safe） | **改**：变成认知任务包，yield 给宿主执行 |
| `skill` | 技能包调用（内部走 LLM） | **改**：任务包模板 = skill md + 知识条目 + 变换参数，yield 给宿主执行 |
| `agent` | 应用内 Agent 按剖面执行 | **改**：泛化为"宿主任意执行者"（宿主可再委派子 Agent，toolkit 不关心） |
| `script` | spawn 外部引擎进程 | 保留（确定性重活可选本地跑），也可声明为任务包 |
| `web-search`（新） | —（会话里是外挂） | 认知任务包（宿主有搜索能力则用之）或本地可选实现 |
| `render-html`（新，由 `sm.topic-delivery` 通用化） | 选题专用交付页 | **core/minitool 步**，零 LLM 确定性渲染，模板注册表选壳 |

BYOK 直连模式（v3 的 llm-steps + key-safe）**保留代码但不进关键路径**，作为未来"无人值守批量跑"的可选后端；v2 验收不依赖它。

### 2.3 需求拆解与分配

拆解动作本身也是认知活——按 harness 纪律，**由宿主 Agent 执行，toolkit 提供协议与原料**：

1. 宿主调 `toolkit_list`（含知识库索引）拿能力清单。
2. 宿主按 toolkit 内置的**拆解协议**（一个固化 skill）把用户需求映射为 flow@1 草稿：阶段划分、**拆到知识对象粒度**（哪几个人物、哪几个桥段、哪几个对标件）、每步绑 skill 与知识条目、报告口径、验收门位置。
3. `flow_import` 走 Zod 校验（非法整单拒绝，结构正确性由契约硬保证，不靠提示词自觉）。
4. `flow_run` 开跑，进入 2.1 的循环。

"灵活"体现在：拆解粒度、路线（激进/平缓）、版本数（A/B）、是否上对标、是否加热点，全是 flow@1 里的显式字段，由宿主按需求现场决定；toolkit 只负责校验与执行。

---

## 三、能力三层模型：Skill × 知识库 × minitool

**命题：flow 的原子化，靠知识粒度支撑；能力的可组合，靠三层绑定实现。**

| 层 | 回答的问题 | 形态 | v3 现状 | 例子 |
| --- | --- | --- | --- | --- |
| **Skill**（方法论层） | 怎么做 | 程序性知识：拆解维度、字段规范、checklist、评审标准 | `assets/skills/*.md`（27 个，直接移植为这层） | `character-card.md`：人物卡的拆维度与字段规范 |
| **知识库**（知识层） | 用什么 | 原子知识对象：可寻址（ID）、结构化（md 正文 + JSON 元数据）、可版本化、带出处 | **未成库**——散落在对标作品、方案册、批注集、transform-playbook 里 | `kb/原型/黑化复仇者`、`kb/桥段/第三集身份反转`、`kb/对标/黑暗荣耀`、`kb/节拍/开篇3s钩子` |
| **minitool**（操作层） | 怎么绑定与校验 | 确定性原子操作（零 token）：kb 检索/取件、任务包装配、schema 校验、硬断言、片段组装、渲染 | core-steps（`sm.annotate`、`sm.topic-delivery` 等）——原子化的方向 | `deconstruct_character`、`deconstruct_trope`、`check_trope_combo`、`render_fragment` |

### 3.1 绑定公式

> **flow 原子步 = minitool(skill, 知识条目) → 可独立验收的产物片段**

例——"精确拆某个人"：

```text
flow 节点：拆-反派-拍卖师
  minitool:  deconstruct_character   （提供人物卡 schema + 校验 + 硬断言）
  skill:     character-card          （拆解维度与字段规范 → 写进任务包指令）
  knowledge: kb/原型/黑化复仇者       （匹配原型条目 → 写进任务包上下文）
  产物:      人物拆解件（md + JSON），过 schema 与断言，独立进注册表
```

三层缺一不可：只有 skill = 泛泛建议；只有知识条目 = 死数据；只有 minitool = 空转。绑在一起才是**可执行、可校验、可复用、可回流**的原子步。

### 3.2 知识库条目契约（新增进 contracts）

```text
KnowledgeEntry = {
  id:    "kb/<type>/<slug>"        # 类型化寻址：原型/桥段/对标/节拍/风格规则/平台规则
  type:  character-card | trope | benchmark | beat-sheet | style-rule | ...
  body:  md 正文（人可读，硬约束沿袭 flow@1）
  meta:  JSON（适用类型、情绪轴、爽点等级、冲突对象、搭配建议/禁忌…）
  provenance: { source: factory | run | import, ref? }   # 出处：出厂 / 某次 run 沉淀 / 外部导入
}
```

flow 节点与任务包都以 `kb/...` ID 引用条目（不内联拷贝），条目可版本化，任务包组装时由 minitool 取件注入。

### 3.3 知识库的 two flywheels（两个飞轮）

1. **拆解入库**：run 产物（人物拆解件 / 桥段拆解件 / 对标拆解件）经确认后**晋升为 KB 条目**（provenance 记来源 run）——越用越厚。参照会话里的 `批注集.json` 就是原子拆解件的雏形。
2. **组合校验**：条目 meta 带搭配建议/禁忌（如桥段×原型相性），minitool 在拆解协议装配期做**确定性组合校验**——宿主拼 flow 时就拦住不相容组合，而不是跑完才发现。

### 3.4 minitool 的双暴露面

- **flow 内**：作为原子步的绑定与校验器（图调度器就地执行）。
- **flow 外**：作为普通 MCP 工具暴露给宿主，供任务执行中临时调用（如 `kb_search` 找条目、`render_fragment` 试渲染一个片段）。

---

## 四、参照会话的设计信号

| 会话阶段 | 信号 | harness 下的落点 |
| --- | --- | --- |
| ① 立需求（报告+方案，步步 skill 固化） | skill 是默认纪律 | 每个认知步的任务包都注入 skill + 知识条目 |
| ② 对标韩剧改人设 | 对标锚定是标准输入 | `kb/benchmark/*` 条目化，flow 显式引用 |
| ③ 基于最新工单挖优化 | 复盘回流 | journal + 注册表查历史 run；拆解协议含"复盘步" |
| ④ A/B + 双专家监管 + 基线验证（63 vs 40） | 质量体系实证有效 | 拆解协议模板：监管步 + 基线对照步 + 硬断言步 |
| ⑤ 缺新意与实时性，热点搜索 | 实时性一等需求 | `web-search` 步型 + `kb/节拍/zeitgeist` 技能 |
| ⑥ 交付 HTML 固化进 flow | 界面即产物 | `render-html` minitool 进 outputs |
| （批注集.json / 拆解件） | 原子拆解产物已有雏形 | 拆解入库飞轮的首批原料 |

---

## 五、移植清单

### 5.1 直接移植（不重写）

- `packages/contracts`：envelope / flow@1 / smwf@2 / run / artifact / journal / assets / asset-registry（**去 SrdApi 与 GUI 契约**）。
- durable execution 五件套：`pipeline-graph-scheduler` / `pipeline-runner` / `step-executor` / `run-state-store` / `run-event-log`；`run-gate` 的挂起-裁决语义泛化为 awaiting_input（扩状态机，不改恢复语义）。
- `artifact-registry-store`（bundle 语义支撑 HTML 交付页打包）。
- MCP stdio server 模式（`apps/desktop/src/main/mcp/`，纯转译层）——"被任意宿主安装调用"的现成接入面。
- 资产层：`skills/`（27 个 → Skill 层）、`prompts/`、`agent-profiles/`、`asset-index.json` 登记制。
- `sm.topic-delivery` 确定性渲染 + `delivery-template.html` + `tools/build-topic-delivery.mjs`。
- 验收门与裁决权边界（`allow_agent_verdict` 默认人工）。
- 验证产物模式（硬断言.json / 评审明细.json / 复测汇总.json）。

### 5.2 改造

| 件 | v3 | miniflow |
| --- | --- | --- |
| llm-steps + key-safe | 关键路径（直连端点、自持 Key） | **降级为可选 BYOK 后端**，不进 v2 关键路径 |
| agent-steps | 应用内 Agent 执行 | 泛化为**宿主执行者**：任务包 yield/submit 循环 |
| core-steps | 流程级处理器 | **原子化为 minitool 注册表**（检索/绑定/校验/组装/渲染） |
| 对标作品/方案册/批注集 | 散件 | **知识化**：首批 KB 条目的原料（v1 库见 M2） |
| flow-store | 出厂底稿 + 导入 override | 出厂件降级样例；`flow_import` 一等入口；新增拆解协议 skill |
| 宿主进程 | Electron Main 承载一切 | 独立 Node CLI（`miniflow` bin），headless-first |
| 数据落点 | `<userData>` | 工作区目录注入（等价 `SM_USER_DATA`），宿主无关 |

### 5.3 舍弃

Electron 壳全部、renderer 全部、`window.srd` 桥、SrdApi 契约、dockview 等 UI 依赖；market 只留注册表与索引机制。

### 5.4 新增

- **任务包协议**（task package：指令 + 知识条目引用 + 上下文产物引用 + 输出契约 + 断言点）——harness 核心新契约。
- **知识库契约与库**（KnowledgeEntry schema + `knowledge/` 库 + 索引）。
  - **审美体系标准 v1**（16 条：12 维度 + 总纲 + 路线 + 监管 + 红队标准）+ 49 条硬断言表；
  - **市场数据飞轮**：`src/kakaxing-Json`（7938 部在售短剧快照，日更）→ `tools/distill-kakaxing.mjs`（确定性蒸馏，零 LLM）→ `kb/market`（结构/网感公式/约束基线）+ `kb/trope`（13 梗族含饱和度与演化链）+ `kb/benchmark`（28 对标件）——**实时性 与 找梗能力的数据底座**；
- **minitool 注册表**（`kb_search` / `kb_load` / `check_aesthetic_asserts` / `check_contract_compliance` / `check_trope_combo` / `distill_kakaxing` / `render_html`）。
- **选题技能层 v2**（`skills/`）：找梗师 / 网感师 / 剧情编排师 + 剧情红队 + v3 移植五件。
- `flow_next` / `flow_submit` / `flow_resume` / `kb_list` / `kb_read` 工具（见 §六）。
- 拆解协议 skill（会话六轮迭代经验固化为"需求 → flow@1"的装配手册）。
- **workflow v2 参照实现**（`flows/topic-selection/`）：找梗→热点→分析（实盘约束）→双路线方案（编排三表+八段式策划案）→红队对抗→人工验收→交付页；产物格式规范见同目录 OUTPUT-FORMAT.md。

---

## 六、工具面（被 dsh/codex/zcode/workbuddy 安装调用）

安装 = 宿主 MCP 配置里注册一条 stdio 命令（`miniflow mcp`；开发态 `node bin/miniflow.js mcp`）。协议沿用 v3：newline-delimited JSON-RPC 2.0，`initialize → tools/list → tools/call`，结果统一 `result.content[0].text`。

| 工具 | 说明 |
| --- | --- |
| `toolkit_list` | 能力清单：步型/minitool/skill/模板/样例 flow/输出契约 |
| `kb_list` / `kb_read` | 知识库索引与条目读取（拆解的检索面） |
| `flow_synthesize`（可选辅助） | 按内置协议把需求文本映射为 flow@1 草稿建议（认知仍由宿主执行） |
| `flow_import` | 导入/更新 flow@1（Zod 整单校验 + **KB 引用存在性校验**） |
| `flow_run` / `flow_resume` | 开跑/接续；返回首个任务包或挂起态 |
| `flow_next` | 取当前任务包（宿主重启后的重入点） |
| `flow_submit` | 回交任务包产出；校验、落盘、推进，返回下一任务包或终态 |
| `flow_status` / `flow_runs` | 状态与历史（awaiting_input / suspended 显式标注） |
| `flow_artifacts` / `flow_read_artifact` | 产物注册表与读取 |
| `flow_approve` | 验收门裁决（默认人工，逐 flow 显式放开） |
| `minitool_*` | 原子操作直接暴露（`kb_search` / `render_fragment` / `check_trope_combo`…），flow 内外皆可调 |
| `assets_diag` | 资产体检（登记制排障） |

宿主侧的最小驱动循环：

```text
toolkit_list / kb_list →（按拆解协议组装 flow@1，拆到知识对象粒度）→ flow_import → flow_run
→ 循环 { flow_next 拿任务包 → 用自己的 token 执行 → flow_submit }
→ completed → flow_artifacts → 交付报告包 + HTML 交付页
```

---

## 七、目标架构（`D:\storymasterv4`）

```text
packages/contracts    Zod 契约：envelope / flow@1 / smwf@2 / run / task-package /
                      knowledge-entry / artifact / journal
packages/runtime      durable execution：调度器、状态机（running/awaiting_input/suspended/completed）、
                      journal、验收门、产物注册表、校验管线
packages/toolkit      能力三层：
                      skills/       方法论层（自 v3 assets/skills 移植 + 拆解协议）
                      knowledge/    知识库（typed entries + 索引 + 拆解入库飞轮）
                      minitools/    原子操作注册表（deconstruct/check/render/kb）
                      composing     任务包组装器：minitool(skill, kb条目) → 任务包
apps/cli              miniflow bin：mcp（stdio server，纯转译）/ serve（本地常驻，可选）
assets/               自 v3 移植：样例 flow、delivery 模板、prompts、profiles
docs/                 本蓝图 + 移植工单（沿用 WO 纪律）
```

技术栈沿用 v3：TypeScript + Zod + pnpm workspace + vitest，Node ≥ 22.19，不引第三方 workflow SDK。

---

## 八、实施路线

| 批次 | 内容 | 验收口径 |
| --- | --- | --- |
| **M0 底座抽包** | contracts/runtime/toolkit 从 v3 移植成独立包；状态机加 awaiting_input；**task-package 与 knowledge-entry 契约定型** | 纯 Node 进程跑通样例 flow 的 core/minitool 段；state.json / events.jsonl / artifacts.json 语义与 v3 一致 |
| **M1 Harness 工具面** | `miniflow mcp` stdio server；flow_run/next/submit/resume 循环闭环 | 用 zcode（或 codex）当宿主，真实驱动一条样例 flow：任务包由宿主模型执行、submit 校验推进、跨进程 resume 成功 |
| **M2 三层能力** | 拆解协议 skill；**知识库 v1**（自 v3 散件 + 会话产物沉淀首批条目：对标件、桥段类型学、原型卡）；minitool 注册表（deconstruct_character / deconstruct_trope / check_trope_combo） | 给一段自然语言需求，宿主合成出**含原子拆解步**（精确到某人物/某桥段）的合法 flow@1 并跑通；KB 引用校验生效 |
| **M3 交付与实时** | render-html 模板注册表 + web-search 步型 + 拆解入库飞轮 | flow outputs 含交付 HTML；zeitgeist 热点可注入；run 拆解件可晋升 KB 条目 |
| **M4 参照场景验收** | 复刻会话全链路：素材+对标+热点 → 分析报告 + 合理/爽双版本 + A/B 基线 + 硬断言 + 移动交付页 | 产物结构与 `deliver/topic-selection/run2-20260914/` 对齐；含"拆某个人物 / 拆某个桥段"原子步的独立验收演示；全程只用宿主 token |

## 九、移植纪律（继承 v3）

1. **移植不重写**：运行时语义（断点续跑、原子写、图推演恢复）已验证，只解耦搬运；状态机扩展向后兼容既有 state.json。
2. **harness 不越界**：v2 关键路径零模型调用；BYOK 直连是未来可选后端，不混进当前验收。
3. **三层不拆开用**：新能力入 toolkit 必须三层齐备（skill + KB 条目 + minitool 绑定），禁止只丢一个 md 进 skills 就算交付。
4. **旁路写入反模式**：一切产物/资产走注册表登记；各端走命令域，不直接摸文件。
5. **裁决权默认人工**：`allow_agent_verdict` 逐 flow 显式放开，拦截在命令层单点。
6. **flow@1 用户可读是硬约束**：知识条目正文同样人可读；宿主先 `flow_read` 拿样例当模板。
7. **单一事实源**：契约先行，命令域 union 检查（v3 `tools/check-command-union.mjs` 移植做 CI 纪律）。

---

## 附：v3 关键文件索引

- 契约：`packages/contracts/src/{flow,flow-run,artifact,agent-profile,journal,assets,asset-registry,envelope}.ts`
- 运行时：`apps/desktop/src/main/services/{pipeline-graph-scheduler,pipeline-runner,step-executor,run-state-store,run-event-log,run-gate,artifact-registry-store,flow-store,skill-steps,core-steps}.ts`
- MCP 模式：`apps/desktop/src/main/mcp/`
- 资产：`apps/desktop/assets/{skills,prompts,agent-profiles,flows,asset-index.json}`（skills = Skill 层直接来源）
- 知识库原料（散件待入库）：对标作品产物、方案册、`批注集.json`、`transform-playbook.json`
- HTML 交付原型：`apps/desktop/assets/flows/topic-selection/delivery-template.html` + `tools/build-topic-delivery.mjs`
- 会话参照产物：`deliver/topic-selection/run2-20260914/`（选题交付页.html = "界面即产物"实物样板）
