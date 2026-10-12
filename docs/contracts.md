# 契约层导读（contracts/）

> 31 份 JSON Schema + 2 份 OpenAPI 生成物。**所有跨进程数据结构必须有 schema**——这是本目录存在的唯一理由。
> 规格全文见 [`ARCHITECTURE.md`](ARCHITECTURE.md)。

## 硬规矩

1. **先出 schema，再写实现，再出 lint。** 没有 schema 的数据结构不允许跨进程传递。
2. **schema 是事实源。** 代码与 schema 不一致时以 schema 为准；本文档与代码不一致时以代码为准。
3. 契约代数为 `<name>@<N>`（flow@3 / module@1 / decision@1）。代数变更即破坏性变更，须走版本宣告。

## 索引

### 生产线与编排

| schema | 作用 |
| --- | --- |
| `flow.schema.json` | flow@3 生产线描述符 |
| `flow-overlay.schema.json` | 运行期覆盖（`effectiveFlow3`） |
| `flow-pack.schema.json` | 扩展包挂载声明 |
| `run-state.schema.json` | 运行状态 —— **流程身份的真源**（铁律 8） |

### 能力与任务

| schema | 作用 |
| --- | --- |
| `module.schema.json` | module@1 能力之家 |
| `task-package.schema.json` | 任务包：指令 + 技能标尺 + 产物契约 |
| `toolbox.schema.json` | 工具箱 |
| `minitool.schema.json` | minitool（内建步，如 `scan_quality`） |
| `capability-manifest.schema.json` | 能力清单 |

### 产物与证据

| schema | 作用 |
| --- | --- |
| `artifact.schema.json` | 产物 |
| `artifact-header.schema.json` | 产物头：来源 / 轮次 / 上游可溯源 |
| `module-report.schema.json` | 模块报告 |
| `metrics.schema.json` | 运行指标（`RunMetric.checks`） |
| `journal-event.schema.json` | 执行流水记账（agent 内核执行环台账，非叙事大事记） |
| `chronicle-event.schema.json` | 大事记（叙事 5W1H 多轨时间线）派生件 `世界书/chronicle.json`，见 W4.6 |
| `diagnostics.schema.json` | 诊断 |
| `assertion-preset.schema.json` | 断言预设（v5.0.0 已退役，仅存历史契约） |

### 选择面（R8）

| schema | 作用 |
| --- | --- |
| `decision.schema.json` | 决策 |
| `catalog-entry.schema.json` | 候选条目 |
| `beat-plan.schema.json` | 拍点计划 |
| `stage.schema.json` | 阶段 |

### 语料与检索

| schema | 作用 |
| --- | --- |
| `kit.schema.json` | kit 描述 |
| `skill-overlay.schema.json` | 技能覆盖 |

### 四相能力与项目索引（批次2 · R2.1 契约先行，2026-10-10 落地）

| schema | 作用 |
| --- | --- |
| `rule.schema.json` | `rule-card@1` 规则卡：knowledge/rules/*.md 的规则 DSL 信封（ARCHITECTURE §3.4）。必填信封 = 存量卡实际形状（零迁移）；`clauses` / `scanner_qids` / `format` 是批次2.4（写诊改三相打通）收敛字段，铺开前缺省合法。**语料不是闸**——severity 是评审优先级，不构成提交拦截 |
| `diagnosis-report.schema.json` | `diagnosis-report@1` 诊断报告：写/诊/改三相承载体，**人 / agent / 宿主三方可读**。`evidence[]`（程序判定，机读证据）与 `opinion{}`（模型观点，仅供参考）硬分离；建议必须 = 规则修复策略的反向表达（ARCHITECTURE §3.2 同源铁律）。与 `diagnostics.schema.json` 分工：那边记「机器检查没跑成」（旁路留痕），这边承载「跑成了的检查的结果」 |
| `repair-plan.schema.json` | `repair-plan@1` 修复改单：诊→改的承载（批次2.5 P3）。`rule_ref`（`kb/rules/<域>#<AE-id>`，须指卡上真实条款）+ `repair`（逐字取自卡内 `clauses[].repair`，同源铁律）+ `diff`（unified diff，产出后回填）+ `status` 生命周期（proposed→applied/rejected、applied→rolled_back，**推进归人**）。tier 值域 **S\|A 不含 B**——B 级绝不入单（ARCHITECTURE §3.3）；工具链只产 diff 绝不写正文，回滚走 snapshots。校验/记账面 = `tools/repair-apply.py`，执行件 = `mf_apply_repairs`（`core/src/agent.ts`），诊产物过门 = `tools/diagnosis-validate.py` |
| `deconstruct.schema.json` | `deconstruct-report@1` 拆书报告：拆（逆向）的承载（批次3a P5）。`sampling` 抽样策略与单元清单（**抽样优先，禁止全书记忆化冒充拆书**——报告只带引用位置与引文，quote 截断限长 200 字）+ `findings`（claim 归因 + evidence 样本内引文——**无引文的 claim 不许产出**（防编造）+ provenance 单元回溯 + candidate_card 草稿卡：rule-card@1 信封同构、id 走 `kb/deconstruct/`/`pj-rules/` 命名空间、条款 id 用 DC- 前缀标记「样本提取」出身）+ `status` draft→reviewed→landed（**findings 不等于规则，归因是人审后的落卡前置**——land 只收 reviewed，draft 拒绝）。采样/校验/落卡 = `tools/deconstruct.py`，归因件 = `mf_deconstruct`（`core/src/agent.ts`） |
| `project-index.schema.json` | `project-index@1` 项目文件体系索引：`role` 角色标注（human=人写 / generated=工具产物 / hybrid=生成后人手改）+ `hash`/`mtime` 失效策略基础（对比即知手改，generated 被手改须升 hybrid）。只落数据根，双根不合一 |

### 漫画视觉链路（工单 2026-10-11 A 批 · 契约先行，2026-10-11 落地）

kit 只提供知识 / 分镜提示词 / 描述 / 剧本并对接引擎，**不绘制、不再加工像素**；这七份契约就是这条链上「机器之间说得上话」的那层。

| schema | 作用 |
| --- | --- |
| `storyboard.schema.json` | `storyboard@1` 分镜表：agent 认知步的产物、job 的输入、人审的对象。承载体是 `分镜表.md` 内嵌 ```json 块（内核 `script` 壳只认最近 .md 上游产物，`core/src/minitools.ts:88-95`），取块规则写死在本契约。`bubbles[].text` 字数按画像 `in_model_text` 口径**只出证据**，不自动改稿 |
| `asset-design.schema.json` | `asset-design@1` 美术资产设计表：人设 / 背景 / 物品 / 细节图案**四类**设计意图件（`class` 决定 `design` 必填项）。**本件没有状态字段**——意图与产物状态分离，状态归台账 |
| `image-profile.schema.json` | `image-profile@1` 生图后端画像：模型与量化档 / 图模板选择 / 引擎档位表 / 能力位 / 护栏预算。普适接口面——加一种后端 = 加一份画像，不改代码；出厂画像必填项一律留 `<必填>` 占位（不把任何人的本机模型名写进仓库） |
| `image-job.schema.json` | `image-job@1` 出图任务包：**对接引擎的事实源**（成品提示词 + 参考图清单 + seed + 尺寸 + 逐任务指纹 + warnings/unresolved 分账）。写收据的件可替换（kit 提供参考驱动器，宿主可自己执行），事实源始终是这份包 |
| `image-receipt.schema.json` | `image-receipt@1` 单图出图收据：「这张图存在吗、是怎么来的」的唯一凭据。`ok / failed / skipped_idempotent / blocked_guardrail` 四态分开记账（「没出」与「出了但废」不许一锅炖）；读不到的数值留 `null`，**禁止填 0 冒充**。声明「已出 N 张」不带收据路径即违规（红线 5） |
| `asset-registry.schema.json` | `asset-registry@1` 产物管理台账：设计件 ↔ 任务 ↔ 产物文件 ↔ 收据 四方对账，由 `tools/img-assets.py` 确定性重建（不是手写件）。`stale_design`（改了设定没重出图）必须点名；**台账只记账不裁决**，好坏归人眼与 vision 复核 |
| `engine-capability.schema.json` | `engine-capability@1` 引擎能力探测收据：实测与声明**并排**记账 + 加速件签名命中（**识别 ≠ 启用**）。产出件 `tools/img-probe.py` 在 B 批，A 批先钉形状（`tools/__fixtures__/engine-capability-sample.json` 逐键对齐） |

### 协议面

| schema | 作用 |
| --- | --- |
| `page-payload.schema.json` | 页面载荷（宿主面板读） |
| `project-config.schema.json` | 项目配置 |
| `intent-graph.schema.json` | 意图图 |
| `agent-profile.schema.json` | agent 画像 |

### OpenAPI（生成物，勿手改）

| 文件 | 说明 |
| --- | --- |
| `http-openapi.json` | legacy 面（`/api/verbs/*`），冻结在 v1.2 |
| `http-openapi-v1.json` | **V1 面（`/api/v1/*`）**，由 `V1_ROUTES ⊕ VERBS` 自动生成 |

## 待补契约（对应 ARCHITECTURE.md §10）

暂无——批次3a P5 落地后，四相能力契约（rule / diagnosis-report / repair-plan / deconstruct / project-index）全部到位；漫画视觉链路七份（storyboard / asset-design / image-profile / image-job / image-receipt / asset-registry / engine-capability）A 批已出。**契约先行**：`engine-capability@1` 的产出件 `img-probe` 与 `img-drive` / `img-check` / `img-rerun` / `img-sheet` 属 B、C 批，实现后必须过同一份 schema。后续新增能力仍先出 schema 再写实现。
