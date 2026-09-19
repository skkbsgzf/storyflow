# KB 装载 · pre（读前识别与样本检查）

> 由 miniflow kernel kb_load 内建装载，来源 2 个知识文件。


---

<!-- source: knowledge/deconstruct/protocol.md -->

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
  "asserts": ["AE-DEC-TRACE", "AE-DEC-SAMPLE", "AE-DEC-SLOT"],
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


---

<!-- source: knowledge/deconstruct/style-learning.md -->

---
{
  "id": "kb/deconstruct/style-learning",
  "type": "deconstruct-protocol",
  "title": "文风学习协议（情绪决定笔墨密度）",
  "dimension": "style",
  "version": "1.0.0",
  "status": "active",
  "applies_to": ["long-form", "short-drama"],
  "routes": ["all"],
  "asserts": ["AE-DEC-STYLE"],
  "provenance": {
    "source": "factory",
    "refs": [
      "ref:deepwrite/apps/desktop/src/main/prompts/learning-imitation/style_learning.txt"
    ]
  },
  "updated": "2026-09-15"
}
---

# 文风学习协议

**标尺**：**写什么不重要，怎么写才重要**。文风拆解关注"怎么写"，不得把情节内容误当成文风规律；产物必须是可直接执行的写手规则（含模板、速查表、自检清单），不是评论文章。

## 一、核心可执行规则：情绪决定笔墨密度

情绪越强，时间越慢、笔墨越密；情绪越平，越果断带过。

| 情境 | 主角状态 | 笔墨密度 | 写法 |
| --- | --- | --- | --- |
| 被背叛 | 震惊/失控/麻木 | 高 | 放慢时间，写感官和身体反应 |
| 被羞辱 | 克制/压抑/反击前 | 高 | 用停顿、沉默、微动作承压 |
| 回忆涌上 | 被过去击中 | 高 | 现实动作触发回忆，回忆不解释过满 |
| 日常过渡 | 情绪平稳 | 低 | 一句话带过 |
| 时间跳跃 | 事件无关键变化 | 低 | 果断跨越，只保留结果 |
| 心死行动 | 冷静/决绝 | 中高 | 少情绪词，多动作和选择 |

反面典型：**无情绪动作强行细写**——读者会追问角色为什么关注这些细节，造成误读。

## 二、九个观察维度（拆文风时逐维标记）

1. 情绪笔墨密度（上表）
2. 句式与段落节奏：句长配比、独句成段、段尾翻转/补刀/落空/情绪坠落
3. 叙述视角与信息控制：读者只跟随主角当下认知；何时给、何时藏
4. 对话写法：标签用法、密度、留白、短-短-长节奏、**权力关系如何通过话语暴露**（强势方：短/冷/命令/反问/沉默；弱势方：解释/停顿/回避/失语）
5. 动作写法：动作代心理（心碎=身体失控；克制=攥紧移开视线；绝望=反应变少语气变平；决绝=干净动作少解释）
6. 人物写法：弱化外貌、强化标签特征与情绪按钮；人物靠选择/反应/沉默/拒绝站住；对立人物镜像
7. 环境写法：环境只在情绪需要时出现，作为情绪容器；同一地点因心境不同呈现不同质感
8. 转场与时间：跳跃果断；回忆/现实/切换的完成方式
9. 章节收束：见下

## 三、收束四型（每节每页必选其一）

1. **情绪坠落式**：最后一句让角色意识到更痛的事实
2. **行动推进式**：最后一句落在明确动作上
3. **信息反转式**：最后一句释放新信息，改变读者判断
4. **留白悬停式**：停在沉默、未说出口的话或未完成动作上

## 四、判定与卫生纪律

- 【major】拆出的规则必须能直接指导生成新正文——"是否能指导写手"是产物合格线。
- 【block】禁大段复制原文（与 `kb/deconstruct/protocol` §四.4 一致）。
- 【minor】多篇样本先全部读完再横向比较共同写法与差异写法，不许只看概况下结论。
- 与审美层的接口：本协议产物落入 `style-rule` 类条目时，执行校验走 `kb/aesthetic/naturalness-zh`（24 类）与 `kb/aesthetic/dialogue`（对白标准）；稳态共性写入条目正文，个别章节变体写进 meta.variants。
