---
{
  "id": "kb/rules/deconstruct",
  "type": "rule-corpus",
  "title": "拆解纪律域规则语料（断言台账退役迁移，agent 可激活条款）",
  "dimension": "deconstruct",
  "version": "1.0.0",
  "status": "active",
  "activation_hint": [
    "调研/拆书"
  ],
  "provenance": {
    "source": "v5.0 批A：knowledge/aesthetic/assertions.json 台账 C 轨迁移（tools/rules-init.py 生成，规则原文零改动）",
    "refs": [
      "AE-DEC-SAMPLE",
      "AE-DEC-SLOT",
      "AE-DEC-STYLE",
      "AE-DEC-TRACE"
    ]
  },
  "updated": "2026-09-21"
}
---

# 拆解纪律域规则语料 · kb/rules/deconstruct

> **本卡是语料不是闸**（v5.0 拍板：只用 agent，不用断言）。
> 优先级语义：`block`=最高优先（agent 评审无解释不得放过）；`major`=次优先；`minor`=提示。
> 原文中的「判 block/major」是台账历史措辞，一律读作优先级，**不构成提交拦截**。
> 能确定性计数的条款不在此卡（归 quality-scan 工具链出收据证据）。

- **【AE-DEC-SAMPLE｜block】** 三态区分（原文事实/合理推断/无法确认）显式标注；样本不足不归纳共性（对象：拆解交付物）
- **【AE-DEC-TRACE｜block】** 拆解判断必须可追溯至章节标题/范围；不得补写人物经历、虚构未读情节（对象：拆解交付物）
- **【AE-DEC-SLOT｜major】** 拆解产物必须落入六槽位之一且带可迁移公式+替换变量+使用条件；混合多槽判 major（对象：拆解交付物）
- **【AE-DEC-STYLE｜major】** 文风拆解产物须能直接指导写手生成新正文（含规则/模板/速查表/自检清单），纯评论判 major（对象：文风拆解件）
