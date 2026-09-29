---
{
  "id": "kb/deconstruct/protocol",
  "type": "deconstruct-protocol",
  "title": "拆书总协议（六槽位与溯源纪律）",
  "dimension": "protocol",
  "version": "1.0.0",
  "status": "active",
  "applies_to": ["short-drama", "comic-drama", "long-form"],
  "routes": ["all"],
  "provenance": {
    "source": "factory",
    "refs": [
      "ref:deepwrite/apps/desktop/src/main/prompts/learning-imitation/material_split.txt",
      "ref:deepwrite/apps/desktop/src/main/prompts/learning-imitation/plot_learning.txt",
      "ref:deepwrite/apps/desktop/src/main/extras/long-book-analysis/prompts/*.txt"
    ]
  },
  "updated": "2026-09-15"
}
---

# 拆书总协议

**定位**：本条目是知识库**拆解层**的总协议——回答"怎么把一部参考作品拆成可入库的原子素材"。它是 `benchmark/`（对标拆解件）、`trope/`（桥段条目）、`archetype/`（原型卡）三类条目的**入库前端**，也是未来 `deconstruct_book / deconstruct_character / deconstruct_trope` 系列 minitool 的操作规范。方法论执行在 skill 层，本条目只定**槽位、字段与纪律**。

## 一、六槽位（拆完必须落进六个槽，不许混合）

| 槽位 | 装什么 | 对应 KB 类型 |
| --- | --- | --- |
| `gimmick`（梗） | 一句话卖点、题材元素组合、核心情绪承诺 | trope（部分） |
| `character`（人设） | 人物卡：模式、关系网、弧光、关键选择与证据 | archetype |
| `plot-design`（剧情设计） | 宏观骨架：故事阶段、主线支线、冲突升级、转折与收束 | benchmark |
| `intro`（导语设计） | 开局切入、钩子结构、期待建立 | beat-sheet |
| `plot-refine`（剧情细化） | 章节功能、场景节拍、剧情点密度、悬念与伏笔落点 | beat-sheet |
| `excerpt`（优秀正文片段） | 可仿写的执行样本（概括或极短引用） | style-rule 附件 |

每槽一份独立交付物；**不是复述小说，是沉淀能复用、能变体、能指导写作的素材**。

## 二、双层拆解

1. **设计层**（故事怎么排）：概括五行（梗/元素、人设模式、事件切入、钩子/期待、关键节点）→ 类型判断与核心情绪（甜/痛/爽/悔/疑/燃/压迫/释然）→ 结构公式。
2. **细化层**（每章每场怎么推）：章节功能（建立/铺垫/叠加/误导/打击/觉醒/对峙/揭露/收束）、单场景承载剧情点数、钩子与伏笔落点、对话/动作/闪回/视角切换如何服务节奏。

## 三、可迁移化（拆解的最终目的）

- 把具体人名和专有设定**抽象为可迁移的结构公式、替换变量与使用条件**（"拆某个人/拆某个桥段"的产物必须带替换变量，否则只是读后感）。
- 每个槽位产出物文末附：可复用模板 + 替换变量表 + 使用注意事项（何时适用、何时失效）。

## 四、溯源纪律（全部 block 级）

1. **【block】可追溯**：所有判断必须能追溯到章节标题或章节范围；不得补写人物经历、不得虚构未读取的情节。
2. **【block】三态区分**：区分原文事实、合理推断、暂时无法确认——三态在交付物里显式标注。
3. **【block】样本不足不归纳**：可读样本少于阈值（单篇观察可、类型共性需 ≥2、跨类型需 ≥3）时只出单篇观察；OCR 缺漏、章节大量缺失必须标风险。
4. **【minor】禁长段复制**：短引文仅在确有必要时使用且保持极短；片段槽位以"概括 + 极短示例"为限。
5. **【major】合并去重**：跨批次遇到同一人物/桥段时合并别名与证据，避免重复建条目（对应 KB 治理：拆解入库飞轮的查重义务）。
