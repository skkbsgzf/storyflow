---
{
  "id": "kb/aesthetic/constitution",
  "type": "aesthetic-standard",
  "title": "审美体系总纲",
  "dimension": "constitution",
  "version": "1.0.0",
  "status": "active",
  "applies_to": ["short-drama", "comic-drama", "long-form"],
  "routes": ["all"],
  "provenance": {
    "source": "factory",
    "refs": [
      "storymaster-v3:assets/skills/topic-chief-aesthetic.md",
      "ref:write-chinese-long-screenplay/legacy/references/self-review.md",
      "ref:ai-screenplay-writer/README.md",
      "session:sess_aa829e9e"
    ]
  },
  "updated": "2026-09-14"
}
---

# 审美体系总纲

审美体系回答一个问题：**什么叫"好"**。全部判定围绕一根标尺——**对标作品里被数据验证过的强度**：对标做到的，方案必须做到；对标没做到的，方案做到才算超额。好作品 = 主旋律选题 + 新意诠释 + 扎实基本功（会话实证结论），三者缺一即打回。

## 一、价值模型（四条公理）

1. **对标锚定制**：一切强度判断以对标件（benchmark）为参照系，不以评审个人口味为参照。"我觉得不够爽"无效；"对标同等位置做到了 X，本稿只有 Y"有效。
2. **合同优先于审美**：创作约束移交单（分析报告产出）的硬条款一票否决审美加分。总编管爽不爽，监理管违约不违约。
3. **强度底线不退，风格路径可选**：快餐档"宁可过火，不可温吞"；深沉档"宁可克制，不可廉价"。路线影响爆点密度与表达方式，不影响"每一拍必须有效"的底线。
4. **判定-重写闭环**：判定不是出报告——不达标的段落当场重写到位（审美总编纪律"重写到位，而非附整改意见"）；重写后复判，带病放行视为判定失败（取自 ai-screenplay-writer 的 validator-retry 语义）。

## 二、十二判定维度

| 维度 | 条目 | 一句话标尺 |
| --- | --- | --- |
| hook | `kb/aesthetic/hook-3s` | 3 秒内产生生理反应 |
| pacing | `kb/aesthetic/pacing-density` | 爆点分布无沙漠，密度按路线档位 |
| curve | `kb/aesthetic/emotion-curve` | 曲线类型明确，无失衡段 |
| character | `kb/aesthetic/character` | 压力下选择揭示人物真相，主角最多维 |
| conflict | `kb/aesthetic/conflict-escalation` | 代价梯只升不降，危机是两难选择 |
| scene | `kb/aesthetic/scene-value` | 每场价值必须有变化，有结果落差 |
| reversal | `kb/aesthetic/reversal` | 反转判型清晰，铺垫 ≥2 处 |
| dialogue | `kb/aesthetic/dialogue` | 每句台词是一种行动 |
| naturalness | `kb/aesthetic/naturalness-zh` | 过 24 类去模板化清单 |
| visual | `kb/aesthetic/visual-poster` | 关键爆点画得成海报级分镜 |
| platform | `kb/aesthetic/platform-compliance` | 卡点成立，合规红线不降档 |
| ending | `kb/aesthetic/ending` | 强结局五条件，禁止高潮新规则 |

## 三、判定级别（severity，融合 v3 三态与 wcls 三级）

| 级别 | 含义 | 处置 |
| --- | --- | --- |
| `block` | 一票否决：合规红线、硬条款违反、零铺垫反转、禁止性结局手段 | 整份不合格，重写后重查；**不许降档** |
| `major` | 明确损害：因果断裂、价值无变化、密度不达档位、对白无行动 | 当场重写到位 |
| `minor` | 提示级：节奏单调、钩子超长、轻微模板腔 | 修则更好，可带 minor 放行 |

判定纪律（继承 v3）：**拿不准时降一档**（block→major→minor）；**唯一例外是合规与合同条款，永不降档、宁可错报不可漏报**。

## 四、判定流程（四步）

1. **对账**（oversight 维度先行）：约束移交单逐条对账，硬条款违反直接判 block，后面的步骤不用走。
2. **质量扫描（证据制）**：`tools/quality-scan.py` 把机器可查项逐条跑成收据（钩子、密度、铺垫数、格式、红线）——v5.0 起扫描器只出数字与位置，不做提交拦截；引用收据才算「已扫描」（铁律 10 升级版）。
3. **语义判定**：扫描器查不出的（人物真相、潜台词、情绪质量、名场面强度）按十二维度判定，条款家 = `knowledge/rules/` 规则卡（激活由决策记账），每条意见注明依据的维度条款。
4. **盲读复核**（wcls 分层自审 + 韩法"念给苛刻的人听"）：关闭设定资料，仅读正文——钩子测试（没看过背景的人问"然后呢"过，问"这是什么意思"重写）、盖名测试（遮住人名可辨说话者）、卡点测试（每集末答"为什么必须看下一集"）。

## 五、首集宽容条款（取自 ai-screenplay-writer）

首集（pilot）判定只查**与 Bible 的矛盾**（类型错位、人物错置、无视关键设定）；合理的新元素、新地点、人物层次**不作为扣分项**。续集起转入连续性严检：只抓不可否认的矛盾（死而复生、类型突变、重大情节冲突），不阻拦故事自然演进。长程连续性由 summary memory（前情摘要）+ 连续性台账支撑，审美判定不重复台账的职责。

## 六、知识层的位置

本总纲是**标准**（what good looks like）。执行方法论（审美总编怎么注入、怎么行使终审权）在 skill 层（`审美总编`、`需求交付监理`，自 v3 移植）；绑定与校验操作（断言扫描、对账表生成）在 minitool 层（`check_aesthetic_asserts`、`check_contract_compliance`）。三层缺一不可。
