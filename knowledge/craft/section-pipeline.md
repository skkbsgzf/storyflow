---
{
  "id": "kb/craft/section-pipeline",
  "type": "craft-standard",
  "title": "节卷积写作纪律（一节一验收，过点再滚上下文）",
  "dimension": "craft",
  "version": "0.1.0",
  "status": "active",
  "applies_to": ["long-form"],
  "routes": ["drafting"],
  "provenance": {
    "source": "user.directive 2026-09-22「全流程规范化执行：主Agent划节→拆解器两类验收→过则更新上下文→章末过点报告」",
    "calibration": "knowledge/semif-calibration/（机器条款题面唯一事实源）"
  }
}
---

# 节卷积写作纪律

卷积波次（kb/craft/convolution-waves）的**节级化执行版**：一章拆成 3-5 节，每节 500-700 字（±两成超额写，节末收敛），**一写一验收一滚上下文**；验收未过的节不并入已验收上下文。与波次的关系：波=回看节奏，节=交付验收单位；两把尺子同轴不同齿，不互相取消。

## 一、节需求包（写节前由主 Agent 从选题报告/章功能序列/分场卡整理，一次一份）

| 件 | 内容 | 来源 |
| --- | --- | --- |
| 塑造目标 | 本节要推进的人物/剧情/情绪曲线点（一句话可检查的目标） | 选题 part + 章功能序列 |
| 前文概要 | 已验收上下文的摘要（≤120 字）＋末段原文（接缝用） | 滚动累积 |
| 文风 | kb/craft/prose-constraints 路由 + 本章特需 + 去 AI 味条款 | 标尺卡 |
| 其他需求 | 章末留悬念/开篇有钩/本节禁止出现的解释腔等 | 需求包顶部 |

## 二、两类验收项（拆解器按 knowledge/semif-calibration/index.json 路由，见 skills/acceptance-decompose）

- **机器类**：条款在 index.json 里状态 = calibrated/pilot 且该节文本命中其 filter → 跑 `tools/laya-scan.py --clauses <id>`（引擎位 09-24 起=laya 学生），P 值只排复核优先级（**任何状态都不是放行闸**）；pilot 条款命中 = 必升人工复核。
- **感受类**：爽点/冲击力/情绪曲线到位度 → 读者面板（skills/reader-panel）出评语+三问裁决。
- 两不管条款（index.json = failed 或未收录，如无义句、声口、时序）→ 一律走 agent 对照语料卡裁决，**禁止伪装成机器已验**。

## 三、节的过与不过

- 过 = 机器类无 ⚠复核优先未处置 + 感受类读者面板无「打回」判词 → 节文并入已验收上下文，前文概要重算。
- 不过 = 主 Agent 只重写本节（携带拆解器的处置清单），**不动已验收节**。
- 小验收项不达标不阻断全章：登记为证据遗留（overdue 项），章末过点报告统一呈报，裁决归用户（作家）。

## 四、章末过点报告（内部/章过点-<章号>-<ts>.md，落盘后面板自动聚合）

```text
# 第N章 过点报告
- 节×K ｜ 机器证据：semif扫描×条款（引用 receipt 路径）+ quality-scan 收据
- 复核未处置清单：条款/段/P/一句话理由（默认交作家）
- 读者面板判词摘要：每节一行（爽点✓/△/✗ + 最强一句 + 最弱一句）
- 本节口径遗留：pilot 条款命中、边缘样张（gold 争议）、agent 两可判
```

报数必附收据文件（铁律 10）；无收据 = 删声明。
