---
{
  "id": "kb/continuity/state-ledger",
  "type": "continuity-standard",
  "title": "长程连续性与状态台账标准",
  "dimension": "continuity",
  "version": "1.0.0",
  "status": "active",
  "applies_to": ["long-form"],
  "routes": ["all"],
  "asserts": ["AE-CONT-LEDGER", "AE-CONT-KNOW", "AE-CONT-ITEM", "AE-CONT-FORESHADOW"],
  "provenance": {
    "source": "factory",
    "refs": [
      "post:xhslink.cn/o/3bRWmAttfTo（InkOS 37 维审计、webnovel-writer 事实合同）",
      "ref:deepwrite（长篇连续性账本 long-ledger）",
      "ref:write-chinese-long-screenplay/legacy/references/continuity-revision.md"
    ]
  },
  "updated": "2026-09-15"
}
---

# 长程连续性与状态台账标准

**标尺**：**加规则治崩**——长篇（几十到几百章）的质量问题首先是状态崩坏而非文采。正文之外必须维护一套机器可查的事实台账，写新章前查账，交新章后记账。

## 一、台账五类事实（webnovel-writer"事实合同"口径，登记过审才生效）

| 台账 | 登记什么 | 典型事故 |
| --- | --- | --- |
| `characters` | 谁活着/死了/失踪、伤势、位置 | 死者复活登场 |
| `inventory` | 物品归属与流转 | 道具凭空归还/丢失 |
| `knowledge` | **谁知道什么秘密**（按人物逐个记） | 未被告知的人物说出秘密 |
| `promises` | 伏笔与承诺（埋设点 → 预期回收点） | 伏笔永久失踪 |
| `timeline` | 事件顺序与时间跨度 | 时间线自相矛盾 |

## 二、判定条款

1. **【block】知识越权**：人物说出/使用其台账未登记的信息 → 硬伤（character 维度"知识边界"的长程版）。
2. **【block】正典矛盾**：新章与台账已接受事实直接冲突 → 不得合并；确需改历史走修订影响评估（`continuity-revision`：改根因场后所有下游场与证据回归）。
3. **【major】伏笔回收率**：`promises` 台账中的到期伏笔未回收 → major；关键伏笔（卡点级）逾期 → block。calm 档按 >60% 回收率标准（`kb/aesthetic/ending` 联动）。
4. **【major】写前查账**：每章动笔前必须带出本章相关台账切片（出场人物状态、在场物品、知情范围、到期伏笔）——这是 harness 任务包装配的一部分，不是可选项。

## 三、与 harness 的对应（本标准为什么在知识层）

- 台账就是 flow 运行时的**持久状态**之一：`flow_submit` 交付新章时，minitool 做台账增量校验（断言 AE-CONT-*）；`flow_next` 组装下一章任务包时自动注入台账切片。
- InkOS 的"审计→按需修订→状态结算"与**原子提交**纪律（校验全过才一次性接受正文+状态，不许状态推进了正文没落盘）直接对应我们 flow 的 submit 校验与产物注册表原子落盘语义。
- **加规则治崩（本维度）与减规则治假（`kb/aesthetic/ai-trace`）是相反相成的两仗**：状态上零容忍，手法上留余地。
