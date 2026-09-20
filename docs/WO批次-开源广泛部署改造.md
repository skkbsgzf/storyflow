# WO 批次 · 面向开源广泛部署的改造（分支 `module-flow-v3`）

> 依据：`docs/审计-开源广泛部署阻塞项与初始化面板-2026-09-20.md`（本批唯一问题源）+ `docs/规范-模块化flow与工具箱-R6.md`（格式基线）。
> 触发样本：`p-wxl-001` 首跑（`docs/复盘-p-wxl-001首跑与workflow缺口-2026-09-20.md`）。
> 用法：**按波（wave）分批派给不同 agent**；同波内工单**文件互斥**，可并行；跨波有依赖，必须等上一波验收。
> 目标：让这套代码**在一个陌生人的机器上、无上下文、无作者陪同**的情况下能装、能跑、能理解、能改。
> 处置口径：**A=立即剔除**（纯负债）｜**B=面板化**（该保留，但必须让用户看见并可控）｜**C=补齐**（开源门面与工程基线）。

---

## 工单公共纪律（每单都适用）

1. **只写「写权文件」清单内的文件。** 清单外的文件一律不碰（本仓有并发写入者，越界即互相覆盖）。
2. **提交只 add 自己的文件**，禁止 `git add .` / `git add -A`；必须带 `-c user.name=miniflow -c user.email=miniflow@local`。
3. 结束时**跑完本单验收命令**并在提交信息里附结果。
4. 禁止把 LLM 引入任何**机器校验**环节（校验器必须确定性）。
5. **删数据前必须先出清单、人批后再执行**（铁律 10）。一律 `git rm --cached` + `.gitignore`，**禁止 `rm`/`rm -rf`**（工作区文件必须保留）。
6. 禁止补拍快照洗白存量问题；存量红档列清单不修。
7. **本批最高红线：不许为了让门禁变绿而删断言、降级门、补拍快照。** 红线高于绿灯。
8. 环境：Windows Git Bash **缺 coreutils**，每条 bash 前缀
   `export PATH="/c/Program Files/Git/usr/bin:$PATH";`
   `npx` 不可用；tsc 用 `cd core && node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit`，
   vitest 用 `node node_modules/vitest/vitest.mjs run`。
9. 含 `\n` / 转义的文本一律用 Write/Edit 工具写，**不要用 `python -c "…"` 走 bash 双引号**。

### 波次总览

| 波 | 工单 | 并行度 | 依赖 |
| --- | --- | --- | --- |
| **0** | OS-00 数据与合规剥离 | 1（可与波 1 并行，两者文件零交集） | — |
| **1** | OS-01 契约冻结：单一词表 + 可调面 | 1 | — |
| **2** | OS-02 内核运行时改造 | **1（唯一 core/src 写入者）** | 波 1 |
| **3** | OS-03 lint 补强 ｜ OS-04 初始化面板 ｜ OS-05 可移植性与依赖 | 3 | 波 2 |
| **4** | OS-06 开源门面与首次运行 ｜ OS-07 验收报告 | 2 | 波 3 |

⚠️ **`core/src` 全批次只允许一个 agent 写。** R5 与 v3 的经验一致：内核改动互相耦合，拆开并行必然冲突。
⚠️ 波 0 的文件（`.gitignore` / 数据清单 / demos）与波 1 的（`contracts` / `docs`）**零交集**，可同时开工。

---

## 波 0 · 数据与合规（P0，法律风险，先于一切技术整改）

### OS-00 · 数据与合规剥离

**目标**：把**不能随开源发布**的东西从版本库里摘出来。这是唯一一条「不做就有法律风险」的工单。

**实测现状**（`git ls-files` / `du` 实测）
| 项 | 实测 |
|---|---|
| `projects/` 已跟踪 | **1041 个文件 / 20M**（`p-slj-001..007`、`p-wxl-001`、`ccwd-fq*` 全是真实创作全文） |
| `src/kakaxing-Json/data/` 已跟踪 | **9 个文件 / 29M** |
| └ `scriptrawstone.jsonl` | 28,269,871 B —— **7938 部剧本**，含平台 `topPlanning` **策划全文原文** |
| └ `scriptwriter.jsonl` | 115,663 B —— **95 人真实姓名 / 城市 / 报价**（如 `"realName":"缪盛","city":"江西南昌","servicePriceFrom":8000`） |
| └ `shortfilm.jsonl` | 1,506,688 B —— 含 `phoneNumberMask` 与 **UCloud 签名密钥** |
| 全仓已跟踪 | 1415 个文件 |
| `knowledge/benchmark/b001..b0NN.md` | `provenance.source="import"`，refs 指向 `dataset:kakaxing/scriptrawstone@2026-09-15`；**全库无授权字段** |
| `.zhuque-key` | **未跟踪** ✓（`.gitignore:10-11` 已覆盖） |

**做什么**
1. **出清单，不执行**：`docs/数据剥离清单-2026-09-20.md` —— 逐条列 `路径 → 处置(剔除/脱敏/保留) → 理由 → 风险`。**等人批。**
2. 人批后执行**数据/代码分离**：
   - `projects/` 是运行时数据根 → 整体进 `.gitignore`，`git rm -r --cached projects`
     （保留工作区；`demos/` 已有的 6 个可跑示例作为**唯一的入库样例**）；
   - `src/kakaxing-Json/data/` → `.gitignore` + `git rm -r --cached`；保留 `scrape-kakaxing.mjs` / `README.md`
     并写明「**数据需自行采集，不入库**」；
3. **消 PII**：`scriptwriter.jsonl` / `shortfilm.jsonl` 整体剔除（不做脱敏后入库——脱敏规则本身也是可推理的敏感信息）。
4. **补 `.gitignore` + 取消跟踪**：缺 `.zcode/`、`.obsidian/`、`trace/`、`nul`、`tmp-fixture-page/`；
   已误跟踪 `.zcode/plans/plan-sess_*.md`（**含会话 ID**）、`.obsidian/*`、`trace/cli.jsonl`。
5. **扫密钥历史**：`git log --all --diff-filter=A -- .zhuque-key src/kakaxing-Json/data`
   → 若曾入库，**密钥必须轮换**，并在合规说明里写明「历史提交不可回溯」。
6. 出 `docs/合规说明-数据与许可.md`：每份数据的来源 / 授权状态 / 处置结论 / 保留的蒸馏产物。
7. `src/kakaxing-Json/` 是**另一个 scraper 项目**（`scrape-kakaxing.mjs` / `build-viewer.mjs` / `verify.mjs` /
   `update.cmd`），与 harness 主链无关 —— 一并评估：**移出主库**（转独立仓）或明确标注为「第三方数据采集工具，与底座协议无授权关系」。
8. ⚠️ **执行中新暴露：单元测试硬依赖真实项目数据 —— 必须先解耦再移数据。**
   `core/test/caliber.test.ts:94-108` 的两条 D5 用例读的是 `projects/p-fq-001` / `p-ts-001` / `p-key-soul`
   这三个**已被归档**（→ `projects/_archive/p-ts-001-20260916`、`projects/_archived/…`）的目录。
   `asserts.ts:477` 有 `if (!myOwn.length) return [];` 提前返回 ⇒ 目录不存在即返回空数组 ⇒ 实测
   **2 failed / 151 passed**（`expected [] to include '老周'`）。
   ⇒ **把 `projects/` 移出仓库前，必须先把这两条用例改成 `test/fixtures/` 造数**，否则「移数据」会顺带把测试打挂，
   而打挂的测试又会被当成「数据迁移的副作用」而不是「测试本来就依赖脏数据」。
   **动作顺序：先建 fixture → 跑绿 → 再执行第 2 项。**

**保留（不要误删）**：`knowledge/benchmark/*.md`（**蒸馏产物**，是 harness 的合法知识条目）、`tools/distill-kakaxing.mjs`（工具）、`kits/tool/kit.json`。

**写权文件**：`.gitignore`，`docs/数据剥离清单-2026-09-20.md`，`docs/合规说明-数据与许可.md`，`demos/**`，`src/kakaxing-Json/README.md`
**依赖**：无（可与波 1 并行）
**验收**
```bash
git ls-files projects | wc -l                    # 期望 0
git ls-files src/kakaxing-Json/data | wc -l      # 期望 0
git ls-files | wc -l                             # 期望大幅下降（1415 → 低位）
git status --short projects | head                # 工作区文件仍在（只是不再跟踪）
python tools/flag-scan.py 2>/dev/null || true     # 若有密钥扫描工具，结果入合规说明
```
**红线**：**禁止 `rm`/`rm -rf`/`rmdir`**；只允许 `git rm --cached` + `.gitignore`；**清单先行、人批后执行**；不删 `knowledge/benchmark/*`。

---

## 波 1 · 契约冻结（P1）

### OS-01 · 单一 overlay 词表 + 可调字段面冻结

**目标**：把「**哪些旋钮存在、默认什么、谁能覆盖**」冻结成 schema 唯一真源。**这是本批所有后续工单的地基。**

**实测现状（本次审计的头号结构问题）**

`overlay` 有**两套互不相通的词汇表**，交集只有 `set-policy`：

| | `contracts/flow-overlay.schema.json` + `overlay.ts:214-324` | `modules.ts::effectiveFlow3:356-379`（`kernel.ts:156` 调用） |
|---|---|---|
| kinds | `set-node` `set-op` `place-node` `remove-node` `set-edge` `add-edge` `remove-edge` `set-tool` `set-policy` `suppress-boundary` `set-input`（**11 种**，schema 枚举实测） | `set-policy` `set-module` `insert-tool`（**3 种**） |
| 交集 | —— 只有 **`set-policy`** —— | |

⇒ 在 flow@3 上：**11 种 schema 官方 kind 只生效 1 种**；另 2 种能生效的（`set-module`/`insert-tool`）**不在 schema 里**。

**最硬的证据**：`projects/ccwd-fq/registry/overlay.json` 有 2 条 `set-tool` patch，`"status": "applied"`、
history 记 `actor:"user"`（2026-09-18 拍板）—— 而 `kernel.ts:161` 在 flow@3 路径把 `toolOverrides` **硬编码为 `{}`**。
**审计日志记着"已生效"，内核根本没读。**（该 patch 之所以今天还在起作用，只因为 `ccwd-fq` 是 flow@1 跨代残留，走的是 legacy 路径。）

**做什么**

1. **统一词表**：`contracts/flow-overlay.schema.json` 的 `kind` 枚举与实现对齐 —— 每个 kind 必须有且只有一个消费者；
   `set-module` / `insert-tool` **补进 schema**。
2. **`set-tool` 补上 flow@3 语义**：`op.config` / `model_tier` / `knowledge` / `asserts` 的 overlay 覆盖
   （这是 §一.3「每个 tool 内容可调」**唯一缺失的落点**；当前只能改 repo 级 `modules/*/module.json` = 跨项目污染）。
3. **`set-input` 补上 flow@3 语义**（当前 `kernel.ts:160` 同样硬编码 `inputs: {}`）。
4. **枚举冲突统一**：`contracts/module.schema.json:190-194` 现为 `["high","low"]`，引擎 `kits.ts:251` 为 `["high","lite"]`
   ⇒ 写 `low` 过 lint 但引擎 enum 校验不认。**统一为 `high|lite`。**
5. **`model_tier` 默认值语义修正**（用户点名的那条）：`module.schema.json:195` 的 desc 写
   「**缺省不声明 = 无档位约束**」，但 `kits.ts:249-253` 的 config default 是 **`high`**（`resolveToolConfig` 会回填）
   ⇒ **用户不表态 = 系统自动上强档**。契约与实现**必须二选一**：建议改为「不约束/继承」，并在面板上让用户显式选。
6. **`policy` 补字段**：新增 `maxRounds`（link 重跑上限）、`awaitTimeoutMs`（等待超时）；
   `policy.budget` 的 `tokens`/`latencyMs`/`humanGates`（`overlay.ts:29`）**无任何消费者** ⇒ 实现或删。
7. **可调阈值字段面**：把下列引擎常量登记为「有出厂默认 + 项目可覆盖」的字段（与 panel 共用同一张表）：
   `assembler.ts:17,18,21`（`CONTEXT_BUDGET`/`SKILL_CAP`/`KB_TOTAL_CAP`/单卡上限）、`assembler.ts:388`（`maxContextChars`）、
   `aesthetic.ts:428,437-438`（章长 block/warn）、`:389-392`（排比/转折/虚词配额）、`:406`（集数下限）、
   `optimize.ts:74,81,124,153,159,171`（规则阈值）、`metrics.ts:287`（成本系数）。
   > 原则：**"能不能调"不该取决于常数当初写在哪一层。** 模块级旋钮（`maxChars`/`chapterMin`/`minScenes`/`passes`）已可覆盖，引擎级不能 —— 统一规则。
8. **`minitool.timeoutMs`**（`contracts/minitool.schema.json:20`，default 60000）：**接线或删**，不许留装饰。
9. 写 `docs/规范-开源部署与可调面-R7.md`：单一 overlay 词表 + 可调面总表（字段 / 出厂默认 / 作用域 / 谁可覆盖）+ 勘误段。

**写权文件**：`contracts/**`，`core/src/schema.ts`（`SCHEMA_IDS` 登记），`core/src/types.ts`，`docs/规范-开源部署与可调面-R7.md`，
以及**契约改动的直接后果文件**（本次为 `tools/module-lint.py` —— 见下）。
**依赖**：无
**验收**
```bash
python - <<'PY'
import json
d=json.load(open('contracts/flow-overlay.schema.json',encoding='utf-8'))
k=d['$defs']['patch']['properties']['kind']['enum']
assert 'set-module' in k and 'insert-tool' in k, k
m=json.load(open('contracts/module.schema.json',encoding='utf-8'))
print('model_tier enum =', m['definitions']['tool']['properties']['model_tier']['enum'])
print('overlay kinds =', k)
PY
cd core && node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
```
**红线**：只动契约与类型，**不动运行时行为**（行为在 OS-02）；不改 `flows/` `kits/` `modules/` 存量数据。

> **写权补充说明（执行时新增）**：`tools/module-lint.py` 被纳入 OS-01。理由：它里面硬编码 `TIERS = {"high","low"}`；
> 只改契约不改 lint，会立刻制造「契约说 `lite`、lint 认 `low`」的**新矛盾** —— 那正是本批要消灭的病。
> **规则**：凡**契约改动的直接后果**（enum 同步、白名单同步），一律随契约同批落地，不留到 OS-03。

---

## 波 2 · 内核运行时（P1）

### OS-02 · 可中断 / 可恢复 / 词表落地 / 默认值回调

**目标**：把「卡死」和「以为有」两类问题从内核根上解决。**本批唯一 core/src 写入者。**

**实测现状**
- `core/src/*.ts` 全文**无** `timeout` / `setTimeout` / `AbortController` / `heartbeat`（grep 实测为空）⇒ **agent 卡住 = 永久卡住**。
- 门 reject → `failed` + run-end（`kernel.ts:744-755`）；`flow_resume` 对 `failed` **直接早退**（`kernel.ts:593`）⇒ 只有 `flow_rerun` 能救，但 UI 上没人告诉你。
- link reject → 上游整段自动重跑（`kernel.ts:657-673`），**人可无限打回，无上限**。
- `itb-` 边界门**默认 `always`**（`overlay.ts:118-124`）⇒ 每处跨 kit 边必挂人工门。
- `itb-` 与 `link` 会**背靠背并存**（`kernel.ts:836-838`，overlayHash 漂移不 replan，静默沿用旧快照）。
- `iterate` **是死配置**：`modules.ts:21` 只有类型声明、**无传播代码**。
  ⇒ 实测 11 个项目的 `effective.json`，**派生节点无一携带 `iterate`**（`p-wxl-001`：28 顶层节点 / 25 组合节点，`it=[]`）；
  而 `kernel.ts:520 batchable = !!node.iterate`、`cond.ts:243`、`minitools.ts:441` 都在 **node** 上读 ⇒ **逐章迭代从未生效**。
  `flows/caocao-wudalang/flow.json` 却声明了 `m3.iterate={unit:chapter,over:大纲,first:1}`，`first:1` 语义从未定义。

**做什么（四阶段，可分段提交）**

**A · 可中断 / 可恢复**
1. 等待态显式化：state 落「**在等谁**」（节点 / 门 / 派发时刻 / 已等时长），页面据此显示；`kernel.ts:1180 gatesDue` 已有数据可复用。
2. `flow_resume` **接 `failed`**（改 `kernel.ts:593` 早退）；或至少在返回里明确「failed 只能用 `flow_rerun`」。
3. **link 重跑上限** `policy.maxRounds`（默认值进面板）：超限 → `blocked` + 显式原因（不许无限 ping-pong）。
4. **`itb-` 边界门默认改 `auto`**（`overlay.ts:118-124`）；flow@3 路径**不再注入** `itb-`（R6 已宣布退役）。
5. **overlayHash 漂移 → replan 或显式报错**（`kernel.ts:836-838`），**不许静默沿用旧快照**。
6. `policy.awaitTimeoutMs` 到点 → state 标 `stalled` + 写 journal（**只标记不自动推进**，避免机器替人拍板内容）。

**B · 词表落地（对齐 OS-01 冻结的契约）**
7. `effectiveFlow3` 支持 `set-tool` → 返回 `toolOverrides`；`kernel.ts:161` **不再硬编码 `{}`**。
8. `effectiveFlow3` 支持 `set-input`；`kernel.ts:160` **不再硬编码 `{}`**。
9. **未被 flow@3 支持的 kind → 显式 warn 并计入 `appliedCount` 对账**，绝不许静默丢弃。
   （`overlay.ts:299 set-tool` 的实现可直接复用——只是 flow@3 路径没接。）

**C · 默认值回调**
10. `model_tier` 默认由 `high` 改「不约束」（`kits.ts:249-253`）；`optimize.ts:158` 的 `?? "high"` 同步。
11. 引擎常量改读 policy/config（OS-01 登记的字段面）。
12. `optimize.ts:251` 产出的 `set-policy{key:"kit_boundary"}` 是**内核不认的 patch**（`types.ts:117` 已退役，
    `modules.ts:356-360` 只认 `link_default`）⇒ 静默丢弃。改为产 `link_default`。

**D · 死配置**
13. `iterate`：**实现「模块 iterate → 派生节点传播」**（`modules.ts:21` 补代码），或**删声明**。
    若实现，必须定义 `first` 语义并写进 R7 规范。**不许只留声明。**
14. `policy.budget` 未接线的键、`minitool.timeoutMs`：实现或删（与 OS-01 对齐）。

**写权文件**：`core/src/**`，`core/test/**`
**依赖**：波 1
**验收**
```bash
cd core && node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
node node_modules/vitest/vitest.mjs run            # 期望全绿
cd .. && python tools/flow-verify.py p-wxl-001      # 复跑样本
```
**新增测试必须覆盖**：① `set-tool` 在 flow@3 真的进 `toolOverrides`；② `iterate` 传播后派生节点带该字段；
③ `maxRounds` 超限 → `blocked`；④ `resume` 接 `failed`；⑤ `itb-` 默认不再注入。
**红线**：派生逻辑只在内核实现一次；**不许删断言让门变绿**；`iterate` 不许只留声明；存量项目 `overlayHash` 语义不许破坏。

---

## 波 3 · 三并行（P2）

### OS-03 · 工具链 lint 补强：让「声明了却不生效」变成 error

**目标**：**能力四环的第四环**——把这一批暴露出来的所有「声明了但没人跑」变成静态门。

**现状（lint 全绿 + 能力死亡）**
- `tools/module-lint.py` 的 `E-SLOT-BAD` 只查锚点**存在**，不查**可达** ⇒ `also_fits` 那批 op 全部 lint 通过却结构性不可达。
- 断言路由靠**文件名正则**（`aesthetic.ts:487` `/章节正文|第\d+章|正文|终稿/`）⇒ `rename` 即静默失效，**无 lint 能发现**。

**⚠️ 执行中新暴露的头号问题：门禁工具本身在 flow@3 上崩，而「崩 = 通过」**
实测 `grep -n '\["graph"\]' tools/*.py` ⇒ **12 个工具、17 处**直接读 `flow["graph"]["nodes"]`；
而 `flow@3` 的 flow.json **没有 `graph`**（节点由内核 `expandFlow3` 派生）。三条全链门禁直接 `KeyError`：

| 工具 | 表现 | 后果 |
|---|---|---|
| `tools/validate-kb.py:73` | `KeyError: 'graph'` | **掩盖了一条真 FAIL**（见下） |
| `tools/flow-normalize.py:633` | `KeyError: 'graph'` | 「幂等」结论拿不到（技能/记忆里却写着「期望幂等」） |
| `tools/r5-migrate.py:68` | `KeyError: 'graph'` | 同上 |

**最有力的证明**：把 `validate-kb.py` 的崩溃修成「flow@3 显式免检」之后，它立刻报出
`[FAIL] unresolved kb refs: [('skills/orchestration-miner.md', 'kb/trope/saturation')]`
—— 这条 FAIL **一直存在，被崩溃遮住了**。这就是「崩掉当成没事」的教科书实例。

> **OS-01 执行时已修 3 处**（`validate-kb.py` / `flow-normalize.py` / `r5-migrate.py`，均改为「flow@3 显式免检 + 打印免检清单」，
> 见落地台账）。**剩余 9 处未处理**（`flow-verify.py` 实测可用 ✓ / `whereami.py` 实测可用 ✓ / `kit-lint.py:181` 已有 flow@3 分支 ✓；
> 未验：`kit-migrate.py:62`、`snapshot.py:121`、`render-flow.py:30`）。
> **本单必须先做一次全量排查**：每个读 `graph` 的工具，要么补 flow@3 分支，要么显式免检 —— **不许留一个会 `KeyError` 的**。

**做什么**
1. **全量排查 `graph` 依赖**：对 17 处逐一判定「补 flow@3 分支 / 显式免检 / 已可用」，结果写进
   `docs/清单-工具在flow@3上的可用性.md`（工具 × 可用性 × 处置 × 实测证据）。
2. `tools/module-lint.py`
   - `E-SLOT-BAD` 升级为**可达性**校验：锚点存在 **且** 在最终 seq 里能落位；
   - 新增：`model_tier` 值不在引擎枚举内 → **error**（对齐 OS-01）；
   - 新增：`E-PATCH-NO-CONSUMER` —— patch kind 必须至少有一个消费者实现；
   - 新增：**声明的断言在本产物类型下不可达 → error**（配合 OS-02 的节点契约路由）。
3. `tools/flow-lint.py`：flow@3 overlay 里出现未支持的 kind → **error 并给迁移命令**。
4. 每个 lint 支持 `--json`（供 agent 消费）。
5. 在 `tools/__fixtures__/` 放**负例**：故意触达每一条新 E 级规则，证明它们真的会红。
6. ⚠️ **断言两套台账对账**：`kit-lint.py` 实测报
   「未登记断言：引擎发出但 `knowledge/aesthetic/assertions.json` 里没有 → **`AE-CH-LEN`**」。
   `AE-CH-LEN` 正是 `p-wxl-001` 章数事故的核心断言 —— **它连台账都没进**。
   两套账（注册表 87 条 / 引擎自造 `AE-PROSE-*`/`AE-SCRIPT-*`/`AE-CH-LEN` 等）必须收敛成一套，否则「断言可查」永远不成立。

**写权文件**：`tools/module-lint.py`，`tools/flow-lint.py`，`tools/snapshot.py`，`tools/render-flow.py`，
`tools/kit-migrate.py`（仅 flow@3 免检分支），`docs/清单-工具在flow@3上的可用性.md`，`tools/__fixtures__/**`
> `tools/flow-verify.py` / `whereami.py` / `kit-lint.py` 实测在 flow@3 上可用，**不在本单写权内**（勿动）。
**依赖**：波 2
**验收**
```bash
python tools/module-lint.py --json      # 0 error
python tools/flow-lint.py --json        # 0 error（7 个未迁移 flow@2 的存量红档列清单，不修）
python tools/module-lint.py --fixtures  # 负例全部按预期报 E 级
# 崩溃类回归：下面每条都必须「正常结束」，不许 KeyError
for t in validate-kb flow-normalize r5-migrate; do python tools/$t.py --check 2>&1 | tail -2; done
```
**红线**：**红线高于绿灯** —— 不许为了 0 error 而放宽规则；存量红档列清单、标注来源、不修。

---

### OS-04 · 初始化面板（回答用户那句「至少在初始化时给面板」）

**目标**：把「不该由代码替用户拍板」的东西，从硬编码变成**页面上可填的字段**。

**现状（实测）**
- 模板**无 `<form>`、无 checkbox**；唯一可编辑的是原始 JSON textarea（`workflow-page-template.html:1555-1570`）。
- 工具箱抽屉 `openToolboxPaper`（`:1297-1318`）：`cursor:default`、**无事件、无 checkbox、不生成任何 patch**，
  而 chip 文案写着「勾选即出 overlay patch」—— **界面在撒谎**。
- `项目配置` 编辑器**恒显占位**：模板 `:1555` 读 `DATA.projectConfig`，但 `tools/project-pages.py:378-394` **未注入该键**。
- 建项目路径：CLI 有 `flow_run`/`flow_init`（`cli.ts:83,105`），**MCP 有 7 个 verb 却没有 `flow_init`**。
- `flow.inputs` 声明很完整（`project|string|number|boolean|enum` + `required/default/options`），
  消费于 `cond.ts:169 resolveInputs` → `state.inputs`（`kernel.ts:323/343`）—— **消费链是通的，缺的只是表单**。

**做什么：四分区，数据全部来自已有声明（不新增契约）**
1. **项目输入区** ← 读 `flow.inputs` **逐字段渲染**（required 校验 / enum 下拉 / number 默认值 / boolean 开关），
   写回 `输入/项目配置.json`。
   > **这一区一次性消灭两个缺口**：「手写 JSON」和「MCP 没有 `flow_init`」。
2. **编排区** ← 读 `module.caps` / `skeleton` / `also_fits` 渲染勾选（**复用工具箱抽屉，但要真的能勾**），
   生成 patch 前先做 **kind 白名单校验**（对齐 OS-01 统一后的 schema），并显示「这条 patch 会不会被内核读」。
3. **阈值与预算区** ← OS-01 登记的可调面，按「常用 / 高级」分组暴露；每项显示 `出厂默认` 与 `当前来源`。
4. **门与风险区** ← `itb-` 默认策略 / `link` 默认 / **`maxRounds` 最大重跑轮次** / **`awaitTimeoutMs` 等待超时**。
5. 每次改动 → 生成 **overlay patch 草稿**（不直接改 `flow.json`），显示可复制的 patch + 命令，**经人确认才落盘**。
6. 首次运行引导：`tools/whereami.py:210` 输出 `IDLE: 没有待办项目`（**不报错、不引导**）→ 改为指向初始化面板 + `demos/` 示例。

**写权文件**：`tools/workflow-page-template.html`，`tools/project-pages.py`，`tools/page-lint.mjs`，`tools/whereami.py`
**依赖**：波 2（字段面与 patch 通道已定）
**验收**
```bash
python tools/project-pages.py caocao-wudalang p-wxl-001     # 入参顺序：flowId 在前
for d in projects/*/; do node tools/page-lint.mjs "$d/workflow.html"; done
```
**红线**：改模板后**必须重生成页面**再跑 page-lint（否则跑的是旧产物）；面板产出的 patch **必须人确认**才落盘；
不许把「勾选即出 patch」再写成一句谎话——要么能勾，要么改文案。

---

### OS-05 · 可移植性与依赖：换台机器能跑起来

**现状（实测）**
- **硬编码盘符 11 处**：`AGENTS.md:31`（强制「脚本一律从仓库根 `D:/storymasterv4` 运行；Python 用 `python`」）、
  `core/dbg-leak.mts:3`、`core/gen-fixpage.mts:3`、`core/scripts-inventory-projects.py:3`、
  `projects/_archive/*/run-asserts.py`、`src/store-draft/build.mjs`。
- Windows 绑定：`src/kakaxing-Json/update.cmd`（`chcp 65001`/`where node`/`cd /d`/`pause`）；
  `docs/WO批次-模块化flow-v3.md:18` 要求手动 `export PATH="/c/Program Files/Git/usr/bin:$PATH"`。
- `tools/export-doc.py:257-259` 顶层 `from docx import ...`（python-docx）—— **docx 交付链的必经步骤**，
  未装依赖时直接崩，且崩在渲染阶段而非启动阶段，报错信息对用户无指引。
- `core/package.json` 有 deps 但**无 `engines`**。

**做什么**
1. 11 处硬编码盘符 → `path.relative` / `import.meta.url` / `Path.cwd()`；`AGENTS.md:31` 改为「从仓库根运行（路径自适应）」。
2. `tools/export-doc.py`：docx 依赖改**可选 + 前置检查 + 明确指引**（提示 `pip install python-docx`），
   并提供**降级路径**（导出 markdown 而非 docx）。
3. `core/package.json` 补 `engines`（node 版本）。
4. 写 `docs/安装与运行.md`：Node / Python 版本、必需与可选依赖、三步跑通（含一条最短 demo 命令）。
5. 用 `grep -rn "storymasterv4\|D:/" --include=*.ts --include=*.mts --include=*.py --include=*.mjs` 收尾自查（期望只剩 docs 说明类命中）。

**写权文件**：`AGENTS.md`，`core/dbg-leak.mts`，`core/gen-fixpage.mts`，`core/scripts-inventory-projects.py`，
`tools/export-doc.py`，`core/package.json`，`docs/安装与运行.md`
**依赖**：波 2
**验收**
```bash
export PATH="/c/Program Files/Git/usr/bin:$PATH"
grep -rn "storymasterv4" --include=*.ts --include=*.mts --include=*.py --include=*.mjs . | grep -v node_modules | grep -v "^./dist/"
cd core && node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
cd .. && python tools/export-doc.py --help      # 缺 docx 时给明确指引而不是 traceback
```
**红线**：不改文档中**示例性**的路径说明（那些是给人看的）；只改**功能性**读取。

---

## 波 4 · 二并行（P3）

### OS-06 · 开源门面与首次运行体验

**现状**：`README.md` / `LICENSE` / `CONTRIBUTING.md` / `CHANGELOG.md` / 根 `package.json` / `pyproject.toml` **全部缺失**；
唯一入口 `AGENTS.md`（11KB）通篇是「违反即无效工作」式的 **agent 行为契约**，不是给人的安装文档。

**做什么**
1. `README.md`：这是什么 / 30 秒跑通 / 目录结构 / 协议标准（`module@1` / `flow@3` / 知识条目格式）/ 文档索引 / 贡献入口。
2. `LICENSE`：**选型必须人批**（当前全库无授权声明，且含第三方数据来源 —— 与 OS-00 结论联动）。建议 MIT（与人既往开源选择一致）。
3. `CONTRIBUTING.md`：门禁怎么跑、提交纪律（逐路径 add）、能力四环自查表、结构类改动永远人批。
4. `CHANGELOG.md`：从 `git log` 归纳（模块化 v3 / D1–D5 / 本批）。
5. 首次运行：空 `projects/` 时 `whereami.py` 引导建项目；`demos/` 补一条**双击/单命令即跑**路径；
   `docs/安装与运行.md`（OS-05 产出）从 README 链进去。
6. `AGENTS.md` 降级定位：明确写「**这是给 agent 的行为契约，人类请先看 README**」，并把绝对路径要求移出。

**写权文件**：`README.md`，`LICENSE`，`CONTRIBUTING.md`，`CHANGELOG.md`，`AGENTS.md`，`demos/**`
**依赖**：波 3
**验收**：README 的「30 秒跑通」命令**在干净环境实测可跑**（贴出实际输出）。
**红线**：LICENSE 未定前**不许提交任何 LICENSE 文件**；不许在 README 里承诺未实现的能力（**这正是本次审计的病根**）。

---

### OS-07 · 全链门禁回归与验收报告

**做什么**
1. 跑全链（见附 A）。
2. **能力四环自查表**：本批每个新能力逐条打勾 ①契约声明 ✓ ②内核执行 ✓ ③UI 可见可开 ✓ ④lint 可校验 ✓ —— **缺一环就是没做**。
3. 「声明了却不生效」**清零对账表**：逐个 overlay kind × `flow@3` 是否生效的矩阵，与本批改造前对照。
4. 遗留清单（存量红档按来源标注：p-key-soul 16 / p-ts-001 14 / p-fq-001 7，均为 R4 前存量债）。
5. 写 `docs/验收报告-开源广泛部署.md`。
6. 更新 `AGENTS.md` 铁律（新增「可中断」「单一词表」「阈值分层」条目）。

**写权文件**：`docs/验收报告-开源广泛部署.md`，`AGENTS.md`
**依赖**：全部
**验收**：附 A 命令全绿（或遗留项**显式记账**）。
**红线**：**不许为了让门禁变绿而删断言、降级门、补拍快照**。

---

## 附 A · 全链门禁（每条都要跑）

```bash
# 从仓库根
export PATH="/c/Program Files/Git/usr/bin:$PATH"
python tools/module-lint.py --json
python tools/flow-lint.py --json
python tools/kit-lint.py
python tools/artifact-lint.py
python tools/validate-kb.py
python tools/flow-normalize.py --check
python tools/r5-migrate.py --check
python tools/kit-config-init.py --check
cd core && node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
node node_modules/vitest/vitest.mjs run
cd .. && python tools/project-pages.py caocao-wudalang p-wxl-001
for d in projects/*/; do node tools/page-lint.mjs "$d/workflow.html"; done
```
**基线**：09-17 = vitest 114 / kit-lint 0·14 / flow-lint 0·0 / artifact-lint 0·96 / page-lint 44/44×3 + 27/27×2；
09-19 = vitest 127。**跑门禁前先实测，别引用旧数。**

## 附 B · 可自行复核的关键命令

```bash
# 1. 内核是否真的没有超时 → 空
grep -rn "timeout\|setTimeout\|AbortController" core/src/*.ts

# 2. 两套 overlay 词表
python -c "import json;d=json.load(open('contracts/flow-overlay.schema.json',encoding='utf-8'));print(d['\$defs']['patch']['properties']['kind']['enum'])"
sed -n '341,380p' core/src/modules.ts          # effectiveFlow3 只认 3 种
sed -n '155,168p' core/src/kernel.ts           # toolOverrides:{} / inputs:{} 硬编码

# 3. model_tier 枚举冲突 + 默认 high
sed -n '190,196p' contracts/module.schema.json # high|low
sed -n '249,255p' core/src/kits.ts             # high|lite, default "high"

# 4. iterate 是死配置
grep -n "iterate" core/src/modules.ts          # 只有第 21 行类型
python - <<'PY'
import json,glob,os
for p in sorted(glob.glob('projects/*/registry/effective.json')):
    d=json.load(open(p,encoding='utf-8'))
    ns=[n for m in (d.get('composition') or []) for n in (m.get('nodes') or [])]
    print(os.path.basename(os.path.dirname(os.path.dirname(p))), 'iterate:', [n.get('id') for n in ns if n.get('iterate')])
PY

# 5. "applied 但没生效" 的铁证
cat projects/ccwd-fq/registry/overlay.json

# 6. 入库规模
git ls-files projects | wc -l ; git ls-files src/kakaxing-Json/data | wc -l
du -sh projects src/kakaxing-Json/data
```

---

## 附 C · 本批不做（明确排除）

- **存量项目的实际目录搬迁**（`projects/` 的路径迁移是独立批次，本批只做「移出仓库跟踪」）；
- **把 `src/kakaxing-Json/` 拆成独立仓**（本批只标注 + 剔除数据，拆仓需人拍板）；
- **多条 flow 的内容调优**（模块/工具/skill 内容属内容线，本批只动机制）；
- **`acceptance_criteria` 数值断言原语**（独立批次）；
- **许可选型之外的商标/品牌命名**（需人拍板）。

## 附 D · 待拍板（需用户决策，其余由执行者自行拍定）

| # | 事项 | 建议 | 影响 |
|---|---|---|---|
| 1 | `LICENSE` 选型 | **MIT**（与既往开源选择一致） | OS-06 阻塞 |
| 2 | `projects/` 是否接受整体移出仓库跟踪 | **接受**（改为本地数据根 + `demos/` 保留最小样例） | OS-00 阻塞 |
| 3 | `src/kakaxing-Json/` 整体去留 | **移出主库**（第三方平台采集工具，与底座协议无授权关系） | OS-00 |
| 4 | `model_tier` 默认语义 | **不约束/继承**（而非 `high`） | OS-02 阶段 C |
| 5 | 压缩历史（`filter-repo` 重写）还是仅当前树剥离 | **仅当前树剥离 + 轮换密钥**（重写历史会打乱所有 SHA，风险大于收益） | OS-00 |
| 6 | **N2**：`adapt:"off"`（只观测）语义 | **实现它**（`off` = 不产出提案）——否则契约里的这个取值是装饰 | OS-02 |
| 7 | **N4**：per-link 降级通道 | **新增 `set-link {link:"<实例id>", mode:"auto"｜"manual"}`**，否则 `R7-boundary-auto` 规则在 flow@3 永远无效 | OS-01 补充 + OS-02 |
| 8 | **N1**：`state.plan` 陈旧 + replan 从未运行 | **修**（计划存在但节点集与生效编排不一致时必须 replan），但**先出存量影响清单**再动 | OS-02 阶段 A |

## 落地台账

| 工单 | 状态 | 落点 | 日期 |
|---|---|---|---|
| OS-00 第 8 项（测试脱耦） | ✅ 已落地 | `core/test/caliber.test.ts` 两条 D5 用例改自建 fixture（临时目录），不再依赖真实项目数据。**`vitest` 由 151 passed/2 failed 变为全绿** | 2026-09-20 |
| OS-01 契约冻结 | ✅ 已落地 | 见下「OS-01 明细」 | 2026-09-20 |
| OS-02 波 2 第一批（词表落地 + policy 声明生效） | ✅ 已落地 | `modules.ts::effectiveFlow3` 实装 `set-tool`/`set-input`/`unsupported` 回显/`flow.policy` 起点；`kernel.ts::effectiveOf` 去掉硬编码 `{}`。新增 9 条单测（`modules.test.ts` 8→16 条） | 2026-09-20 |
| OS-03 门禁崩溃（3/12 处，预修） | ✅ 已落地 | `tools/validate-kb.py`、`tools/flow-normalize.py`、`tools/r5-migrate.py` 补 flow@3 免检分支 | 2026-09-20 |
| **OS-02 阶段 A（可中断 / 可恢复）** | ✅ 已落地 | 等待态显式化（`blocked` 独立于 `failed`）；`flow_resume` 接 `failed`/`blocked`；连接件驳回封顶 `maxRounds`；出厂 `kit_boundary: always→auto`（含 N5 修复）；`overlayHash` 首装漂移即重编译；`awaitTimeoutMs` → `stalledAt`。见下「OS-02 阶段 A 明细」 | 2026-09-20 |
| **R8-OPS 第 0 批 · 失败外显（诊断通道）** | ✅ 已落地 | 新增 `contracts/diagnostics.schema.json` + `core/src/diag.ts`（`recordDiag`/`readDiags`/`summarizeDiags`，**永不抛异常**）；改造 8 处「吞掉会改变结论」的 `catch`；`flow_effect` 与 `/api/diagnostics` 暴露汇总。见下「R8-OPS 第 0 批明细」 | 2026-09-20 |
| **R8-OPS 第 0 批 · server 合一 + `miniflow up`** | ✅ 已落地 | 新增 `core/src/static.ts`（白名单静态面）+ `core/src/compat.ts`（serve.py 八个 legacy 端点并入内核面）；`cli.ts` 新增 `up`（端口占用自动顺延）。**同进程单端口同时提供 内核 API + legacy 端点 + 页面**。见下明细 | 2026-09-20 |
| **R8-OPS 第 1 批 · 前端 live 化（快照 → 轮询）** | ✅ 已落地 | 新增 `kernel.viewLive()`（含 `fingerprint`/`revision`/`filesRevision`）+ `GET /api/projects/:id/live(?files=1)`；页面模板由「SSR 快照」改为**静态切片 SSR + 易变切片轮询**；**顺带修 flow@3 `workbench-payload` 500**（`flow.graph` 缺失，第 4 处 N 类 latent）。见下明细 | 2026-09-20 |
| **R8-OPS 第 2 批 · 动词表唯一源** | ✅ 已落地 | 新建 `core/src/verbs.ts`（13 动词唯一台账）；MCP 由 7 个手写 tool → 遍历表注册；HTTP `/api/verbs/:verb` 由 4-case → 查表分派；CLI 删 13-case switch、`usage()` 由表生成。顺带修 `skill_patch` 写死 `ROOT` 的静默错位（改 `kernel.repoRoot`）；`contracts/http-openapi.json` 11→24 路径（补声明已有未声明端点）。见下明细 | 2026-09-20 |
| OS-02 阶段 C（默认值回调）/ 阶段 D（死配置 `iterate`） | ⏳ 待开工 | 含 N2（`adapt:"off"` 未实现，需拍板）、N4（`set-link` 契约，需拍板）、§三勘误 2（`model_tier` 默认 `high`）、§二 C/D 两表 | — |
| OS-00 数据剥离执行 / OS-04 / OS-05 / OS-06 / OS-07 | ⏳ 待开工 | 数据剥离需先拍板 附 D #2/#3/#5 | — |

### OS-02 执行中新发现（已实测，需拍板才能动）

| # | 发现 | 证据 | 处置 |
|---|---|---|---|
| **N1** | **`state.plan` 是陈旧快照，`replan()` 从未运行过** | `state.planHash` **11/11 缺失**；`state.plan.order` 含 `itb-` 节点 **11/11**；而 `effective.json` 的 `itb-` 节点 **0/11**。`kernel.ts:823` 是 `state.plan?.order ?? compilePlan(...)` ⇒ 计划存在就照用；`replan()` 会写 `planHash` 却从未写过 | 阶段 A，**涉存量 run 状态，需谨慎** |
| **N2** | **`adapt:"off"` 与 `"propose"` 行为等价——「只观测」未实现** | `optimize.ts:329` 唯一判断是 `adapt === "apply"` ⇒ `off` 与 `propose` 产出相同。两条 flow@3 都声明 `adapt:"off"`，存量 11 个项目 `effective.json` 全是 `propose` | 实现 `off` 语义或删除该取值（**改优化器可观测行为，需拍板**） |
| **N3** | **`R7` 编号有歧义** | `R7` 既是规范版本号（R5/R6/R7 文档），又是优化器规则号（`optimize.ts` 的 `R3/R6/R7/R9`） | 后续规范改 `R7-spec` 或换主题词 |
| **N4** | **`R7-boundary-auto` 产出的 patch 在 flow@3 被显式忽略** | `optimize.ts:251` 产 `set-policy{key:"kit_boundary"}`；R6 已退役该键 ⇒ 落进 `unsupported`。**根因：R6 退役 kit 边界却没给 per-link 替代**——现有 kind 无 `set-link`，`sorted link_default` 是全局的 | 阶段 A 后**不再产出**（缺省已是 `auto`，守卫命中）；per-link 替代仍缺 → 新增 `set-link {link, mode}` 或删该规则（**需拍板**） |
| **N5** | **`kit_boundary="auto"` 结构性损坏：会截断整条流程（P0）** | `plan.ts:52` 把不活跃节点的出入边一并裁掉 ⇒ 边界门的下游失去活跃入边、又不是源点 ⇒ 不可达。实测 `plan.order` 止于 `gate-r1`（**8** 节点，应为 **22**），一半节点 `status=none` 而 `run` 判 `completed`。**从未暴露**：缺省是 `always`，而优化器恰把该值当低风险提案自动落地 | **阶段 A 已修**：边界门留在计划内、由 `advance` 自动裁决；并加「真实 flow@3 计划不得截断」守规矩的守卫用例 |
| **N5b** | **同一根因的另一次暴露面**：它同时证明「`when` 裁掉的**中间节点**会孤立其下游」是**通用**陷阱（不止边界门） | `plan.ts:70-71` 的注释只考虑了「条件支线变假源点」，未考虑「中间节点被裁 ⇒ 下游不可达」 | 已由 N5 的结构守卫用例覆盖；后续任何「用 `when` 关掉中间节点」的写法都要先过这条断言 |
| **N6** | **`phase:"link"` 从未落盘——指标又被 `catch{}` 吞了一次** | `types.ts:304 MetricPhase` 含 `"link"`、内核在写，但 `contracts/metrics.schema.json` 的 `phase.enum` **没有** ⇒ `recordMetric` 抛 `SchemaViolation` ⇒ `kernel.metric` 的 `catch{}` 静默吞掉。实盘核对 11 项目 + `_archived` 共 **436 行 metrics**：`link` 相 **0 条**、`boundary` 相 **0 条** | 已补 enum；**建议 OS-03** 加「契约枚举 ↔ 引擎类型」一致性 lint（`MetricsPhase` 这类同仓双写漂移编译器看不见） |
| **N7** | **`validate-kb` 存量 FAIL**：`skills/orchestration-miner.md` 引用 `kb/trope/saturation` 未解析 | `knowledge/trope/` 无 `saturation.md`——`saturation` 是**卡内字段**不是卡 id。该项在修 `KeyError:'graph'` 后才显形（原先是「崩了当没事」） | 归 OS-03 存量；引用语义（换成真卡 id / 去掉 `kb/` 前缀）需作者确认，**本批未动** |

### OS-02 阶段 A 明细（可中断 / 可恢复）

| 文件 | 改动 | 证据 |
|---|---|---|
| `contracts/run-state.schema.json` | v1.0.3：`status` 枚举补 **`blocked`**；根级新增 **`rejects`**（逐门累计驳回）、**`stalledAt`**；补 `x-status-semantics` 语义表 | `saveState` 走 `assertSchema` 严格复验 —— **契约先行**，否则落盘即抛 |
| `core/src/types.ts` | `RunStatus` 补 `blocked`（区分「停机等人」与「终态 failed」）；`RunState` 补 `rejects`/`stalledAt`；`FlowDescriptor.policy` 补 `maxRounds`/`awaitTimeoutMs` | tsc 0 |
| `core/src/overlay.ts` | ① `DEFAULT_POLICY.kit_boundary: "always" → "auto"`；② `injectKitBoundaries` **移除** auto 分支的节点级 `when`（N5 根因）；③ `effectiveFlow` 透传 `maxRounds`/`awaitTimeoutMs`（此前对 flow@2 静默丢弃） | 探针实测 `itb-structure.when` 由 `{...never}` 变为 `undefined` |
| `core/src/kernel.ts` | ① `flow_resume` 接 `failed`/`blocked` → `recoverRejected`（按因分流：被打回⇒重跑上游／等待超时⇒只澄清标记 + 计时重起）；② `rejectedScope`（flow@3 走模块表，否则计划前缀）；③ `doGate` link 分支累计 `rejects` + `rejectCapped` → `blocked`；④ `markStalled`（`advance` 入口）；⑤ `blockedStop`；⑥ `flow_next`/`advance` 对 `blocked` 短路；⑦ gate 分支新增 `kit_boundary=auto` 的**计划内自动裁决**；⑧ `overlayHash` 首装不一致即 `replan`（不再无条件沿用旧快照） | 新增 `r7-runtime.test.ts` 6 条 |
| `contracts/metrics.schema.json` | `phase.enum` 补 **`link`**（N6） | 实盘 436 行 metrics 中 `link` 相原为 0 |
| `core/test/r7-runtime.test.ts` | 新建：合成 flow@2（a → link1 → b）驱动连接件裁决；覆盖 resume 接 failed/blocked、`maxRounds` 封顶、`blocked` 屏障、`awaitTimeoutMs`；外加**真实 flow@3 计划不得截断**的结构守卫 | 6 passed |
| `core/test/r5-generative.test.ts` | 「默认撞边界」组改为**显式 `kit_boundary=always`**（缺省已变）；新增「缺省=auto：边界门可见、自动放行、下游不断」回归组 | 37 passed |
| `docs/规范-开源部署与可调面-R7.md` | §二 B 表标落地；新增 §八 阶段 A 执行记录 + N5–N7 | — |

**阶段 A 门禁实测**

| 门 | 结果 |
|---|---|
| `cd core && tsc --noEmit` | **OK** |
| `vitest` | **172 passed / 0 failed（17 files）** —— 全绿（阶段 A 前 165） |
| `module-lint.py` | **0 errors** / 36 warnings |
| `kit-lint.py` | **0 errors** / 21 warnings |
| `flow-lint.py` | **21 errors** —— 与阶段 A 前**同数**，全部为 7 个未迁移 flow@2 的存量红档 |
| `artifact-lint.py` | **0 errors** / 168 warnings（与阶段 A 前同数） |
| `validate-kb.py` | **1 FAIL**（N7，存量）+ 1 WARN（flow@3 免检 2 条） |

### OS-01 明细

| 文件 | 改动 | 证据 |
|---|---|---|
| `contracts/flow-overlay.schema.json` | `kind` 枚举 11 → **13**（补 `set-module` / `insert-tool`）；补属性 `caps` / `module` / `tool` / `slot` | 枚举实测 13 项 |
| `contracts/module.schema.json` | `definitions.tool.model_tier` 枚举 `high\|low` → **`high\|lite`**；措辞与「缺省=无约束」对齐 | 实测 `['high','lite']` |
| `contracts/flow.schema.json` | `policy` 新增 **`maxRounds`**（≥1）与 **`awaitTimeoutMs`**（≥10000） | `policy keys` 实测含二者 |
| `tools/module-lint.py` | `TIERS` `{high,low}` → **`{high,lite}`**；`E-MODEL-TIER` 文案同步 | 契约改动的直接后果，随契约同批 |
| `docs/规范-开源部署与可调面-R7.md` | 新建：单一词表 13 kind 消费者表 + 可调面 A/B/C/D 四表 + 档位勘误 | — |

**OS-01 门禁实测（本波）**

| 门 | 结果 |
|---|---|
| `cd core && tsc --noEmit` | **OK** |
| `vitest` | **165 passed / 0 failed（165）—— 全绿**（OS-00 第 8 项 + OS-02 第一批后；原 151/2） |
| `module-lint.py` | **0 errors** / 36 warnings |
| `kit-lint.py` | **0 errors** / 21 warnings |
| `flow-lint.py` | **21 errors** / 1 warning —— **全部为 7 个未迁移 flow@2 的存量红档**（`book-deconstruct`/`episode-script`/`novel-fanqie`/`novel-longform`/`novel-prose`/`outline-production`/`topic-selection`，各 3 条 E-FORMAT/E-FIELD/E-MODULES），**本波未引入、未修** |
| `validate-kb.py` | 崩溃已修 → 现报 **1 FAIL**（`skills/orchestration-miner.md` 引用 `kb/trope/saturation` 未解析）+ 1 WARN（flow dataBase 2026-09-14 ≠ snapshot 2026-09-15）。**该 FAIL 为存量，此前被崩溃掩盖** |
| `flow-normalize.py --check` | 崩溃已修 → 「处理 9 个 flow」，无异常 |
| `r5-migrate.py --check` | 崩溃已修 → 「0 个 flow 待迁移（幂等）」+ flow@3 免检 2 条 |
| `artifact-lint.py` | 0 errors / 168 warnings（11 projects / 312 md）|
| `kit-config-init.py --check` | 报「若干 op 未被 config 表覆盖」—— **存量**，未修 |

**存量红档（本波引入？→ 否）**

| 红档 | 来源 | 为什么之前看不见 |
|---|---|---|
| `vitest` 2 failed（`caliber.test.ts` D5 禁词表） | `p-fq-001`/`p-ts-001`/`p-key-soul` 三个目录**已被归档**，`asserts.ts:477` 提前返回空数组 | 测试硬依赖真实项目数据 ⇒ 归档动作一发生就挂，与代码无关。**已由 OS-00 第 8 项修复（改自建 fixture）** |
| `flow-lint` 21 errors | 7 个 flow@2 从未迁移（WO 批次 v3 的 WO-08 未执行） | 门禁如实报告，只是没人看 |
| `validate-kb` 1 FAIL（`kb/trope/saturation`） | `skills/orchestration-miner.md` 引用了不存在的知识条目 | **被 `KeyError: 'graph'` 崩溃掩盖** —— 「崩 = 通过」 |
| `kit-lint` 未登记断言 `AE-CH-LEN` | 引擎自造 id，未进注册表台账 | 两套命名漂移，lint 只报 WARN |
| `kit-config-init` 覆盖缺口 | config 表未覆盖若干 system op | 需 `--allow-generic` 或补表 |

---

## R8-OPS · 第 0 批：常驻 server 架构的前置两件

### 起因：用户提出的架构诉求（2026-09-20 讨论）

原话要点：工具链现**寄生于其他 Agent 上下文**（Skill/插件形态）；希望**首次启动起一个 server 线程**、
默认初始化**常驻前端页**；初始化面板含几个 step（**项目地址** + **项目配置文件**，支持「用户自存模板／
导入官方模板／从零填参数新建模板」）；要求先讨论「agent↔server 持续通信能否解决 flow 调用规范问题、
让前后端更稳」；未来让工具**原生适配 pi agent**。

**讨论结论（已由用户拍板）**

1. 方向**对**，且是「补最后一段」而非重建——`core/src/http.ts`（REST + OpenAPI v1.1.0）与
   `core/src/mcp.ts`（MCP/stdio）**早已存在**。
2. 持续通信的价值不在"通信"，在**收敛到唯一入口**。病灶实测：`flow_init` **在 CLI 有、MCP 无、
   HTTP verb switch 无** ⇒ 初始化面板所需动词恰好最不可达。「规范问题」的实体是
   **动词表四份副本（CLI 13 / MCP 7 / HTTP 4 / Skill 纯文档）互不同步**——与 N6 同源。
3. **常驻前置条件 = 失败必须外显**（本批 0A）。
4. **两台 server 必须合一**（本批 0B）：`tools/serve.py`（Python，管页面）与 `core/src/http.ts`
   （TS，管内核）并存，且页面 `fetch` **全打在 serve.py 上、一个都没打到内核 API** ⇒ 页面状态是
   构建时注入的静态快照、写操作绕开内核直接改文件。**这才是"前后端不稳定"的真正来源**。
5. 前端「快照 → 订阅」是**架构改动**，建议先轮询 `/api/projects/:id/state`（端点已有、内核已落盘读模型、
   零新增契约），再考虑 SSE。
6. 初始化面板的数据模型**已存在**（`contracts/project-config.schema.json` +
   `docs/项目初始化配置.md` + `tools/project-init.py`），要做的是「schema → 表单 + 模板库」。
   **必须守住：模板 ≠ 配置**；配置只是**项目 overlay 的输入**，须经内核合成，不得直接当 flow 参数。
7. pi agent：MCP SDK `^1.7.0` **自带 `streamableHttp` transport**（server + client 均有），无需新依赖；
   但建议**放最后**，先稳单机链路。

**用户拍板（AskUserQuestion 三选）**：① server 架构 = **单进程（http.ts 兼静态托管）**；
② 前端实时性 = **先轮询**；③ 下一步 = **先做前置两件**。

### 0A · 失败外显（诊断通道）

| 文件 | 改动 |
|---|---|
| `contracts/diagnostics.schema.json` | **新建**：`diagnostics@1`（`ts`/`format`/`kind`/`scope`/`detail`，`additionalProperties:false`）。`kind` enum：`metric`/`assert`/`kb`/`aesthetic`/`overlay`/`feedback`/`io`/`other` |
| `core/src/diag.ts` | **新建**：`recordDiag`（落 `<dir>/registry/diagnostics.jsonl` + stderr 一次，**永不抛异常**）、`readDiags`（坏行容错）、`summarizeDiags`（`count`/`byKind`/`byScope`/`recent`） |
| `core/src/schema.ts` | `SCHEMA_IDS` 增 `"diagnostics"`（测试侧据此做契约复验） |
| `core/src/kernel.ts` | ①`metric()` 的裸 `catch{}`（N6 藏身地）→ `recordDiag(kind:"metric")`；②`completed` 后的负反馈自动触发（`flowMine`+`flowOptimize`）失败 → `recordDiag(kind:"feedback")`；③`flowEffect` 返回体增 `diagnostics`；④新增 `viewDiagnostics(projectId?)`（无参=仓库级） |
| `core/src/asserts.ts` | `checksVia` 读 `knowledge/aesthetic/assertions.json` 失败 → 留痕（台账读不到 = 别名全失 = 断言链"看起来正常但整链降级"） |
| `core/src/metrics.ts` | `buildConceptIndex` 读 `knowledge/index.json` 失败 → 留痕（概念层整体跳过 ⇒ **「命中率崩了」这个结论本身不可信**，而它正是要不要动编排的判据） |
| `core/src/optimize.ts` | `readKbIndex` 失败 → 留痕（提案基于"零知识卡" ⇒ 优化器给的结论是假的） |
| `core/src/aesthetic.ts` | `projectConfig`（词汇表）+ `purityRegexps`（纯净度标记台账）失败 → 留痕。**词汇表区分 ENOENT**：缺文件是合法常态（未配置），只有「存在但读不出来」才留痕——否则噪声会淹没信号 |
| `core/src/http.ts` | 新增 `GET /api/projects/:id/diagnostics` 与 `GET /api/diagnostics`；`graph` 的 `loadFlow` 失败也留痕（原先把失败原因丢了） |
| `core/test/r8-diag.test.ts` | **新建 4 条**：契约合规 + 坏行容错；**失败注入**（把 `metrics.jsonl` 占成目录 ⇒ EISDIR）；kb 索引损坏；两档 scope 互不串味 |

**判据（不是所有 `catch` 都要改）**：只有「**吞掉就会改变结论 / 让能力静默失效**」的必须留痕；
纯容错型（半行 JSON 跳过、锁目录清理、默认值回退）**保持吞**——全仓 ~57 处静默 `catch`，本批只改 8 处，
其余定性为「可吞」。

### 0B · server 合一 + `miniflow up`

| 文件 | 改动 |
|---|---|
| `core/src/static.ts` | **新建**：受白名单约束的静态托管。**顺带修掉一个 P0**：旧 `serve.py` 继承 `SimpleHTTPRequestHandler`，任何 `/xxx` 都照发 ⇒ `/.zhuque-key`、`/.git/config`、`/src/kakaxing-Json/*`（29M 含真实姓名/电话/UCloud 密钥）**全部可下载**。新模型 = 后缀白名单 ∩ 路径包含 ∩ 敏感段/前缀拒绝；拒绝一律 404（不泄露存在性）。私有目录可用 `MINIFLOW_STATIC_DENY_PREFIX` 追加 |
| `core/src/compat.ts` | **新建**：`serve.py` 八个 legacy 端点并入内核面（`/_kit/save`、`/api/save`、`/_kit/history`(GET/POST)、`/api/archive-project`、`/api/import-flow`、`/api/regen`、`/api/import-demo`、`/_kit/tunnel.json`）。与 serve.py 的三点差别：①不再无声吞错（全部写 diagnostics）；②写路径复用 `isDeniedRelativePath`（与静态面**单点实现**）；③页面生成失败**显式返回**（`MINIFLOW_PYTHON` 可指定解释器），不假装成功 |
| `core/src/http.ts` | 注册 `registerCompat` + 静态面（`/` 与 `/*` 两条路由——find-my-way 里它们是不同路由，入口页不能漏）；`startHttp` 启动横幅改为「内核 + 前端已同进程启动」 |
| `core/src/cli.ts` | 新增 **`up`** 动词：`miniflow up [--port 8421] [--open]`；端口被占用**自动顺延**（首次启动最常见的卡点，且与用户无关）；入口页缺失时**明确告警**；`serve` 保留兼容 |
| `core/test/r8-server.test.ts` | **新建 7 条**：`resolveStaticPath` 拒绝穿越/敏感文件；`isDeniedRelativePath` 读写共用；入口页与技能文档可发、敏感面一律 404；写入端点合法落盘 + 敏感路径 400；归档进 `_archived` 而非真删；隧道端点显式声明未启用；诊断端点两档 |

**冒烟实测（真跑 `miniflow up --port 8433` + curl）**

| 请求 | 结果 | 说明 |
|---|---|---|
| `GET /` | **200** | 入口页（storyflow 项目工作台） |
| `GET /projects/p-wxl-001/workflow.html` | **200** | 项目工作台页 |
| `GET /knowledge/index.json` | **200** | 页面需要（技能/标尺卡文档） |
| `GET /src/kakaxing-Json/README.md` | **404** | ✅ 旧 serve.py 会发出去 |
| `GET /.git/config` | **404** | ✅ |
| `GET /core/src/kernel.ts` | **404** | 后缀不在白名单 |
| `GET /api/diagnostics` | **200** | `{"scope":"repo",…,"count":0}` |
| `GET /api/projects` | **200** | 11 项目清单正常 |

### 第 0 批门禁实测（2026-09-20）

| 门 | 结果 |
|---|---|
| `cd core && tsc --noEmit` | **OK** |
| `vitest` | **183 passed / 0 failed（19 files）**（阶段 A 后为 172/17；本批 +11） |
| `module-lint.py` | **0 errors** / 36 warnings（同前） |
| `kit-lint.py` | **0 errors** / 21 warnings（同前） |
| `flow-lint.py` | **21 errors** —— 与阶段 A 同数，全部为 7 个未迁移 flow@2 存量红档 |
| `artifact-lint.py` | **0 errors** / 168 warnings（同前） |
| `validate-kb.py` | **1 FAIL**（N7 存量） |

### 第 0 批明确未做（下一批候选）

- ~~**前端 live 化**（把页面 `fetch` 从 serve.py 路径改为内核端点 / 轮询 `/api/projects/:id/state`）~~ —— **第 1 批已完成**。
- **初始化面板（OS-04）**：项目地址 + 配置模板（自存/导入官方/从零新建）。数据模型已在
  `contracts/project-config.schema.json`，缺的是表单与模板库。
- **`mcp.ts` 补动词**：仍只 7 个（缺 `flow_init`/`effect`/`mine`/`skill_patch`/`optimize`/`overlay`）——
  「唯一动词表」要真正落地，必须让 CLI/HTTP/MCP 三面从**同一份声明**派生。
- **`tools/serve.py` 的退场**：目前与 `up` 并存（隧道能力暂只在 serve.py 侧，`/_kit/tunnel.json`
  已显式声明未启用）。
- **pi agent 适配**：MCP SDK 自带 `streamableHttp`，可留待 OS-07 之后。

---

## R8-OPS · 第 1 批：前端 live 化（快照 → 轮询）

### 为什么先做这个（执行顺序 1 → 3 → 2）

用户拍板的方向里，第 1 批是「前端真正活起来」——**只有当前端能实时反映内核状态，才能看出初始化面板（OS-04）该长什么样**。
第 0 批解决了「同进程能跑」，但页面仍是 `__PAYLOAD__` 注入的**构建时快照**：
`tools/project-pages.py` 生成一次，之后内核里发生什么都不再更新（要刷新只能重跑 python）。
本批把「易变切片」改为**轮询内核端点**，静态切片（`modules`/`toolbox`/`kbTitles`——它们由 python 侧计算、内核不算）**保持 SSR**。

### 1A · 内核侧：`viewLive` 读模型 + `/live` 端点

| 文件 | 改动 |
|---|---|
| `core/src/kernel.ts` | 新增 `fingerprint(...)`（djb2，稳定序）+ `viewLive(projectId, {files?})`：一次返回 `state`/`eff`/`overlay`/`optimize`/`metrics`/`diagnostics` + 两个指纹。**`revision`** 由「状态 / 门裁决 / 逐节点 round·verdict / `overlayHash` / `planHash` / metrics 事件数 / 诊断条数」合成；**`filesRevision`** 由「产物清单的 路径+size+mtimeMs」合成。**两个指纹分开**：状态没动但文件变了（或反之）都能被单独识别，避免无差别重绘 |
| `core/src/http.ts` | 新增 `GET /api/projects/:id/live`（`?files=1` 时附带 `files`/`snapshots`，走已有 `viewWorkbenchPayload`）。默认不返回文件内容——**轮询要便宜**，文件内容只在需要重绘产物面板时才拉 |
| `core/test`（既有） | 复用第 0 批的 `r8-server.test.ts` 契约；本批无新增测试文件（live 语义由**真实进程 curl + 指纹变化**验证，见下冒烟） |

### 1B · 前端侧：静态切片 SSR + 易变切片轮询

`tools/workflow-page-template.html`：

- `const DATA, files, RS, EFF, OVERLAY, OPTIMIZE, METRICS, flow, nodes, edges, LEGACY_CANVAS` → **`let`**（原本是常量，轮询无法替换）；
  新增 `bindPayload(PAYLOAD)`（加载时调用一次，行为与原 SSR 一致——**无 server 时页面照旧可用**）、`fillDataDefaults()`、`rebuildFileVersions()`、`refreshMwTip()`、`bindCanvas()`。
- 新增 `startLive()` / `pollLive()` / `applyLive()` / `liveApi()` / `livePill()` / `renderDiagStrip()`：
  轮询 `/live`，比较 `revision`/`filesRevision` 后才应用；应用后重跑 `autoLayout()` + `renderEffectiveBanner()` + `renderDiagStrip()`，并按 **id** 复位 `sel`（**不按索引**——否则列表一变动选中项就漂）。
- 头部新增两个 UI 钩子：**`#live-pill`**（默认 `● 快照`，轮询成功转 `● 实时` / 失败转 `● 离线`）+ **`#diag-strip`**（把 `diagnostics` 汇总成一条可点开的失败带——**0A 诊断通道的可见面**）。
- **防御 `location`**：`LIVE.on = (typeof location !== "undefined") && /^https?:$/.test(location.protocol||"")`。
  `page-lint.mjs` 在**无 `location` 的裸 VM** 里求值页面脚本，缺此守卫直接 500。
- 文案修正：`proj-switch` 标题与「新建项目」提示由 `serve.py` 改为 **`miniflow up`**（旧的启动方式已废）。

### 1C · 顺带修掉的存量缺陷（被 `/live` 首次暴露）

> **flow@3 的 flow.json 没有 `graph`**（节点由内核 `expandFlow3` 派生）；而 `FlowDescriptor.graph` 是**类型必填**。
> 因此任何读 `flow.graph.nodes` 的消费方在 flow@3 项目上必 500。这是**第 4 处**同源 latent（前 3 处：`artifactPathOf` 之外的工具链读图、`plan.ts` 计划截断、`minitools` 快照）。

| 文件 | 改动 |
|---|---|
| `core/src/minitools.ts` | `artifactPathOf`：`const node = flow.graph?.nodes?.[nodeId]; if (!node) return undefined;` |
| `core/src/kernel.ts` | `viewWorkbenchPayload`：① `loadFlow` 匹配循环在无 `graph.nodes` 时**回退用 `modules.length`**；② 快照循环在 `flow.graph.nodes` 缺失时**改读 `effRaw.nodes`**。并删掉此前实验中未定型的 `loadFlowSafe` |

**前后对照（实测）**：`GET /api/projects/p-wxl-001/workbench-payload` 由 **500 `Cannot read properties of undefined (reading 'nodes')`** → **200**。

### 第 1 批冒烟实测（真进程 `miniflow up --port 8421` + curl）

| 请求 | 结果 |
|---|---|
| `GET /` | **200** |
| `GET /projects/p-wxl-001/workflow.html` | **200** |
| `GET /api/projects/p-wxl-001/live` | **200**，keys = `project,state,eff,overlay,optimize,metrics,diagnostics,revision,filesRevision`（**无 `files`**，默认轻量） |
| `GET /api/projects/p-wxl-001/live?files=1` | **200**，额外交回 `files`（23 项）/`snapshots`（23 项） |
| `GET /api/projects/p-wxl-001/workbench-payload` | **200**（修前 500） |

**「活性」证明（不改内容，只改 mtime / 注入诊断）**

| 动作 | `revision` | `filesRevision` | 结论 |
|---|---|---|---|
| 起始 | `1ywg019` | `1yex6d9` | — |
| `touch` 一个产物 md（仅 mtime） | `1ywg019`（不动） | **`aitmis`**（变化） | **只动文件 → 只有 filesRevision 变** |
| 追加 1 行 `diagnostics.jsonl` | **`1ywg026`**（变化） | `aitmis`（不动） | **只动状态 → 只有 revision 变，且 `diagnostics.count` 0→1** |

⇒ 两张指纹**正交**，轮询能精确判断「该重绘什么」，不产生无谓重绘。诊断注入行与 mtime 均已还原。

### 第 1 批门禁实测（2026-09-20）

| 门 | 结果 |
|---|---|
| `cd core && tsc --noEmit` | **OK** |
| `vitest` | **183 passed / 0 failed（19 files）** —— 与第 0 批同数，**本批零回归** |
| `module-lint.py` | **0 errors** / 36 warnings（同前） |
| `kit-lint.py` | **0 errors** / 21 warnings（同前） |
| `flow-lint.py` | **21 errors** / 1 warning —— 全部为 7 个未迁移 flow@2 存量红档 |
| `artifact-lint.py` | **0 errors** / 168 warnings（同前） |
| `validate-kb.py` | **1 FAIL**（N7 存量） |
| `page-lint.mjs projects/p-wxl-001/workflow.html` | **39/39 passed** |
| `page-lint.mjs projects/p-slj-001 · projects/ccwd-fq` | **39/39 passed**（存量页亦不回归） |

### 第 1 批明确未做

- **其余项目的页面未重生成**：模板变了，但 `ccwd-fq2/fq3`、`p-slj-001/004~007` 等页面正被**并发写入者**改动（mtime 早于本批模板改动），
  **不在本批写权内**；它们仍可正常工作（新代码全是**追加**，老页面即「无轮询的静态页」）。等并发写入者落定后统一重生成。
- **`p-wxl-001/` 整目录未提交**：该项目由**另一 run** 于 08:49 建，整目录未跟踪（2.0M/95 文件），
  与第 0 批 `core/projects/zzz-dummy-archive` 同理——**不替别的写入者提交其项目数据**。本批只提交「模板 + 内核代码」。
- **SSE / WebSocket**：仍为轮询（用户拍板的「先轮询」）；订阅式留待需要时再上。
- **`mcp.ts` 补动词**（下一步，步骤 3）与 **OS-04 初始化面板**（步骤 2）。

---

## R8-OPS · 第 2 批（执行顺序里的「步骤 3」）：动词表唯一源

### 起因：动词表有四份副本

R8-OPS 讨论记录里点名的病灶实体：**「flow 调用规范问题」的实体是动词表四份副本互不同步**。

| 面 | 改造前 | 改造后 |
|---|---|---|
| CLI（`cli.ts`） | `switch` 里 **13 个 case** | **零动词清单**（查表分派） |
| MCP（`mcp.ts`） | **7 个手写 `registerTool`** | 遍历表逐条注册 |
| HTTP（`POST /api/verbs/:verb`） | `switch` 里 **4 个 case**，其余回「gate/rerun 走专用端点」 | 查表分派，**表里有几个就收几个** |
| Skill 文档 | 纯文字描述（无清单，故未成第五副本） | 同上（不再需要） |

**最刺眼的证据**：`flow_init` 是**初始化面板的落点**，改造前**CLI 有、MCP 无、HTTP 无**——
即「最需要被前端的那个动词，恰好在所有非 CLI 面上不可达」。`flow_effect`/`flow_mine`/`skill_patch`/
`flow_optimize`/`flow_overlay` 同样只存在于 CLI。
与 **N6**（`MetricPhase` 含 `"link"` 而契约枚举没有 ⇒ 指标被 `catch{}` 静默吞掉）**同源**：
同一事实写在多处，编译器与 lint 都看不见。

### 做什么

| 文件 | 改动 |
|---|---|
| `core/src/verbs.ts` | **新建**：唯一台账 `VERBS: VerbDef[]`（13 动词）。每条 = `{name, description, group, params[], run, fromFlags?}`。`params[]` 是跨面同名的归一化入参描述（`string`/`number`/`boolean`/`record`/`string[]` + `required`/`enum`/`desc`）。附 `resolveProjectName`（自动命名去重，抽自 CLI 内联逻辑 ⇒ **HTTP/MCP 也有**）、`flagsToArgs`（纯函数）、`usageFromVerbs`（usage 由表生成）。**不 import cli/http/mcp**（避免环） |
| `core/src/mcp.ts` | 删掉 7 个手写 tool → 遍历 `VERBS` 注册；`zodOf(VerbParam)` 把参数描述折成 zod inputSchema。拆出 **`buildMcpServer(kernel)`**（不连 transport）以便测试真握手 |
| `core/src/http.ts` | `/api/verbs/:verb` 的 4-case `switch` → **查表分派**；未知动词 404 `UNKNOWN_VERB` 且 detail **列出全部可用动词**（不静默）。专用端点（`/gate`、`/rerun`、`/config`）保留为便利面，与表分派同语义 |
| `core/src/cli.ts` | 删掉 13-case `switch` 与内联 `flow_run` 命名逻辑 → **查表分派**（`def.fromFlags ? … : flagsToArgs`）；`usage()` 由 `usageFromVerbs()` 生成 ⇒ **用法不可能与实现漂移**。仅保留进程面 `up`/`serve`/`mcp` |
| `core/test/r8-verbs.test.ts` | **新建 11 条**。关键：**不逐条枚举动词**（那又会变成第 5 份副本），而断言**关系**——① 表名字唯一且含那 6 个「只有 CLI 有」的动词；② `usage` 含每个动词名；③ MCP `verbToolSpecs` 名字集合 = 表；④ **HTTP 逐个动词注入请求，断言 body.error ≠ `UNKNOWN_VERB`**（业务错可以，不认识不行）；⑤ 未知动词 404 + detail 列全；⑥ `flow_init` 经 HTTP 真落 `项目配置.json`；⑦ **MCP 真握手**（SDK `InMemoryTransport` → `tools/list` = 表）；⑧ `flagsToArgs`/`fromFlags` 三种归一化 |

### 顺带修掉的静默错位

`skill_patch` 原先写死**编译期 `ROOT`** 作为 skills 根 ⇒ `miniflow --root <path>`（验证层 dist/release 重拍用）
下补丁**仍写到真实仓库**。改成 `kernel.repoRoot`（缺省即 `ROOT`，`--root` 时跟随工作区）。

### 契约补声明（本次一并收口）

`contracts/http-openapi.json` **11 → 24 条路径**（v1.1.0 → **v1.2.0**）。此前下列端点**真实存在但契约里查不到**，
正属本批要消灭的「声明面 ≠ 实际面」：

| 补进契约 | 来源 |
|---|---|
| `POST /api/verbs/{verb}` | 本批（动词表分派） |
| `GET /api/projects/{id}/live` | R8-OPS 第 1 批 |
| `GET /api/diagnostics`、`GET /api/projects/{id}/diagnostics` | R8-OPS 第 0 批（0A） |
| `GET /api/openapi.json` | 早已存在（自描述契约） |
| `/_kit/save`、`/api/save`、`/_kit/history`、`/api/archive-project`、`/api/import-flow`、`/api/regen`、`/api/import-demo`、`/_kit/tunnel.json` | R8-OPS 第 0 批（0B，自 serve.py 并入）——**全部标 `deprecated: true`**，只记录事实、不邀请使用 |

### 冒烟实测

**CLI**（临时 `--root`，不写仓库）

| 命令 | 结果 |
|---|---|
| `--help` | usage 由表生成：13 动词 + 两组标题 + 进程面，**无手抄清单** |
| `flow_list --root <tmp>` | `[]` |
| `flow_init --project t1 --root <tmp>` | 创建 `项目配置.json`；**再跑一次** → `{exists:true}`（幂等） |
| `skill_patch --list --root <tmp>` | `[]`，且落在 **临时 root 的 skills/**（非真实仓库）⇒ 验证 `repoRoot` 修正 |
| `nope` | `未知动词: nope` + usage，退出码 2 |

**HTTP**（真进程 `miniflow up --port 8421` + curl）

| 请求 | 结果 |
|---|---|
| `GET /api/openapi.json` | `version 1.2.0`，**24 paths** |
| `POST /api/verbs/flow_init {project:…}` | **200**，真落 `<项目>/项目配置.json`（改造前此动词在 HTTP 面 = `UNKNOWN_VERB`） |
| `POST /api/verbs/flow_effect {project:"p-wxl-001"}` | **200** |
| `POST /api/verbs/nope` | **404** `{"error":"UNKNOWN_VERB","detail":"可用动词：flow_list, …, flow_overlay"}` |
| `GET /`, `GET /projects/p-wxl-001/workflow.html`, `GET /api/projects/p-wxl-001/live` | **200 / 200 / 200** |

**MCP**：`r8-verbs.test.ts` 用 SDK `InMemoryTransport` 真握手 → `tools/list` 返回的正是表里的 13 个动词，
且真调 `flow_list` 返回 `[]`（与 CLI 同一执行路径）。

### 第 2 批门禁实测（2026-09-20）

| 门 | 结果 |
|---|---|
| `cd core && tsc --noEmit` | **OK** |
| `vitest` | **194 passed / 0 failed（20 files）**（第 1 批后 183/19；本批 +11） |
| `module-lint.py` | **0 errors** / 36 warnings（同前） |
| `kit-lint.py` | **0 errors** / 21 warnings（同前） |
| `flow-lint.py` | **21 errors** / 1 warning（存量 flow@2，同前） |
| `artifact-lint.py` | **0 errors** / 168 warnings（同前） |
| `validate-kb.py` | **1 FAIL**（N7 存量） |

### 第 2 批明确未做 / 遗留

- **`AGENTS.md` 未改**（属 OS-06/07 写权，且非本批文件）：建议 OS-07 补一条铁律
  「**动词唯一表 `core/src/verbs.ts`** —— CLI/HTTP/MCP 三面均由其派生，禁止任一面手抄动词清单」。
  （AGENTS.md 现状只有 R5 历史叙述「内核新增三动词」，非当前名册，不构成漂移。）
- **`tools/serve.py` 仍是 legacy 端点的第二实现**：本批把它的八个端点**声明**进契约（deprecated），
  但未删文件、未删隧道能力。退场仍待办。
- **下一步 = 步骤 2 · OS-04 初始化面板 + 模板库**（项目地址 + 配置模板：自存／导入官方／从零新建）。
  本批已为它扫清前置：`flow_init` 三面可达、`GET/PUT /api/projects/{id}/config` 已在契约内、
  页面可轮询实时状态。**守住「模板 ≠ 配置」**（配置只是项目 overlay 的输入，须经内核合成）。
