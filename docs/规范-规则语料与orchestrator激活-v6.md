# 规范 v6 · 规则语料与 Orchestrator 激活（agent-only 质量判决面）

> 状态：**生效**（v5.0.0 批C 新立，2026-09-21；编号顺延 R1..R8 规范代际）
> 前置：R5（门降级：人工裁决只在 kit 边界）已生效；R8（选择必须有事实：decision@1 记账）复用为本规范的激活机制；v5.0 工单（断言退役，`docs/版本宣告-v5.0.0.md`）是本规范的存在理由。
> 适用范围：`knowledge/rules/*`（规则语料库）、`projects/<id>/decisions/rules-active.json`（激活决策）、`scan_quality` / `tools/quality-scan.py`（扫描器证据）、评审步与端尾验收（裁决执行面）。

## 零 · 本规范立什么

断言协议退役后，「质量怎么保证」不能靠真空。v5.0 的判决模型把旧断言拆成三个各有其家的面：

| 面 | 家 | 性质 |
| --- | --- | --- |
| 可数的（计数/存在性/配比/台账比对） | 扫描器：`core/src/aesthetic.ts` → `scan_quality` 内建步 / `tools/quality-scan.py` | **证据**，不拦截、不裁决 |
| 不可数的（代入感/钩型质量/人物弧光等语义判据） | 规则语料：`knowledge/rules/` 域卡，经 Orchestrator 激活进任务包「判定标尺」 | **条款**，agent 逐条对照裁决 |
| 确定性底线（残渣/空文/计数一致/头部/跨项目专名） | 提交链完整性：`core/src/asserts.ts::runIntegrityAsserts/runHeaderAsserts` + 词汇表守卫 | **闸**，唯一还能机器打回的东西 |

一句话：**机器只数数，agent 做判断，人在端尾拍板。** 三层各守本分，谁也不冒充谁。

## 一 · 规则语料卡契约

### 1.1 卡的形式

一张卡 = 一个域（`knowledge/rules/<域>.md`，如 hook / pacing / ai-trace / dialogue，当前 16 张）。卡头 YAML 契约：

- `id: kb/rules/<域>`、`type: rule-corpus`、`dimension`、`version`、`status`
- `activation_hint: [阶段/节点提示]`——给 Orchestrator 的激活线索（如 `m3.成文`、`端尾验收`），**不是装载声明**，不构成任何自动生效
- `provenance: {source, refs: [AE-*]}`——来源回溯：v5.0 批A 自断言台账迁移（`tools/rules-init.py` 生成，原文零改动），refs 指回 `projects/_archived/assertions-ledger-v5.0.0/` 的归档条目。回归锁（`core/test/kits.test.ts` + kit-lint v5.0 台账）保证「卡 ↔ 归档」双向可溯。

### 1.2 条款的语义（去闸化，硬性措辞纪律）

- 每条带 `when`（适用阶段/题材条件）+ 优先级 `block|major|minor`。**优先级 = agent 评审的强制力等级**（block = 评审无解释不得放过），**不是提交拦截**；卡头必须自标「本卡是语料不是闸」。
- 历史台账「判 block」字样一律读作优先级。新卡/改卡禁止出现「打回」「拦截」「必须通过否则 reject」类闸语义。
- 红线：**不引 LLM 当机器校验器**——凡能写成确定性计数/比对的，进扫描器（§三），不进卡；卡里只放需要语义判断的条款。
- 用户导入规则走同格式入卡（卡可增域），激活协议不区分来源，但 `provenance.source` 必须写明出处。

### 1.3 维护口径

卡自批A 生成后**以卡为真相手工维护**：`tools/rules-init.py` 是一次性迁移器语义，全量重跑会覆盖手工改卡——禁止重跑（归档台账只读，回溯不靠重生成）。守门：C 轨 50 条必须条条在卡（kit-lint error 级「规则语料缺口」）；卡内 `refs` 不许混入 X 轨（已删除）或纯 T 轨 id（W 级点名）。

## 二 · 激活协议（Orchestrator 决策 = R8 决策的一个实例）

### 2.1 为什么是「激活」而不是「全装」

16 张卡全塞必然撞 9000 字标尺封顶，且「装了没人读」正是断言时代 170 次空转的病根（v4.0.0 宣告 §一教训）。铁律 12（R8）②「catalog/知识候选无默认生效权」在此照用：**未被 decision 命中的规则卡 = 不装载 + 任务包「未装载的候选」显式回显**，禁止静默回落全装。

### 2.2 决策契约

载体：`projects/<id>/decisions/rules-active.json`（`decision@1`，复用现有内核消费面）。必填：

- `by`——谁激活（如 `agent:<会话>(Orchestrator) + user.approval(<日期> 批字)`）；缺则进 issues 不进 values（铁律 12③）
- `inputs_read`——激活判断读了什么（选题报告/剧本/前文/收据/journal）
- `evidence`——**每条 picked 必须有据**（如「收据 quality-scan-第1章-试改v2：aiIndex 15→0，机味维被证明是真实缺陷 → ai-trace 激活」）
- `picked: [kb/rules/*]` + `excluded: [{id, reason}]`——**排除了什么、为什么，不许哑**（铁律 12④）

样板（实盘在案）：`projects/p-yaomo-fx-001/decisions/rules-active.json`（批A 演练，6 picked / 10 excluded 带理由）。

### 2.3 激活律（循环语义）

- **默认 ≈ 语料库 1/10**（当前 16 卡即 ≈1-2 张起步，按题材/阶段可上浮，压线不超封顶回显）；
- **端尾验收不达标 → 按缺陷域回滚补装**：文风差补文风卡、对白差补 dialogue 卡；剧情/冲突差不补卡（回分场卡/编剧层，见成文架构纪律的分工边界——卡不越层救火）；
- 额外两轮仍不达标 → **blocked 问人**，不许无限补装。
- 决策是运行中事实：**禁止把 rules-active 的 picked 写回 `flow.inputs`**（铁律 12⑥）；先验→决策单向桥（`feeds_decision`）允许（如风格先验喂激活），反向禁止。

### 2.4 装载机制（现状诚实账）

- 卡进任务包只走 K1 单点（`op.knowledge` → 判定标尺段），机制不变、封顶不变。
- 决策驱动收窄的机械通道 = `op.knowledge_pools` + `where.tags=["$decision:rules-active.picked"]`（与 `kb/trope/*` 按 `decision:region` 过滤同构，内核已实现）。**当前 modules 里 rules 卡的 pool 化接线尚未逐 op 落**（现状仅 prose 模块验收面静态引用 1 张），落地属后续工单——在此之前激活决策的实际消费方是编排 agent（按 §六 验收面读卡），协议先行、机械随迁，禁止为凑数乱挂 pool。

## 三 · 扫描器证据面

### 3.1 两个入口，一个实现

- **内建步 `scan_quality`**（原 `check_aesthetic_asserts` 断言闸改造）：编排里的确定性 core 步，沿上游边全量扫描，产 `projects/<id>/内部/质量扫描-<node>.json`。
- **agent 自主调用 `tools/quality-scan.py`**（= `core/src/quality-cli.ts` 桥）：写作/评审过程中按需自查，同一 `aesthetic.ts` 实现（禁止第二套扫描器真相）。
- 其余 `check_*` minitool 保持 integrity 模式（存在性/残渣/计数一致——确定性完整性照旧可拦）。

### 3.2 收据契约

```
{ mode:"quality-evidence", node, minitool, checked:[被检文件],
  findings:[{name:AE-*, status:pass|warn|block, detail}], summary:{files,pass,warn,block}, note }
```

- `findings` 的 AE-* 是**扫描器收据 id**（如 AE-DENSITY-WORDS），与退役的声明协议无涉；三态里**没有 unverified**——扫描器只报自己真算过的东西，验不了的压根不出现在证据里（它归卡）。
- block 标签只是证据分级：`scan_quality` 步不因 block 判败、提交不因 block 打回。
- **空扫描 ≠ 通过**：`checked=[]` 时 journal 显式 warn「未检到任何上游产物（证据为空，非质量通过）」——接线问题按接线问题治。
- **报数必附收据**（铁律 10 升级）：一切「已扫描/aiIndex/密度/残留 N 处」声明必须引用收据文件路径，无收据 = 删声明。

### 3.3 台账核账

T 轨 27 条「声称工具化」的条目必须真有实现：kit-lint `W4 扫描器台账缺口`逐条点名（名单事实源 = `tools/rules-init.py` 的 TRACK_T，经 `tools/lintlib.py::scanner_coverage` 对 `aesthetic.ts` 源码 + prose-scan 服务面实查）。当前已知缺口 1 条：`AE-NAT-HIT`（24 类不自然词表命中未落扫描器；语义半边在 ai-trace 卡）——**补实现前不许假装验过**。

## 四 · 裁决与增补循环（判决怎么走完）

```
派发（K1 装载激活卡 → 判定标尺）→ agent 写作/交卷
  → 完整性闸（唯一机器打回）
  → 评审步/端尾验收：agent 对照语料卡 + 扫描证据逐条裁
      → 通过：交卷自动放行（评审步产物照出，R5 §四）
      → 不通过：reject 带证据（引用收据 + 指明违反的卡条款）→ 增补循环
          → 按缺陷域补装卡（§2.3）→ 2 轮仍不过 → blocked 问人
  → 端尾 kit-boundary 人裁（gate_role:"kit-boundary"，三重凭据不变）
```

- 文学判断节点（novel-deai / novel-judge / dialogue-polish 及端尾验收）保持**强模型档纪律**（AGENTS.md 模型档位纪律原文未动）。
- reject 的合法理由：完整性违规（机器）或「对照激活条款不达标且证据齐」（agent）；「扫描器有 block」本身不是 reject 理由——reject 必须落到条款与论证。

## 五 · 页面与观测面

- 面板验收区 = 「扫描 `<id>`」绿 chip + 「规则 `<卡>`」黄 chip + 固定文案「机器只出证据，裁决归 agent 与端尾验收」（`io.acceptance{scans,rules}` 驱动）。
- 激活三问必答（铁律 12⑦）：选了哪张卡 / 凭什么（evidence）/ 排除了哪些及理由（excluded）——页面读 `decisions/rules-active.json` 原件。
- 历史项目数据（v5.0 前 registry）的 `asserts`/`unverified` 只在页面生成器单点归一（`check` 字段名 + `warn` 态 + `legacy` 标），面板零双名兜底（R4 §5.3）。

## 六 · 守门与回归锁（谁替这条新模型站岗）

| 守卫 | 锁什么 |
| --- | --- |
| flow-lint `E-ASSERTS-RETIRED` / module-lint 同名 | flow/模块/出厂 overlay 出现 asserts/add_asserts/remove_asserts = error（回潮即红） |
| kit-lint `E11` + v5.0 台账 | overlay 补丁带退役断言字段 = error；C 轨进卡 = error；T 轨实现缺口 = W4 点名；卡混 X/T id = W |
| `core/test/r5-generative.test.ts` | 提交链无断言闸（扫描器 block 产物照收）、打回单零 AE- 名、`scan_quality` 收据形状（mode/findings/summary，无 declared/unverified）、WO-A 文本扫描器行为 |
| `core/test/kits.test.ts` | 归档台账 90 条完整可溯：模块 `io.acceptance.scans` ⊆ 归档、checks_via 目标在册、引擎 id 全在册 |
| `tools/page-lint.mjs` | 页面泄 asserts / acceptance 形状错 / 非 legacy 报告用 AE- 检查名 / 面板读 asserts = FAIL |

## 七 · 已知缺口（活账，勿在别处抄数）

1. rules 卡的 pool 化装载接线未逐 op 落（§2.4）——机械通道现成，改 module.json 即得，需按 op 逐个判断消费面，属后续工单。
2. `AE-NAT-HIT` 扫描器无实现（§3.3）。
3. 合规底线（AE-COMPLIANCE 类）从「机制保证」降为「流程保证」：端尾人裁必须展示合规 findings——流程保证依赖人看，风险知晓接受（工单 §五 4）。
4. 170 次空转的历史教训约束本规范一切设计：**任何「声明」若无实时核账（§六），就会烂成第二套真相**——新增卡域/新决策 key 时必须同步补守门，不许裸奔。
