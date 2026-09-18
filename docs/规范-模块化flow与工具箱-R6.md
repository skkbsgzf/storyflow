# 规范 R6 · 模块化 flow 与工具箱编排

> 分支：`module-flow-v3`（**不考虑向后兼容**，旧格式一次性转换后废弃）
> 前置：R4（项目文件与流程配置）、R5（生成式 flow 与运行时编排）
> 一句话：**flow 不再手画节点与边，而是「模块序列」。模块 = 一个工种的工具箱 + 默认骨架 + 插槽。节点与边由内核从骨架派生。**

---

## 零 · 这份规范要解决的四个具体痛

| # | 现状（有实测依据） | 目标 |
| --- | --- | --- |
| 1 | `flow.json` 手写节点与边；契约 561 行、单个 flow 数百行；R4 已诊断 **98/98 条边都在复述目标节点的执行体**（纯漂移面） | flow 只写**模块序列**（~30 行）；节点与边**派生** |
| 2 | 审核语义纠缠在节点上：`isBoundaryGate` / `isWorkGate` 两套判据并存，域内评审步照跑但不打回，语义反直觉 | 审核**只在模块之间**；模块内无门、无打回 |
| 3 | 10 个 tool 只能用默认 4 个；多出来的没有合法的「插入位置」概念 | **插槽 + 能力标签**：说要什么能力，内核挑工具接线 |
| 4 | 文件按「桶」分类（`内部/{意见,收据,依据,稿本}`），一个文件属于哪一步看不出来 | **按模块分段**：一个模块一个目录，产物与意见就地 |

---

## 一 · 模块模型 `module@1`（取代 `kit@1`）

模块 = 一个认知工种的**完整工具箱 + 默认骨架 + 插槽表**。

```json
{
  "format": "module@1",
  "id": "plot",
  "name": "编剧",
  "desc": "主线剧情、人设、暗线、伏笔悬念的编排",
  "ops": {
    "plot-choreographer": {
      "title": "主线编排",
      "skill": "plot-choreographer",
      "kind": "produce",
      "knowledge": ["kb/craft/conflict-escalation"],
      "asserts": ["AE-BEAT-FORMAT"],
      "config": { "depth": { "type": "number", "default": 3, "desc": "…" } },

      "capability": ["主线"],
      "slot": "after:structure-design",
      "also_fits": ["before:scene-breakdown"],
      "requires": ["structure-design"],
      "adds": { "asserts": [], "knowledge": [], "config": {} }
    }
  },
  "skeleton": {
    "spine": ["structure-design", "plot-choreographer", "novel-bible", "scene-breakdown"],
    "edges": [
      ["structure-design", "plot-choreographer"],
      ["novel-bible", "plot-choreographer"],
      ["plot-choreographer", "scene-breakdown"]
    ]
  },
  "caps": ["主线", "人设", "暗线", "伏笔", "悬念", "分场"]
}
```

### 字段语义

| 字段 | 含义 | 缺省 |
| --- | --- | --- |
| `ops.<tool>` | 一个 tool（原 `kit@1` 的 op，字段全部沿用） | — |
| `ops.<tool>.capability` | **这个 tool 提供什么能力**（渲染与选工具的唯一依据） | 必填 |
| `ops.<tool>.slot` | 默认插入点，`after:<tool>` / `before:<tool>` / `end` | 必填（非骨架成员） |
| `ops.<tool>.also_fits` | 其他允许的插入点（用户/优化器可改到这里） | `[]` |
| `ops.<tool>.requires` | 前置 tool（未启用则本 tool 不可启用） | `[]` |
| `ops.<tool>.adds` | 插入后追加的断言 / 标尺 / 旋钮（**插件式增量的载体**） | `{}` |
| `skeleton.spine` | 默认启用的 tool 序列（= 最小可用流水线） | 必填 |
| `skeleton.edges` | 骨架内的接线（**只写骨架成员之间**） | 必填 |
| `caps` | 本模块可提供的全部能力（骨架已覆盖子集 → 差值即可玩空间） | 必填 |

> **`caps` 是渲染的唯一依据**：前端画的不是「工具清单」，是「能力清单＋哪些已启用」。用户想的也是能力，不是 op id。

### 编剧模块的具体形态（对应用户原话）

- **工具箱 10 个**：`structure-design` / `plot-choreographer` / `novel-bible` / `scene-breakdown` / `world-forge` / `episodic-outline` / `script-drama-beat` / `plot-redline` / `subplot-weave`* / `foreshadow-plant`*
  （带 * 为待补的两个新 tool，见 WO-03）
- **默认骨架 4 个**：`structure-design → plot-choreographer ← novel-bible → scene-breakdown`
  → 提供能力：**主线剧情 + 人设一致性**
- **加插件**：启用 `subplot-weave`（插在 `after:plot-choreographer`）→ 得到**暗线**；启用 `foreshadow-plant`（`before:scene-breakdown`）→ 得到**伏笔悬念**
- **按章卷微调**：模块实例可声明 `iterate`（单位 = 章/卷）与 `vary`（逐单位差异）

---

## 二 · flow@3 形态

```json
{
  "format": "flow@3",
  "id": "novel-fanqie",
  "title": "番茄快餐网文",
  "status": "official",
  "inputs": { "素材": { "type": "project", "required": true } },
  "outputs": [ { "module": "m4", "title": "前三章终稿", "audience": "平台编辑" } ],

  "defaults": { "link": "auto" },

  "modules": [
    { "id": "m1", "module": "search", "link": "auto",   "caps": ["选题"] },

    { "id": "m2", "module": "plot",   "link": "manual",
      "caps": ["主线", "人设", "伏笔"],
      "insert": { "after:plot-choreographer": ["subplot-weave"] } },

    { "id": "m3", "module": "prose",  "link": "manual",
      "caps": ["正文", "去机味"],
      "iterate": { "unit": "chapter", "over": "卷纲", "first": 1 },
      "vary": { "13": { "caps": ["伏笔回收"] } } },

    { "id": "m4", "module": "tool",   "link": "auto", "caps": ["交付"] }
  ]
}
```

**一个 flow 从 ~400 行降到 ~30 行。** 作者只回答三个问题：
① 走哪几个模块、什么顺序；② 每个模块**要什么能力**；③ 模块**之间怎么放行**。

### 模块实例字段

| 字段 | 含义 |
| --- | --- |
| `id` | 实例 id（节点 id 前缀，须唯一、稳定） |
| `module` | 引用 `modules/<id>/module.json` |
| `link` | **进入本模块的连接件**：`auto` / `manual`（缺省取 `defaults.link`） |
| `caps` | 想要的能力集合；缺省 = 骨架自带能力 |
| `insert` | 显式把某个 tool 钉到某个插槽（`{"<slot>": ["<tool>", …]}`），用于精细控制 |
| `iterate` | 按单位重复执行（`unit` 章/卷/集，`over` 单位来源，`first` 起始） |
| `vary` | 逐单位差异（`{"<单位序号>": { "caps": […], "insert": {…} }}`） |

### 为什么 `caps` 比列工具好

- **可读**：写「伏笔」比写 `foreshadow-plant` 更像需求；
- **可换**：同一能力将来换一个更好的 tool 实现，flow 不用改；
- **可优化**：优化器的提案空间从「增删节点」变成「增删能力」，语义更大、更少误伤；
- **默认即最小**：不写 `caps` 就是骨架 4 个 tool —— 上手成本 = 零。

---

## 三 · 派生：节点与边从哪来（单点实现）

沿用 R5 纪律：**派生只在内核实现一次，落 `registry/effective.json`，页面与脚本只消费不重算。**

```
flow@3（模块序列）
      │  内核 modules.ts::expandFlow()
      ▼
生效编排 = { nodes, edges, connections, artifacts }
```

### 展开规则

1. **选工具**：`skeleton.spine` ∪ `{ op | op.capability ∩ caps ≠ ∅ }`，按 `requires` 做可达性剪枝（前置缺失则报错，不静默丢）。
2. **定顺序**：骨架成员保持 `spine` 次序；插入工具落在 `slot` 锚点一侧；同槽多工具按 `also_fits`/声明序稳定排序。
3. **节点 id**：`<模块实例id>.<tool>`（如 `m2.plot-choreographer`）—— 稳定、可读、可引用。
4. **节点 kind**：`op.kind === "review"` → 仍是普通 agent 节点（**不是门**，见 §四）。
5. **边**：`skeleton.edges`（两端都被启用才保留）+ 插入节点的自动接线（锚点 → 插入 → 锚点的后继）。**不再产出 `reject` / `loop` 边**——打回升级到模块粒度。
6. **连接件**：相邻模块之间铸一个连接件节点 `<实例id>.link`，id 前缀 `lnk-`（取代 `itb-` 的边界门）。
7. **产物路径**：`<NN>-<模块名>/<产物名>.md`（NN 由模块序号决定）。
8. **条件**：模块级 `when` 保留（可选模块开关）；**节点级 when 取消**（模块内是线性骨架，无分支）。

---

## 四 · 门与连接件：只保留两种模式

用户口径：**模块内没有任何审核、不打回；模块之间自动批准 / 手动批准。**

| 位置 | 机制 |
| --- | --- |
| **模块内部** | 无门。质量由每个 tool 自己的 `asserts` + `config` 承担（R5 §四 口径不变）。断言 block → 该节点**重做**（同模块内重跑，不是打回上游） |
| **模块之间** | 一个连接件节点，`link` 决定模式 |

### 两种连接模式

| 模式 | 行为 | 面板 |
| --- | --- | --- |
| `auto`（自动批准） | 连接件自动放行；journal 留痕；指标计入 `link` 相位 | 灰色虚线 + 「自动」 |
| `manual`（手动批准） | 挂起等人裁决 `pass` / `reject` | 金色实线 + 「待人工」徽章 |

- **`reject` = 重跑上游模块**（整个模块，非单节点）。回注范围是模块入口，方式是重跑该模块全部节点。
- 连接件**不产 artifact**（无产活），裁决态存 run state，不进图。
- 旧概念退役：`gate_role`、`BOUNDARY_PREFIX="itb-"`、`policy.kit_boundary`、`policy.gate_mode`、`isWorkGate`/`isBoundaryGate`。新策略只留一个：`policy.link_default ∈ {auto, manual}`。

---

## 五 · 项目文件布局（更清晰、更少无效文件）

### 旧 → 新

```
旧                                    新
<project>/                            <project>/
├─ 根级输入（散落）                    ├─ 输入/            人写：点子 / 素材 / 需求
├─ 世界书/                            ├─ 世界书/          跨模块共享状态
├─ 内部/                               │   ├─ 设定.md  人物.md  时间线.md  词表.json
│   ├─ 意见/                          ├─ 01-选题/         模块产物就地
│   ├─ 收据/                          ├─ 02-方案/         ├─ 产物.md
│   ├─ 依据/                          ├─ 03-编剧/         ├─ 意见书.md（该模块的意见）
│   └─ 稿本/                          ├─ 04-写作/         └─ …
├─ 章节正文/
├─ 对外交付/                          ├─ 交付/            NN- 定序交付出口
├─ registry/                          ├─ registry/        机器：生效编排 / 指标 / 产物索引
└─ snapshots/                         │   └─ receipts/    机器：收据（原 内部/收据）
                                      └─ snapshots/       机器：快照
```

### 三条简化规则

1. **取消 `内部/` 四桶**：意见与依据跟随所属模块目录就近存放；**收据是机器件**，统一进 `registry/receipts/`（原本混在人工目录里，属错位）。
2. **模块目录即流水线段**：`01-选题/` ⟶ `02-方案/` 的推进在目录上可见，产物归属不再需要查 flow。
3. **删掉临时产物**：`*-dump.json` / `*-inventory.json` / `nodes.json` 等中间件一律不进项目（需要就写 `registry/`）。

### artifact 头部微调

```yaml
artifact: 1
id: <稳定 id>
module: m2 编剧            # 新增：本产物属于哪个模块实例
node: m2.plot-choreographer
state: draft | final
at: 2026-09-18 10:00
by: <谁>
upstream: [<上游 artifact id>]
review:                     # 可选：只在经由 manual 连接件放行后写入
  link: m2.link
  verdict: pass
  at: …
  by: …
```

九项必填不变，**去掉 `class`/`round`/`version`**（版本由 git + snapshots 承担，避免第二处真相）。

---

## 六 · 前端形态

### 布局：竖向节点 + 模块横向拼接

```
    ┌─ 01 选题 ─┐   ┌─ 02 方案 ──┐   ┌─ 03 编剧 ──┐   ┌─ 04 写作 ─┐
    │  ◯ 素材   │   │  ◯ 结构   │   │  ◯ 暗线   │   │  ◯ 第1章  │
    │     ↓     │   │     ↓     │   │     ↓     │   │     ↓     │
    │  ◯ 找梗   │   │  ◯ 编排   │   │  ◯ 主线   │   │  ◯ 第2章  │
    │     ↓     │   │  ↓   ↓    │   │     ↓     │   │     ↓     │
    │  ◯ 报告   │   │  ◯ 人设   │   │  ◯ 分场   │   │  ◯ 第3章  │
    └───────────┘   └───────────┘   └───────────┘   └───────────┘
         ╎ auto          ╎ manual        ╎ manual        → 交付
```

- **同模块内**：节点自上而下，主轴竖直；产物在干路右侧，插入的插件工具在左侧分支（视觉上区分「骨架」与「插件」）。
- **模块之间**：横向连接件。`auto` = 灰色虚线；`manual` = 金色实线 + 「待人工」徽章。
- **模块卡片顶栏**：模块名 + 序列号 + **能力标签条**（`主线 ✓` `人设 ✓` `暗线 ○` `伏笔 ✓` —— ✓ 已启用，○ 可启用未启用）。
- 实施落点：`autoLayout()` 轴交换（列→模块 x、行→模块内 y）＋ `drawEdges()` 模块带与连接件路由。改动集中在两个函数（约 200 行）。

### 工具箱抽屉（可玩性的入口）

点模块卡片 → 右侧抽屉列出**全部** tool，按能力分组：

```
03 编剧 · 能力 4/6 已启用
  ✓ 主线        plot-choreographer       [旋钮 ×4]
  ✓ 人设        novel-bible
  ✓ 分场        scene-breakdown
  ✓ 结构        structure-design
  ○ 暗线        subplot-weave      启用 → 插到 after:plot-choreographer
  ○ 伏笔悬念     foreshadow-plant   启用 → 插到 before:scene-breakdown
```

- 勾选 = **生成 overlay patch**（`set-module caps` / `insert-tool`），**不直接改 flow.json**——沿用 R5「编排是运行时事实」。
- 每个 tool 展开可见其 `config` 旋钮 + 逐键来源 + 可复制补丁。
- 「回收站」视图：模块级历史（本卷用了哪些能力）。

### 面板与门禁

- 保留：`configPaper` / `metricBadges` / `orchestrationPaper` / `boundaryPaper`（改名为 `linkPaper`）。
- 新增：`modulePaper`（模块卡片详情）、`toolboxPaper`（工具箱抽屉）。
- **`page-lint` 必须重写断言组 7 / 10 / 12**：这三组绑在 `EFF.boundaries` / `gate_role==="kit-boundary"` / `kind==="gate"` 上，门模型一换全红。

---

## 七 · 能力 → 工具（可玩性矩阵）

以编剧模块为例，说明「默认 4 个跑主线，加插件开暗线/伏笔」的完整映射：

| 能力 | 提供者 | 默认启用 | 插入位置 | 启用后新增的判定 |
| --- | --- | --- | --- | --- |
| 主线 | `plot-choreographer` | ✓ | 骨架 | 节拍格式断言 |
| 人设 | `novel-bible` | ✓ | 骨架 | 人设一致性断言 |
| 结构 | `structure-design` | ✓ | 骨架 | — |
| 分场 | `scene-breakdown` | ✓ | 骨架 | — |
| 暗线 | `subplot-weave`* | ○ | `after:plot-choreographer` | 暗线双轨检查 |
| 伏笔悬念 | `foreshadow-plant`* | ○ | `before:scene-breakdown` | 伏笔台账闭合断言 |
| 世界观 | `world-forge` | ○ | `before:structure-design` | 设定不冲突 |
| 单集大纲 | `episodic-outline` | ○ | `end` | — |

`*` = 新增 tool（WO-03）。

---

## 八 · 存量转换（一次性，之后旧格式废弃）

虽不计兼容，但存量 7 flows / 5 kits 是资产，需要一个**一次性转换脚本**：

1. `kits/*` → `modules/*`：`ops` 平移；`capability`/`slot`/`skeleton` 依 §一 人工填（**这一步是内容活，不是脚本活**）。
2. `flows/*`（flow@2）→ `flow@3`：按原 `stages` 切模块序列，原 `kit` 域变化处生成连接件，`policy.kit_boundary=always` → `link:"manual"`，`auto|off` → `link:"auto"`。
3. 存量项目目录：按 §五 搬目录 + 改 artifact 头部（**产出搬迁清单供人确认，不自动搬**——沿用铁律 10，禁止补拍快照洗白）。

---

## 九 · 工作量评估

规模刻度：**S** ≤200 行 ｜ **M** 200–500 ｜ **L** 500–1200 ｜ **XL** >1200
参照：R4 内核 12 文件改造 ≈ XL；R5 内核改造（overlay 511 + metrics 206 + optimize 313）≈ L。

| 环节 | 主要交付 | 规模 | 风险 |
| --- | --- | --- | --- |
| 契约（module@1 / flow@3 / 骨架 / 目录布局 / 页面 payload） | 7 个 schema 重写新建 + 规范 | **L** | 中（冻结后变更成本高） |
| 内核底座（展开器 + 门 + overlay + policy 简化） | `modules.ts` 新建 ~380；`kernel/overlay/plan/assembler/types` 增删 ~450（含删 ~150 旧门逻辑） | **L** | **高**（内核，牵动全链） |
| 工具链（flow-lint / module-lint / kit-lint） | `module-lint.py` 新建 ~260；`flow-lint.py` 重写 ~300 | **M–L** | 中 |
| 模块内容重划（5 kit → 8 模块 + 骨架 + 插槽 + 2 新 tool） | `modules/**` JSON ~600 + 2 个 skill | **M** | 中（要领域判断） |
| 前端布局（竖向 + 模块横向拼接） | `autoLayout`/`drawEdges` 重写 ≈200 + 模块带/连接件 | **M** | 中 |
| 前端模块面板（工具箱 / 插槽 / 连接模式 / patch 生成） | 新面板 ≈540 + `page-lint` 断言组 7/10/12 重写 | **L** | 中 |
| 项目文件布局简化（生成器 + 准入校验） | `project-pages.py` 数据面 + `artifact-lint.py` 准入 | **M–L** | 中 |
| NL → 骨架 skill + 骨架校验 | `skills/flow-synthesize.md` ~200 + 校验 minitool | **S–M** | 低 |
| 存量转换脚本 | `tools/flow-v3-migrate.py` ~350 | **M** | 中 |
| 全链门禁回归 | 6 个门 + 回归修复 + 报告 | **M** | 低 |

**合计 ≈ 5000–6000 行改动，与 R4 + R5 两轮之和同量级。**
其中**内核底座（L·高风险）+ 契约（L）是唯一的真正瓶颈**——其余环节都能与之并行。

### 关键路径

```
契约冻结 → 内核底座 → 前端布局 → 前端面板
                    ↘ 工具链 / 模块内容 / 文件布局（可并行）
```

---

## 十 · 红线（本轮不变）

1. **声明必须被执行**：新格式下 `asserts` 仍走 `runDeclaredAsserts` 单点派发，三态裁决（机器能验→真裁决 / 验不了→显式 `unverified`），**绝不冒充 pass**。
2. **结构类改动永远人批**：能力/工具的增删（改图的形状）不入自动应用集合。
3. **不引 LLM 当机器校验器**。
4. **派生只算一次**，落 `registry/effective.json`。
5. **禁止补拍快照洗白**存量问题；目录搬迁须先出清单给人确认。
6. **能力必须有家（四环）**：① 模块声明 ② 内核执行 ③ 前端可见可开 ④ lint 可校验。缺一环 = 等于没有。

---

## 十一 · 勘误（WO-00 实现回写 · 规范是活文档）

> 契约冻结（WO-00）时发现的与正文不符处，以下述为准；正文相应段落已按此勘误阅读。

1. **§二 flow@3 示例缺字段**：required 为 `format/id/title/version/status/modules`，示例补 `"status": "official"`；`status` 枚举定为 `draft | official | retired`（商店口径：official=可装）。
2. **§五 「九项必填不变」计数有误**：R6 头部必填为**八项** `artifact/id/module/node/state/at/by/upstream`（去掉 class/round/version，新增 module）；`review` 可选。`state` 枚举收窄为 `draft | final`（旧 reviewed/superseded 由 snapshots + git 承担）。
3. **§四 policy 落定**：`policy = { link_default: auto|manual, adapt: off|propose|apply, budget: {} }`。连接模式优先级 = **模块实例 `link` > flow `defaults.link` > `policy.link_default`**（正文只写了 policy 一层）。
4. **§一 slot 语义补齐**：骨架成员可省略 `slot`；`slot`/`also_fits` 取值 `after:<tool>` | `before:<tool>` | `end`，锚点必须在本模块 ops 中。
5. **§六 废弃清单补正**：除 `kit.schema.json` 外，`stage.schema.json`（R4 之前的 Stage 封装包）一并标废弃。
6. **payload 冻结口径**：顶层五键 `DATA / EFF / OVERLAY / OPTIMIZE / METRICS`；`EFF` 为 `effective@2`（`links` 取代 R5 的 `boundaries`；`gates` 相位指标更名 `links`）；`DATA.toolbox` 形状 = `toolbox@1`（contracts/toolbox.schema.json）。键集冻结后新增键须立新 WO。
7. **flow@3 保留 `changelog`**（可选）：版本记录随 flow 走，历史信息不因模块化丢失。
8. **`by` 字段口径**：artifact 头部 `by` 在 R6 为 `module/<实例id>.<tool>`（R5 为 `kit/<kit>.<op>`）——转换脚本需同步改写。

## 十二 · WO-00 冻结清单（本波产物）

| 契约 | 状态 | 说明 |
| --- | --- | --- |
| `contracts/module.schema.json` | 新建 | module@1：ops（capability/slot/also_fits/requires/adds）+ skeleton + caps |
| `contracts/flow.schema.json` | 重写 | flow@3：modules 序列 + policy{link_default, adapt, budget}；graph/stages/outputs[].node 删除 |
| `contracts/page-payload.schema.json` | 新建 | page-payload@2：DATA/EFF/OVERLAY/OPTIMIZE/METRICS 五键冻结 |
| `contracts/artifact-header.schema.json` | 重写 | +module；-class/-round/-version；review{link, verdict: pass|reject} |
| `contracts/toolbox.schema.json` | 新建 | toolbox@1：能力 → 工具映射（渲染与选工具共用视图） |
| `contracts/kit.schema.json`、`contracts/stage.schema.json` | 废弃 | 标 `deprecated: true`，保留供 WO-08 对照 |
