# WO 批次 · 模块化 flow v3（分支 `module-flow-v3`）

> 依据：`docs/规范-模块化flow与工具箱-R6.md`（本批唯一设计源）。
> 用法：**按波（wave）分批派给不同 agent**；同波内工单**文件互斥**，可并行；跨波有依赖，必须等上一波验收。
> 目标：基于 kit 底座与前端，把 flow 重做成「模块序列 + 工具箱」，**不考虑向后兼容**。

---

## 工单公共纪律（每单都适用）

1. **只写「写权文件」清单内的文件。** 清单外的文件一律不碰（本仓有并发写入者，越界即互相覆盖）。
2. **提交只 add 自己的文件**，禁止 `git add .` / `git add -A`（工作区有他人未提交改动）。
3. 结束时**跑完本单验收命令**并在提交信息里附结果。
4. 禁止把 LLM 引入任何**机器校验**环节（校验器必须确定性）。
5. 结构类改动（增删模块/工具/边）**永远人批**，不入自动应用集合。
6. 禁止补拍快照洗白存量问题；改数据前先出清单给人确认。
7. 环境：Windows Git Bash **缺 coreutils**，每条 bash 前缀
   `export PATH="/c/Program Files/Git/usr/bin:$PATH";`
   `npx` 不可用；tsc 用 `cd core && node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit`，
   vitest 用 `node node_modules/vitest/vitest.mjs run`。
8. 含 `\n` / 转义的文本一律用 Write/Edit 工具写，**不要用 `python -c "…"` 走 bash 双引号**。

### 波次总览

| 波 | 工单 | 并行度 | 依赖 |
| --- | --- | --- | --- |
| **0** | WO-00 契约冻结 | 1（串行） | — |
| **1** | WO-01 core 底座 ｜ WO-02 工具链 ｜ WO-03 模块内容 | 3 | 波 0 |
| **2** | WO-04 前端布局 ｜ WO-05 文件布局 ｜ WO-06 NL 骨架 | 3 | 波 1 |
| **3** | WO-07 前端模块面板 ｜ WO-08 存量转换 | 2 | 波 2 |
| **4** | WO-09 全链门禁与验收 | 1 | 波 3 |

⚠️ **core/src 是瓶颈，全批次只允许 WO-01 一个 agent 写。** 不要为了并行把它拆开——R5 的经验是内核改动互相耦合，拆开必然冲突。

---

## 波 0

### WO-00 · 契约冻结与格式定义

**目标**：把 R6 规范落成可被校验的契约，冻结页面 payload 形状。这是全批的**唯一真源**，冻结后不再变。

**做什么**
1. 新建 `contracts/module.schema.json`（`module@1`：`ops` / `skeleton` / `caps`，含 `capability`/`slot`/`also_fits`/`requires`/`adds`）。
2. 重写 `contracts/flow.schema.json` → **flow@3**：`format` pattern `^flow@3$`；required `format/id/title/version/status/modules`；`modules[]` 见规范 §二；`policy` 简化到 `{ link_default, adapt, budget }`；**删除** `graph`/`stages`/`outputs[].node`（改为 `outputs[].module`）。
3. 新建 `contracts/page-payload.schema.json`：**冻结** `project-pages.py` 注入模板的键集合（`DATA/EFF/OVERLAY/OPTIMIZE/METRICS` 及各子键），供波 2 的 WO-04/WO-05 并行。
4. 新建 `contracts/artifact-header.schema.json`（改写）：加 `module`，去 `class`/`round`/`version`，`review` 改挂 `link`。
5. 新建 `contracts/toolbox.schema.json`：能力标签 → tool 的映射（渲染与选工具共用）。
6. 废弃 `contracts/kit.schema.json` / `contracts/stage.schema.json`（标 `deprecated`，不删文件）。
7. 写 `docs/规范-模块化flow与工具箱-R6.md` 的**勘误段**：实现中发现与规范不符处，回来改规范（规范是活文档）。

**写权文件**：`contracts/**`，`docs/规范-模块化flow与工具箱-R6.md`
**依赖**：无
**验收**
```bash
python tools/validate-kb.py                    # 契约自身可加载
python - <<'PY'                                # 每个 schema 能被 json 解析且 $id 唯一
import json,glob
for f in glob.glob('contracts/*.schema.json'):
    d=json.load(open(f,encoding='utf-8')); assert '$id' in d or '$schema' in d, f
print('contracts ok')
PY
```
**红线**：不改任何代码；不动 `flows/` `kits/` 存量。

---

## 波 1（3 并行）

### WO-01 · 内核底座：模块展开器 + 连接件 + policy 简化

**目标**：内核能把 flow@3 展开成节点与边，并只保留两种模块间连接模式。

**做什么**
1. 新建 `core/src/modules.ts`：`ModuleRegistry`（读 `modules/<id>/module.json`，`assertSchema("module", …)`）+ `expandFlow(flow, eff)` 按规范 §三 的 8 条规则展开。
2. `core/src/plan.ts`：`compilePlan` 改吃展开结果；节点 id 用 `<实例id>.<tool>`。
3. `core/src/overlay.ts`：**删** `domainMap`/`injectKitBoundaries`/`BOUNDARY_PREFIX`/`isBoundaryGate`/`isWorkGate`（约 150 行）；新增 `link` 连接件派生；patch kinds 收敛（保留 `set-node`/`set-op`/`place-node`/`remove-node`/`set-policy`/`set-input`，新增 `set-module`(caps) 与 `insert-tool`(slot)）。
4. `core/src/kernel.ts`：`advance` 的门处理改为连接件两模式（`auto` 放行 / `manual` 挂起）；`doGate` 裁决简化为 `pass` / `reject`（reject → 重跑上游模块全部节点）；`persistEffective` 落新结构。
5. `core/src/types.ts` / `schema.ts`：注册 `module` schema 与 flow@3 类型。
6. `core/src/assembler.ts`：背景卡改读模块（`flow.stages` → 模块名/能力标签）。
7. `core/test/`：新增 `modules.test.ts`（展开正确性：默认骨架 4 节点 / 加 `caps:["伏笔"]` 后 5 节点且插槽正确 / 连接件 id 与模式）。

**写权文件**：`core/src/**`，`core/test/**`
**依赖**：WO-00
**验收**
```bash
cd core && node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
node node_modules/vitest/vitest.mjs run
```
**红线**：不碰 `tools/`、`modules/`、`flows/`；展开必须**幂等**（同一输入两次结果一致）。

---

### WO-02 · 工具链：flow-lint / module-lint / kit-lint

**目标**：静态门能校验新格式；旧的失败信息要带**迁移命令**。

**做什么**
1. 重写 `tools/flow-lint.py` → 校验 flow@3：模块引用存在、`caps` 可满足、`link` 合法、模块实例 id 唯一、`outputs[].module` 存在、`insert` 的 slot 与 tool 在目标模块中合法。
2. 新建 `tools/module-lint.py`：E 级 = `skeleton.spine` 的 tool 不存在 / `slot` 锚点不存在 / `capability` 与 `caps` 不一致 / `requires` 成环；W 级 = 无插槽的 tool（不可玩，无法被启用）。
3. `tools/kit-lint.py`：加一次性兼容层（检测到 `kits/` 时提示改用 `module-lint`，不报 error）。
4. 每个 lint 支持 `--json` 输出（供 agent 消费）。

**写权文件**：`tools/flow-lint.py`，`tools/module-lint.py`，`tools/kit-lint.py`
**依赖**：WO-00
**验收**
```bash
python tools/module-lint.py --json      # 0 error（此时 modules/ 可能还没建——允许 0 模块 + 明确提示）
python tools/flow-lint.py --json        # 报错必须附迁移命令
```
> 本单验收**以自带 fixture 为准**（在 `tools/__fixtures__/` 下放 2 个最小 flow@3 + 1 个 module@1），
> 不要求仓库存量 flows 通过——那要等 WO-08。
**红线**：不碰 `core/`、`modules/`、`tools/project-pages.py`。

---

### WO-03 · 模块内容重划：5 kit → 模块 + 骨架 + 插槽

**目标**：把能力重新封装成「可玩」的模块。**这是内容活，本单最需要领域判断。**

**做什么**
1. 新建 `modules/`，把现有 5 个 kit（`search`/`plot`/`prose`/`tool`/`detect`，共 55 op）重划为模块（建议 8 个：选题 / 方案 / 编剧 / 写作 / 交付 / 检索 / 检测 / 底座），每个模块一个 `module.json`。
2. 每个模块：写 `skeleton.spine`（默认最小可用集）+ `skeleton.edges` + `caps`。
   **编剧模块必须满足用户口径**：工具箱 10 个、默认骨架 4 个（跑通主线 + 人设）。
3. 为每个 op 补 `capability` / `slot` / `also_fits` / `requires` / `adds`。
4. 新增 2 个 tool 的 skill：`skills/subplot-weave.md`（暗线编织）、`skills/foreshadow-plant.md`（伏笔悬念插入）。
5. `kits/` 保留原地不删（供 WO-08 转换对照），但不再被引用。

**写权文件**：`modules/**`（新建），`skills/subplot-weave.md`，`skills/foreshadow-plant.md`
**依赖**：WO-00
**验收**
```bash
python tools/module-lint.py --json      # 0 error（需 WO-02 已完成）
python - <<'PY'
import json,glob
for f in glob.glob('modules/*/module.json'):
    d=json.load(open(f,encoding='utf-8'))
    sp=set(d['skeleton']['spine']); ops=set(d['ops'])
    assert sp<=ops, (f,'spine 有未声明的 tool')
print('modules ok')
PY
```
**红线**：不改 `core/`、`tools/`、`flows/`；**不为了凑骨架而删 tool**（工具只增不删）。

---

## 波 2（3 并行）

### WO-04 · 前端布局引擎：竖向节点 + 模块横向拼接

**目标**：画布从「左→右单向」改成「模块横向拼接、模块内竖向」。

**做什么**
1. `autoLayout()`（约 470–513）轴交换：**模块序号 → x**；**模块内节点序 → y**。保留原最长路径分层逻辑，但作用在 y 轴上。
2. `drawEdges()`（约 881–917）：模块带改**纵向色带**（原来横向）；边改竖向三次贝塞尔（控制点取 y 中点）；连接件画在模块之间的横向缝上（`auto` 灰虚线 / `manual` 金实线 + 徽章）。
3. 模块内「骨架 vs 插件」视觉区分：骨架节点主轴居中，`insert` 进来的插件节点**左侧分支**并标 `插件` 徽章。
4. `render()`：`col` 计算改为模块索引；`STAGE_*` 常量改 `MODULE_*`。
5. 更新 `tools/render-flow.py`（静态 SVG 渲染器）同步竖向布局。

**写权文件**：`tools/workflow-page-template.html`（**仅布局段：`autoLayout`/`drawEdges`/`render` + 相关常量**），`tools/render-flow.py`
**依赖**：WO-00（payload）、WO-01（展开后的数据形状）
**验收**
```bash
python tools/project-pages.py --root projects/<任一项目>   # 能生成
node tools/page-lint.mjs                                   # 布局相关断言不宜新增失败
```
**红线**：不新增面板（那是 WO-07）；不改 payload 键（WO-00 已冻结）；改模板后**必须重生成页面**再跑 page-lint。

---

### WO-05 · 项目文件布局简化 + 页面数据面

**目标**：落地规范 §五 的新目录结构与头部微调，并让页面生成器与准入校验跟上。

**做什么**
1. `tools/artifact-lint.py`：路径准入改新布局（`输入/` `世界书/` `NN-模块名/` `交付/` `registry/` `snapshots/`）；头部校验改新字段（加 `module`，去 `class`/`round`/`version`）；`review` 只允许在 manual 连接件放行后出现。
2. `tools/project-pages.py`：数据面按冻结的 payload 改（模块目录扫描、产物归属按模块、`registry/receipts/` 读收据）；注入新键 `DATA.modules` / `DATA.toolbox`。
3. 写 `docs/项目目录搬迁清单-p-fq-001.md`：**只出清单，不执行搬迁**（列每个文件的旧路径 → 新路径 → 风险）。存量 3 个项目各一份。
4. 新建 `tools/project-init.py`：按新布局初始化一个空项目（含 `输入/` `世界书/` `交付/` 骨架文件）。

**写权文件**：`tools/artifact-lint.py`，`tools/project-pages.py`，`tools/project-init.py`，`docs/项目目录搬迁清单-*.md`
**依赖**：WO-00，WO-04（模板消费的键已冻结）
**验收**
```bash
python tools/artifact-lint.py            # 按新布局；存量红档列清单不修
python tools/project-pages.py --root projects/p-fq-001
```
**红线**：**禁止自动搬迁存量文件**（铁律 10）；禁止补拍快照洗白红档。

---

### WO-06 · NL → 骨架：生成 skill 与骨架校验

**目标**：给「自然语言需求 → flow@3 草稿」提供骨架与文件格式。**只提供骨架和格式，不实现智能。**

**做什么**
1. 写 `skills/flow-synthesize.md`：一个**装配手册** skill。内容 = 决策表（需求关键词 → 模块序列）+ 能力词表（用户说什么 → 对应 `caps`）+ `link` 模式选择规则 + **输出必须是合法 flow@3** 的硬约束 + 一个完整示例。明确「不发明 tool，只组合已有能力」。
2. 新建 `tools/skeleton-lint.py`：校验 flow@3 草稿的骨架合法性（比 flow-lint 更早、更快，供生成循环内自检），支持 `--fix-hint` 输出下一步该问用户什么。
3. 在 `docs/` 写 `骨架与文件格式-速查.md`：一页纸，给人和 agent 同时看（模块清单 / 能力标签表 / flow@3 最小示例 / 三个常见错误）。

**写权文件**：`skills/flow-synthesize.md`，`tools/skeleton-lint.py`，`docs/骨架与文件格式-速查.md`
**依赖**：WO-00，WO-03（要知道有哪些模块与能力标签）
**验收**
```bash
python tools/skeleton-lint.py --file tools/__fixtures__/flow-min.json
```
**红线**：不写生成器代码（`flow_synthesize` minitool 留到下一批）；不引 LLM 进校验器。

---

## 波 3（2 并行）

### WO-07 · 前端模块面板：工具箱 / 插槽 / 连接模式

**目标**：把「可玩性」做进界面——点模块能看见能力，勾选能启用。

**做什么**
1. `modulePaper()`：模块卡片详情 —— 能力标签条（✓ 已启用 / ○ 可启用）、工具清单、插槽位置、骨架 vs 插件。
2. `toolboxPaper()`：工具箱抽屉 —— 按能力分组列全部 tool；勾选即**生成 overlay patch**（`set-module caps` / `insert-tool`），显示可复制补丁与命令；每 tool 展开 `config` 旋钮 + 逐键来源。
3. `linkPaper()`：由 `boundaryPaper()` 改造 —— 连接件两模式说明 + 当前裁决态 + 手工放行入口。
4. 画布交互：点模块顶栏 → 开抽屉；点连接件 → 开 `linkPaper`。
5. **重写 `page-lint.mjs` 断言组 7 / 10 / 12**：改为校验模块卡片 / 能力标签 / 连接件模式；删掉所有绑 `gate_role==="kit-boundary"`、`EFF.boundaries`、`kind==="gate"` 的断言，改为新契约。

**写权文件**：`tools/workflow-page-template.html`（**面板段，接 WO-04 的布局段**），`tools/page-lint.mjs`
**依赖**：WO-04，WO-01（overlay patch kind），WO-05（payload 新键）
**验收**
```bash
python tools/project-pages.py --root projects/p-fq-001
node tools/page-lint.mjs                # 全绿（断言已按新契约重写）
```
**红线**：不改布局段（WO-04 的产物）；面板产生的 patch 必须**经人确认**才落盘。

---

### WO-08 · 存量转换脚本

**目标**：把存量 7 flows + 5 kits 一次性转成新格式（保持信息不丢）。

**做什么**
1. 新建 `tools/flow-v3-migrate.py`：flow@2 → flow@3。按原 `stages` 切模块序列；原 `kit` 域变化处生成连接件；`policy.kit_boundary=always` → `link:"manual"`，`auto|off` → `link:"auto"`；原 `graph.nodes` 与 `graph.edges` 用于**反推骨架**（哪些 tool 是真的默认启用），产出 `modules/<id>/module.json` 的 `skeleton` 初稿**供人审**。
2. `--check` 幂等模式；`--dry-run` 输出逐 flow 的转换 diff 摘要。
3. 写 `docs/转换报告-flow@2到v3.md`：每个 flow 的模块序列、被反推的骨架、**信息丢失点清单**（哪些旧字段无处安放）。

**写权文件**：`tools/flow-v3-migrate.py`，`docs/转换报告-flow@2到v3.md`
**依赖**：WO-01（展开器语义），WO-03（模块已存在），WO-02（lint 可验收）
**验收**
```bash
python tools/flow-v3-migrate.py --dry-run
python tools/flow-v3-migrate.py --check      # 幂等
python tools/flow-lint.py --json
python tools/module-lint.py --json
```
**红线**：不自动搬项目目录；信息丢失点必须**显式列出**而非静默丢弃。

---

## 波 4

### WO-09 · 全链门禁回归与验收报告

**目标**：确认整批落地后全链绿，产出可交接的验收报告。

**做什么**
1. 跑全链：
```bash
cd core && node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
node node_modules/vitest/vitest.mjs run
cd .. && python tools/module-lint.py --json
python tools/flow-lint.py --json
python tools/artifact-lint.py
python tools/validate-kb.py
python tools/flow-v3-migrate.py --check
python tools/project-pages.py --root projects/p-fq-001
node tools/page-lint.mjs
```
2. 修回归（**只修自己范围内的**；跨单回归退回对应 WO）。
3. 写 `docs/验收报告-模块化flow-v3.md`：门禁对照表（老基线 → 新值）、遗留清单、**能力四环自查表**（每个新能力：模块声明 ✓ / 内核执行 ✓ / 前端可见可开 ✓ / lint 可校验 ✓）、下一批建议。
4. 更新 `AGENTS.md`（铁律与目录说明）。

**写权文件**：`docs/验收报告-模块化flow-v3.md`，`AGENTS.md`
**依赖**：全部
**验收**：上列命令全绿（或遗留项显式记账）。
**红线**：**不许为了让门禁变绿而删断言、降级门、补拍快照**——红线高于绿灯。

---

## 附 · 本批不做（明确排除）

- `flow_synthesize` minitool 的**生成实现**（本批只给骨架与格式，见 WO-06）；
- 存量 3 个项目的**实际目录搬迁**（只出清单，人批后单独一批）；
- 指标口径修复 D1–D5（独立批次，与格式改造正交，**建议先做**——反馈进化的前置）；
- `acceptance_criteria` 数值断言原语（独立批次）。
