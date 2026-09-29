# _vendor · 运行时外部件（不入库）

本目录被 .gitignore 整体排除——里面是外部工具的**运行时克隆与环境**，体积大（venv+模型资产），
进 git 只会炸推送。

## laya（学生批扫引擎，现役）

- `laya-venv/`：学生头运行环境（torch 2.14.0+cu126，RTX A4500 自适应；无卡机器回落 CPU）。
- `laya-exp/`：训练/实验侧组件。
- 还原步骤：见 `modules/detect/module.json` 的 `laya-screen` op 说明与学生权重目录
  `runs/laya-run-0923/student-v3`；跑法 `python tools/laya-scan.py --clauses <qid,…>`。

## SemIf 4B 判官（已卸载 2026-09-24）

- 原 `SemIf/`（.venv+GGUF 约 1.4GB）连同 `tools/semif-scan.py`、`tools/semif-daemon/`、
  `tools/semif-mcp/` 一并卸载——批扫引擎位已由 laya 学生独占（人裁 `docs/人裁-laya唯一引擎-20260924.md`），
  4B 永不回落的裁决下引擎本体不再留在盘上。
- 保留件：`knowledge/semif-calibration/`（校准包题面/金标卷，离线体检选题事实源）与
  `tools/semif-grade.py`（判分器，detect/`semif-cal-grade`）——它们不依赖 4B 运行时。
- 如需复原：按 `knowledge/semif-calibration/index.json` modelPins 钉版（GGUF sha256 前缀
  13c16f426047）重新克隆+建venv+放模型；历史收据全部可读不受影响。

## 纪律

- 这里的东西只有运行时身份，没有版本身份：harness 的行为契约在 `tools/*.py` 与校准包，
  不在 vendor 内容本身。
- 换机/新 clone：还原本目录对应条目，否则相关 op 触达即显式报缺，不冒充。
