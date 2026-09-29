---
{
  "id": "kb/rules/pacing",
  "type": "rule-corpus",
  "title": "节奏与密度域规则语料（断言台账退役迁移，agent 可激活条款）",
  "dimension": "pacing",
  "version": "1.0.0",
  "status": "active",
  "activation_hint": [
    "m2.编剧",
    "m3.成文"
  ],
  "provenance": {
    "source": "v5.0 批A：knowledge/aesthetic/assertions.json 台账 C 轨迁移（tools/rules-init.py 生成，规则原文零改动）",
    "refs": [
      "AE-CUSHION",
      "AE-DENSITY-CALM",
      "AE-DENSITY-HOT",
      "AE-DESERT",
      "AE-INFO-LOAD",
      "AE-STRUCT-REDUN"
    ]
  },
  "updated": "2026-09-21"
}
---

# 节奏与密度域规则语料 · kb/rules/pacing

> **本卡是语料不是闸**（v5.0 拍板：只用 agent，不用断言）。
> 优先级语义：`block`=最高优先（agent 评审无解释不得放过）；`major`=次优先；`minor`=提示。
> 原文中的「判 block/major」是台账历史措辞，一律读作优先级，**不构成提交拦截**。
> 能确定性计数的条款不在此卡（归 quality-scan 工具链出收据证据）。

- **【AE-STRUCT-REDUN｜block】** 不推动信息/关系/情绪任何一项的段落删除或合并（对象：全部段落）
- **【AE-CUSHION｜major】** 两个大卡点之间 ≥2 个中型爽点垫场（对象：全剧分布图）
- **【AE-DENSITY-CALM｜major】** 合理版每集爆点 ≤1 且为前 ≥20 拍铺垫的兑现；蓄力:引爆 ≈ 9:1（机器校验经 AE-DENSITY-WORDS 统一区间执行）
- **【AE-DENSITY-HOT｜major】** 爽版每集爽点 ≥3，每 3 拍一个小刺激，受辱→回击 ≤2 拍（机器校验经 AE-DENSITY-WORDS 统一区间执行）
- **【AE-DESERT｜major】** 不允许连续 5 集无爆点的沙漠段（对象：全剧分布图）
- **【AE-INFO-LOAD｜major】** 一个场/拍只有一个主要认知更新；≥3 个互不相关新名词/规则/时间层需拆分（对象：每场）
