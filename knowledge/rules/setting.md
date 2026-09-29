---
{
  "id": "kb/rules/setting",
  "type": "rule-corpus",
  "title": "设定底座域规则语料（断言台账退役迁移，agent 可激活条款）",
  "dimension": "setting",
  "version": "1.0.0",
  "status": "active",
  "activation_hint": [
    "m1.选题",
    "m2.编剧"
  ],
  "provenance": {
    "source": "v5.0 批A：knowledge/aesthetic/assertions.json 台账 C 轨迁移（tools/rules-init.py 生成，规则原文零改动）",
    "refs": [
      "AE-SET-3MIN",
      "AE-SET-ORIG"
    ]
  },
  "updated": "2026-09-21"
}
---

# 设定底座域规则语料 · kb/rules/setting

> **本卡是语料不是闸**（v5.0 拍板：只用 agent，不用断言）。
> 优先级语义：`block`=最高优先（agent 评审无解释不得放过）；`major`=次优先；`minor`=提示。
> 原文中的「判 block/major」是台账历史措辞，一律读作优先级，**不构成提交拦截**。
> 能确定性计数的条款不在此卡（归 quality-scan 工具链出收据证据）。

- **【AE-SET-3MIN｜block】** 三分钟测试：观众 3 分钟内不依赖设定解释即可说出谁/要什么/为什么替他急；自造专名前三章 ≤2 个（对象：开局与前三章）
- **【AE-SET-ORIG｜block】** 禁止原创科幻/架空世界观作为设定底座；设定来源须为实事新闻底子或市面验证体系（三级制）（对象：S1/S2 选题与框架）
