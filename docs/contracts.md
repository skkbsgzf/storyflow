# 契约层导读（contracts/）

> 26 份 JSON Schema + 2 份 OpenAPI 生成物。**所有跨进程数据结构必须有 schema**——这是本目录存在的唯一理由。
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
| `journal-event.schema.json` | 事件记账 |
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

| 拟新增 schema | 批次 | 用途 |
| --- | --- | --- |
| `rule.schema.json` | 批次2 先行 | 规则 DSL（S/A/B 分级 + 证据字段 + 修复策略 + provenance） |
| `project-index.schema.json` | 批次2 随包 | 项目文件体系索引 |
| `diagnosis-report.schema.json` | 批次2 三相前置 | 诊断报告 —— **人 / agent / 宿主三方可读**，`evidence[]` 与 `opinion{}` 硬分离 |
| `deconstruct.schema.json` | 批次3 | 拆（逆向）产出：带 `provenance.refs` 的规则卡 |

**契约先行**：以上落地前不写对应实现。
