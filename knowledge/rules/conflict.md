---
{
  "id": "kb/rules/conflict",
  "type": "rule-corpus",
  "title": "冲突域规则语料（断言台账退役迁移，agent 可激活条款）",
  "dimension": "conflict",
  "version": "1.0.0",
  "status": "active",
  "activation_hint": [
    "m2.编剧"
  ],
  "provenance": {
    "source": "v5.0 批A：knowledge/aesthetic/assertions.json 台账 C 轨迁移（tools/rules-init.py 生成，规则原文零改动）",
    "refs": [
      "AE-CONFLICT-ADAPT",
      "AE-CONFLICT-CHOICE",
      "AE-CONFLICT-IRREV",
      "AE-CONFLICT-JUMP",
      "AE-CONFLICT-MECH"
    ]
  },
  "updated": "2026-09-21"
}
---

# 冲突域规则语料 · kb/rules/conflict

> **本卡是语料不是闸**（v5.0 拍板：只用 agent，不用断言）。
> 优先级语义：`block`=最高优先（agent 评审无解释不得放过）；`major`=次优先；`minor`=提示。
> 原文中的「判 block/major」是台账历史措辞，一律读作优先级，**不构成提交拦截**。
> 能确定性计数的条款不在此卡（归 quality-scan 工具链出收据证据）。

- **【AE-CONFLICT-MECH｜block】** 转折必须来自已建立的机制/人物/证据；凭空出现新机制判 block（对象：每场）
- **【AE-CONFLICT-ADAPT｜major】** 递进复杂化：代价/范围/不可逆性逐级上升且一次只动一到两个代价梯维度（对象：结构图）
- **【AE-CONFLICT-CHOICE｜major】** 危机 = 互不兼容且均有代价的方案选择（对象：结构图）
- **【AE-CONFLICT-IRREV｜major】** 不可回头点必须包含主角的选择（不只是外界偶然封路）（对象：结构图）
- **【AE-CONFLICT-JUMP｜major】** 禁止 jumping conflict（无过渡的冲突暴跳）；static conflict 超 2 拍判 minor（对象：分拍剧本）
