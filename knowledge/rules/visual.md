---
{
  "id": "kb/rules/visual",
  "type": "rule-corpus",
  "title": "视觉可拍性域规则语料（断言台账退役迁移，agent 可激活条款）",
  "dimension": "visual",
  "version": "1.0.0",
  "status": "active",
  "activation_hint": [
    "m2.分镜",
    "m3.成文"
  ],
  "provenance": {
    "source": "v5.0 批A：knowledge/aesthetic/assertions.json 台账 C 轨迁移（tools/rules-init.py 生成，规则原文零改动）",
    "refs": [
      "AE-VIS-MOTIF",
      "AE-VIS-POSTER"
    ]
  },
  "updated": "2026-09-21"
}
---

# 视觉可拍性域规则语料 · kb/rules/visual

> **本卡是语料不是闸**（v5.0 拍板：只用 agent，不用断言）。
> 优先级语义：`block`=最高优先（agent 评审无解释不得放过）；`major`=次优先；`minor`=提示。
> 原文中的「判 block/major」是台账历史措辞，一律读作优先级，**不构成提交拦截**。
> 能确定性计数的条款不在此卡（归 quality-scan 工具链出收据证据）。

- **【AE-VIS-MOTIF｜major】** calm 档 ≥2 个贯穿物件母题，爆点绑定物件；hot 档建议
- **【AE-VIS-POSTER｜major】** 每个关键爆点可画成海报级分镜（谁/在哪/对谁/做了什么/记忆点）；画不出 → 改写或换爆点（对象：大纲+前三集）
