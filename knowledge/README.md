# miniflow 知识库（Knowledge Layer）

> 能力三层模型（见 `docs/miniflow-产品梳理与移植蓝图.md` §三）中的**知识层**：回答"用什么"。
> 本库是**数据先行**的原始搭建——M0 之后由 `packages/toolkit` 装载，通过 minitool 按 ID 取件注入任务包。

## 条目格式

一个条目 = 一个 md 文件，JSON frontmatter + 人可读正文（沿袭 flow@1 的"用户可读是硬约束"）：

```markdown
---
{
  "id": "kb/aesthetic/hook-3s",          // 全库唯一：kb/<type>/<slug>
  "type": "aesthetic-standard",           // 类型，见下表
  "title": "开场钩子标准",
  "dimension": "hook",                    // 维度（aesthetic 类型内使用）
  "version": "1.0.0",
  "status": "active",                     // active | draft | retired
  "applies_to": ["short-drama"],          // 适用形态
  "routes": ["all"],                      // hot(爽版) | calm(合理版) | all
  // v5.0：卡头不再有 "asserts" 字段（声明式断言协议下架，提交链只跑确定性完整性检查）。
  // 可数条款 → quality-scan 扫描器（T 轨，出收据）；不可数条款 → knowledge/rules/ 规则卡（agent 激活）。
  "provenance": {
    "source": "factory",                  // factory | run | import
    "refs": [ "storymaster-v3:assets/skills/hook-3s-formula.md",
              "ref:screenwriting-skills/sw-dialogue" ]
  },
  "updated": "2026-09-14"
}
---
（正文：标准条款，每条带判定级别 block / major / minor）
```

## 板块 track（批次3c R2 · 人工职能维度）

每张卡 frontmatter 带一个 `track` 字段（additive，中文值），回答「这张卡归哪个人工职能管」：

```json
{
  "id": "kb/aesthetic/hook-3s",
  "track": "编剧",
  "...": "其余信封字段不变"
}
```

| track | 收什么 | 映射口径（存量 120 卡定案，`scripts/r2-add-track.py` 为映射与红线审计的留档件） |
| --- | --- | --- |
| `文风` | 词句层：AI 味/去模板化/比喻/感官/风格档/成文约束/文风学习/词句校准 | `aesthetic/{ai-detection-sources,ai-trace,metaphor-zh,naturalness-zh,sensory-detail,slop-list,style-routes}`、`craft/{prose-constraints,user-style-rules}`、`deconstruct/*-draft` 与 `style-learning`、`rules/ai-trace`、`semif-calibration/` 五卷 |
| `编剧` | 故事设计：人物/冲突/对白/钩子/节奏/反转/场景/结局/可视化/结构母型 | `aesthetic/{character,conflict-escalation,dialogue,ending,hook-3s,pacing-density,reversal,scene-value,unreasonable-highlight,visual-poster}`、`rules/{character,conflict,dialogue,ending,hook,pacing,reversal,scene,visual}`、`structure/` 全部 |
| `选材` | 题材/市场/对标/梗族/设定/平台合规 | `market/` 全部、`benchmark/` 全部、`trope/` 全部、`rules/{meme,platform,setting}`、`aesthetic/platform-compliance` |
| `情绪` | 情绪曲线族 | `aesthetic/emotion-curve`、`rules/curve` |
| `连续性` | 长程台账/世界书 | `continuity/` 全部、`rules/continuity` |
| `立意` | **本批空白（Q3 确认无卡）**——缺口入 R3 补缺清单写题目；立意组建卡前该值不得出现 | — |
| `通用` | 横切流程/总纲/监管/评审协议/形态标准/工程方法/拆书协议 | `aesthetic/{constitution,oversight,perspective-review,redline-scoring}`、`craft/{convolution-waves,highlight-loop,section-pipeline}`、`deconstruct/protocol`、`formats/` 全部、`method/` 全部、`rules/deconstruct` |

纪律：track 是**人工维度**，逐卡亲读裁定、正文零改写（只加 frontmatter 行）；新增卡入库时人工填
track，不契合任何板块给 `通用`。与 track 并行的**算法维度**是编译期聚类（`tools/kit-compile.py`
簇标签进产物 `entries[].cluster` + `stats.clusters`，不回写卡）——双层组织：track 回答「人怎么分」，
cluster 回答「语料怎么聚」。检索消费见 `kb_search` 两段式聚簇检索；视图见
`python tools/kb-health.py --by track|cluster`。

## 类型分类（当前定义）

| type | 目录 | 回答什么 | 状态 |
| --- | --- | --- | --- |
| `aesthetic-standard` | `aesthetic/` | 什么叫好——判定维度、阈值、硬断言 | **v1 已建**（含红队评分、提案标准与结构级去机味） |
| `style-route` | `aesthetic/`（routes 条目） | 风格路线参数档位 | **v1 已建** |
| `market-snapshot` | `market/snapshot.json` | 市场数据快照（机器可读，题材×热度矩阵/约束分布/热度分位） | **已建，日更** |
| `market-standard` | `market/` | 市场结构与网感公式（标题/卖点/共情点句式）、生产约束基线 | **v1 已建** |
| `deconstruct-protocol` | `deconstruct/` | 拆解层协议——怎么把参考作品拆成可入库素材（六槽位/溯源纪律/文风学习） | **v1 已建** |
| `continuity-standard` | `continuity/` | 长程连续性与状态台账（谁死了/谁拿了什么/谁知道什么） | **v1 已建** |
| `format-standard` | `formats/` | 形态标准（长篇网文：章末钩子/批量生成/平台语境） | **v1 已建** |
| `trope` | `trope/` | 梗条目：机制 + 饱和度 + 演化链 + 变体样本 | **v1 已建（13 族，generated）** |
| `benchmark` | `benchmark/` | 对标件（强度标尺：热度/评级/约束/对标用法） | **v1 已建（28 件，generated）** |
| `beat-sheet` | `beat/`（待建） | 节拍表 / 结构模板 | 待后续 |

## 数据飞轮（generated 条目的日更机制）

```text
咔咔猩平台（工作日 10:00 上新）
  → src/kakaxing-Json/update.cmd（增量抓取快照）
  → node tools/distill-kakaxing.mjs（确定性蒸馏，零 LLM）
      ├─ knowledge/market/snapshot.json（题材×热度矩阵、约束分布、热度分位）
      ├─ knowledge/trope/*.md（13 梗族：饱和度判定 + 演化链 + 变体样本）
      ├─ knowledge/benchmark/*.md（28 对标件：CN/NA/家族冠军/S 级）
      └─ knowledge/index.json（全库索引重建）
```

generated 目录（`trope/`、`benchmark/`）每次蒸馏**整体重建**，不要手改——手改内容会被下次运行覆盖；要沉淀人工结论，新建条目或写进 `market/` 手写层。`provenance.refs` 带 `dataset:kakaxing/scriptrawstone@<日期>`，引用条目时注明快照日期。

## 治理纪律

1. **三层不拆开用**（移植纪律 §九.3）：知识条目入库时必须同时指明可绑定的 skill（方法论）与 minitool（检索/校验操作）；只丢一个 md 进库不算交付。
2. **引用不拷贝**：flow 节点与任务包只引用 `kb/...` ID；条目可版本化，任务包装配时由 minitool 取件注入。
3. **拆解入库飞轮**：run 产物中的拆解件（人物拆解件/桥段拆解件/对标拆解件）经确认后晋升为条目，`provenance.source = "run"` 并记录来源 run。
4. **人可读硬约束**：正文保持创作者可读可议；机器可判定的阈值落进扫描器（`tools/quality-scan.py`，T 轨 id 见 `tools/rules-init.py::TRACK_T`），不可判定的写成规则卡条款（`knowledge/rules/`）。正文与扫描器口径不一致时，以扫描器实现为准并回改正文。v5.0：原「一律登记进 assertions.json」的台账纪律随断言协议退役。
5. **provenance 必填**：每条必须有出处（出厂件 / 某次 run / 外部 import），无出处的条目不得标记 active。

## Skill 层（`skills/`，与知识库同仓库原始搭建）

知识条目的绑定 skill 落在仓库根 `skills/`：

| skill | 职责 | 绑定知识 |
| --- | --- | --- |
| `find-trope`（找梗师） | 查族→饱和度判定→主辅梗选型→演化链找新变体 | `kb/trope/*` `kb/market/*` |
| `internet-feel`（网感师） | 标题/卖点/共情点公式产出 + 24 类自检 | `kb/market/internet-feel` |
| `plot-choreographer`（剧情编排师） | 三线骨架×分集功能表×卡点表×场景复用表 | `kb/market/constraints` `kb/aesthetic/*` |
| `plot-redline`（剧情红队，父会话建） | 对抗式打分、死点挖掘、不合理亮点提案 | `kb/aesthetic/redline-scoring` `unreasonable-highlight` |
| v3 移植五件 | `topic-zeitgeist` / `topic-analysis-report` / `topic-proposal` / `topic-chief-aesthetic` / `topic-delivery-gate` | 选题链路既有标准 |

工作流装配见 `flows/topic-selection/flow.json`（v2）与 `flows/topic-selection/OUTPUT-FORMAT.md`（产物格式契约）。

## v1 来源与融合决策（审美体系）

| 来源 | 取什么 | 落到哪 |
| --- | --- | --- |
| **StoryMaster v3 + 会话 sess_aa829e9e**（自有底料） | 审美总编四条把控、钩子四型与判分、情绪曲线六型、结构节奏四查、反转类型学、平台卡点四查、双专家监管+约束对账、爽版/合理版风格档、短剧节拍硬格式、"爆点密度 63 vs 40"实证 | `constitution` `hook-3s` `pacing-density` `emotion-curve` `reversal` `platform-compliance` `style-routes` `oversight` `visual-poster` |
| **jtydhr88/screenwriting-skills**（26 技能 / 47 本书） | 麦基：人物真相=压力下的选择、维=矛盾、主角最多维（太阳系设计）、对白=行动+三层同心球+盖名测试；埃格里：三维人物、对立统一；韩法大师班：类型=对观众的承诺、"故事=危机加深×欲望加强"、写情绪不写哭、台词最后写 | `character` `conflict-escalation` `dialogue` `ending`（部分） |
| **write-chinese-long-screenplay / Narrative Harness** | 因果-价值内核（入场/出场价值、结果落差、下场压力）、便宜方案检查、对白八缺陷、24 类中文去模板化、代价梯、集功能与集末钩子优先级、结局反推五条件、severity 三级与分层自审顺序、连续性台账思想 | `scene-value` `conflict-escalation` `dialogue` `naturalness-zh` `ending` `constitution`（severity 与判定流程） |
| **E-Asrar-Haghighi/ai-screenplay-writer** | 质量门重试语义（validator 不过→重写而非带病放行）、首集宽检 vs 续集严检、World Bible 作上下文、summary memory 长程连续性 | `constitution`（首集宽容条款、判定-重写闭环） |

## v2 来源与融合决策（拆解层 / 连续性 / 网文形态补充）

| 来源 | 取什么 | 落到哪 |
| --- | --- | --- |
| **swjybky/deepwrite**（v3 前身，学习仿写与拆书提示词） | 拆书六槽位（梗/人设/剧情设计/导语/细化/片段）、设计层×细化层双层拆解、可迁移公式+替换变量、溯源三态纪律（可追溯/事实推断区分/样本不足不归纳/禁长段复制）、文风学习"情绪决定笔墨密度"可执行规则与笔墨密度速查表、收束四型 | `kb/deconstruct/protocol` `kb/deconstruct/style-learning` |
| **小红书帖：6 个写小说 skill 横评**（xhslink.cn/o/3bRWmAttfTo） | InkOS"出草稿→过审计→按需修订→状态结算"四步与原子提交；webnovel-writer"一章=一份合同"事实台账（谁死了/谁拿了什么/谁知道什么秘密）；sepia 引用的结构级 AI 检测实证（分类器只看叙事结构 93.2%，词句层改进无效）→"加规则治崩、减规则治假"二元论；chinese-novelist-skill 三层问答开书+章末钩子强制；awesome-novel-agent 题材画像 | `kb/continuity/state-ledger` `kb/aesthetic/ai-trace` `kb/formats/webnovel-longform` |
| **星月写作（小红书，官方帖标题层）** | 降 AI 率路线（朱雀类检测为结构级，词句规避无效→与 sepia 结论互证）；短篇商业化语境（番茄平台、保底与稿费节奏、模型选型）；提示词正文在图片层未抓取，后续人工补 | `kb/aesthetic/ai-trace` `kb/formats/webnovel-longform`（平台语境条款） |
| **EthanYoQ/AI-Novel-Writer** | GitHub 连接不稳，多轮重试未完成克隆——**待补**。补齐后按本表格式登记增量 | （待定） |

未吸收部分（记录避免重复劳动）：sw-* 的独立技能包形态（其方法论由我们的 skill 层后续择要移植，不进知识库）；wcls 的 Python harness 实现（我们有自研运行时，只取其状态台账思想）；asw 的 LangGraph 编排（同左）；deepwrite 的桌面工作台（我们走 headless harness 形态，只取其提示词方法论）；InkOS/webnovel-writer 等帖中 skill 的具体实现（只取审计维度与台账口径，实现走我们自己的 runtime）。

## 参考仓库

参考仓库浅克隆在 `.refs/`（git 忽略），仅作溯源阅读，不参与构建：`screenwriting-skills`（26 编剧技能）、`write-chinese-long-screenplay`（Narrative Harness）、`ai-screenplay-writer`、`deepwrite`（v3 前身，拆书/仿写提示词源）；`AI-Novel-Writer` 因网络问题待补克隆。帖子类来源（小红书）正文无法稳定抓取的，已在来源表中标注"待人工补"。
