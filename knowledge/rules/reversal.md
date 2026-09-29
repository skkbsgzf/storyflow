---
{
  "id": "kb/rules/reversal",
  "type": "rule-corpus",
  "title": "反转域规则语料（断言台账退役迁移，agent 可激活条款）",
  "dimension": "reversal",
  "version": "1.0.0",
  "status": "active",
  "activation_hint": [
    "m2.编剧",
    "m3.成文"
  ],
  "provenance": {
    "source": "v5.0 批A：knowledge/aesthetic/assertions.json 台账 C 轨迁移（tools/rules-init.py 生成，规则原文零改动）",
    "refs": [
      "AE-REV-ADJACENT",
      "AE-REV-MIDPOINT",
      "AE-REV-SETUP",
      "AE-REV-TYPE"
    ]
  },
  "updated": "2026-09-21"
}
---

# 反转域规则语料 · kb/rules/reversal

> **本卡是语料不是闸**（v5.0 拍板：只用 agent，不用断言）。
> 优先级语义：`block`=最高优先（agent 评审无解释不得放过）；`major`=次优先；`minor`=提示。
> 原文中的「判 block/major」是台账历史措辞，一律读作优先级，**不构成提交拦截**。
> 能确定性计数的条款不在此卡（归 quality-scan 工具链出收据证据）。

- **【AE-REV-SETUP｜block】** 每次反转 ≥2 处前置暗埋（回看成立）（对象：每处反转）
- **【AE-REV-MIDPOINT｜major】** 中点反转必须改写故事模型，只升烈度不改模型判 major（对象：全剧结构）
- **【AE-REV-ADJACENT｜minor】** 相邻反转同类型判 minor；三连同型判 major（对象：反转序列）
- **【AE-REV-TYPE｜minor】** 每处反转可判明四型之一（身份/立场/因果/预期）；类型模糊判 minor（对象：每处反转）
