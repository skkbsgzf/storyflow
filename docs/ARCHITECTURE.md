# StoryFlow 内核架构规格

> **本文是自研 core 内核的规格唯一入口。** 取代此前散落在 `docs/` 下的规范系列（已归档 `docs/_archive/`，见 §7）。
> 事实源优先级：`contracts/*.schema.json` > 本文档 > `README.md` > 归档历史。
> 本文档与代码不一致时，以代码与 schema 为准，并回头修本文。

---

## 0 · 一句话定义

StoryFlow 是一个**「故事 kit 提供者」的运行时**：
agent runtime（pi-agent-core）+ 模块化 flow + MCP + 确定性工具链 + 可插拔语料。

**它不做什么**（这是立场，不是缺口）：

| 不做 | 谁做 |
| --- | --- |
| 审核 / 打回 / 红队 / 合规裁决 | 宿主（接入协议见 `docs/PROTOCOL-REVIEW.md`） |
| 前端 UI / 页面 | 宿主。kit 只出三样：文档、自包含可视化 HTML、契约数据包（2026-10-10 决议：pi-web fork 演进线冻结，`panel/` 为存量；宿主适配活样板 = pinax-bridge） |
| 语料内容本身 | 用户（源 md 是本地资产，不入库） |

---

## 1 · 进程与端口

```
消费者（浏览器 / Electron / 移动端 / CLI）
    │  adapter/（REST + SSE，单 base URL + 单口令）
┌───▼──────────────────────────┐
│ storyharness  :8431            │
│  协议面 serve · 执行环 · 批调度 │
│  会话 JSONL · packs 挂载        │
│  ┌──────────────────────────┐  │
│  │ core  :8421              │  │
│  │  flow@3 编排 · 动词单表   │  │
│  │  overlay · kb 图检索     │  │
│  │  MCP 面                  │  │
│  └──────────────────────────┘  │
└───────┬──────────────────┬─────┘
        │ HTTP /api/verbs  │ 子进程
┌───────▼─────────┐  ┌──────▼────────┐
│ tools/ Python   │  │ 前端 = 宿主    │
│ lint/scan/...   │  │ /api/panel/* 410│
└─────────────────┘  └───────────────┘
```

- **core 是编排事实的唯一源**。flow@3 → `expandFlow3` → `effectiveFlow3 + overlay`。前端与 harness 都不重算编排。
- **同一 pi-agent-core 执行环**支撑两种驱动：交互对话回合 / 生产线节点执行。
- MCP 面与 HTTP 面**同表**（`core/src/verbs.ts`），不存在两套语义。

---

## 2 · 契约层（contracts/）

31 份 JSON Schema + 2 份 OpenAPI 生成物。**所有跨进程数据结构必须有 schema**。核心几张：

| schema | 作用 |
| --- | --- |
| `flow.schema.json` | flow@3 生产线描述 |
| `module.schema.json` | module@1 能力之家 |
| `run-state.schema.json` | 运行状态（流程身份真源，铁律 8） |
| `task-package.schema.json` | 任务包（指令 + 技能标尺 + 产物契约） |
| `artifact-header.schema.json` | 产物头（来源/轮次/上游可溯源） |
| `flow-overlay.schema.json` | 运行期覆盖 |
| `decision.schema.json` / `catalog-entry.schema.json` | 选择面（R8） |
| `journal-event.schema.json` | 事件记账 |

**新增能力的硬规矩**：先出 schema，再写实现，再出 lint。没有 schema 的数据结构不允许跨进程传递。全文导读见 `docs/contracts.md`。

---

## 3 · 四相能力模型

### 3.1 为什么是四相

「一个 tool 干一件事」导致规则写死在代码里、每个场景重写一遍。四相模型把**能力**和**知识**彻底分开：

```
                     ┌─────────────┐
                     │  规则（KB）  │  ← 唯一真源
                     └──────┬──────┘
        ┌───────────────────┼───────────────────┐
        ↓                   ↓                   ↓
   ┌─────────┐        ┌─────────┐        ┌─────────┐
   │  写     │        │  诊     │        │  拆     │
   │ 正向生成 │        │ 逆向体检 │        │ 逆向提取 │
   └─────────┘        └─────────┘        └─────────┘
        │                   ↓
        │              ┌─────────┐
        └─────────────→│  改     │
         诊的产物       │ 有据可依 │
                       └─────────┘
```

- **写**：从规则出发生成内容（现有四条生产线）
- **诊**：从规则出发检出偏差，**只出证据不裁决**
- **改**：与诊同源，改的就是诊断出的项
- **拆**：从样本反向提取规则，**回流 KB**

### 3.2 铁律：诊断与建议必须同源

诊断说「这句违反 `禁句式-排比`」，建议就必须是这条规则的反向表达，修改就是这条规则修复策略的自动应用。**三者共用一份规则定义**——结构上不可能矛盾。这不是优化，是架构约束：通用大模型的诊断与建议会不一致（它得"重新思考一遍"），storyflow 三相共用规则源。

### 3.3 规则分级（成本可控的关键）

| 级 | 定义 | 执行方式 | token | 例 |
| --- | --- | --- | --- | --- |
| **S** | 硬约束、可精确定义 | Python 确定性规则 | **零** | 错别字、禁词、标点、数值冲突 |
| **A** | 有明确模式、需上下文窗口 | KB 检索 + 本地学生头（laya） | 零（本地算力） | 句式指纹、结构指纹、人物口吻 |
| **B** | 主观审美 | agent 评审通道（**不进诊断服务**，2026-10-10 决议） | 视调用 | 爽感、爆点、节奏 |

**S 级是地基**：零成本零延迟，可默认常开。B 级永远走「证据 + 建议」双通道，绝不自动改稿。三轨口径沿用 v5.0.0：**可数的归工具（T），不可数的归语料（C），没人读的删除（X）**。

### 3.4 规则 DSL（单一真源）

规则散落在「`knowledge/rules/*.md` 卡」+「扫描器条款（qid）」两处。收敛为一份定义、两个视图：

```
rule_id / tier(S|A|B) / scope / 检测目标
/ 判定逻辑 / 证据字段 / 严重度 / 修复策略 / provenance.refs
```

- **诊断视图**：命中什么 + 证据（位置、上下文、数值）
- **建议视图**：应该怎么改 + 理由（修复策略的反向表达）
- **修改视图**：自动应用（必须宿主确认，走 tool 链，可回滚）

现状（R2.4 已收敛 2026-10-10）：16 张域卡（`tools/rules-init.py` 生成，AE-id 可溯，README 索引页除外）frontmatter 已铺 `rule-card@1` 收敛字段——`clauses[]`（条款结构化升格，正文零改写）+ `scanner_qids[]`（卡 ↔ laya 学生头 qid 对账：curve/dialogue/scene/reversal/ai-trace 五卡有真实对应，其余空数组记账）；卡驱动诊断动词 `mf_analyze_card`（`core/src/agent.ts`，`mf_analyze_curve` 转薄别名）按卡组装诊断 prompt、输出对齐 diagnosis-report@1。`contracts/rule.schema.json` 是收敛字段的契约面。

改相（批次2.5 P3 已落地 2026-10-10）：`contracts/repair-plan.schema.json`（repair-plan@1 改单契约——tier 值域 **S|A 不含 B**＝B 级绝不入单；status 生命周期 proposed→applied/rejected、applied→rolled_back，推进归宿主/人；diff 只回填不应用）+ 执行件 `mf_apply_repairs`（`core/src/agent.ts`，按改单条款回卡取 `clauses[].repair` 原文产 unified diff，**绝不写盘**——写盘归宿主 batch-edit，人裁；B 级进单 INVALID_INPUT）+ 记账面 `tools/repair-apply.py`（validate/dry-run（含盘上卡同源核账）/status 推进落收据，**不做 diff 应用**）。诊产物过门：`tools/diagnosis-validate.py`（diagnosis-report@1 契约等价校验；`--map` 出 quality-scan 收据→诊断报告字段映射表——quality-scan 输出格式不动，validations[].status 转 items[].severity 归 agent 裁决，机器只出证据）。qid 反向对账边界：S 级引擎条款有稳定 AE-id（T 轨台账＋`tools/lintlib.py` 已核账），但双轨设计下扫描器条款与卡条款刻意不同 id，逐条机械映射不存在——不硬造，细则 id 体系随批次3 快诊断服务化补立。

### 3.5 拆（逆向能力）

**定义**：拆 = 从既有样本反向提取规则，回流 KB，供写/诊/改复用。「凡可被写的，都可被拆」。

```
样本 → ① 采样策略（抽样优先，不求全覆盖）→ 结构化抽取（事实层）
     → ② 归因（从「有什么」到「为什么有效」）
     → ③ 规则卡（带 provenance.refs）→ 沉淀 KB → 复用
```

**统一形态**：拆与诊是同一台机器的两个方向——诊输入文本、规则来自 KB；拆输入文本、**产出**规则卡。**成本纪律**：抽样优先，先小样本验证规则假设再扩大采样；禁止「全书记忆化」冒充拆书（那是 RAG，不是拆）。拆的产物与写的产物**同构**（带 provenance 的规则卡）。

现状（批次3a P5 已落地 2026-10-10）：`contracts/deconstruct.schema.json`（deconstruct-report@1 拆书报告——source 样本标识 / sampling 抽样策略与单元清单（含 --expand 痕迹）/ findings（claim 归因 + evidence 样本内引文 + provenance 单元回溯 + candidate_card 草稿卡内嵌）/ status 生命周期 draft→reviewed→landed——**findings 不等于规则，归因是人审后的落卡前置**）；确定性件 `tools/deconstruct.py`（sample 三切分采样器：默认头/中/尾小样本、--expand 等距扩采、章节/场景/字数三模式、清单只带单元元数据绝不搬运正文；report 契约手工等价校验+摘要；land 回流通道：draft 拒绝、rule-card@1 信封自检、同 id 卡已存在拒绝覆盖，全局落 `knowledge/deconstruct/<域>-<来源slug>.md`、项目落 `projects/<id>/规则/`）；归因件 `mf_deconstruct`（`core/src/agent.ts`，与 mf_analyze_card 同模式的 agent 工具环局部件，**动词单表未动**——输入单元数超上限显式拒绝、每条 claim 必须带样本内引文否则拒绝（防编造）、只产 status=draft 草稿绝不落卡）。落卡是 rule-card@1 信封形状但**不走 kb/rules 家法**：id 用 `kb/deconstruct/`（项目落点 `pj-rules/`）命名空间，clauses[].rule_id 用 DC- 前缀标记「样本提取」出身（与台账迁移的 AE-id 区分，防搬运别卡条款 id），kit-lint E12 不扫 knowledge/deconstruct/（落卡自检归 land）。

---

## 4 · 四条生产线（flows/）

| 生产线 | 用途 | 代表产物 |
| --- | --- | --- |
| `screenplay` | 短剧剧本 | 剧本.md |
| `novel` | 长篇小说（章节卷积成稿） | 终稿.md |
| `prose` | 成文（被 novel 引用） | 章节正文 |
| `topic` | 短剧成稿（调研→结构→小纲→成稿→交付页） | 选题/成稿 |

每条线：输入在开跑前**显式表态**（enum 无默认值——选择必须有事实）；产物自带 artifact 头。

---

## 5 · 四扩展点（全部声明式）

| 扩展点 | 声明位置 | 消费者 |
| --- | --- | --- |
| 生产线 | `flows/<用途>/flow.json` | core 展开器 |
| 能力/技能 | `modules/<模块>/module.json` 的 ops | 任务包装载 + skill→tool |
| 语料 | `knowledge/**/*.md` → 编译进 `kit/hypergraph.rag.json` | kb 检索 + 判定标尺 |
| 扩展包 | `storyharness/packs/<包>/` + manifest（pages/apis/config） | serve 挂载表 |

**能力注册表现状**（2026-10-10 批1b 后）：8 模块 / **69 ops** / 40 skill / 66 caps。

---

## 6 · 执行模型（v5.0.0 基线：agent-only）

```
规则语料(knowledge/rules ← 语义规则 + 用户导入)
    │ orchestrator 参数化激活（R8：by + evidence + 未激活回显）
    ▼
agent 写作/评审（唯一语义裁决者）
    │ 评分证据 ← 确定性扫描器（收据制）
    ▼
端尾交付验收（gate_role:"kit-boundary"，人裁语义不变）
不达标 → reject 带证据 → 增补循环 → 2 轮仍不过 → blocked 问人
```

**核心原则**：submit 路径上不存在语义断言闸，**机器只出证据**。提交链只跑确定性完整性（存在性/空文/残渣/计数/artifact 头/词汇表）。**报数必附收据**——一切「已扫描/已校验」必须引用扫描器收据文件，禁止心算，无收据 = 删声明。

---

## 7 · 文档体系与迁移说明

### 7.1 新结构

```
docs/
  ARCHITECTURE.md      # ← 本文档，内核规格唯一入口
  Agent.md             # 宿主接入指南
  PROTOCOL-REVIEW.md   # 宿主审核/打回接入协议
  contracts.md         # 契约层导读
  ROADMAP.md           # 三批次路线图
  规划-*.md            # 专项规划（过程性，随批次推进归档）
  integration/         # CLI/HTTP/MCP/SSE 接入参考（随面同步，红线 11）
  _archive/            # 历史过程文档（只读，不删）
```

### 7.2 判定规则

- 描述「现在是什么」→ `ARCHITECTURE.md`（唯一）
- 描述「当初为什么」→ `docs/_archive/`（只读；遇「当初为什么这么定」，归档比空白有用）

### 7.3 被取代的历史文档

以下系列的**结论已并入本文对应章节**，原文在 `_archive/`：

| 历史文档 | 内容归属 |
| --- | --- |
| `版本宣告-v5.0.0.md` | §6 执行模型 |
| `底座规格-miniflow-harness.md` | §1 进程与端口、§2 契约层 |
| `规范-模块化flow与工具箱-R6.md` | §4 生产线、§5 扩展点 |
| `规范-规则语料与orchestrator激活-v6.md` | §3.3 规则分级、§3.4 规则 DSL |
| `规范-项目文件与流程配置-R4.md` | §3.5 拆（项目级文件体系部分） |
| `规范-开源部署与可调面-R7.md` | §7 文档体系、宿主边界 |
| `规范-FS抽象层-FS1.md` | §2 契约层 |
| 其余（R8/PP1/AP1/工单/交接回执/设计/调研） | 决策历史，按需回查 |

---

## 8 · 质量口径（2026-10-10 实测）

| 面 | 基线 |
| --- | --- |
| core 测试 | 433/434（唯一失败 `r8-os02cd` 脚本壳超时 = python stub 环境例，非代码回归） |
| storyharness 测试 | 148/148 |
| tsc | storyharness `--noEmit` 0 错 |
| 门禁 | verbs-doc（27 动词）+ openapi（19 路由）逐字节一致 |
| 三 lint | flow 0 err / module 0 err / kit 0 err |

**CI 必过项**：`tsc 0 错` + 全量测试 + 三 lint 0 error。任何「报数无收据」视为 lint error。

---

## 9 · 不变量（改动时必须守住）

1. **机器只出证据**，裁决权在 agent（人裁只在 kit 边界）
2. **报数必附收据**，无收据 = 删声明
3. **诊断/建议/改同源**，结构上不可能矛盾
4. **跨进程结构必须有 schema**
5. **本项目专名绝不进入其他项目**（跨项目专名是 lint error）
6. **HTML 输出只读数据、零运行时依赖、不得反向调用 kit**
7. **选择必须有事实**（R8：无证据不激活）
8. **序号缺口是历史事实**，禁止补拍洗白

---

## 10 · 待办（按三批次推进，见 `docs/ROADMAP.md`）

| 项 | 批次 | 落点 |
| --- | --- | --- |
| 规则 DSL 契约 | 批次2 R2.1（✅ 已落地 2026-10-10）＋ R2.4 收敛字段铺开（✅ 已落地 2026-10-10：16 张域卡 clauses/scanner_qids 逐卡核对，kit-lint W10 清零） | `contracts/rule.schema.json` |
| `project-index.json` 契约 | 批次2 R2.1（✅ 契约已落地 2026-10-10）＋ R2.2 实现（✅ 已落地 2026-10-10：`tools/project-index.py`） | `contracts/project-index.schema.json` |
| 项目索引生成器（路径探索→索引→增量→记忆→项目级 RAG） | 批次2 R2.2（✅ 已落地 2026-10-10：`tools/project-index.py` build/diff/memory ＋ `tools/kit-compile.py --project` ＋ core kb_search 双根合并检索） | `tools/project-index.py` |
| 诊断报告契约（三相承载体） | 批次2 R2.1（✅ 契约已落地 2026-10-10）＋ R2.4 实现（✅ 已落地 2026-10-10：`mf_analyze_card` 输出对齐 items 语义，诊断/建议同源由卡驱动结构保证） | `contracts/diagnosis-report.schema.json` |
| HTML 页面件补齐（时间轴整页/诊断报告页） | 批次2 R2.3（✅ 已落地 2026-10-10：`tools/journal-page.py` / `tools/diagnosis-page.py`） | `tools/worldbook*.py` / `journal-template.html` 扩展 |
| 能力归并（一次性工具 → 卡驱动诊断动词） | 批次2 R2.4（✅ 已落地 2026-10-10：`core/src/agent.ts` `mf_analyze_card`，`mf_analyze_curve` 转薄别名；agent 工具环局部工具族，动词单表未动） | `core/src/agent.ts` + verbs |
| 项目知识生产面（项目文风/规则目录＋卡模板、项目档编译纳入、校验标准声明位） | 批次2.5 P1（✅ 已落地 2026-10-10：`tools/project-init.py` 文风//规则/ 骨架＋rule-card@1 模板＋`--upgrade` 存量补目录；`tools/kit-compile.py --project` 纳入 文风/；`tools/project-index.py` 两目录标 human；`contracts/project-config.schema.json` 增 optional `validation`——声明位先行，消费随批次3） | `tools/project-init.py` + `tools/kit-compile.py` + `contracts/project-config.schema.json` |
| kb-rag 亲和 + 知识图谱自包含页 | 批次2.5 P2（✅ 已落地 2026-10-10：`core/src/kb.ts` 双根合并策略升级——去重/同分项目优先/k 分配（各根 top-k ⊕ 截回 k）＋kbRead `source` 溯源，口径见函数注释、`kb-project.test.ts` 12 例钉死；`tools/kb-affinity.py` 卡↔消费者对账收据（孤儿记账不失败、structural 悬空才 exit 1，kit-lint 门禁口径不动）；`tools/kb-graph-page.py`＋`kb-graph-template.html` 零依赖力导向图谱页（拖拽/平移/缩放/悬停/图例隔离/枢纽常显，--project 双根合并，零外部资源断言＋幂等）） | `core/src/kb.ts` + `tools/kb-affinity.py` + `tools/kb-graph-page.py` |
| 改相闭环 + 诊产物对齐 | 批次2.5 P3（✅ 已落地 2026-10-10：`contracts/repair-plan.schema.json` repair-plan@1 ＋ `mf_apply_repairs`（`core/src/agent.ts`，产 diff 不写盘、B 级拒绝、repair 同卡面强校验）＋ `tools/repair-apply.py`（validate/dry-run/status 记账，不做 diff 应用）＋ `tools/diagnosis-validate.py`（diagnosis-report@1 校验＋quality-scan 收据映射 --map）＋ qid 反向对账诚实边界（见 §3.4 改相段，不硬造随批次3）） | `contracts/repair-plan.schema.json` + `core/src/agent.ts` + `tools/repair-apply.py` + `tools/diagnosis-validate.py` |
| 收尾杂项（阶段动作清单/解释器可配置/干跑/防覆盖） | 批次2.5 P4（✅ 已落地 2026-10-10：`docs/integration/host-integration.md` §六 项目阶段动作五节点约定表；`core/src/minitools.ts` 脚本壳解释器可配置——`MINIFLOW_PYTHON`/`STORYFLOW_PYTHON` 覆盖、缺省回退 `python` 零破坏（python stub 环境例治本入口）；`tools/kit-compile.py --check` 干跑（双模式、零写盘）；`tools/rules-init.py` 防覆盖门（存量 rule-card@1 收敛字段默认拒绝，--force 才覆盖）） | `docs/integration/host-integration.md` + `core/src/minitools.ts` + `tools/kit-compile.py` + `tools/rules-init.py` |
| 拆（逆向）——契约+采样器+归因件+回流通道（四相收口） | 批次3a P5（✅ 已落地 2026-10-10：`contracts/deconstruct.schema.json` deconstruct-report@1 ＋ `tools/deconstruct.py`（sample/report/land，--selfcheck）＋ `mf_deconstruct`（`core/src/agent.ts`，agent 工具环局部件，动词单表未动）＋ `core/test/p5-deconstruct.test.ts`；归因走 LLM 打桩测试，采样/校验/落卡是确定性件） | `contracts/deconstruct.schema.json` + `tools/deconstruct.py` + `core/src/agent.ts` |
| 本地快诊断服务化（S 级 + laya 环境回填 + 静默追写） | 批次3a P6（✅ 已落地 2026-10-10：`diag_scan` 动词进 verbs 单表（28 动词三脸同源）＋ 逻辑本体 `core/src/diagnosis.ts`——S 级 aesthetic 引擎真身进程内直调（稳态 2–3ms，无 Python spawn 税）投影 diagnosis-report@1，`项目配置.validation` 三旋钮（tierThreshold/cardScope/severityFloor）在此变现；A 级 laya 适配并入动词调用路径，权重/venv 缺失显式 `LAYA_UNAVAILABLE` 带回填指引、绝不回落 4B/API——**A 级真跑通仍待用户侧权重回填**（`runs/laya-run-0923/student-v3` ＋ `tools/_vendor/laya-venv`），回填后即插即用；静默追写宿主协议 `docs/integration/silent-follow.md`；协议面未加端点——动词直通已覆盖） | `core/src/verbs.ts` + `core/src/diagnosis.ts` + `core/test/diag-scan.test.ts` + `docs/integration/silent-follow.md` |
| 图文视频能力（seedance 族） | 批次3（3a P7 ✅ 2026-10-10 核对：prose render-prompt-seedance 四件套齐全——op 声明/slot+caps/技能文件/visual-poster＋style-learning 双卡，无 flow 启用「视频提示词」cap＝「留库备用」本态） | 届时按声明式口径重建 |
| 存量 ops 过堂 + 杂项 | 批次3a P7（✅ 已落地 2026-10-10：三 lint 逐条 triage 全程 0 error——module-lint 39→34（W-SLOT-CLASH ×5 同槽链化，五 flow 展开序逐字节不变）、flow-lint 3→1（W-ENUM-DEAD ×2 接 feeds_decision:route 先验桥，topic 6.0.2/prose 0.3.1）、kit-lint 47→15（38 条「未用技能」系 checker 未展开 flow@3 的系统性误报，补内核规则1 轻量展开后剩 6 条真实账）；顺带修 topic 流 m4 dialogue-polish 早于 script-final 的展开序真 bug（also_fits 补首锚 after:script-final，「强制末环节」语义与展开一致）；scripts/ops 四启动器注入 MINIFLOW_PYTHON（.vbs 纯 ASCII，商店 stub 免疫）；能力删留零裁决——待拍板 15 条随批次3a 报告） | tools/module-lint.py + tools/flow-lint.py + tools/kit-lint.py + modules/* + flows/* + scripts/ops |
| 知识库体检（四账收据 + 语义 findings + 分级处置 A/B/C/D） | 批次3b Q1（✅ 已落地 2026-10-11：`tools/kb-health.py` 四账收据制只读体检——inventory 画像 / dups 查重候选 / edges 边审计 / coverage 覆盖矩阵，与 kb-affinity（卡↔消费者）互补管卡↔卡与卡↔标尺；报告 projects/_reports/kb-health-20261011.md。核心发现：语料本体健康、真重复 0；编译管线 kit-compile front() 不识 JSON frontmatter ＝ 产物 107/115 title 回落『---』、tags 全空、5998 边 5992 伪边、2 张 market 卡 id 错位（本档 §3.4 双轨语料面不受影响——kb.ts 已对『---』标题免疫，修复归 Q2 管线侧） | `tools/kb-health.py` + `projects/_reports/`（收据域不入库） |
| 知识库聚合拉边补缺（A 直改 / B 合并草案 / C 补缺草稿 / D 移交） | 批次3b Q2（✅ 已落地 2026-10-11：①A1 根因修复 `tools/kit-compile.py` `front()` 补 JSON frontmatter 解析（JSON 优先、YAML 裸键兜底向后兼容）＋重编译——产物 title 回落 107→0、tags 复活（19 张有值）、伪边 5992→0（真标题互涉为 0：卡间导航走 id 级互引 131→137 笔，mention 边非本库导航形态）、2 张 market 卡 id 归位；消费面回归全绿（kit-compile --check 稳定一致、core 474/475 已知环境例除外、storyharness 148/148、kb-graph-page --selfcheck、三 lint 0 error、门禁双 --check）；`core/src/kb.ts`『---』自保补丁评估保留（防旧版产物缓存，有测试钉）；②A2–A5：4 张 SemIf 报告 H1 补族名＋5 张补最小 frontmatter、2 张方法卡补信封（user-style-rules 手改区特例不动）、section-pipeline 补 updated、index.json note 补 semif 报告豁免；③B×4 合并草案、C×5 校准包 rule-card@1 草稿卡落 `knowledge/deconstruct/*-draft.md` 待审区（status=draft、DC- 条款 id、信封过 deconstruct land 自检；落卡机制见 §3.4 拆（逆向））＋C1/C2/C4/C5 认领对账与 pov-leak 落位草案；④D×5 移交 Q3。**语料正文零改写纪律全程保持**——rules/ 16 域卡零改写，正文改动一律走草案） | `tools/kit-compile.py` + `kit/hypergraph.rag.json` + `knowledge/`（本地层，md 不入库）+ `projects/_reports/`（草案/收据域不入库） |

**契约先行**：schema 落地前不写对应实现。
