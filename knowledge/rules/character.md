---
{
  "id": "kb/rules/character",
  "type": "rule-corpus",
  "title": "人物域规则语料（断言台账退役迁移，agent 可激活条款）",
  "dimension": "character",
  "version": "1.0.0",
  "status": "active",
  "activation_hint": [
    "m2.编剧",
    "m3.成文"
  ],
  "provenance": {
    "source": "v5.0 批A：knowledge/aesthetic/assertions.json 台账 C 轨迁移（tools/rules-init.py 生成，规则原文零改动）",
    "refs": [
      "AE-CHAR-COVER",
      "AE-CHAR-DIM",
      "AE-CHAR-MOTIVE",
      "AE-CHAR-VILLAIN"
    ]
  },
  "updated": "2026-09-21"
}
---

# 人物域规则语料 · kb/rules/character

> **本卡是语料不是闸**（v5.0 拍板：只用 agent，不用断言）。
> 优先级语义：`block`=最高优先（agent 评审无解释不得放过）；`major`=次优先；`minor`=提示。
> 原文中的「判 block/major」是台账历史措辞，一律读作优先级，**不构成提交拦截**。
> 能确定性计数的条款不在此卡（归 quality-scan 工具链出收据证据）。

- **【AE-CHAR-COVER｜major】** 盖名测试：遮住人物名仍可根据策略/知识/语言选择辨认说话者（对象：对白全文）
- **【AE-CHAR-DIM｜major】** 主角为最多维人物（维=矛盾）；怪癖清单不算维（对象：人设）
- **【AE-CHAR-MOTIVE｜major】** 主角人设能回答'为什么一定是她'（不可替代性证明）（对象：人设）
- **【AE-CHAR-VILLAIN｜major】** 对抗力量随主角行动学习适应；主反派在关键卡不得降智（hot 档非关键卡限额豁免）（对象：全剧）
