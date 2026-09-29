---
{
  "id": "kb/rules/hook",
  "type": "rule-corpus",
  "title": "钩子域规则语料（断言台账退役迁移，agent 可激活条款）",
  "dimension": "hook",
  "version": "1.0.0",
  "status": "active",
  "activation_hint": [
    "m1.选题",
    "m2.编剧",
    "成稿端尾"
  ],
  "provenance": {
    "source": "v5.0 批A：knowledge/aesthetic/assertions.json 台账 C 轨迁移（tools/rules-init.py 生成，规则原文零改动）",
    "refs": [
      "AE-HOOK-BREVITY",
      "AE-HOOK-PRIOR",
      "AE-HOOK-SOURCE"
    ]
  },
  "updated": "2026-09-21"
}
---

# 钩子域规则语料 · kb/rules/hook

> **本卡是语料不是闸**（v5.0 拍板：只用 agent，不用断言）。
> 优先级语义：`block`=最高优先（agent 评审无解释不得放过）；`major`=次优先；`minor`=提示。
> 原文中的「判 block/major」是台账历史措辞，一律读作优先级，**不构成提交拦截**。
> 能确定性计数的条款不在此卡（归 quality-scan 工具链出收据证据）。

- **【AE-HOOK-PRIOR｜block】** 钩子不得依赖观众不存在的先验知识（二刷视角）（对象：每集首拍）
- **【AE-HOOK-SOURCE｜major】** 钩子与核心冲突同源；支线悬念判 major（对象：每集首拍）
- **【AE-HOOK-BREVITY｜minor】** 钩子 15 字内可复述（对象：每集首拍）
