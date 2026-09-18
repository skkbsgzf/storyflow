# AGENTS.md · miniflow 工作区行为协议

本仓库是 **miniflow 创作任务 harness** 的工作区：`flows/ skills/ knowledge/ templates/ tools/` 是 toolkit，`projects/<id>/` 是创作项目运行数据。权威规格见 `docs/底座规格-miniflow-harness.md`。

## 铁律（违反任何一条 = 无效工作）

1. **先查表再动手**：任何创作动作（包括「继续」「重试」这类裸指令）开工前先跑 `python tools/whereami.py`；多项目歧义时它会返回 `AMBIGUOUS`，此时向用户澄清，禁止静默猜测。
2. **磁盘真相 > 对话记忆**：项目状态（大纲、框架案、编排表、run 状态）以盘上文件为准；上下文里的记忆只当线索，不当事实。写产物前必须 Read 过该产物的输入文件。
3. **产物只经工具生成**：小纲/剧本导出 docx 只用 `tools/export-doc.py`（自带硬断言：源/导出计数、残渣、集标题），断言不过 = 交付失败，禁止「接受现状」。
4. **长内容只用 Write 工具**，禁止 bash heredoc（历史事故：截断 + 残渣入交付物）。单次工具调用载荷不要过大，长文件分片写。
5. **跨项目隔离**：每个项目的人物/地名/专名绝不进入其他项目的产物；拿不准时先 Read 目标项目的 `故事框架案.md` 核对词汇。
6. **人工裁决只在 kit 边界**（R5 改写，原「所有 gate 都归人裁」已废）：常规人工裁决点 = **`gate_role:"kit-boundary"` 的跨域交接验收门**（由内核在域切换处自动派生，不手画），以及 `policy.gate_mode="manual"` 显式退回手动时的门。域内门已降级——纯汇合点直接自动放行；**带产活的门是「评审步」：评审照跑、产物照出，交卷后自动裁决**（跳过它的产物 = 静默断路，禁止把 `status` 直接置 done）。任何 gate 的裁决，人一旦介入（`state.gate.awaiting`）机器不得越权代替。规范：`docs/规范-生成式flow与运行时编排-R5.md` §四。
7. **交付即快照**：产物落盘后用 `python tools/snapshot.py capture <flow> <project> <node> --files <相对路径>` 留档（M1 后自动化）。
8. **流程身份绑定**：项目工具链（页面生成/快照/导出）的 flowId 一律取自项目 `state.json` 的 `flowId` 绑定，传参不一致即中止；禁止凭记忆假设项目属于哪个流程（事故：p-fq-001 被挂上 topic-selection 串图）。
9. **正文纯净**：过程元数据（节点/skill/轮次/输入清单/隔离声明/数据快照口径）只进宿主思维链与 journal，绝不进产物正文（AE-OUTPUT-PURITY，block；机械校验 `tools/check-purity.py`）。
10. **改 done 节点产物必须走 flow**：已完成节点的产物要修改，走 `flow_rerun`；内核暂不支持时（如 iterate 实例重派发）走五步降级路径，**单命令载体 `python tools/amend-artifact.py --project <id> --node <id> --file <rel> --reason "<理由>"`**（①声明绕流意图入 journal → ②实跑校验落收据 → ③修订对照表登记 → ④重快照 → ⑤flow-verify 复检，任一步失败即中止；理由为空直接拒绝）。一切「已扫描/已校验」声明必须引用收据文件，无收据=删声明（事故复盘：docs/绕流改稿事故分析-R2.md——v5 虚报扫描+补拍快照洗白，被甲方人眼揪出）。
11. **能力必须有家（kit@1）**：技能必须归入 `kits/<域>/kit.json` 四域之一（search 检索取数 / plot 剧情 / prose 文学 / tool 确定性底座；检测评估能力打包于 kits/detect，domain=tool）；flow 节点用 `kit`+`op` 引用，**禁止再手写 `kb` 清单**——两套真相=漂移（R1 报告：47 个 agent 节点中 40 个 node.kb 与技能自称不匹配，且 node.kb 内核从不读取，声明全空转）。守门人 `python tools/kit-lint.py`，0 error 方可提交。

## 项目开工口径（每个创作轮次）

```bash
python tools/whereami.py            # 我在哪：项目/当前节点/必读输入/应产输出
# 按提示 Read 必读输入 → 产出/修改 → 工具导出（断言内置）→ snapshot capture
```

- **成文架构纪律（2026-09-17）**：剧情前置锁定（编剧流分场卡/节拍卡），文学质量内置在成文流水线 `flows/novel-prose`（三专科层稿 + 成文师逐段六维盖章），polish 只做收尾薄修——禁止跳过分场直写正文、禁止逐行打补丁式对线、禁止在 polish 层救烂原文（屎上雕花禁令）。约束整合唯一入口：`kb/craft/prose-constraints` 六维路由总纲。
- **beta 期思维链存档（2026-09-19）**：repo 根 `BETA` 标记存在期间，每轮执行收口跑 `python tools/cot-capture.py --project <id> --note <推理注记.md>`——推理注记**执行中随手写**（决策依据、取舍、打回根因），不事后补写；CLI 调用由内核自动留痕 `trace/cli.jsonl`（BETA 门控）。分析走 ZCode skill `cot-analyst`（定量 `tools/cot-analyze.py` + 定性 rubric），报告落 `docs/`。beta 结束删 `BETA` 即停，历史存档保留。

## 环境注意

- Windows + Git Bash：脚本一律从仓库根 `D:/storymasterv4` 运行；Python 用 `python`（`python3` 可能不存在）。
- 会话可能被 fork / 上下文被压缩：这**不构成**凭记忆继续的理由，whereami + Read 重新落地。
- 工作台页面：`projects/<id>/workflow.html`（静态快照）；registry/journal 才是实时真相（M3 前以盘上文件为准）。
- **kit 标尺装载（K1 复位）**：agent 节点的判定条款由内核在 `buildTaskPackage` 单点装载（`kit.op.knowledge` → 指令「判定标尺」段 + 派发头清单 ｜ 单卡 1600 字 / 总量 9000 字封顶，超限与缺失均显式回显）。要改「某步该对照哪些条款」，只改 `kits/<域>/kit.json` 一处——改技能 frontmatter 或节点字段都不再影响装载。
- **kit 工具链**：`tools/kit-lint.py`（底座体检：引用有效性/漂移/孤儿/断言覆盖）、`tools/kit-migrate.py`（从技能与 flow 反推 kit，合并式不丢数据）、`tools/flow-kit-apply.py`（节点文本级迁移，格式零损伤）。
- **规范 R4 工具链**（`docs/规范-项目文件与流程配置-R4.md`，配套 `contracts/flow.schema.json` + `contracts/artifact-header.schema.json`）：`tools/flow-lint.py`（flow@2 字段唯一化/边 role·when·params 可求值/产物路径准入）、`tools/artifact-lint.py`（过程件头部九项 + 目录准入 + 污染扫描）、`tools/flow-normalize.py`（flow@1→flow@2 迁移，文本级保格式，`--check` 幂等）、**`tools/page-lint.mjs`（前端面板契约：把生成页载入无头 DOM，断言无旧字段名、边面板渲染结构化条件、节点面板显示 kit.op/依据/审核、脚本无硬编码节点 id；改 `tools/workflow-page-template.html` 后必跑）**。
- **前端消费纪律（R4 §5.3）**：面板只读唯一字段名（节点 `output`、知识 `kit`+`op`、校验 `asserts`、边 `role/when/params/via`），**禁止双名兜底与字符串嗅探**（事故：`nodeInfoPaper` 读已删的 `m.kb` → 面板静默空白；`isEdgeActive()` 硬编码 `"rejected"`/`RS.nodes["gate-r2"]`）。字段不在 `flow.schema.json` 白名单内时，面板显式标「未规范化」，不得静默丢弃。
- **规范 R5 工具链**（`docs/规范-生成式flow与运行时编排-R5.md`，配套 `contracts/flow-overlay.schema.json` + `contracts/metrics.schema.json`）：`tools/kit-config-init.py`（为 55 个 op 注入 config 旋钮表，`--force`/`--check`/`--allow-generic`，幂等）、`tools/r5-migrate.py`（删 legacy `gate_role:"验收门"`，`--check` 幂等）。内核新增三动词：`flow_effect`（生效编排 + 指标汇总）、`flow_optimize`（由指标产出提案）、`flow_overlay`（改写编排，`--approve`/`--replan`）。
- **生成式编排纪律（R5）**：
  - **编排只有一个事实源**：生效编排 = `flow.json ⊕ 出厂 overlay ⊕ 项目 overlay ⊕ kit 边界派生`，由 `core/src/overlay.ts::effectiveFlow` 单点实现并落 `registry/effective.json`。页面/脚本**禁止在别处重实现**派生逻辑（Python/JS 各写一份必漂移）。
  - **人工裁决只在 kit 边界**（见铁律 6）；域内质量由各 tool 的 `asserts` + `config` 承担，**不再靠图上加门**。
  - **声明即契约（R5 §4.1）**：`node.asserts` / `kit.op.asserts` 必须**真跑**，单点实现在 `core/src/asserts.ts::runDeclaredAsserts`（`flow_submit` 与 `check_aesthetic_asserts` 共用，禁止各自实现）。裁决三态：引擎有校验器（同名或同族 `ID#子项`）→ 用引擎真裁决；没有 → 标 `unverified`（语义层，归评审/红方），**绝不冒充 pass**。声明里的 block 断言会把提交打回，`declared/block/unverified` 三个数都落 metric 与 journal。
  - **每个 tool 的配置项必须可调**：`kits/<kit>/kit.json` 的 `ops.<op>.config` 是旋钮表（E7 未声明即 lint 报错）；生效优先级 `overlay.set-tool.config > 节点 config > op.default > 通用默认`，结果带**逐键来源**，未识别键**显式回显不静默**。改配置进 `registry/overlay.json`，结构类改动（增删节点/改线/换 op）**永远不自动落地**。
  - **编排挖掘师（R5 §6.0）**：每轮结束后的质性复盘走通用 Skill `orchestration-miner`——`flow_mine`
    组装证据包（journal/打回/批注/中间文件）→ findings@1（每条带可溯源证据，无证据不立案）→
    `flow_optimize` 并入提案（非结构类 risk=medium 待批；结构类只进拍板清单，永不自动落地）。
  - **两条主指标**：上下文命中率（注入的标尺被产物真正引用的比例，信号取自 `artifact@1` 头部 `upstream` 与正文）＋ tool 效率（`consumedBy / 成本`）。同 `<kit>.<op>` **跨节点归口**——换位置不换 tool。口径只在内核定义一次，汇总落 `registry/metrics-summary.json`。
  - **改写即重编译**：`state.overlayHash` 与生效编排不符即 `replan`（受影响下游置 `pending`+`stale`）；旧 run 首次接触 R5 只认领指纹不重编译。
- **R5 存量残留（记账，逐步清场）**：断言台账两套命名未对齐（注册表 74 条，引擎发出的 17 个 id 只有 4 个同名）；40 条被声明的断言中 28 条无机器校验器（`AE-CONT-*`、`AE-VIS-EMPTY`、`AE-WNF-HOOK` 三类文本层可查，应补）；7 处残留评审步（`gate-r1`/`gate-final` 等）待优化器 R6 提案 + 人批裁掉。详见 `docs/规范-生成式flow与运行时编排-R5.md` §十。
- **模型档位纪律**：文学判断节点（novel-deai / novel-judge / dialogue-polish 及各 gate 评审）必须在强模型档执行；轻量档（Flash 类）会话接手此类节点前，须先向用户声明降档风险并经确认——「默默用轻模型跑了文学判断」视同铁律 10 的虚报。
- **iterate 提交（K6）**：`flow_submit --seal` 语义——iterate 节点逐实例提交时保持 awaiting，实例清单记入 state 节点 `committed`，最后一个实例带 `--seal` 收口置 done；rerun 自动清零 committed。
