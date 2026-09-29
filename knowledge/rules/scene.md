---
{
  "id": "kb/rules/scene",
  "type": "rule-corpus",
  "title": "场景域规则语料（断言台账退役迁移，agent 可激活条款）",
  "dimension": "scene",
  "version": "1.0.0",
  "status": "active",
  "activation_hint": [
    "m2.编剧",
    "m3.成文"
  ],
  "provenance": {
    "source": "v5.0 批A：knowledge/aesthetic/assertions.json 台账 C 轨迁移（tools/rules-init.py 生成，规则原文零改动）",
    "refs": [
      "AE-SCENE-CHEAP",
      "AE-SCENE-DELTA",
      "AE-SCENE-GOAL",
      "AE-SCENE-PRESSURE"
    ]
  },
  "updated": "2026-09-21"
}
---

# 场景域规则语料 · kb/rules/scene

> **本卡是语料不是闸**（v5.0 拍板：只用 agent，不用断言）。
> 优先级语义：`block`=最高优先（agent 评审无解释不得放过）；`major`=次优先；`minor`=提示。
> 原文中的「判 block/major」是台账历史措辞，一律读作优先级，**不构成提交拦截**。
> 能确定性计数的条款不在此卡（归 quality-scan 工具链出收据证据）。

- **【AE-SCENE-DELTA｜block】** 入场价值与出场价值不得只是换一种说法；价值无变化的场合并/删除/重设计（对象：每场）
- **【AE-SCENE-CHEAP｜major】** 存在人物显然会选的更便宜方案时，必须建立不能使用它的原因（对象：每场）
- **【AE-SCENE-GOAL｜major】** 视点人物拥有本场可观察的场景目标；主冲突主动反制（对象：每场）
- **【AE-SCENE-PRESSURE｜major】** 下一场因本场后果而必要（非'然后又发生'）（对象：相邻场）
