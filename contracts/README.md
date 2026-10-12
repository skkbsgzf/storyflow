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
| `storyboard.schema.json` | **漫画视觉链路 A 批** | `storyboard@1` 分镜表：漫画/漫改的机读中间表示，承载体是 `分镜表.md` 内嵌 ```json 块（script 壳只认 .md 上游产物） |
| `asset-design.schema.json` | **漫画视觉链路 A 批** | `asset-design@1` 美术资产设计表：人设/背景/物品/细节图案四类**设计意图**件（类别决定 design 必填项；产物状态不在本件，归台账） |
| `asset-registry.schema.json` | **漫画视觉链路 A 批** | `asset-registry@1` 产物管理台账：设计件↔任务↔产物文件↔收据 四方对账，由 `tools/img-assets.py` 确定性重建，只记账不裁决 |
| `image-profile.schema.json` | **漫画视觉链路 A 批** | `image-profile@1` 生图后端画像：模型/量化档位/图模板选择/引擎档位表/能力位/护栏预算（普适接口——加后端=加画像文件，不改代码） |
| `image-job.schema.json` | **漫画视觉链路 A 批** | `image-job@1` 出图任务包（**对接引擎的事实源**）：成品提示词+参考图清单+seed+尺寸+指纹；驱动器可替换 |
| `image-receipt.schema.json` | **漫画视觉链路 A 批** | `image-receipt@1` 单图出图收据：ok/failed/skipped_idempotent/blocked_guardrail 四态分开记账；无收据=无声明 |
| `engine-capability.schema.json` | **漫画视觉链路 A 批** | `engine-capability@1` 引擎能力探测收据：实测 vs 声明 并排记账 + 加速件签名命中（识别≠启用） |
| `flow-overlay.schema.json` | R5 沿用 | 运行时编排改写；R6 patch kinds 收敛（+set-module / insert-tool），由 WO-01 实现对齐 |
| `metrics.schema.json` | R5 沿用 | 指标口径；R6 门相位改 links 相位 |
| `chronicle-event.schema.json` | **批次4 W4.6 大事记** | `chronicle@1` 叙事时间线聚合件：`世界书/时间线.md`（或 `编年/大事记.md`）人写真相源的**派生件**（立场同 `worldbook-history@1`——工具独占写、重建即覆盖、源 md 永不被改写）。5W1H + 章 refs + Δ + lane 归属；`when.via` 三值枚举、`approx`/`uncoveredPeople` 只记账不裁决（「kit 只给形，不猜你的内容」）。契约刻意不用 `$ref/anyOf/oneOf/$defs`，好让 `tools/jsonschema_lite.py` 拿同一份 schema 校验产出 |
| `minitool.schema.json` / `task-package.schema.json` / `run-state.schema.json` / `artifact.schema.json` / `journal-event.schema.json` / `project-config.schema.json` / `agent-profile.schema.json` / `http-openapi.json` | 沿用 | 各自领域不变。注：`journal-event@1` 是**执行流水**（kernel run/advance/submit…16 个事件枚举），与 `chronicle@1` 的叙事大事记两套账，看板分列不混排 |

## 已废弃（标 `deprecated: true`，仅供 WO-08 存量转换对照）

- `kit.schema.json` — 由 `module.schema.json`（module@1）取代
- `stage.schema.json` — 由模块化模型（连接件取代 Stage 验收门）取代

规格全文：`docs/_archive/规范-模块化flow与工具箱-R6.md`（现行，含 §十一 勘误）；历史：`docs/_archive/底座规格-miniflow-harness.md`、R4/R5 规范。

**使用方式**：TS 内核由 schema 生成/校验类型；Python 侧 `jsonschema` 直读校验；`tools/*-lint.py` 是契约在静态门的手工等价物。变更契约 = 立 WO 改本目录（冻结纪律见 WO-00）。全局产品版本治理：根 `VERSION` + `CHANGELOG.md`（v4.0.0 起，见 `docs/_archive/版本宣告-v4.0.0.md`）；契约 `@N` 与产品 semver 是两个轴。
