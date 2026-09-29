---
{
  "id": "kb/rules/dialogue",
  "type": "rule-corpus",
  "title": "对白域规则语料（断言台账退役迁移，agent 可激活条款）",
  "dimension": "dialogue",
  "version": "1.0.0",
  "status": "active",
  "activation_hint": [
    "m3.成文",
    "polish"
  ],
  "provenance": {
    "source": "v5.0 批A：knowledge/aesthetic/assertions.json 台账 C 轨迁移（tools/rules-init.py 生成，规则原文零改动）",
    "refs": [
      "AE-DLG-ACTION",
      "AE-DLG-EXPO",
      "AE-DLG-PINGPONG"
    ]
  },
  "updated": "2026-09-21"
}
---

# 对白域规则语料 · kb/rules/dialogue

> **本卡是语料不是闸**（v5.0 拍板：只用 agent，不用断言）。
> 优先级语义：`block`=最高优先（agent 评审无解释不得放过）；`major`=次优先；`minor`=提示。
> 原文中的「判 block/major」是台账历史措辞，一律读作优先级，**不构成提交拦截**。
> 能确定性计数的条款不在此卡（归 quality-scan 工具链出收据证据）。

- **【AE-DLG-ACTION｜major】** 每句台词可标注动名词短语行动；标不出 → 删或重写（hot 档潜台词豁免条款见 kb/aesthetic/dialogue §五）（对象：对白全文）
- **【AE-DLG-EXPO｜major】** 禁止解释独白（角色停止行动向观众说明双方已知设定）（对象：对白全文）
- **【AE-DLG-PINGPONG｜major】** 禁止二人乒乓（只交换信息，无第三对象/秘密/制度/风险介入）（对象：对白场景）
