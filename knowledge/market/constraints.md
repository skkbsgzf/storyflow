---
{
  "id": "kb/market/constraints",
  "type": "market-standard",
  "title": "生产约束基线（短剧/漫剧实盘值）",
  "version": "2026-09-14",
  "status": "active",
  "applies_to": ["short-drama", "comic-drama"],
  "routes": ["all"],
  "asserts": [],
  "provenance": {
    "source": "import",
    "refs": ["dataset:kakaxing/scriptrawstone@2026-09-14（全量统计）", "kb/market/snapshot.formatConstraints", "storymaster-v3:assets/skills/script-drama-beat.md"]
  },
  "bind": { "skills": ["plot-choreographer"], "minitools": ["check_contract_compliance"] },
  "updated": "2026-09-14"
}
---

# 生产约束基线

**用途**：选题分析报告第五节"创作约束移交单"的默认数值来源——约束不再拍脑袋，直接取市场实盘（7938 部在售剧本的硬格式统计）。方案对这些条款逐条对账（`kb/aesthetic/oversight` 监理纪律，违反一票否决）。

## 一、体量约束（分布即标准）

| 维度 | 主流值 | 分布依据 |
| --- | --- | --- |
| 集数 | **60 集**（4224 部） | 50 集 945 / 80 集 925 / 40 集 718 / 30 集 116 |
| 单集时长 | **1-1.5 分钟** | 竖屏付费短剧口径 |
| 单集字数上限 | **1200 字**（4284 部） | 1000 字 1640 / 1400 字 528 / 1600 字 476 |
| 场景数上限 | **≤3**（7937/7938） | 几乎全库硬约束——低成本快转景 |
| 主要演员上限 | **≤10**（7925 部） | 同上 |

**用法**：方案默认按 60 集 × 1.5 分钟 × 1200 字 × ≤3 场景 × ≤10 演员声明约束；偏离主流值（如 80 集或 4 场景）必须在移交单中显式声明并给理由——偏离不是错，隐式偏离才是错。

## 二、约束 → 编排的直接推论

1. **3 场景上限** ⇒ 每集冲突必须发生在可复用景（宅门/办公室/宫殿/车厢）；换景 = 换集节拍点。剧情编排师分集时先画场景复用表。
2. **10 演员上限** ⇒ 有名有姓角色 ≤10（含反派）；群演反应拍（当众打脸必需）不计入，但"全场惊呆"必须由环境描写的群演承担。
3. **1-1.5 分钟 ≈ 600-900 字正文**（script-drama-beat 口径）⇒ 每集 8-12 拍，前 3 秒钩子约 1 拍、结尾卡点约 2 拍。
4. **60 集 × 1.5 分钟 = 90 分钟总片长** ⇒ 实际叙事容量 ≈ 一部电影的紧凑版：主线只容 1 个大反转 + 2-3 个中型反转（`kb/aesthetic/reversal` 结构位点联动），副线必须挂主线条件。

## 三、题材标签纪律

申报题材标签从市场受控词表取（快照 `genreHeatCN`/`genreHeatNA` 中的 genre 字段），不用自造词；标签组合 = 1 主题材 + 2-3 副标签（市场策划案通行形），标签顺序即卖点顺序。

## 四、与硬断言的绑定

本条目数值进入约束移交单后，由 minitool `check_contract_compliance` 逐条对账；分拍格式合规由 `AE-BEAT-FORMAT` 断言扫描（`kb/aesthetic/assertions.json`）。
