# kit 底座落地 · R3（装载复位 → kit@1 契约 → 四域 → 迁移）

> 日期：2026-09-17 ｜ 承接 `kit化改造-定向调研-R1.md` 与 `kit化改造-外部调研对照-R2.md`
> 用户判词：**「尽快重构整个 kit 底座，写文效果太差」**——故本批不再等分类拍板，先动与写文效果直接相关的装载链路，再落分类。

## 一、一句话结论

R1 查到的**知识装载断路已经修好**：此前 flow 的 agent 节点用 `node.kb` 声明判定条款、内核却只读 core 节点的 `node.loads`，**没有任何代码读 `node.kb`**——22 张美学卡、74 条硬断言对写手不可见，写手只拿到方法论长文和上游摘录。现在节点改为 `kit`+`op` 引用，内核在 `buildTaskPackage` 单点装载标尺，**实测已进入指令正文与派发头**。

## 二、改动清单

### L1 内核（装载复位）

| 文件 | 改动 |
| --- | --- |
| `core/src/kits.ts` | **新增** KitRegistry：加载 `kits/*/kit.json`，`resolve(kit,op)` 显式解析 + `bySkill()` 兼容期反查；报歧义技能 |
| `core/src/assembler.ts` | `buildTaskPackage` 新增标尺装载：`kit.op.knowledge` 优先，节点 `kb` 仅在无 kit 归属时生效；产出 `knowledge` 回调清单与 `kitRef` 回显；**缺失条目显式回显**（不静默丢弃） |
| `core/src/spawn.ts` | 派发头新增【判定标尺】段：列出卡片与来源路径，要求交付前逐条对照 |
| `core/src/types.ts` | `FlowNode` 增 `kit`/`op`；`TaskPackage` 增 `knowledge`/`kitRef` |
| `core/src/schema.ts` | `SCHEMA_IDS` 增 `kit` |
| `contracts/kit.schema.json` | **新增** `kit@1` 契约（flow-pack 的子单位，不新造平行层） |
| `contracts/task-package.schema.json` | 增 `knowledge`/`kitRef` |
| `core/test/kits.test.ts` | **新增** 11 项回归（注册表/解析/装载/封顶/glob/漂移兼容/派发头） |

**装载预算**：单卡 1600 字、总量 9000 字封顶。超限与不存在都写进「标尺缺口」段——延续仓库自己的判词：*约束不进上下文 = 约束不存在*。

### L2 四域 kit（单一事实源）

`kits/<域>/kit.json`，共 **55 ops**：

| 域 | ops | 域内操作 |
| --- | --- | --- |
| `search` | 9 | 拆书 / 找梗 / 素材解剖 / 时代情绪 / 调研聚合 / 方案 / 审美总编 / 交付对账 / 网感 |
| `plot` | 8 | 结构选型 / 单元剧大纲 / 剧情编排 / 分场锻拍 / 短剧节拍 / 开书 / 世界观 / **剧情红队（review）** |
| `prose` | 10 | 台词师 / 场景师 / 设定官 / 成文师 / 去AI味 / 终稿评审（review）/ 章回写手 / 台词打磨 / 成品剧本 / Seedance提示词 |
| `tool` | 28 | 内核 minitool（12）+ `tools/` 脚本（16）——确定性底座，跨域共用 |

红队不再无家：`plot-redline` 以 `kind: "review"` 落在 plot 域（负载独立计量，裁决权默认人工，未动铁律 6）。

### L3 迁移（47 个 agent 节点）

- 全部 7 个 flow 的 agent 节点：`skill` + `kb` → `skill` + `kit` + `op`，**保留 skill 字段**（人类可读且与 op 同源）
- 文本级迁移，**格式零损伤**：紧凑单行节点与展开多行节点都原样保留（首次用 `json.dumps` 重写时炸出 747 行噪声 diff，已回退重做）；最终 diff 仅 38 insertions / 109 deletions（删的是无人读的 kb 清单）
- 收编 kb 声明 114 条（并集进入 kit）、悬空 0

### L4 校验器

- `tools/kit-lint.py` **新增**：E1–E6 错误级（契约/技能档案/知识条目/minitool 登记/flow 引用/跨 kit 歧义）+ W1–W4 警告级（孤儿技能/未用技能/悬空知识/断言缺口）
- `tools/kit-migrate.py` **新增**：从技能与 flow 反推 kit（**合并式**——flow 迁移后 kb 已删，重跑不丢数据）
- `tools/flow-kit-apply.py` **新增**：节点迁移（幂等可复跑）
- `tools/minitools.json`：补登 3 个既有但未登记的工具（`kb_read` / `flow_read_artifact` / `continuity_check`），补全 10 个未登记技能中文名

## 三、验证（全绿）

| 项 | 结果 |
| --- | --- |
| `tsc --noEmit` | OK |
| `vitest run` | **47 passed**（新增 11） |
| `flow-lint.py` | **0 errors**（warnings 19→9，余下均为 planned minitool 的忠实提示） |
| `kit-lint.py` | **0 errors / 6 warnings** |
| `validate-kb.py` | 全 PASS（顺带修掉 2 处既有悬空引用：`kb/market/market-structure`→`structure`、`kb/market/internet-feel-formulas`→`internet-feel`） |
| 端到端冒烟 | `topic-selection` 跑通：主任务与并行批的 taskPackage 均带 kitRef + 标尺段，派发头渲染卡片清单 |

冒烟实证（find-trope 节点）：

```
kitRef → {"kit":"search","op":"find-trope","domain":"search","skill":"find-trope","kind":"produce"}
装载 6 张标尺卡：kb/trope/chongsheng-fuchou (1598 字) … kb/trope/na-fantasy (1002 字)
派发头 → 【判定标尺（域：search / search.find-trope）】…交付前逐条对照
```

## 四、本批挖出的新问题（未修，待你定）

1. **`novel-prose` 根本跑不通**（最高优先）：`ledger` 节点是 core 节点却未声明 `minitool`，`flow_run` 直接 `blocked`——`minitool「(未声明)」未实现`。且它想要的 `continuity_slice`/`continuity_commit` 在注册表里是 **planned**（`novel-longform` 同病）。**长篇成文链卡在第一步**，这是"写文效果差"里比分类更硬的一环。
2. **53/74 条断言无 op 覆盖**：断言表有 74 条，flow 里只有 21 条被 check 节点引用。写手现在能通过标尺看到条款，但仍有一大半**没有闸门执行**（红队/评审类断言尤其集中）。
3. **5 个孤儿技能**：`internet-feel` / `novel-judge` / `render-prompt-seedance` / `topic-chief-aesthetic` / `topic-delivery-gate` 有档案有 kit，但无任何 flow 引用——`novel-judge` 尤其可惜（它是多轮精修内环的判分器）。
4. **`topic-zeitgeist` 无标尺**：技能 frontmatter 没有 `bind.knowledge`，装载 0 张卡（时代情绪锚目前裸跑）。
5. **glob 全量 vs 检索取数**：`kb/trope/*` 是 13 个文件，装载被封顶截到 6 张。当前行为（封顶+缺口提示）比"静默全塞"好，但正解是 R2 提到的检索式取数（`kb_search`/`kb_read` 仍 planned）。

## 五、建议顺序

1. **K2 打通成文链**（半天级）：修 `novel-prose.ledger`（声明 minitool 或改为由设定官承担的 agent 步），让 `flow_run novel-prose` 能跑到第一个 agent 节点——不修这个，标尺装得再好也发不出去。
2. **K3 断言接入**：把 53 条无覆盖断言按 op 归位（`kit-lint` 已能列出清单），让"标尺可见"变成"闸门可执行"。
3. **K4 孤儿技能归流**：`novel-judge` 接进 `novel-deai` 的多轮精修内环；`internet-feel`/`topic-delivery-gate` 接进选题交付链。
4. K5 检索式取数（`kb_search`/`kb_read` 落地），替换 glob 全量装载。

> 命名：`kit` 一词现由 kit@1 域单位使用；`tools/kit.py` 的 vendor 器仍在用同名概念，建议后续改名（本批未动，避免与铁律 1 的既有引用打架）。
