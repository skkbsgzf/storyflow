---
{
  "id": "kb/rules/continuity",
  "type": "rule-corpus",
  "title": "连续性域规则语料（断言台账退役迁移，agent 可激活条款）",
  "dimension": "continuity",
  "version": "1.0.0",
  "status": "active",
  "activation_hint": [
    "m3.成文（每章动笔前）"
  ],
  "provenance": {
    "source": "v5.0 批A：knowledge/aesthetic/assertions.json 台账 C 轨迁移（tools/rules-init.py 生成，规则原文零改动）",
    "refs": [
      "AE-CONT-LEDGER"
    ]
  },
  "updated": "2026-09-21"
}
---

# 连续性域规则语料 · kb/rules/continuity

> **本卡是语料不是闸**（v5.0 拍板：只用 agent，不用断言）。
> 优先级语义：`block`=最高优先（agent 评审无解释不得放过）；`major`=次优先；`minor`=提示。
> 原文中的「判 block/major」是台账历史措辞，一律读作优先级，**不构成提交拦截**。
> 能确定性计数的条款不在此卡（归 quality-scan 工具链出收据证据）。

- **【AE-CONT-LEDGER｜major】** 每章动笔前注入本章相关台账切片（人物状态/在场物品/知情范围/到期伏笔）（对象：逐章任务包）
