---
{
  "id": "kb/structure/catalog",
  "type": "structure-catalog",
  "title": "叙事结构选型目录（第二阶段深挖用）",
  "dimension": "structure",
  "version": "1.0.0",
  "status": "active",
  "applies_to": ["short-drama", "comic-drama", "long-form"],
  "routes": ["all"],
  "asserts": [],
  "provenance": {
    "source": "factory",
    "refs": [
      "ref:screenwriting-skills/sw-story-structure（结构母型）",
      "ref:screenwriting-skills/sw-truby-anatomy（道德论证/心愿网）",
      "ref:write-chinese-long-screenplay/legacy/references/adapter-save-the-cat.md（救猫咪节拍）",
      "ref:write-chinese-long-screenplay/legacy/references/adapter-mckee.md",
      "ref:write-chinese-long-screenplay/legacy/references/genre-engines.md（类型引擎）",
      "ref:deepwrite/apps/desktop/src/main/prompts/learning-imitation/plot_learning.txt（剧情设计拆解）"
    ]
  },
  "updated": "2026-09-15",
  "bind": { "skills": ["structure-design"], "minitools": ["kb_search", "check_trope_combo"] }
}
---

# 叙事结构选型目录

**用途**：选题流程第二阶段（结构深挖）的选型底表。选型不是贴标签——选一条结构后必须做**深挖（补骨架）、改造（换变量）、融合（复合第二结构）**三步，让结构长在本次选题的梗与人群上，而不是套模板。

## 一、结构母型速览

| 结构 | 骨架 | 强项 | 风险 | 适配 |
| --- | --- | --- | --- | --- |
| **复仇**（背叛→蛰伏→清账） | 冤屈建立→能力获得→逐层清算→终局对账 | 目标清晰、爽点天然当众 | 中段清算同质化（连打脸疲劳） | 熟龄复仇/赘婿/重生 |
| **救猫咪**（15 节拍） | 开场画面→催化剂→争论→中点→坏人逼近→一无所有→终场 | 节拍齐整、卡点位置现成 | 节拍化痕迹重，需去模板（24 类） | 家 clustered/情感/成长 |
| **逆袭/升级**（欲望递进） | 底层→第一桶金→进入牌桌→掀桌 | 爽点密度好布（神豪族主场） | 升级只涨数值=单薄，需代价梯 | 神豪/赘婿/系统流 |
| **双线交叉**（明暗双线） | A 线明面推进、B 线暗面汇聚→交叉引爆 | 中点反转天然位 | 交叉间距失控（>5 拍判失衡） | 悬疑/商战/身份错位 |
| **倒钩回归**（宿命回环） | 开局即终局倒影，结尾回收 | 余味深、二刷价值高 | 前期钩子弱，短剧慎单用 | 深沉档/长线 IP |
| **单元宿命**（重复结构带变量） | 每单元同机制不同变量（模拟器/循环/接单） | 量产稳定、每单元自带钩 | 变量枯竭即崩，需变量清单 | 系统流/模拟器/无限流 |

## 二、选型三步（深挖 · 改造 · 融合）

1. **深挖**：把所选结构的骨架逐节点问"本次选题的**具体事件**是什么"——写不出具体事件 = 该结构只有皮。
2. **改造**：至少改造一个标志件（救猫咪的"催化剂"换位、复仇的"清算顺序"倒序、升级的"金手指"带成本）。改造点必须回指梗卡新变体落点。
3. **融合**：复合第二结构做辅骨（复仇×身份错位双线 / 升级×单元宿命）。辅骨不许喧主——每集仍只有一个主认知更新（`kb/aesthetic/pacing-density` AE-INFO-LOAD）。

## 三、节奏市场对表

- 结构节拍落点对照 `kb/market/structure` 实盘：60 集 → 首卡 8-12、中点 30 改写模型、55+ 决战。
- hot 档：选型偏"清算/升级"型，每集爽点 ≥3；calm 档：偏"倒钩/双线"型，9:1 浓度。
- 融合后须过红方视角验收："资深编剧"视角查骨架完整，"目标读者"视角查爽点在位（`kb/aesthetic/perspective-review`）。

## 四、不确定因素注入点（反单薄）

结构选型后必须输出 ≥2 个**不确定因素注入点**（人物前史/身份层/世界观规则的反认知变量），例：老年复仇框架 + "她曾是黑道大小姐"/"真假千金互换"/"穿书转世自知剧本"——同一框架由此长成不同作品。注入点经红方多视角评估后择优融入，再进第三阶段成形。
