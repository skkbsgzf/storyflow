# contracts/ · miniflow 标准本体

JSON Schema（draft 2020-12）是全部插件与内核数据模型的**唯一权威定义**——「标准 = contracts/」，不绑定任何框架（决策日志 #7）。

## R6 现行（module-flow-v3 分支）

| Schema | 层 | 一句话 |
| --- | --- | --- |
| `module.schema.json` | **R6 核心契约** | `module@1` 工种工具箱：ops（capability/slot/also_fits/requires/adds）+ skeleton + caps |
| `flow.schema.json` | **R6 核心契约** | `flow@3` 模块序列：modules[]（id/module/link/caps/insert/iterate/vary）+ policy{link_default, adapt, budget} |
| `page-payload.schema.json` | **R6 冻结契约** | `page-payload@2` 工作台页注入数据五键：DATA / EFF / OVERLAY / OPTIMIZE / METRICS |
| `toolbox.schema.json` | **R6 冻结契约** | `toolbox@1` 能力标签 → 工具映射（渲染与选工具共用视图） |
| `artifact-header.schema.json` | **R6 重写** | artifact@1 头部：+module；-class/-round/-version；review 挂连接件（pass/reject 两值） |
| `capability-manifest.schema.json` | **口径统一 P0.2** | `capability-manifest@1` Agent 能力清单声明面：id/desc/kind/model_tier/knowledge/domain/parameters（KitOp 同位；execute 属运行时不在契约） |
| `beat-plan.schema.json` | **口径统一 P0.2** | `beat-plan@1` `submit_narrative_beat_plan` 工具入参（升格自 Pinax narrativeBeatPlanToolSchema，双侧零漂移后收单源；无 format 常量——顶层即工具入参） |
| `flow-overlay.schema.json` | R5 沿用 | 运行时编排改写；R6 patch kinds 收敛（+set-module / insert-tool），由 WO-01 实现对齐 |
| `metrics.schema.json` | R5 沿用 | 指标口径；R6 门相位改 links 相位 |
| `minitool.schema.json` / `task-package.schema.json` / `run-state.schema.json` / `artifact.schema.json` / `journal-event.schema.json` / `project-config.schema.json` / `agent-profile.schema.json` / `http-openapi.json` | 沿用 | 各自领域不变 |

## 已废弃（标 `deprecated: true`，仅供 WO-08 存量转换对照）

- `kit.schema.json` — 由 `module.schema.json`（module@1）取代
- `stage.schema.json` — 由模块化模型（连接件取代 Stage 验收门）取代

规格全文：`docs/规范-模块化flow与工具箱-R6.md`（现行，含 §十一 勘误）；历史：`docs/底座规格-miniflow-harness.md`、R4/R5 规范。

**使用方式**：TS 内核由 schema 生成/校验类型；Python 侧 `jsonschema` 直读校验；`tools/*-lint.py` 是契约在静态门的手工等价物。变更契约 = 立 WO 改本目录（冻结纪律见 WO-00）。全局产品版本治理：根 `VERSION` + `CHANGELOG.md`（v4.0.0 起，见 `docs/版本宣告-v4.0.0.md`）；契约 `@N` 与产品 semver 是两个轴。
