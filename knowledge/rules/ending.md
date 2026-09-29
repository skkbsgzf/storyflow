---
{
  "id": "kb/rules/ending",
  "type": "rule-corpus",
  "title": "结局域规则语料（断言台账退役迁移，agent 可激活条款）",
  "dimension": "ending",
  "version": "1.0.0",
  "status": "active",
  "activation_hint": [
    "m2.编剧",
    "端尾验收"
  ],
  "provenance": {
    "source": "v5.0 批A：knowledge/aesthetic/assertions.json 台账 C 轨迁移（tools/rules-init.py 生成，规则原文零改动）",
    "refs": [
      "AE-END-AFTER",
      "AE-END-MECH",
      "AE-END-PAYOFF"
    ]
  },
  "updated": "2026-09-21"
}
---

# 结局域规则语料 · kb/rules/ending

> **本卡是语料不是闸**（v5.0 拍板：只用 agent，不用断言）。
> 优先级语义：`block`=最高优先（agent 评审无解释不得放过）；`major`=次优先；`minor`=提示。
> 原文中的「判 block/major」是台账历史措辞，一律读作优先级，**不构成提交拦截**。
> 能确定性计数的条款不在此卡（归 quality-scan 工具链出收据证据）。

- **【AE-END-MECH｜block】** 禁止高潮新规则/突然认罪/偶然救援/临时万能人物解决主冲突（对象：结局）
- **【AE-END-AFTER｜major】** 余波展示新秩序 + 损失 + 仍未消失的代价；代价归零判 major（对象：结局）
- **【AE-END-PAYOFF｜major】** 重要铺垫可感知回收（calm 档伏笔回收率 >60%）（对象：结局）
