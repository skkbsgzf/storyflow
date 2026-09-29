---
{
  "id": "kb/rules/meme",
  "type": "rule-corpus",
  "title": "梗域规则语料（断言台账退役迁移，agent 可激活条款）",
  "dimension": "meme",
  "version": "1.0.0",
  "status": "active",
  "activation_hint": [
    "m1.选题",
    "m3.成文"
  ],
  "provenance": {
    "source": "v5.0 批A：knowledge/aesthetic/assertions.json 台账 C 轨迁移（tools/rules-init.py 生成，规则原文零改动）",
    "refs": [
      "AE-MEME-DENSITY",
      "AE-MEME-SPREAD"
    ]
  },
  "updated": "2026-09-21"
}
---

# 梗域规则语料 · kb/rules/meme

> **本卡是语料不是闸**（v5.0 拍板：只用 agent，不用断言）。
> 优先级语义：`block`=最高优先（agent 评审无解释不得放过）；`major`=次优先；`minor`=提示。
> 原文中的「判 block/major」是台账历史措辞，一律读作优先级，**不构成提交拦截**。
> 能确定性计数的条款不在此卡（归 quality-scan 工具链出收据证据）。

- **【AE-MEME-DENSITY｜major】** S1 梗卡须附网络热梗素材表 ≥10 条（梗名/传播度评级/可挂接场景）；不足判 major（对象：S1 梗卡）
- **【AE-MEME-SPREAD｜major】** 每个主梗/新变体可拆 ≥3 个跨场景可复用梗用法；前三章每集 ≥1 个可切片传播的梗点（对象：S1 梗卡与前三章）
