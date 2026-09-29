---
{
  "id": "kb/rules/platform",
  "type": "rule-corpus",
  "title": "卡点域规则语料（断言台账退役迁移，agent 可激活条款）",
  "dimension": "platform",
  "version": "1.0.0",
  "status": "active",
  "activation_hint": [
    "m2.编剧",
    "端尾验收"
  ],
  "provenance": {
    "source": "v5.0 批A：knowledge/aesthetic/assertions.json 台账 C 轨迁移（tools/rules-init.py 生成，规则原文零改动）",
    "refs": [
      "AE-CARD-PAID"
    ]
  },
  "updated": "2026-09-21"
}
---

# 卡点域规则语料 · kb/rules/platform

> **本卡是语料不是闸**（v5.0 拍板：只用 agent，不用断言）。
> 优先级语义：`block`=最高优先（agent 评审无解释不得放过）；`major`=次优先；`minor`=提示。
> 原文中的「判 block/major」是台账历史措辞，一律读作优先级，**不构成提交拦截**。
> 能确定性计数的条款不在此卡（归 quality-scan 工具链出收据证据）。

- **【AE-CARD-PAID｜major】** 付费卡点覆盖第 8-12 集首卡区间，强度到顶点（对象：分集结构）
