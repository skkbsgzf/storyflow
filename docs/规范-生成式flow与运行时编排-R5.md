# 规范 R5 · 生成式 flow 与运行时编排

> 状态：**生效**（配套 `contracts/flow-overlay.schema.json`、`contracts/metrics.schema.json`、`core/src/overlay.ts`、`core/src/metrics.ts`、`core/src/optimize.ts`、`tools/kit-config-init.py`、`tools/r5-migrate.py`）
> 适用范围：`flows/*/flow.json` 的编排层；`kits/*/kit.json` 的能力声明层；`projects/<id>/registry/` 的运行时数据面
> 日期：2026-09-17
> 前置：R4（过程件头部契约 / flow@2 字段唯一化 / kit+op 能力引用）已生效

## 零 · 这份规范推翻什么

R4 之前的设计在图上给**每个阶段挂一扇门**（`gate_role:"验收门"`），每扇门都要求人裁决。后果：

| # | 问题 | 实证 |
| --- | --- | --- |
| 1 | **节点数随阶段线性膨胀**，串行屏障多 | `topic-selection` 5 扇门 + 5 个阶段 = 图上 10 道人工裁决；`novel-fanqie` 2 扇门 |
| 2 | **审核与产出绑死在同一张图上** | 门的裁决、打回、回注路由全是图结构，改一次审核口径 = 改 flow.json = 改内核认的拓扑 |
| 3 | **不灵活**：想省一道门 / 换一个工具 / 调一次力度，都得改流程定义 | 门角色、评审席位、抽检比例写死在节点字段里 |
| 4 | **无从度量**：没人知道哪个 tool 在产出、哪个在空转 | 图上 44 个 agent 节点 + 7 扇门，没有任何「这一步行不行」的运行数据 |

**R5 的转向**：编排不再是写死的图，而是**运行时被两种指标持续调优的对象**。

- 人工裁决**只在 kit 域切换处**出现（`kit-boundary`），自动派生，不手画。
- 域内质量**由各 tool 自己的 `asserts` + `config` 承担**，不再靠图上加门。
- tool 的**位置**（增删 / 改线 / 换 op）与**内容配置项**（旋钮）都可以被用户或优化 agent 改写。
- 调优依据是两条**机器可算**的指标，不是人的印象。

---

## 一 · 编排 = bootstrap ⊕ overlay ⊕ 边界派生

生效编排（内核唯一判断依据）由四层合成，`core/src/overlay.ts::effectiveFlow` 单点实现：

```
flows/<id>/flow.json                    bootstrap（出厂拓扑，只读基线）
  ⊕ flows/<id>/overlay.json             出厂 overlay（跨项目默认改写）
  ⊕ projects/<id>/registry/overlay.json 项目 overlay（本项目的改写）
  ⊕ injectKitBoundaries(域序列)          kit 边界验收派生（自动，不手画）
  = registry/effective.json             生效编排（落盘读模型，页面纯消费）
```

**硬约束**

| 约束 | 理由 |
| --- | --- |
| `applyOverlay(flow, overlays)` 必须是**纯函数** | 同样输入必须得同样编排；否则「重跑」与「继续」会分家 |
| 装载序 **factory 先、project 后** | 项目改写必须能覆盖出厂默认 |
| `proposed` 状态的补丁**不参与**合成 | 待批的提案不许悄悄生效 |
| 生效编排**只有一个实现** | 内核算好写 `registry/effective.json`，页面不重复实现派生逻辑（否则两边必漂移） |

### 1.1 patch 类型（`flow-overlay@1`）

| kind | 作用域 | 改什么 |
| --- | --- | --- |
| `set-node` | 节点 | `config` / `when` / `output` |
| `set-op` | 节点 | 换 `kit.op`（= 换做这件事的 tool），顺带清 `skill` 防漂移 |
| `place-node` | 图 | 插一个节点到 `after`/`before` 之间，自动接线 |
| `remove-node` | 图 | 删节点；`rewire: bridge` 直接把上下游接起来，`drop` 断链 |
| `set-edge` / `add-edge` / `remove-edge` | 边 | `role` / `when` / `params` |
| `set-tool` | **tool**（跨节点） | `config` / `knowledge` / `asserts` / `model_tier`——按 `<kit>.<op>` 归口，**换位置照样生效** |
| `set-policy` | 全局 | `kit_boundary` / `gate_mode` / `adapt` |
| `suppress-boundary` | 图 | 单点跳过某个交界的人工派生 |
| `set-input` | 全局 | 覆盖 `flow.inputs` 取值 |

每条补丁**必须带 `reason`**；由优化器产生的还必须带 `evidence`（哪条规则 + 哪条指标 + 采样数）。合法性由 `tools/kit-lint.py` 校验。

---

## 二 · tool 的内容配置项（每个 tool 都必须可调）

### 2.1 声明（kit 侧）

`kits/<kit>/kit.json` 的每个 `ops.<op>.config` 是一张**旋钮表**：

```json
"config": {
  "angles":     { "type": "number", "min": 1, "max": 8, "default": 4, "unit": "个视角",
                  "desc": "红方评审采几个视角", "effect": "提高=更全面但更慢；≥6 时建议配 sampling" },
  "harshness":  { "type": "enum", "enum": ["宽","标准","狠"], "default": "标准",
                  "desc": "判词锋利度", "effect": "提高=早暴露问题，但读者代入感受损" }
}
```

- `type ∈ {number, string, boolean, enum, array}`
- `enum` 必须给非空 `enum` 列表，`default` 必须在列表内
- `desc`（是什么）与 `effect`（调了会怎样）**都必须写**——没有 `effect` 的旋钮没法被优化 agent 推理
- **E7 硬约束**：任何 `op` 未声明 `config` 即 lint 报错。「能力不可调」= 违背本规范的第一条承诺

**通用兜底**：每个 tool 隐式享有 4 项（`core/src/kits.ts::GENERIC_CONFIG`），保证即使专属旋钮还没想清楚，它也不是不可调的。

| key | 类型 | 默认 | 语义 |
| --- | --- | --- | --- |
| `depth` | enum 浅/标准/深 | 标准 | 本步投入深度 |
| `strictness` | enum 宽松/标准/严格 | 标准 | 判定尺度（影响自检与断言宽严） |
| `maxChars` | number 200–40000 | 4000 | 产物篇幅上限 |
| `model_tier` | enum high/lite | high | 执行档位 |

### 2.2 生效优先级（`resolveToolConfig`）

```
overlay.set-tool.config  >  节点 config  >  op.config.default  >  通用默认
```

- 结果带**逐键来源** `sources[k] ∈ {overlay, node, op, generic}`——面板据此显示「这个值从哪来」，不靠猜。
- 写了未声明的键 → 进 `unknownKeys` **显式回显**（进任务包指令的告警段 + 前端面板），**不静默丢弃**。
- 类型不符 / 枚举越界 → 同样进 `unknownKeys`，不采纳但告知。

### 2.3 注入点

`buildTaskPackage` 把合成结果写进任务包的「本步配置」段，并置 `pkg.toolConfig`。**配置不是文档，是进上下文的执行参数**——否则「可调」只是展示。

---

## 三 · kit 边界验收（唯一保留的人工裁决点）

### 3.1 派生规则

`injectKitBoundaries(flow, {policy, suppressed})`：

1. 按前向拓扑序算每个节点的**域**（`node.kit`；门/素材节点透明，不定义域）。
2. 遍历前向边，找 **源域 S ≠ 目标域 T** 且落点是执行域节点的边。
3. 对每组 `落点节点` 插一个 `itb-<目标节点>`（`kind:gate`, `gate_role:"kit-boundary"`），**原地改线**（保留原边 id/role/when/params），并加一条 `e-itb-<目标>-out` 放行边。
4. 已有边界门已覆盖同一 `(S→落点)` 时不再插（幂等）。
5. `gates` 集合 = 结果里的**全部** kit 边界门，含手工书写的——这类门一旦漏在清单外，页面与优化器就会以为「这里没人管」。

### 3.2 三个旋钮（默认开着，但用户能关）

| 旋钮 | 取值 | 行为 |
| --- | --- | --- |
| `policy.kit_boundary` | `always`（默认） | 域切换处一律派生人工验收 |
| | `auto` | 派生但默认不拦（`when: {input:"__boundary_auto__", eq:"never"}`），风险升高时才拦 |
| | `off` | 完全不派生（全自动） |
| `suppress-boundary` 补丁 | `{to: "<落点>"}` | 单点跳过该交界 |
| 手工 `gate_role:"kit-boundary"` | — | 显式指定某门为边界验收（计入 `boundaries`） |

---

## 四 · 门降级：domain gate 不再逐阶段拦人

R5 起 `gate_role` 的**唯一合法值**是 `kit-boundary`（旧 `stage/final/spot` 已弃，`kit-lint` E 级报错）。

**关键区分**（这条不看清楚会把质量信号一起删掉）：

| 门的形态 | R5 行为 | 理由 |
| --- | --- | --- |
| **纯汇合点**（无 `output`/`skill`/`op`/`minitool`） | 直接自动放行，判 done | 它没有产活，跳过不损失任何东西；域内质量由上游 tool 的 asserts 承担 |
| **带产活的门**（挂了 skill/op/output） | 它是**评审步**：**照跑**（派发任务包、产物照出），交卷后**自动裁决** | 跳过它 = 产物凭空消失而节点判 done，是**静默断路**，比多一道门坏得多 |
| **带产活的门 + 已被人接手**（`state.gate.awaiting`） | 挂起等人（原逻辑） | 人一旦介入，机器不越权 |
| **`gate_role:"kit-boundary"`** | 挂起等人 | 唯一的常规人工裁决点 |
| **`policy.gate_mode="manual"`** | 所有门都等人 | 整体退回手动（旋钮，不是硬编码） |

自动裁决会留下三份证据：journal 的 `verdict` 事件（写清「为什么自动」+ 如何恢复人工）、metric 的 `auto-gate` 相、以及任务包里的配置快照。

### 4.1 声明的断言怎么被执行（「声明即契约」的执行点）

门降级之后，「域内质量由该 tool 的 `asserts` 承担」必须真的发生——否则自动裁决 = 不再检查。
执行点只有一个：`core/src/asserts.ts::runDeclaredAsserts`，由**两处**调用（禁止各自实现）：

| 调用方 | 位置 | 作用 |
| --- | --- | --- |
| `flow_submit` | `kernel.ts::doSubmit` | 有效断言 = `node.asserts/check/review ∪ kit.op.asserts`（含 overlay `set-tool add_asserts`）；block 即打回，并在 `metrics.jsonl` 记 `asserts.declared/block/unverified` |
| core 步 | `minitools.ts::runCoreNode`（`check_aesthetic_asserts`） | 引擎全量照跑（不因声明收窄而丢掉引擎自己发现的 block）+ 逐条裁声明，结果落 `内部/断言报告-<node>.json` 的 `declared/contract/summary` |

**裁决三态，没有第四态**：

| 情形 | 裁决 |
| --- | --- |
| 引擎有机器校验器（同名，或同族 `ID#子项`，如 `AE-BEAT-FORMAT` 覆盖 `AE-BEAT-FORMAT#dur`） | 采用引擎真裁决（`pass` / `warn` / `block`） |
| 引擎没有 | `warn` + 「无机器校验器（语义层断言，归评审/红方剖面）」，并登记进 `unverified` |

**绝不冒充 pass**：验不了的断言不许报成通过——语义层断言不是缺陷，是分工（机器读不出「代入感」，所以不假装读过）。
`unverified` 同时进 metric 与 journal `warn` 事件：哪一条 tool 的契约是空的，运行记录里看得见。

> **当前账（2026-09-17 实测）**：6 处 `asserts` 声明共 40 条 → 机器能验 12 条、无人能验 28 条；
> `novel-longform/audit`、`outline-production/asserts`、`book-deconstruct/promote` 三处**声明全部为零可验**。
> 见 §十 缺口 2/6。
> **WO-A 收口（2026-09-17 晚）**：机器校验步真空转已归零（kit-lint 0 error）。路径：注册表 +11 条
> 引擎断言补登记（85 条全账）；同义异名经注册表 `checks_via` 字段解析（`AE-DENSITY-HOT/CALM →
> AE-DENSITY-WORDS`，runDeclaredAsserts 与 kit-lint 读同一份，两边不各写一套）；文本层校验器补齐
> `AE-WNF-HOOK`（章末钩+同型轮换）/`AE-CONT-KNOW`（越权专名切片）/`AE-CONT-ITEM`（台账数字事实
> 冲突切片）/`AE-CONT-FORESHADOW`（伏笔逾期，卡点级 block）/`AE-VIS-EMPTY`（分镜心理词）/
> `AE-OUTPUT-PURITY`（引擎内建，标记台账 `knowledge/aesthetic/purity-markers.json` 与
> `tools/check-purity.py` 同源共享）；语义断言按红线迁出机器校验步并在 redline/style 节点 desc
> 记账（novel-longform 3 条、outline-production 7 条、book-deconstruct 4 条）。残余 10 条语义断言
> 声明于写作/评审层 = 归评审剖面（记账不告警）。check-purity.py 收敛后 p-fq-001 成文产物 **0 残留**，
> p-key-soul 4 处、p-ts-001 3 处为**真实残留**（成品剧本内的过程标注），待存量红档拍板一并处理。

> **红蓝对抗的正式退场路径**：带产活的门是红蓝对抗的残留物。优化器规则 R6 会按
> 「它的产物被下游真正消费了几次」提案 `remove-node`；无人消费即提案裁掉。
> 结构类补丁永远需要人批（见 §六）。

---

## 五 · 两条主指标（调优的唯一依据）

`registry/metrics.jsonl`（append-only），字段见 `contracts/metrics.schema.json`。落点三处：

| phase | 何时记 | 记什么 |
| --- | --- | --- |
| `dispatch` | 派发认知步/评审步 | `ctx.offered`（装载了几件上下文）、`ctx.ids`、当步配置快照 |
| `submit` / `core` | 交卷 / 确定性步完成 | `ctx.used`、`ctx.hitIds`、断言通过数、重试数 |
| `auto-gate` / `gate` / `boundary` | 自动裁决 / 人工裁决 | `verdict` |

### 5.1 上下文命中率

```
命中率 = 被产物真正引用过的注入件数 ÷ 注入件数
```

命中判定**不需要任何写作负担**：信号取自 R4 已写好的 `artifact@1` 头部 `upstream:` 行（带 sha 的路径）与正文出现的 id（`core/src/metrics.ts::extractCtxUsage`）。装了 4 张标尺卡、产物一个都没提 = 死条款。

### 5.2 tool 效率

```
成本  = (tokensIn + tokensOut)/1000 + latencyMs/60000 + assertBlock×5 + retries×2
效率ω = consumedBy / 成本                （consumedBy = 该产物被下游真正引用的次数）
```

**按 tool 归口**：同一 `<kit>.<op>` 跨节点合并——换位置不换 tool，指标必须跟着 tool 走，否则「挪个位置」就被误判成换了个 tool。

### 5.3 汇总只算一次

`persistMetricsSummary` 把汇总写 `registry/metrics-summary.json`。口径（哪些 phase 算 submits、成本怎么算、命中率分母是谁）**只在内核定义一次**，页面与优化 agent 消费同一份结果。

---

## 六 · 优化器（确定性启发式，不是 LLM）

`proposeFromMetrics(flow, summary, {policy})` → `registry/optimize.json`（`optimize@1`）。

### 6.0 质性通道：编排挖掘师（orchestration-miner，2026-09-17）

指标只看得见数字；「为什么」在 journal、打回根因、批注和中间文件里。通用 Skill
`orchestration-miner`（tool kit · `orchestration-mine` op）做**事后挖掘**，管道四步：

| 步 | 动作 | 落点 |
| --- | --- | --- |
| 组装 | `flow_mine --project <id>`：journal 尾部/打回记录/指标游标/证据文件清单 → 挖掘包 | `registry/mine-package.json`（mine-package@1）+ spawnPrompt |
| 挖掘 | 编排挖掘师按五维度（ctx/coverage/structure/quality/cost）逐维度过，产出证据化发现 | `registry/miner-findings.json`（findings@1，每条带 source+quote）+ 人读报告 `内部/意见/编排挖掘-<runId>.md` |
| 并入 | `flow_optimize` 自动读取：非结构类 finding → `M@` 提案（**risk 恒 medium**，人批才落地）；结构类 → `report.mineStructural` 拍板清单，**永不进 overlay** | `registry/optimize.json`（`sources: [metrics, miner]`） |
| 提示 | `flow_effect` 返回 `mine.due`：距上次挖掘又积累了一轮运行（≥8 事件）→ 建议跑 `flow_mine` | 读模型纯消费 |

纪律与红线（写进 Skill 正文并由内核契约兜底）：**无证据不立案**（每条 finding 必须带
`journal:<行>` / `artifact:<路径>` + ≤120 字引文）；**只提案不落地**（质性提案 risk 恒 medium，
结构类想法只进拍板清单）；**不引 LLM 当机器校验器**（coverage 维度建议只指向文本可查维度或迁评审）；
单轮 findings ≤8 条，挖不出就诚实写空。

| 规则 | 触发 | 提案 |
| --- | --- | --- |
| R1 死条款 | 装载 ≥N 次、命中 0 | `set-tool` 收窄 `knowledge`（glob 走 `exclude_knowledge` 名单） |
| R2 标尺饥荒 | 打回多 + 命中率低 | `set-tool` 补标尺（**medium risk**：改上下文预算，必须人点头） |
| R3 档位升 | 被高频消费 | `set-tool config.model_tier=high` |
| R4 档位降 | 零消费、零打回 | `set-tool config.model_tier=lite` |
| R5 裁冷 tool | 有派发无交卷/无消费 | `set-node` 降配 |
| R6 旧门清场 | 纯汇合点（无产活）→ **无需样本**即提裁；评审步 → 需 `submits ≥ 3` 且 `consumedBy===0` | `remove-node`（`rewire:bridge`） |
| R7 边界降噪 | 边界连续 N 次零打回 | `set-policy kit_boundary=auto` |
| R9 热门加注 | 被消费 ≥2 次且命中 ≥60% | `set-tool config.depth=深` |

**自动化边界**（`policy.adapt`）：

| 取值 | 行为 |
| --- | --- |
| `off` | 只观测，不产出提案 |
| `propose`（默认） | 产出提案落盘，全部待批 |
| `apply` | low risk **且非结构类**的自动落地，其余待批 |

**结构类补丁（`place-node`/`remove-node`/`set-op`/`add-edge`/`remove-edge`）永远不自动落地**——改拓扑是人的判断，`isStructuralPatch` 硬拦。

---

## 七 · 重编译（改了编排就得重算计划）

| 触发 | 行为 |
| --- | --- |
| `state.overlayHash !== eff.overlayHash` | `replan`：重算计划序，新节点补进 `state.nodes`，消失的删除，**受影响下游置 `pending`+`stale`**（上游或执行体变了，旧产物不再可信） |
| 旧 run 首次接触 R5（`overlayHash === undefined`） | **只认领指纹不重编译**——在跑的 run 不因版本升级被打断；journal 记一条「如需启用请 `flow_overlay --replan`」 |
| `flow_overlay --replan` | 强制立即重编译 |

---

## 八 · 面的接口

| 面 | 入口 |
| --- | --- |
| CLI | `flow_effect --project <id>` / `flow_optimize --project <id> [--apply]` / `flow_overlay --project <id> [--patches f.json] [--approve <id,…>] [--replan]` |
| 读模型 | `registry/effective.json`（`effective@1`）、`registry/metrics-summary.json`（`metrics-summary@1`）、`registry/overlay.json`、`registry/optimize.json` |
| 页面 | `tools/project-pages.py` 注入四项数据面；节点面板「内容配置项」页显示旋钮 + 逐键来源 + 可复制的改写补丁；画布上边界门金色双线、tool 效率/命中率徽章、顶部生效编排横幅 |

---

## 九 · 门禁

| 工具 | 检查 |
| --- | --- |
| `tools/kit-lint.py` | E7 op.config 存在、E8 config 合法、E9 exclude_knowledge 存在；W5 未被覆盖的旋钮、W6 门角色（区分纯汇合点与评审步）；**W4b 声明空转（被声明的断言无机器校验器）**、**W4c 未登记断言（引擎发出但注册表没有）**；overlay 补丁合法性（kind/origin/reason/optimizer 需 evidence） |
| `tools/flow-lint.py` | flow@2 字段唯一化；`gate_role` 合法值；7 flows 0 error |
| `tools/flow-verify.py` | 产物脱流探测；文本哈希按 `errors="replace"` 读（与内核 `readFileSync("utf-8")` 对齐）——历史 GBK 产物不再让校验器自己崩掉 |
| `tools/page-lint.mjs` | 44 条断言：含「每个 kit.op 节点都渲染出可调配置项」「命中率徽章与采样分母一致」「overlay 改写显示理由」「无读模型时显式降级为 bootstrap 且不伪造边界/指标」 |
| `core/test/r5-generative.test.ts` | 28 条：overlay 幂等 / 边界派生 / 配置优先级与来源 / 指标算术 / 优化器风险分级与样本门槛 / 读模型一致性 / **评审步不许被跳过** / **声明的 block 断言真的打回提交、未声明的同一产物照样收** |
| `core/test/helpers.ts::lockBootstrapPolicy` | 既有测试用 overlay 显式锁定 `gate_mode=manual`+`kit_boundary=off` 隔离 R5 默认策略 |

---

## 十 · 已知缺口（不在 R5 范围，但必须记账）

| # | 缺口 | 影响 / 下一步 |
| --- | --- | --- |
| 1 | ~~`kit.op.asserts` 只在任务包 `outputContract` 里声明、提交时不执行~~ | **已闭合（2026-09-17）**：见 §4.1。`flow_submit` 与 `check_aesthetic_asserts` 共用 `runDeclaredAsserts`；打回与 `unverified` 都落 metric/journal |
| 2 | 断言台账两处不一致：注册表 74 条，引擎实际发出 17 个 id 且**只有 4 个同名**（`AE-BEAT-FORMAT`/`AE-CARD-END`/`AE-COMPLIANCE`/`AE-HOOK-EVENT`）；引擎自造 11 个未登记 id（`AE-PROSE-*`、`AE-SCRIPT-*`、`AE-CHOREO-*`、`AE-DENSITY-WORDS`、`AE-MEME-POINT`） | 「声明→引擎」的映射目前是偶然命中的。需一次命名对齐：统一同义异名（`AE-DENSITY-HOT/CALM` ↔ `AE-DENSITY-WORDS`）、给引擎自造 id 补注册表条目。`kit-lint` W4c 已开始报警 |
| 3 | 40 条被声明的断言里 28 条无机器校验器；其中 `AE-CONT-KNOW/ITEM/FORESHADOW`（伏笔/道具/信息在场，6 处引用）、`AE-VIS-EMPTY`、`AE-WNF-HOOK`（block）文本层其实可查 | 这三类补齐后，`novel-prose/audit`、`episode-script/audit` 才真正「有断言在守」；补之前它们是纸面契约（内核已显式标 `unverified`，不再冒充通过） |
| 4 | `AE-OUTPUT-PURITY`（铁律 9，block）无内核校验器；`tools/check-purity.py` 的 MARKERS 过宽（`节点 `/`kb/`/`输入：`），不能直接当提交级 block | 需要收敛出一份「可用于提交级」的纯净度规则子集，再接入 `runDeclaredAsserts` |
| 5 | 7 处残留评审步（`gate-r1/gate-final` 等）尚未裁掉 | 由 R6 提案 + 人批逐步清场；零样本时 R6 主动不提（凭格式猜会删掉有效质量信号） |
| 6 | `metrics.jsonl` 对存量 run 为空 | 存量项目指标徽章显示「未采样」、优化器产 0 提案（已复验：p-fq-001 零样本 → 0 提案）；新 run 起自然有数据 |
| 7 | `p-fq-001` 有 7 处 `flow-verify` 红档（`内部/稿本/*`、`世界书/世界观圣经.md` 的声明路径与盘上根级文件不一致） | R4 目录分层的存量迁移债，与 R5 无关；需一次文件搬迁（改前先确认没有别的流程依赖旧路径） |
| 8 | `flow-verify.py` 曾因 GBK 产物解码崩溃（p-key-soul / p-ts-001），**崩=免疫**：修好后这两项目暴露 14/16 处红档 | 崩溃已修（见 §九）。这 14/16 处是存量未快照债，**禁止靠补拍快照洗白**（绕流改稿事故手法），须走铁律 10 的降级路径或按文件搬迁处理 |
| 9 | overlay `set-node` 只落 `config`/`when`/`output`，类型声明里的 `node: Partial<FlowNode>` 其余字段（含 `asserts`）静默不生效 | 想按节点加断言目前只能走 `set-tool add_asserts`（op 级）。要么收窄类型，要么补齐字段并显式回显未支持项 |

