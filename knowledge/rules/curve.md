---
{
  "id": "kb/rules/curve",
  "type": "rule-corpus",
  "title": "情绪曲线域规则语料（断言台账退役迁移，agent 可激活条款）",
  "dimension": "curve",
  "version": "1.0.0",
  "status": "active",
  "activation_hint": [
    "m2.编剧"
  ],
  "provenance": {
    "source": "v5.0 批A：knowledge/aesthetic/assertions.json 台账 C 轨迁移（tools/rules-init.py 生成，规则原文零改动）",
    "refs": [
      "AE-CURVE-CROSS",
      "AE-CURVE-FLOOR",
      "AE-CURVE-STALL",
      "AE-CURVE-TYPE"
    ]
  },
  "updated": "2026-09-21"
}
---

# 情绪曲线域规则语料 · kb/rules/curve

> **本卡是语料不是闸**（v5.0 拍板：只用 agent，不用断言）。
> 优先级语义：`block`=最高优先（agent 评审无解释不得放过）；`major`=次优先；`minor`=提示。
> 原文中的「判 block/major」是台账历史措辞，一律读作优先级，**不构成提交拦截**。
> 能确定性计数的条款不在此卡（归 quality-scan 工具链出收据证据）。

- **【AE-CURVE-CROSS｜major】** 双线交叉曲线交叉点间距 >5 拍判失衡（对象：大纲）
- **【AE-CURVE-FLOOR｜major】** 螺旋下降曲线必须有至少一个微小反击（丧到底 = 弃剧点）（对象：大纲）
- **【AE-CURVE-STALL｜major】** 层层递进曲线中任何一级不高于上一级判失衡（对象：大纲）
- **【AE-CURVE-TYPE｜major】** 全稿情绪曲线可判明唯一主型（六型之一）（对象：全稿）
