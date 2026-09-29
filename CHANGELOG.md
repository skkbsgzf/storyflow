## 0.8.0 · 故事 Kit 重构（2026-09-29）

定位改版：**轻量、可玩性高的故事 kit 提供者**，与创作工作区彻底解耦。

1. flows 按用途归一：screenplay / novel / prose / topic 四条（删除主题流与项目细节）；demos 全删。
2. 运行时精简：判官层（judge.ts + 证据/回喂链路 + judge 子命令 + 配置段）整体移除；
   module io.acceptance 验收约束层移除；detect 检测模块移除——审核归宿主（docs/PROTOCOL-REVIEW.md 三通道接入）。
3. Skill 即 Tool：kit/skills.tools.json（40 技能 → skill.* 工具：名称即功能+版本+约束），tools/kit-skills.py 编译。
4. knowledge 层改为发布编译产物 kit/hypergraph.rag.json（115 词条/5998 边 HyperGraphRAG）；源 md 不进 git（本地可插拔），tools/kit-compile.py 重建。
5. 新增 adapter/ 适配层：REST+SSE 接口协议 + 零依赖参考客户端 storyflow-client.mjs（浏览器/Electron/移动端同构）。
6. flow id 变更：drama-flow→screenplay、novel-longform→novel、novel-prose→prose、topic-selection→topic（headless 默认 screenplay）。

# Changelog · miniflow harness

版本唯一事实源：仓库根 `VERSION`。格式参考 Keep a Changelog；R1..R8 历史代际摘要附于 4.0.0 条目。

## [5.0.0] · 2026-09-21 · v5.0 工单：断言体系退役与规则语料化（agent-only 执行模型）

拍板（2026-09-21 用户指令）：「确认不用的全部干掉，疑似有用的喂给 orchestrator 当做语料，未来我只用 agent，不用断言。」宣告文档：`docs/版本宣告-v5.0.0.md`（含 90 条去向总表 = 工单 §二 正式版；批0 盘账：全库 journal 真正打回过东西的断言只有 2 个 id 共 7 次，25 条以「无机器校验器」名义空转 170 次 warn）。**废除对象 = 断言协议（声明式提交闸 + pass/block/unverified 三态裁决 + node/op `asserts` 字段），不是检查能力**：可数的 27 条转扫描器证据（T 轨），不可数的 50 条转规则语料（C 轨），13 条随红蓝对抗/监管残族删除（X 轨）。

### Added（批A · 先立）
- **`knowledge/rules/` 规则语料库**：C 轨 50 条 → 16 张域卡（hook/pacing/curve/character/conflict/scene/reversal/dialogue/visual/ending/ai-trace/deconstruct/continuity/meme/setting/platform），`tools/rules-init.py` 从台账生成、原文零改动、卡头 `provenance.refs` 记来源 id 可回溯；措辞去闸化（「判 block」读作优先级，不构成拦截）。
- **质量扫描工具链**：`tools/quality-scan.py` + `core/src/quality-cli.ts` 桥（复用 `aesthetic.ts` 全量扫描器，JSON findings + 退出码恒 0——证据工具无权裁决）；内核 minitool `scan_quality`（原 `check_aesthetic_asserts` 改造：照跑全量、只出 `内部/质量扫描-*.json` 收据不拦截；空扫描 journal 显式留痕「非质量通过」）。
- **module@1 验收面新契约**：`io.acceptance.{scans,rules}`（扫描器 id + 规则卡 id），取代已退役的 `io.acceptance.asserts`。
- 演练：p-yaomo-fx-001 agent-only 验收样例（批A-3）。

### Changed（批B · 后破）
- **提交链无断言闸**：`core/src/kernel.ts::flow_submit` 删除 `runDeclaredAsserts` 三态派发与 对外交付/ 引擎全量闸——唯一残留闸 = 确定性完整性（`runIntegrityAsserts` 存在性/空文/残渣/计数 + `runHeaderAsserts` 头部 + 词汇表守卫）；`core/src/asserts.ts` 三态裁决层整层下架（`checks_via` 别名转译随之消失——扫描器直接报真名）。
- **指标更名**：`RunMetric.asserts` → `checks`；汇总 `assertPass/assertBlock` → `checkPass/checkBlock`。打回成本口径（block×溢价+retries×2）算术不变，只是打回只剩完整性来源。
- **数据层清扫**（一次性迁移器 `tools/asserts-retire.py`，逐条回显）：`flows/*/flow.json` 与 `modules/*/module.json` 全部 `asserts` 字段/引用删除，`check_aesthetic_asserts`→`scan_quality` 改名（9 条 flow / 9 个模块）；`contracts/flow.schema.json` asserts 出白名单。
- **守门反转**：flow-lint `E-ASSERTS-RETIRED`（flow.json/出厂 overlay 出现 asserts/add_asserts/remove_asserts = error）、module-lint 同名规则 + kit-lint `E11`（overlay 补丁带退役断言字段即 error）；kit-lint「断言覆盖」账改挂「规则语料与扫描器台账」（v5.0 台账：规则卡 16 张 / C 轨 50 条全覆盖 = error 级；T 轨 26/27 有实现，缺口 W4 点名 AE-NAT-HIT 不静默）。
- **前端 v5.0 面**：`tools/workflow-page-template.html` 验收区改「扫描/规则」证据 chips +「机器只出证据，裁决归 agent 与端尾验收」；历史项目数据只在生成器单点归一（`tools/project-pages.py`：`assert`→`check`、`unverified`→`warn`、标 `legacy` 并在页面显式标出历史口径——面板零双名兜底，R4 §5.3 不破）；`tools/page-lint.mjs` 新增四账（op 带 asserts / acceptance 形状非 `{scans,rules}` / 非 legacy 模块报告检查名以 AE- 开头 / nodeInfoPaper 泄 asserts = FAIL）。
- **测试改写**（批B-4）：`r5-generative.test.ts`「声明断言必须被执行」套件换 v5.0 回归锁（扫描器 block 级产物提交照收；残渣违规照样打回且 problems 零 AE- 名、落 `checks.block`；`scan_quality` 收据 `mode:quality-evidence`、无 declared/unverified 口径、有 block 证据不判败本步）；WO-A 五用例改 `runAestheticAsserts` 直调（密度真名/章末钩三态/伏笔逾期/纯净度/禁不可拍摄）；`kits.test.ts` 断言台账套件改锁归档（90 条无重复、引擎 id 全在册、`io.acceptance.scans` 逐条可回溯归档、checks_via 目标在册）。

### Removed
- X 轨 13 条：红蓝对抗残族 6（AE-RED-*/AE-PR-*）＋监管/评审步残族 3（AE-OVER-*/AE-ROUTE-EXCLUSIVE）＋随协议作废元条款 4。`unverified` 态自此不存在。
- **断言台账退役归档**：`knowledge/aesthetic/assertions.json` → `projects/_archived/assertions-ledger-v5.0.0/`（只读原件 + README，规则卡与 kit-lint 台账都从它回溯）。
- 一次性迁移器 `tools/asserts-retire.py`、`tools/asserts-retire-kb.py`（批C 收口退役；幂等复跑实证仅 1 处命中 = minitools.json 里「原 check_aesthetic_asserts」溯源注记，非活引用）。

### 记账（批C · 文档与版本）
- `AGENTS.md`：版本治理行 + 铁律 3/9 去「断言」措辞、K1 补「质量条款的家 = 规则语料 + 激活制」、能力注册表工具链改口径、新增「质量证据工具链（v5.0）」条、前端消费纪律字段清单更新（`io.acceptance{scans,rules}`）、R5「声明即契约」→「证据即收据（报数必附收据，铁律10 升级）」、「R5 存量记账」→「v5.0 断言退役收口」。模型档位纪律、人工裁决边界未动（工单 §三 明令）。
- `docs/规范-生成式flow与运行时编排-R5.md` §4.1 就地标退役 + §十 销账；新增 `docs/规范-规则语料与orchestrator激活-v6.md`（编号顺延）；`flows/README.md` 断言口径清扫；`docs/版本宣告-v5.0.0.md`（90 条去向总表由 lintlib 口径单点生成）。

### 门禁（v5.0.0 收口实测）
- vitest **281/281** 全绿 + `tsc --noEmit` 0 错；flow-lint 9 flow **0E**/7W；module-lint 9 模块 **0E**/34W；kit-lint **0E**/41W（含 W4×1 AE-NAT-HIT 显式账）；page-lint 70/70（p-yaomo-fx-001 重生成页）。
- 工单 §四 批B 验收口径：`flow_submit` 链上 grep 不到任何 AE- 字样（kernel.ts/asserts.ts 源码 0 命中；打回回归锁断言 problems 无 AE- 名）；flows JSON 残余 AE- 全部 confined 于 changelog 历史条目与 0.3.0/3.1.0/6.0.1 口径声明（逐文件 JSON 路径核账）。

## [4.2.0] · 2026-09-21 · 工单批D：kit@1 清场（能力唯一事实源 = modules/）

宣告文档 §五 批D 落地：`kits/` 四域 kit.json 删除、kit-lint 由「只提示迁移」转阻断门禁、三个 kit 迁移器退役。module@1 自此是能力的唯一之家（铁律11），协议字段名 `kit`（节点 `kit`+`op`、`ResolvedOp.kit`、`kitRef`）保留不动——已冻结的引用协议，值域现为模块 id。

### Changed
- **装载器单源化** `core/src/kits.ts::KitRegistry`：删除 `kits/` 目录扫描块（原「kits 先装、modules 按 id 合并、kit 为既有权威」的双源逻辑连同 WO-03 同 id op 级补缺一并消失）；`modules/*/module.json` 成唯一装载源，模块即权威。归一化补 `minitools`（数组，此前只认单数遗留键致 30 个机器件的执行体声明被静默丢弃）与 `exclude_knowledge`。
- **kit-lint 转阻断 + 事实源切换** `tools/kit-lint.py`：数据源 `kits/*/kit.json` → `modules/*/module.json`，删 legacy 对照模式的 E 级降级（error 自此真阻断、exit 1）；删 format/domain 轴检查（模块无 kit@1 四域轴）与 assist 校验（该字段随 kit@1 退役，内核无消费方）。
- **跨模块重复技能 E6→W8**：`scene-breakdown` 合法双家（plot 骨架步 + drama 主工具）。铁律11 是「必有 ≥1 家」而非「至多 1 家」，flow@3 派生节点一律携 kit+op 显式引用、bySkill 反查仅兜底，歧义无害但须记账。
- `core/src/schema.ts`：`"kit"` 从 `SCHEMA_IDS` 除名（`contracts/kit.schema.json` 只读留档）；`tools/project-pages.py::kits_summary_build` 去 kits glob。
- 7 个 flow 无改动（flow@3 派生节点早已引用模块 id，批B 起 `kits/` 对活流程即惰性遗产）。

### Added
- **`planned` 占位契约**（`contracts/module.schema.json` + `tools/module-lint.py`）：铁律11「能力必须有家」的诚实形态——`planned:true` 豁免 `E-MINITOOL-IMPL`、显式记 `W-PLANNED`（占位可见，不冒充有实现）。三件落位：`docx_ingest`→delivery（批注回流）、`continuity_check`→base（连续性校验）、`meme_harvest`→topic。planned 件用**独立 capability**，绝不与现役 agent 步共享 cap（否则 caps 自动拉入生产编排并在首节点 block 整条流——meme_harvest 曾误挂「时代情绪锚」致 topic-selection e2e 全红，已改判为「热点采集」）。
- 三个悬空 cap 自此有主：delivery「批注回流」、base「连续性校验」、topic「热点采集」。
- `exclude_knowledge` 迁入 module@1 契约（module-lint E-KB-UNKNOWN 核对 + 装载器消费）。

### Fixed
- **find-trope 注入收窄回归**（批D 排查中定位并修复，非「报告后搁置」）：批A 前真正生效的标尺装载源是 `kits/search`，其 find-trope 带 D1-D5 落地的 `kb/market/brief-four-questions` + 三张 `na-*` 海外梗卡剔除；`modules/topic` 副本无这两字段。清场使 modules 转唯一权威 = D1-D5 收窄静默回归。修复：字段随迁 `modules/topic`（`caliber.test.ts` D4 断言转绿，改指 `topic`）。
- **装载器丢机器件执行体**：`ops.*.minitools` 数组此前不被读取（只认单数 `minitool`），30 个机器件的执行体声明在装载层被吞；补数组形态与 `script`。
- **`project-pages.py` 陈旧 effective 崩页**：`registry/effective.json` 的 composition 实例不在 `flow.modules`（如 drama-flow 的 m4 delivery 已收）时 `next()` 抛 StopIteration → 整页崩。改为按「无 caps 请求」渲染该实例工具箱并显式回显 stale 警告（p-slj-002/003 复跑实证）。

### Removed
- `kits/` 五域 kit.json；`tools/kit-migrate.py`、`tools/kit-config-init.py`、`tools/flow-kit-apply.py`（kit@1 迁移三件套，仅自身与 AGENTS/R5 文档引用）；`modules/base` 的 `flow-kit-apply`/`kit-config-init` 两个已退役脚本壳 op。`assist` 字段口径退役（记账）。

### 记账
- 权威规格就地改写：`AGENTS.md`（版本治理行 / 铁律11 / K1 装载 / 能力注册表工具链 / R5 工具链 / R5 配置可调条款，`kits/` 字样清零）；`docs/版本宣告-v4.0.0.md`（§二 工种工具箱行、§三 规则3、§四 处决清单#9、§五 批D 全标闭合，含 spine-less 落位定案）；`docs/规范-生成式flow与运行时编排-R5.md`（状态行去 kit-config-init、适用范围/§二 配置源切 modules、§九 工具表补 planned/W8）；`docs/规范-模块化flow与工具箱-R6.md`（§十一 勘误新增 #17 无骨架工具箱落位口径、#18 planned 占位契约、#19 kit@1 清场回写）。
- **base 无骨架模块落位口径定案**（原记「缺口归批D」）：`spine=[]` 工具箱模块不靠 caps 落位（无锚=module-lint E-PLACE），改用实例 `insert:{"end":[…]}` 显式有序启用；`expandFlow3` 的 `explicitInsert` 路径本就支持，内核零改动。
- 门禁：tsc 0 错；**vitest 271/271**（含 kernel.e2e / r5-generative / r7-runtime 三套内核端到端——modules 单源装载下 flow_run/link 门/buildTaskPackage 全绿，即批D 运行时验收）；flow-lint 0E/2W；kit-lint 0E/42W（阻断口径）；module-lint 0E/34W（含 3 条 W-PLANNED）；validate-kb 通过（90 断言）；12 个项目工作台页重生成 + page-lint 全 exit 0。

## [4.1.1] · 2026-09-21 · 工单批C：断言台账收敛

宣告文档 §五 批C（断言台账收敛）落地；权威规格行同步销账（R5 §十 #2/#3/#4/#5）。

### Changed
- **断言标识字段统一单名**：`knowledge/aesthetic/assertions.json` 条目 `asserts[].id` → `name`（与引擎 `Validation.name` 同名；「两套命名=漂移」就地根除）。方向选择：引擎侧字段不动——`name` 已持久化进各项目 `registry/artifacts.json` 与 metrics，改名即旧数据静默变 unverified，双名兜底又违 R4 §5.3。消费方三处随迁：`core/src/asserts.ts::checksVia`、`tools/kit-lint.py`、`tools/validate-kb.py`。台账版本 1.0.0→1.1.0（90 条）。
- `kit-lint.py`：AE-EXISTS/AE-SKIP-NON-BEAT 不再从引擎集 discard（已作为 dim=meta 路由裁决入册）；「断言缺口」分母改质量条款集（meta 不摊派 op 覆盖）。

### Added
- 补登引擎 3 个 id：`AE-CH-LEN`（多章正文每章 CJK 下限，prose/block）、`AE-EXISTS`（产物缺失入口守卫，meta/block）、`AE-SKIP-NON-BEAT`（非拍级豁免显式回显，meta/minor）——引擎 14 个 id 自此全量在册。
- `kits.test.ts` 台账体检 3 项：标识字段只有 `name` 且无重复；引擎发出 id 全在台账；`checks_via` 别名目标必须真实在册（别名指虚空=声明链静默降级）。

### Fixed
- `tools/validate-kb.py` 读 `asserts[].id` 随字段更名失联（KeyError→改 `name`）。

### 记账
- AGENTS.md「R5 存量残留」行改写为 v4.1.1 收口口径（活账只指 kit-lint 实时输出，文档不抄数）；`docs/规范-生成式flow与运行时编排-R5.md` §十 #2/#3/#4/#5 销账（划线+闭合依据）；`docs/版本宣告-v4.0.0.md` 断言台账行转「已收敛」。
- 门禁：tsc 0 错；vitest 270/270；kit-lint 0E（「未登记断言」警告清零，42W→41W）；flow-lint 0E/2W；module-lint 0E/34W；validate-kb 通过（90 断言）。

## [4.1.0] · 2026-09-21 · 工单批A+批B：flow@3 唯一格式落地

宣告文档 §五 工单批A（存量迁移，commit 6768c0a）与批B（代码层处决）合入本版本；flow@1/@2 手画图与兼容分支自此彻底退场，flow@3 成为唯一可执行 flow 格式。

### Added
- 内核修复：`advance` 全部调用点（flow_next / submit / gate / rerun / resume）改为只吃盘上原始描述符（flow@3 `raw`），不再把派生图当 bootstrap——修复了每推进一次读模型便静默降级一次的系统性错位（links 清空、项目/出厂 overlay 丢失、link 门被 itb-* 边界假门顶替）。
- 回归测试 `kernel.e2e.test.ts`：读模型不因推进动词降级（推进后 registry/effective.json 仍含 4 links、5 composition、无 itb-* 假门）。
- `format.test.ts`：flow@1 字符串谓词处决断言（非对象谓词一律不活跃、不解析嗅探；嵌套 any/all 内层字符串同样拒绝；role 单值判别）。

### Changed
- 7 个 flow 存量迁移至 flow@3；7 处残留 `gate` 评审步随批A拆除（人工裁决收敛到 `gate_role:"kit-boundary"` 跨域交接门）。
- `core/src/cond.ts`：`edgeRole` 只看 `role`（flow@1 optional/loop 布尔折算删除）；`evalWhen` 非对象谓词直接判不活跃并给出「已处决」理由，`evalLegacy`（32 行字符串求值）与 `isLoopEdge` 别名删除。`core/src/types.ts`：`WhenPredicate = StructuredWhen`，`FlowEdge` 不再声明 transform/optional/loop。
- `tools/flow-lint.py`：E-FORMAT 文案改为处决公告（指向 R6 §八 手工重建，不再指向迁移工具）；`skeleton-lint.py` 口径同步。
- 前端镜像 `tools/workflow-page-template.html`：edgeRole/evalWhen/whenText/LEGACY_CANVAS 与内核同语义；`page-lint.mjs` 新增「边 when 全部结构化」探针。
- `contracts/flow.schema.json`、AGENTS.md（版本治理 / R4 工具链 / R5 工具链）口径同步：flow@2 手画形态已处决，一次性转换工具退役。

### Removed
- `tools/flow-normalize.py`（796 行）、`tools/flow-v3-migrate.py`、`tools/r5-migrate.py` 三个一次性迁移器删除；`modules/base/module.json` 与 `kits/tool/kit.json` 中对应 op 登记同步移除（flow 工具能力仍由 flow-lint/flow-verify 承载）。
- 测试契约随迁：`flows.test.ts` 断言唯一合法格式为 flow@3；`plan.test.ts`/`kits.test.ts` 夹具改标 flow@2→派生只读。

## [4.0.1] · 2026-09-21 · 远端兜底落地

### Added
- 远端 `origin`（github.com/skkbsgzf/storyflow，私有）＋ 镜像工具 `tools/push-mirror.py`：断链历史经确定性重写后推远端（本地 ref 不动，新旧 SHA 映射表在 rescue 目录）；机制与硬事实见事故留档 §7.4。
- replace 桥 #2：`f424b336 → 990352c9`（替身根提交），本地 `log --all` 全量遍历不再中断。

### Fixed
- 缺失 blob `187bb1eb` 定位为 R6 规范文档 09-18 17:20 版；镜像行以诚实占位符替代，本地原状保留。

## [4.0.0] · 2026-09-21 · 协议基线（宣告文档：`docs/版本宣告-v4.0.0.md`）

### Added
- 全局版本治理首次落地：根 `VERSION` + 本 `CHANGELOG.md` + git tag 三件套；此前唯一版本指纹是 dist 目录名 `release-<sha>-dirty-<date>`。
- decision@1 / catalog-entry@1（R8-S1..S4b，候选库与选择面）随基线入库为核心面。

### Changed
- **协议基线固定**：flow@3 为唯一 flow 格式；module@1 接替 kit@1；flow@1/@2 与 `kits/` 转只读遗产（改动先迁移，工单批A..D 见宣告文档 §五）。
- 文档口径修复：AGENTS.md（铁律11 / R4 工具链 / R5 残留段）、flows/README、contracts/README、contracts/flow-pack.schema.json、docs/底座规格 中滞后的 flow@1 / kit@1 表述就地更新。

### Removed
- worktree `storymasterv4-d1d5` 与杂支 `metrics-caliber-d1d5`（was `be6ade4`；内容已重放 `4f3029b`，另存内容级快照）。

### Fixed
- be6ade4 快照树闭包：自 d1d5 索引重建 274 棵树（根树逐字节吻合）＋补回 2 个 blob；`git fsck` 缺失 10 → 4（残余属永久丢失提交的闭包，不可恢复）。复盘增量见 `docs/事故-2026-09-18-git目录误删与恢复.md` §七。

### 运维
- 备份三件套落盘 `D:/storymasterv4-rescue-20260921/`；git bundle 形态在本仓断链修复前不可用（walk 必踩 `f424b33 → d3bf007` 断点）。
- 加远端仍为第一优先待办：断链未愈 ＋ 无远端 = 再出事故仍然丢历史。

### 历史代际摘要（R1..R8 → 4.0.0）
R1 kit化 · R2 外部对照＋绕流事故复盘 · R3 kit底座落地 · R4 项目文件与流程配置 · R5 生成式flow与运行时编排 · R6 模块化flow（flow@3/module@1） · R7 开源部署与可调面 · R8 候选库与选择面。逐代规范见 `docs/规范-*.md`。
