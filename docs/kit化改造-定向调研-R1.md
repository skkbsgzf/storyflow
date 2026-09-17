# kit 化改造 · 定向调研 R1

> 触发：用户提出「toolkit 设计比较碎，常出现效果不达预期」；拟将全部能力收敛为 **search kit / plot kit / 文学 kit / tool kit** 四大类，每 kit 含一系列工具，在 flow 底座下拼接成各种 flow。
> 范围：`D:\storymasterv4` 全仓盘点（flows 7 · skills 27 · knowledge 81 · agents 5 · stages 4 · tools 15 · core 内核）
> 日期：2026-09-17 ｜ 结论一句话：**方向对，但「碎」不是主因；先修断路，再换分类。**

---

## 一、体检数据（硬事实）

| 维度 | 现状 | 判读 |
| --- | --- | --- |
| flow 条数 / agent 节点 | 7 条 / **47 个** | 流程规模已成型 |
| 被 flow 使用的技能 | 22 个（技能库共 27） | **5 个孤儿技能**：internet-feel / novel-judge / render-prompt-seedance / topic-chief-aesthetic / topic-delivery-gate（有档案、零流程） |
| 单一技能最大负载 | **plot-redline 独占 12 个节点（26%）** | 红队是横切能力，不属于任何单一题材域 |
| 其余技能负载 | 大多 1-3 个节点，11 个技能仅 1 个节点 | 长尾严重 |
| 技能的 `stage` 字段 | **16 种不同取值**，铺在 27 个技能上 | 平均每阶段 1.7 个技能——阶段轴已碎 |
| knowledge 分类 | `index.json` 13 个 type ↔ 磁盘 10 个子目录（aesthetic 22 / benchmark 28 / trope 13 / market 7 / …） | 两套分类并存且不对齐 |
| 知识资产被绑定额 | 81 条中 **49 条从未被任何技能 bind 引用** | 知识库「有存量、无接线」 |
| 硬断言 | 74 条（AE-* 30 个前缀族） | 断言体系成熟，但没有一条真正进入执行上下文（见 §三） |
| minitool 登记 | 9 个（4 已实现 / 5 planned），其中 kb_search、kb_read 为 planned | 技能库里 `bind.minitools: kb_search` 的技能 5 个 → **触达即 blocked** |
| 技能登记 | 27 个文档中 **10 个未登记**进 `tools/minitools.json` 的 skills 表 | 与「三层不拆开用」纪律（蓝图 §九-3）直接冲突 |
| 静态校验 | flow-lint 0 error / **23 warning**；validate-kb 1 **FAIL**（2 处悬空 kb 引用） | 有报警，但都是 warning 级，无人守 |

---

## 二、「碎」的真相：七个分类轴同时存在且互相交叉

同一批资产（技能 / 知识 / 工具）被七套分类语言各自描述一遍，没有一处能回答「做某件事，到底需要哪些人和哪些卡」：

| # | 分类轴 | 载体 | 例子 |
| --- | --- | --- | --- |
| 1 | 分层 | L1/L2/L3 目录 | tools/ · skills/ · knowledge/ |
| 2 | 阶段 | skill `stage` 字段（16 值）· flow `stages[]` | inspiration / novel_polish / prose_layer… |
| 3 | 载体题材 | 技能名前缀 | `script-*` / `novel-*` / `topic-*` |
| 4 | 知识类型 | knowledge `types`（13 类） | aesthetic-standard / trope / benchmark… |
| 5 | 封装分发 | stage@1 · flow-pack | stages/ 4 个 · contracts/flow-pack |
| 6 | 项目副本 | kit.py vendor | `<project>/kit/` |
| 7 | 确定/认知 | minitool impl | kernel / check-integrity / planned |

**四 kit 方案会引入第八个轴。** 如果它不**取代**其中至少 3 个轴（尤其 #2 #3 与三处声明），结果必然是"又清楚了一层，又多碎一层"。

---

## 三、效果不达预期的真实机制（四条证据链，比分类问题严重）

### 3.1 【致命】知识装载断路——约束声明了，但内核不读

仓库自己的话：`kb/craft/prose-constraints` 开头写着「**约束不进上下文 = 约束不存在**」。实测结果：这句话当前**是字面成立的**。

内核 `core/src/minitools.ts` 的 `kb_load` 读取字段是 `node.loads`：

```ts
function resolveLoads(loads: string | string[] | undefined) { … }
const files = resolveLoads(node.loads);
```

而 flow 的 **agent 节点**声明知识用的是另一个字段 `kb`：

```json
"beats": { "kind": "agent", "skill": "scene-breakdown",
           "kb": ["kb/aesthetic/pacing-density", "kb/aesthetic/scene-value", …] }
```

全 `core/src` 搜索结果是——**除了 `kb_load` 读 `loads`，没有任何代码读取 `kb`**；`buildTaskPackage()`（任务包组装器）只注入三样东西：skill md + 上游产物摘录 + 背景卡。`spawn.ts`（派发头）只渲染角色/背景/工具纪律/指令/上游依据，**不渲染 profile 的 knowledge 清单**。

于是形成四条断头路：

| 声明处 | 字段 | 是否真装载 |
| --- | --- | --- |
| flow 的 core 节点 | `loads` + `minitool: kb_load` | ✅ **唯一生效**（全仓仅 7 处：book-deconstruct.pre、novel-fanqie.market/benchmark、novel-longform.market、outline-production.constraints、topic-selection.market/benchmark） |
| flow 的 agent 节点 | `kb: [...]` | ❌ 无任何代码读取（**35 个节点**） |
| skill frontmatter | `bind.knowledge` / `rubric:` | ❌ 未读取（rubric 只是散文） |
| agent profile | `three_layer_binding.knowledge` | ⚠️ 投影进 `taskPackage.profile.knowledge` 后**被派发头丢弃**；且宿主无 `kb_read` 工具（planned）可自行取数 |

**实测后果**：74 条硬断言、22 张 aesthetic 卡（沙漠段/遮名测试/比喻配额/去AI味 24 类/结构机味五指纹）中，真正能到达写手或红方眼睛的，只有 `market / benchmark / constraints / deconstruct` 这几张被 core 节点装载的卡。其余全靠宿主「自觉考古读文件」——**这正是 R1/R2 报告反复指认的同一句话：正确的方式不是最顺手的方式。**

### 3.2 声明漂移：flow 给的红线和技能自称的红线对不上

把「节点 `kb` 清单」逐节点比对「技能 `bind.knowledge`」：

> **47 个 agent 节点里，40 个存在漂移**（缺载或多载）。

最刺眼的两个：

| 现象 | 数据 |
| --- | --- |
| 红队执行时手里没有红队的卡 | plot-redline 的 12 个节点（含 gate-r1…r5）`kb` 全为空；而技能自称需要 `perspective-review` + `unreasonable-highlight` + `ai-trace` + `structure/catalog` 四张——**四视角代入制的评审，在没有任何视角卡的情况下执行** |
| 技能被挪用到语义不匹配的岗位 | `novel-prose.beats`（"分场小纲锻成五行卡节拍"）挂的是 `scene-breakdown`——该技能的契约其实是 **竖屏短剧小纲 doc + 客户批注回流**。它自称要 `dialogue` + `character` 卡（节点没给），节点却塞了 `hook-3s` + `longform-engineering`（技能没声明）。**需求与供给双向错配** |

### 3.3 复用即漂移：一个技能被按不同语义反复使用

`plot-redline`（12 次）、`scene-breakdown`（2 次、两种语义）、`deconstruct-book`（4 个节点）、`novel-deai`（3 次 polish）。技能是「方法论长文」，**不是可参数化的接口**——同一个 md 在短剧/网文/拆书三种语境下复用，只能靠散文描述里的"你按情况判断"，效果自然漂。这是"碎"的另一种表现：**能力没有契约面，只有文档面。**

### 3.4 类目失衡：按题材语义切出的四类，和真实负载对不上

47 个 agent 节点的实际负载：

| 拟设 kit | 覆盖节点 | 占比 |
| --- | --- | --- |
| search kit（找梗/热点/调研/拆书） | ~11 | 23% |
| plot kit（结构/编排/节拍/分场） | ~6 | 13% |
| 文学 kit（层稿/成文/打磨/章回） | ~15 | 32% |
| tool kit（确定性工具） | 0（core 节点不计 token） | — |
| **无处安放** | **红队 12 + 设定/连续性 + 交付终章 ~3** | **32%** |

**红队独占 26%，四类里没有它的位置**；`world-forge` / `novel-bible` / `worldbook.py` / `continuity_*`（设定与连续性）、`export-doc` / `format-compliance` / `publish-review` / `render-prompt-seedance` / `fin(srd)`（交付与外化）同样无家可归。

---

## 四、对「四 kit」方向的评估

### 4.1 方向对的部分（值得做）

1. **收敛单位是对的**：现在一个"能力"被拆散在 4 个文件里（skill md + kb 条目 + minitool 登记 + flow 节点内联清单），kit 把它重新粘回一个可引用单位——**这才是治碎的正解**。
2. **"可在 flow 底座下拼成各种 flow"是对的**：kit 作为乐高块，比现在的 `node.kb` 手写清单更能复用。
3. 与既有资产同构：`contracts/flow-pack.schema.json`（L2 领域包）已经在做"目录 + manifest + skills/knowledge/minitools 清单"，**kit 应当做成 flow-pack 的子单位（pack ⊃ kits），而不是新造一层平行概念**——否则分类轴从 7 变 9。

### 4.2 必须修正的部分（否则白做）

| # | 问题 | 建议 |
| --- | --- | --- |
| **P1** | **tool kit 与前三类不同轴**：前三类是"认知工种域"，第四类是"实现层"。并列会让"工具"既被当同类、又被当底座 | tool kit **降为 L1 底座**（每个 kit 自带 `tools:` 子层），不参与域分类；或改名 `engine / toolbox` 明确它是层不是域 |
| **P2** | 缺两个真实存在的域：设定/连续性、交付/外化 | 补 **canon kit**（world-forge / novel-bible / worldbook / continuity 台账）与 **delivery kit**（script-final / render-prompt / format-compliance / publish-review / export 链） |
| **P3** | 红队无家可归且负载最大（26%） | 独立成 **review kit**（横切域，服务所有阶段），或每个 kit 内设 review 子层——**建议独立**，因为它的上下文隔离要求（不读生产推理）与其他域正交 |
| **P4** | **命名冲突**：`kit` 一词在本仓已被占用两次——`tools/kit.py` 的 vendor 模型（决策日志 #12）、`conformance kit`（测试考卷）；且项目全名就是 "Harness **Toolkit**" | 三选一：① 域包改名 `domain pack / cap-kit`；② 保留 `kit` 为域，把现有 vendor 改名 `toolbox/工作组件副本`；③ 域包直接叫 `kit`，vendor 降级为 `toolbox vendor`。**需拍板** |
| **P5** | 分类轴必须唯一且可校验 | kit 归属写进 manifest 并在 flow-lint 里强制（节点 `kit` 必须存在、`op` 必须在 kit 的 ops 清单内），否则新分类会像今天的 `kb` 字段一样变成装饰 |

---

## 五、建议的 kit 模型（kit@1 草案）

核心思路：**kit 成为 flow 节点引用能力的唯一单位**，由内核从 kit 解析出 skill + 装载清单 + 工具白名单 + 输出契约——**node.kb / skill.bind / profile.knowledge 三处声明退役为一处**。

```jsonc
// kits/plot/kit.json  (kit@1)
{
  "format": "kit@1",
  "id": "plot",
  "name": "剧情 kit",
  "version": "1.0.0",
  "axis": "domain",                      // domain | engine —— 明确轴，禁止混杂
  "applies_to": ["short-drama", "webnovel"],
  "members": {
    "skills":    ["structure-design", "plot-choreographer", "episodic-outline", "script-drama-beat"],
    "knowledge": ["kb/structure/catalog", "kb/aesthetic/pacing-density", "kb/aesthetic/reversal"],
    "minitools": ["check_aesthetic_asserts", "check_trope_combo"],
    "profiles":  ["story-choreographer"],
    "templates": []
  },
  "ops": [                               // ↑ 工种面：flow 节点引用的是 op，不是 skill
    { "id": "structure-pick", "skill": "structure-design",
      "loads": ["kb/structure/catalog", "kb/aesthetic/pacing-density"],
      "in":  ["选题调研报告@1"], "out": "故事框架案@1" },
    { "id": "beat", "skill": "script-drama-beat",
      "loads": ["kb/aesthetic/pacing-density", "kb/aesthetic/hook-3s"],
      "in": ["分集大纲@1"], "out": "分集剧本@1" }
  ]
}
```

flow 节点随之从"手写清单"变为"引用工种"：

```jsonc
// 现在（声明散落、无人校验）
"beats": { "kind": "agent", "skill": "scene-breakdown",
           "kb": ["kb/aesthetic/pacing-density", …] }

// 改后（单一事实源，内核解析装载）
"beats": { "kind": "agent", "kit": "plot", "op": "beat", "file": "成文节拍卡.md" }
```

**收益**：① 3.1 的断路在 `buildTaskPackage` 一处改动即修复（35 个节点同时受益）；② 3.2 的漂移在结构上不可能发生（清单只有一个来源）；③ 3.3 的复用漂移被 `ops` 的 in/out 契约约束；④ 新分类可被 flow-lint 机械校验。

---

## 六、建议的域划分（5 认知域 + 1 引擎底座）

| kit | 定位 | 主要成员（建议） |
| --- | --- | --- |
| **search**（取材） | 外部信息与素材获取 | find-trope · material-dissect · topic-zeitgeist · internet-feel · deconstruct-book · topic-analysis-report ⟷ kb/market/* · kb/trope/* · kb/benchmark/* · kb/deconstruct/* |
| **plot**（剧情） | 结构与情节设计 | structure-design · plot-choreographer · episodic-outline · script-drama-beat · scene-breakdown ⟷ kb/structure/* · kb/aesthetic/{pacing-density,reversal,emotion-curve,scene-value,ending,hook-3s} |
| **canon**（设定连续性）**新增** | 世界观/人物/台账一致性 | world-forge · novel-bible ·（layer-canon 的连续性职责）⟷ kb/continuity/* · kb/aesthetic/character · kb/market/setting-rules ｜ tools: worldbook.py |
| **prose**（文学） | 文本执行与质量 | layer-voices · layer-scenes · layer-canon · prose-assembler · novel-chapter · novel-deai · dialogue-polish · novel-judge ⟷ kb/craft/prose-constraints（路由总纲）· kb/aesthetic/{dialogue,naturalness-zh,ai-trace,slop-list,metaphor-zh} · kb/formats/* |
| **review**（红队）**新增** | 横切评审，不读生产推理 | plot-redline · first-reader · topic-chief-aesthetic ⟷ kb/aesthetic/{perspective-review,unreasonable-highlight,ai-trace,redline-scoring} |
| **delivery**（交付）**新增** | 外化与合规 | script-final · render-prompt-seedance · topic-delivery-gate ⟷ stages/{format-compliance,publish-review,polish} ｜ tools: export-doc / project-pages / render-flow / serve / snapshot |
| **engine**（tool 底座） | 确定性机制，所有 kit 共用 | tools/*.py（15）+ 内核 minitool（9）｜ **不参与域分类** |

> 若坚持"四类"，最小可行妥协是：把 canon 并入 plot、把 delivery + review 并入 prose，但需接受 「设定一致性」与「红队隔离」两条纪律失去独立载体——**不建议**。

---

## 七、落地顺序（关键：先修断路，再换分类）

**不要一次全量重构。** 若先换分类后修装载，会出现"分类更清楚了但效果没变"，并把归因错判到"分类还是不对"上。

| 批次 | 内容 | 验收口径 |
| --- | --- | --- |
| **K1 装载复位**（半天级，最高优先） | `buildTaskPackage` 增加知识装载：agent 节点 `kb`（或 kit.op.loads）解析 → 知识卡正文注入任务包；`spawn.ts` 渲染装载清单与收据 | 任取一个节点（如 novel-fanqie.chapter）看任务包：`kb` 声明的 3 张卡正文在场；实测红队节点的四视角卡在场 |
| **K2 声明收敛** | 抽出 `kits/**/kit.json`；flow 节点改 `{kit, op}` 引用；`node.kb`/`bind.knowledge`/`profile.knowledge` 三处退役或由 kit 生成 | flow-lint 新增校验：节点 kit/op 必须存在、装载清单只有一个来源；47 节点零漂移 |
| **K3 分类定轴** | 按 §六确定域划分并落 manifest `axis` 字段；engine 与 domain 分离 | 每个域可独立成线跑通一条最小 flow；孤儿技能（5 个）归位或删除 |
| **K4 命名与契约** | 处理 `kit` 命名冲突；新增 `contracts/kit.schema.json`；kit 定位为 flow-pack 子单位 | 决策日志留档；蓝图中 flow-pack 章节同步更新 |

---

## 八、待拍板决策点

1. **分类轴定在哪**：按"认知工种域"（本报告 §六，5 域 + engine 底座）｜还是严格四类（接受 canon/delivery/review 无独立载体）？
2. **tool kit 的位置**：降为 L1 底座（推荐）｜还是保留为并列第四类？
3. **命名**：`kit` 保留给域（vendor 改名 toolbox）｜还是域改名 `domain pack / cap-kit`（vendor 保持不动）？
4. **红队**：独立 review 域（推荐）｜还是每 kit 内设 review 子层？

---

## 附 · 复现命令

```bash
python tools/flow-lint.py                 # 0 error / 23 warning
python tools/validate-kb.py               # 1 FAIL：2 处悬空 kb 引用
# 节点 kb ↔ 技能 bind.knowledge 漂移比对：见本报告 §3.2（40/47）
# 知识装载断路：core/src/minitools.ts:18-56（读 loads） vs core/src/assembler.ts:143-192（不读 kb）
```
