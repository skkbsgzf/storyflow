# KB 装载 · constraints（约束与标准装载）

> 由 miniflow kernel kb_load 内建装载，来源 6 个知识文件。


---

<!-- source: knowledge/market/constraints.md -->

---
{
  "id": "kb/market/constraints",
  "type": "market-standard",
  "title": "生产约束基线（短剧/漫剧实盘值）",
  "version": "2026-09-14",
  "status": "active",
  "applies_to": ["short-drama", "comic-drama"],
  "routes": ["all"],
  "asserts": [],
  "provenance": {
    "source": "import",
    "refs": ["dataset:kakaxing/scriptrawstone@2026-09-14（全量统计）", "kb/market/snapshot.formatConstraints", "storymaster-v3:assets/skills/script-drama-beat.md"]
  },
  "bind": { "skills": ["plot-choreographer"], "minitools": ["check_contract_compliance"] },
  "updated": "2026-09-14"
}
---

# 生产约束基线

**用途**：选题分析报告第五节"创作约束移交单"的默认数值来源——约束不再拍脑袋，直接取市场实盘（7938 部在售剧本的硬格式统计）。方案对这些条款逐条对账（`kb/aesthetic/oversight` 监理纪律，违反一票否决）。

## 一、体量约束（分布即标准）

| 维度 | 主流值 | 分布依据 |
| --- | --- | --- |
| 集数 | **60 集**（4224 部） | 50 集 945 / 80 集 925 / 40 集 718 / 30 集 116 |
| 单集时长 | **1-1.5 分钟** | 竖屏付费短剧口径 |
| 单集字数上限 | **1200 字**（4284 部） | 1000 字 1640 / 1400 字 528 / 1600 字 476 |
| 场景数上限 | **≤3**（7937/7938） | 几乎全库硬约束——低成本快转景 |
| 主要演员上限 | **≤10**（7925 部） | 同上 |

**用法**：方案默认按 60 集 × 1.5 分钟 × 1200 字 × ≤3 场景 × ≤10 演员声明约束；偏离主流值（如 80 集或 4 场景）必须在移交单中显式声明并给理由——偏离不是错，隐式偏离才是错。

## 二、约束 → 编排的直接推论

1. **3 场景上限** ⇒ 每集冲突必须发生在可复用景（宅门/办公室/宫殿/车厢）；换景 = 换集节拍点。剧情编排师分集时先画场景复用表。
2. **10 演员上限** ⇒ 有名有姓角色 ≤10（含反派）；群演反应拍（当众打脸必需）不计入，但"全场惊呆"必须由环境描写的群演承担。
3. **1-1.5 分钟 ≈ 600-900 字正文**（script-drama-beat 口径）⇒ 每集 8-12 拍，前 3 秒钩子约 1 拍、结尾卡点约 2 拍。
4. **60 集 × 1.5 分钟 = 90 分钟总片长** ⇒ 实际叙事容量 ≈ 一部电影的紧凑版：主线只容 1 个大反转 + 2-3 个中型反转（`kb/aesthetic/reversal` 结构位点联动），副线必须挂主线条件。

## 三、题材标签纪律

申报题材标签从市场受控词表取（快照 `genreHeatCN`/`genreHeatNA` 中的 genre 字段），不用自造词；标签组合 = 1 主题材 + 2-3 副标签（市场策划案通行形），标签顺序即卖点顺序。

## 四、与硬断言的绑定

本条目数值进入约束移交单后，由 minitool `check_contract_compliance` 逐条对账；分拍格式合规由 `AE-BEAT-FORMAT` 断言扫描（`kb/aesthetic/assertions.json`）。


---

<!-- source: knowledge/aesthetic/pacing-density.md -->

---
{
  "id": "kb/aesthetic/pacing-density",
  "type": "aesthetic-standard",
  "title": "节奏与爆点密度标准",
  "dimension": "pacing",
  "version": "1.0.0",
  "status": "active",
  "applies_to": ["short-drama", "comic-drama"],
  "routes": ["all"],
  "asserts": ["AE-DENSITY-HOT", "AE-DENSITY-CALM", "AE-DESERT", "AE-CUSHION", "AE-BEAT-FORMAT", "AE-INFO-LOAD"],
  "provenance": {
    "source": "factory",
    "refs": [
      "storymaster-v3:assets/skills/structure-rhythm.md",
      "storymaster-v3:assets/skills/script-drama-beat.md",
      "storymaster-v3:assets/skills/topic-tone-hot.md",
      "storymaster-v3:assets/skills/topic-tone-calm.md",
      "ref:write-chinese-long-screenplay/legacy/references/long-form-architecture.md（节奏与信息）",
      "session:sess_aa829e9e（爆点密度 63 vs 40 实证）"
    ]
  },
  "updated": "2026-09-14"
}
---

# 节奏与爆点密度标准

**标尺**：爆点分布无沙漠，密度对齐路线档位；节奏单调即失衡。密度实证：双专家监管版爆点密度 63 拍 vs 无监管基线 40 拍（sess_aa829e9e）——密度标准被验证为质量增量来源。

## 一、爆点密度（按路线档位）

| 档位 | 标准 |
| --- | --- |
| hot（爽版） | 每集爽点 ≥3（打脸/反转/身份碎片/金句任一）；每 3 拍一个小刺激；零时差：受辱与回击最多隔 2 拍 |
| calm（合理版） | 每集爆点 ≤1，且必须是前 ≥20 拍铺垫的兑现——爆点因稀缺而贵；浓度配比 9:1（90% 蓄力 + 10% 引爆） |
| 通用底线 | 不允许连续 5 集无爆点的"沙漠段"；两个大卡点之间必须 ≥2 个中型爽点垫场 |

## 二、卡点（hook 站位）

1. **【major】集末卡点成立**：对每集结尾必须能回答"观众为什么必须看下一集"，答不上来 = 失败卡点。两种修法：**信息型**（追加新悬念/身份一角/真相半句）或**情绪型**（情绪顶到最高点戛然而止）。
2. **【major】卡点站位**：卡点落点必须在张力峰值，不得落在情绪低谷。付费卡点（短剧）一般放第 8-10 集末尾，悬念强度到顶点（误会顶点/身份将揭）。
3. **【minor】钩子优先级**（长篇集末，wcls 口径，从优到劣）：①选择的后果 ②关系或权力状态改变 ③已有证据被重新解释 ④新义务或截止时间 ⑤纯粹外部袭击。"突然有人敲门"不改变故事模型，只是停顿不是钩子。

## 三、节拍纪律（结构节奏四查，v3）

1. **【block】因果咬合**：上一段抛出的动作、悬念或承诺，下一段必须有回应；断裂判 block 级结构病。
2. **【major】信息释放顺序**：观众此刻知道的信息应恰好比角色少半步（悬念）或完全同步（爽点）；提前泄底、动机迟迟不交代判 major。
3. **【minor】节奏单调**：连续三段长度相近、强度相近即判单调——明确指出该加速（删）还是该停顿（给细节）。
4. **【block】结构冗余**：不推动信息、关系、情绪中任何一项的段落，删除或与相邻段合并。

## 四、认知负载（wcls 口径）

- 【major】一个场/拍只设**一个主要观众认知更新**；同一拍要求整合 ≥3 个互不相关的新名词、规则或时间层 → 拆分或重排。
- 释放段（文戏）也必须改变关系、资源、解释或下一步计划；重复信息必须改变含义、可信度或情感重量。

## 五、短剧节拍硬格式（script-drama-beat）

- 场次：`第X集-第Y场 内/外 日/夜 场景名（具体到房间）`；首次出场人物完整标注（姓名/年龄/身份/性格/外形）。
- 动作：`△` 开头独立成行，每段 ≤3 行，只写可执行动作；**心理描写、文学抒情、无画面信息是禁手**（剧本是生产工具）。
- 单集 90-120 秒 ≈ 600-900 字；节奏配比：前 3 秒钩子（约 10%）→ 冲突展开（约 50%）→ 结尾卡点（约 20%）。
- 两种开局结构：慢蓄力型（前 3 集铺垫，第 6 集小爆点，第 10 集大反转，适合情感/虐恋）；快反击型（第 1 集重大冲突 + 立 flag，每 2 集一个爽点，适合爽文/打脸）。


---

<!-- source: knowledge/aesthetic/reversal.md -->

---
{
  "id": "kb/aesthetic/reversal",
  "type": "aesthetic-standard",
  "title": "反转标准（类型学与铺垫合规）",
  "dimension": "reversal",
  "version": "1.0.0",
  "status": "active",
  "applies_to": ["short-drama", "comic-drama", "long-form"],
  "routes": ["all"],
  "asserts": ["AE-REV-SETUP", "AE-REV-TYPE", "AE-REV-ADJACENT"],
  "provenance": {
    "source": "factory",
    "refs": [
      "storymaster-v3:assets/skills/reversal-typology.md",
      "ref:screenwriting-skills/sw-korean-french-screenwriting（两次反转结构）",
      "storymaster-v3:assets/skills/topic-tone-hot.md（身份撕纪律）"
    ]
  },
  "updated": "2026-09-14"
}
---

# 反转标准

**标尺**：每一次反转都能判型、有铺垫、不重复。观众感知不到"反"的反转不存在。

## 判定条款

1. **【block】铺垫合规**：每次反转必须有 **≥2 处前置暗埋**（回看成立）。零铺垫判 block——观众"被骗"而不是"震惊"。
2. **【minor】判型清晰**：四型之一可判明——
   - **身份反转**（谁是 X 实为 Y）
   - **立场反转**（敌变友、盟变敌）
   - **因果反转**（果变因、善因结恶果）
   - **预期反转**（以为 A 发生了，实为 B）
   类型模糊 → 观众感知不到反差，判 minor（建议合并到最近型或加认同锚点）。
3. **【minor】同型连用**：相邻两次反转同类型 → 第二次的惊讶度减半，判 minor；三连同型判 major。
4. **【major】反转后重算**（wcls 悬疑纪律）：反转落地后，证词、物证、时间线和人物知识必须全部重新计算——出现"反转后没人提"的悬空证据判 major。

## 结构位点（韩法大师班）

商业剧标准结构位：**两次反转**——中点一次（改写故事模型，不是提高音量）、结局前一次（引爆危机选择）。中点反转只升烈度不改模型，判 major（"中段只提高音量"病）。

## 路线差异

| 档位 | 反转纪律 |
| --- | --- |
| hot | **身份撕是主菜**：马甲一层层**当众**撕（直播间/董事会/婚礼现场），每次撕配群演反应拍（倒吸凉气/手机掉地/起立）；撕之前让反派把话说满 |
| calm | 反派体面地塌（被除名/退婚/拉黑），观众"看着他慢慢沉下去"；反转贵在"早就在等这一刻"的计划表感 |
| 通用 | 避免每集用同一种打脸/偷听/撞见（wcls 竖屏短剧纪律） |


---

<!-- source: knowledge/aesthetic/emotion-curve.md -->

---
{
  "id": "kb/aesthetic/emotion-curve",
  "type": "aesthetic-standard",
  "title": "情绪曲线标准（六型判别）",
  "dimension": "curve",
  "version": "1.0.0",
  "status": "active",
  "applies_to": ["short-drama", "comic-drama", "long-form"],
  "routes": ["all"],
  "asserts": ["AE-CURVE-TYPE", "AE-CURVE-STALL", "AE-CURVE-CROSS", "AE-CURVE-FLOOR"],
  "provenance": {
    "source": "factory",
    "refs": [
      "storymaster-v3:assets/skills/emotion-curve.md",
      "ref:screenwriting-skills/sw-korean-french-screenwriting（写情绪不写哭）"
    ]
  },
  "updated": "2026-09-14"
}
---

# 情绪曲线标准

**标尺**：全剧情绪曲线类型可判明，且无失衡段。曲线失衡不扣分于"用了哪一型"，只扣分于"失衡不管"。

## 六型判别与失衡检查

| 曲线 | 形态 | 失衡检查点 |
| --- | --- | --- |
| **压抑爆发** | 连续 ≥60% 篇幅压抑后单点爆发 | 爆发点前是否有"最后稻草"级事件——没有则爆发无力 |
| **错位甜** | 双方目的错位制造甜 | 每个甜点是否伴随信息差收紧——甜而信息差不动 = 空转 |
| **层层递进** | 赌注逐级抬高 | 任何一级不比上一级高 → 判失衡（major） |
| **螺旋下降** | 主角连续失去 | 必须有至少一个"微小反击"防止彻底丧——丧到底 = 弃剧点 |
| **双线交叉** | 两线各自推进交叉引爆 | 交叉点间距 >5 拍 → 判失衡（major） |
| **倒钩回升** | 结尾钩向开头回收 | 回景物变异 → 判 block 级断裂 |

## 换轨建议协议

判明失衡后，给出换轨建议（"此处宜切入螺旋下降"式），并注明**换轨后前 2 拍需要的铺垫调整**——不许只说"该换了"不说代价。

## 情绪书写标准（韩法大师班纪律）

- **写情绪，不写哭**：绝症片不哭；情绪浓度靠具体动作细节（半夜煮拉面、给爸爸写录像机说明书），不靠哭喊台词。此条在 calm 档为硬标准（女主不哭喊，愤怒外化为更轻的声音、更慢的动作）。
- 情绪低谷允许存在，但低谷段必须同时推进信息或关系（pacing 维度第 4 条联动），纯低谷 = 沙漠段。

## 判定输出

1. 判明全稿曲线类型（只能一主型）；判不明的，先补结构（这不是曲线问题）。
2. 逐段扫六张失衡检查表，命中即按级别标注。
3. 失衡处给换轨建议 + 铺垫代价。


---

<!-- source: knowledge/aesthetic/scene-value.md -->

---
{
  "id": "kb/aesthetic/scene-value",
  "type": "aesthetic-standard",
  "title": "场景价值转变标准",
  "dimension": "scene",
  "version": "1.0.0",
  "status": "active",
  "applies_to": ["short-drama", "comic-drama", "long-form"],
  "routes": ["all"],
  "asserts": ["AE-SCENE-DELTA", "AE-SCENE-CHEAP", "AE-SCENE-GOAL", "AE-SCENE-PRESSURE"],
  "provenance": {
    "source": "factory",
    "refs": [
      "ref:write-chinese-long-screenplay/legacy/references/core-story-engine.md（场景生成链与语义检查）",
      "ref:screenwriting-skills/sw-scene-craft（节拍 = 行动/反应）",
      "storymaster-v3:assets/skills/structure-rhythm.md"
    ]
  },
  "updated": "2026-09-14"
}
---

# 场景价值转变标准

**标尺**（wcls 麦基式场景内核）：**每场必须至少一个故事价值发生实质变化**。价值没有变化的场，合并、删除或重新设计——不是修一修。

## 一、场次卡必填字段（写场前先填，判定时逐字段核）

| 字段 | 要求 |
| --- | --- |
| 视点人物 | 必须是本场出场人物之一 |
| 场景目标 | 该人物在本场结束前想造成的**可观察**变化 |
| 故事价值 | 本场真正变化的经验维度（信任/自由/安全/权力/…） |
| 入场价值 | 开场时该价值的具体状态 |
| 主冲突 | 阻止目标的主动对抗/制度/环境/内在限制 |
| 策略 → 预期结果 | 人物相信策略会带来的结果 |
| 实际结果 → 结果落差 | 预期与实际的差异，以及差异为何**迫使人物换招** |
| 出场价值 | 结尾时同一价值的新状态 |
| 下场压力 | 本场后果使后续**必须**处理的问题 |

## 二、判定条款

1. **【block】价值无变化**：入场价值与出场价值只是换一种说法（"信任受损"→"信任出现裂痕"）→ 该场合并/删除/重设计，不是修改。
2. **【major】便宜方案**：存在人物显然会选的更便宜方案，且未建立不能使用它的原因 → 逻辑空洞，判 major。
3. **【major】主动反制**：主冲突必须主动反制（对抗会学习和适应）；环境性阻碍连续两场不动 = 反制缺席。
4. **【major】下场压力**：下一场因本场结果而必要，而不是"然后又发生了"——场与场之间只有时间关系没有因果 = 结构冗余（pacing 维度联动 block）。
5. **【minor】转折来自已建立机制**：场面转折使用已出场的人物/物件/规则；凭空出现新机制判 block（联动 ending 维度禁止项）。

## 三、来源转场景纪律（wcls：背景不许直接进对白）

小传、设定、世界规则转为场景的顺序：找相关事实 → 判定此刻是资源/限制/风险/误导 → 人物按欲望与已知选择策略 → 对抗具体反制 → 用动作/物件/空间/声音提供证据 → 记录观众可推断与应未知的内容 → 写入连续性台账。

## 四、与短剧节拍的换算

短剧一"场" = 若干拍；上述字段在拍级降维执行：每拍一个认知更新（pacing 维度），每 2-3 拍一次价值微变，集末拍 = 出场价值极值 + 下场压力最大化（卡点）。


---

<!-- source: knowledge/aesthetic/ending.md -->

---
{
  "id": "kb/aesthetic/ending",
  "type": "aesthetic-standard",
  "title": "结局标准（反推五条件与禁止项）",
  "dimension": "ending",
  "version": "1.0.0",
  "status": "active",
  "applies_to": ["short-drama", "comic-drama", "long-form"],
  "routes": ["all"],
  "asserts": ["AE-END-MECH", "AE-END-PAYOFF", "AE-END-AFTER"],
  "provenance": {
    "source": "factory",
    "refs": [
      "ref:write-chinese-long-screenplay/legacy/references/long-form-architecture.md（结局反推）",
      "ref:write-chinese-long-screenplay/legacy/references/core-story-engine.md（结局价值与余波）",
      "ref:screenwriting-skills/sw-korean-french-screenwriting（苦乐相掺结局、先写首末幕）"
    ]
  },
  "updated": "2026-09-14"
}
---

# 结局标准

**标尺**：结局从终点**反推**设计——强结局在动笔前就知道落点（韩法纪律：先写第一幕和最后一幕）。

## 一、强结局五条件（全满足才算强）

1. 外部机制**此前已经展示**（高潮用的规则观众见过）
2. 人物做出**早期自己做不到的选择**（人物弧光的兑现——character 维度人物真相联动）
3. 代价与冲突规模**相称**
4. 重要铺垫得到**可感知回收**（calm 档伏笔回收率 >60%）
5. 关系和世界的新状态**可被看见**（用行为、资源、边界、公开身份展示新秩序，不靠口头总结）

## 二、禁止项（全部 block）

- 高潮新规则（用一个此前不存在的机制解决主冲突）
- 突然认罪（反派无压力动机的自我暴露）
- 偶然救援（巧合解决主冲突）
- 临时出现的万能人物
- 通用积极结论（"这说明希望仍在"式收束——naturalness 维度第 24 类联动 block）

## 三、结局价值与余波（wcls 因果链第 8 节点）

- 高潮行动造成**全片最大价值变化**（价值变化 = 主题命题的证明——"某种价值结果，因为人物以某种方式行动"）。
- 余波必须展示：新秩序、损失、**仍未消失的代价**。代价归零 = 冲突规模撒谎，判 major。
- 苦乐相掺（韩法口径）：完美圆满或全盘皆输都是偷懒；两难选择的两难代价要在结局仍然可见。

## 四、短剧特化

- 付费卡点之后至结局的"偿付段"：卡点承诺的悬念必须在偿付段足额兑现（欠观众一个打脸 = 流量反噬）。
- 集末钩子在结局集转为"完播钩"——结局集末尾给出满足感闭环或续季钩（二选一显式声明，不许两不靠）。
