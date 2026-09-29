---
{
  "id": "kb/formats/webnovel-longform",
  "type": "format-standard",
  "title": "长篇网文形态标准（章末钩子与批量生成）",
  "dimension": "format",
  "version": "1.0.0",
  "status": "active",
  "applies_to": ["long-form"],
  "routes": ["all"],
  "provenance": {
    "source": "factory",
    "refs": [
      "post:xhslink.cn/o/3bRWmAttfTo（chinese-novelist-skill 三层问答、awesome-novel-agent 题材画像）",
      "post:星月写作小红书主页（短篇商业化路线：番茄、保底、稿费、模型选型）",
      "ref:deepwrite/README.md（长篇各阶段共享设定与连续性账本）"
    ]
  },
  "updated": "2026-09-15"
}
---

# 长篇网文形态标准

**标尺**：网文长篇是**连载消费品**——判定单位是"章"，商业单位是"追读与稿费"。与短剧共用审美十二维度，但形态约束如下。

## 判定条款

1. **【block】章末钩子强制**：每章结尾必须留下悬念/转折/情绪钩（chinese-novelist-skill 纪律）。钩型轮换参照 `kb/deconstruct/style-learning` 收束四型——连续同型钩判 major（pacing 维度沙漠段的章级版）。
2. **【major】开书三层问答**（chinese-novelist-skill）：题材与核心情绪（对齐 `kb/deconstruct/protocol` 类型判断）→ 主角与金手指/核心欲望 → 前十 章事件链。三问没答完不开书。
3. **【major】批量生成节奏**：一次生成 10-50 章时，先出全段"章功能序列"再逐章执行——逐章流水式生成必然偏航（大纲偏离是 InkOS 审计 37 维之一）。每章交稿必过 `kb/continuity/state-ledger` 台账校验。
4. **【minor】题材画像先行**：开书前挂载对应题材画像（甜宠/追妻火葬场/虐恋/悬疑/重生/复仇/系统流……），画像含该类型的核心情绪走向与读者期待清单——`kb/deconstruct/protocol` 六槽位拆出的同类型对标件是画像的最佳来源。
5. **【minor】平台与商业语境**：星月写作路线的代表约束——目标平台规则（番茄等）、保底与全勤节奏、**过 AI 检测**（联动 `kb/aesthetic/ai-trace`：朱雀类检测是结构级，词句层规避无效）。模型选型影响产出质量档位，选型结论记入 flow 的模型参数，不入知识条目。

## 与 harness 的对应

- 长篇 = 一条多阶段 flow：开书（三层问答 → World Bible）→ 卷纲 → 章功能序列 → 逐章（写前台账切片注入 → 宿主写 → submit 过审计 → 状态结算）。InkOS 的"出草稿→过审计→按需修订→状态结算"四步即单章子图的标准形状。
- 批量生成时 flow 以"章"为原子任务包单位，断点续跑天然按章落盘（runtime 已有语义）。
