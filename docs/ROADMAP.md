# 路线图 · 三批次（2026-10-10 定盘）

> 配套规格：[`ARCHITECTURE.md`](ARCHITECTURE.md) §3 四相能力模型；细化拆解见 [`规划-四相能力落地-需求细化与排期-20261010.md`](规划-四相能力落地-需求细化与排期-20261010.md)。
> 排期原则（2026-10-10 用户决议）：**批次1 框架清理做干净 → 批次2 架构重建；图文视频能力与本地快诊断场景薄弱、底子不厚，整体压到批次3，架构重建后再慢慢排期。**

---

## 一、三批次总览

```
批次1 框架清理（✅ 2026-10-10 已完成）
    ↓
批次2 架构重建
    ├─ R2.1 契约先行：rule.schema.json（diagnosis-report 随三相前置）
    ├─ R2.2 项目文件体系（需求1：索引→增量→记忆→项目级 RAG）∥ R2.3 输出面收拢（需求3）
    └─ R2.4 写诊改三相打通 + 能力归并（需求4 主体）
    ↓
批次3 缓做（架构重建后慢慢排期）
    ├─ 本地快诊断服务化（需求2：S 级 + laya 环境回填 + 静默追写 + agent tool）
    ├─ 图文视频能力（seedance 族，声明已摘除留档）
    └─ 拆 · 逆向（需求4 收尾：deconstruct.schema + 采样/归因/回流）
```

## 二、批次1 · 框架清理（已完成 2026-10-10）

| 项 | 结果 | commit |
| --- | --- | --- |
| 索引净化 | node_modules 18,332 / 回执 9 / pycache 2 出库，tracked 20,050 → 1,707；.gitignore 增补 | `0aa1bf5c` |
| lint 归零 | base 三死声明（前端切割遗留）+ drama seedance 摘除；module-lint 5 err → 0 err；一次性探针/手术件出库 | `1e695318` |
| 文档重组 | 25 项过程文档归档 `docs/_archive/`；ARCHITECTURE / contracts / ROADMAP 三入口落地；全库路径式引用改写 | 本 commit |
| 测试收编 | storyharness/test 三件未跟踪测试入库 | 本批次 |

验收：三 lint 0 error、门禁双绿、core 433/434（1 环境例）+ storyharness 148/148 不回归、索引无垃圾。

## 三、批次2 · 架构重建

### R2.1 契约先行（1–1.5 周）

| 交付物 | 说明 |
| --- | --- |
| `contracts/rule.schema.json` | `rule_id / tier(S\|A\|B) / scope / 检测目标 / 判定逻辑 / 证据字段 / 严重度 / 修复策略 / provenance.refs` |
| 三 lint 增规则卡校验 | 卡面 ↔ 扫描器 qid 对账起步 |

### R2.2 项目文件体系（2–3 周，需求1）✅ 已落地 2026-10-10

| 交付物 | 说明 |
| --- | --- |
| `project-index.schema.json` + 索引生成器 | ✅ `tools/project-index.py build`：路径探索 → `projects/<id>/project-index.json`（符合 project-index@1，写盘前过内置 schema 校验）；角色标注按目录规则首标（输入/世界书=human，交付/内部/台账=generated），机器区（registry/snapshots/kit/内部会话等）默认排除留 `--all`；双根铁律 root_scope 钉死 `projects/<id>/` |
| 增量更新 | ✅ `tools/project-index.py diff`：与存量索引比对 hash+mtime → 三态清单（新增/变更/失踪）；generated 条目与盘上不一致 ⇒ 升格 hybrid 并注「疑似手改」（契约失效策略）；human 条目只记账不覆写；`--receipt` 落收据（报数附收据） |
| 记忆本地化 | ✅ `tools/project-index.py memory`：会话 JSONL（`内部/sessions/`）→ `世界书/记忆卡-<sid>.md` 人机双读（frontmatter 带 session_id/turns/updated/source，正文=逐轮「用户输入首句+时间戳」确定性抽取，不编内容）；派生物整卡可重建 |
| 项目级 RAG | ✅ `tools/kit-compile.py --project <id>`：世界书（含记忆卡）+ 规则卡 → `projects/<id>/kit/hypergraph.rag.json`（与全局产物同构，stats.scope=project；全局模式行为逐字节不变，sha256 前后一致）；core `kb_search` 双根合并检索（`--project` 透传，命中带 `source=global\|project`，项目档缺席=零回归，`core/test/kb-project.test.ts` 钉住） |

验收：合成项目跑通 build→diff（手改升格 hybrid）→memory→项目档编译→双根检索；全局 KB 零混入（项目档只落 `projects/<id>/kit/`，全局 `kit/hypergraph.rag.json` sha256 不变）。

### R2.3 输出面收拢（1–2 周，需求3，可与 R2.2 并行）✅ 已落地 2026-10-10

| 交付物 | 说明 |
| --- | --- |
| 立场入规格 | kit 三输出（文档/自包含 HTML/数据包）；HTML 只读、零依赖、不回 call kit —— `docs/ARCHITECTURE.md` §0 ＋ §9 不变量 6 |
| 页面件补齐 | `tools/journal-page.py`（journal.jsonl → 大事记整页，`journal-template.html` 渲染）＋ `tools/diagnosis-page.py`（diagnosis-report@1 → 诊断报告页，evidence/opinion 分区，fixture＋`--selfcheck`） |
| panel/kitapp 冻结执行 | 存量保留、零新投入 —— `panel/FROZEN.md` |
| 宿主接入文档 | pinax-bridge 四范式（任务化接口/契约镜像/预算归属/工具环桥）提炼进 `docs/integration/host-integration.md` |

### R2.4 三相打通 + 能力归并（2–3 周，需求4）✅ 已落地 2026-10-10

| 交付物 | 说明 |
| --- | --- |
| `diagnosis-report.schema.json` | ✅ R2.1 契约先行；R2.4 实现落点＝`mf_analyze_card` 输出对齐 items 语义（rule_ref/tier/severity/evidence/suggestion，prompt 明示建议必须是条款 repair 的反向表达） |
| 一源两视图收敛 | ✅ 16 张域卡 frontmatter 铺 `format: rule-card@1` + `clauses[]`（rule_id 沿用 AE-id，tier/severity/repair 升格，规则原文零改写）+ `scanner_qids[]`（逐卡人工核对：curve/dialogue/scene/reversal/ai-trace 五卡有真实 qid 对应共 6 条，其余卡空数组记账「已对账无对应」——宁缺毋滥）；kit-lint W10 记账 16/16→0，E12/E13 保持 0 error |
| 卡驱动诊断动词 | ✅ `core/src/agent.ts`：`mf_analyze_card`（card=kb 卡 id，path/text=正文）通用卡驱动诊断；`mf_analyze_curve` 保留薄别名（协议面 storyharness analysis.ts 与 sse-events.md 点名过该名，宿主可见面不断，内部调通用实现卡固定 emotion-curve）。agent 工具环局部工具族，动词单表未动 |
| 三相一致性测试 | ✅ `core/test/r24-triphase.test.ts` 7 例：工具注册 / 16 卡逐卡 prompt 组装（条款 id+repair 同入 prompt＝诊建同源结构断言）/ 输出契约字段位 / 别名行为 / 错误路径显式；LLM 走 fetch 打桩不打真端点。「修改可回滚」随批次3 拆（逆向）与服务化落地 |

## 三·五、批次2.5 · 项目知识与改相收尾（2026-10-10 追加，四相盘点产出的漏项）

> 来源：批次2 后按原始四需求复盘，四相框架之外的六项漏项（A–F）。C 已拍板：图谱页由 kit 补自包含生成器（与诊断页/时间轴同模式，零外部资源）。

| # | 项 | 需求归属 | 说明 |
| --- | --- | --- | --- |
| P1 | 项目知识生产面 | 需求1 | ✅ 已落地 2026-10-10：`tools/project-init.py` 骨架增 文风/、规则/ 两目录＋README＋rule-card@1 卡模板（文风卡 dimension=style / id 用 pj-style 命名空间；规则卡 dimension 留空待填；模板即范式——kit 只给形不猜内容，条款注释态），另增 `--upgrade` 子命令为存量项目补目录（只补缺失件、已存在一律跳过不覆盖）；`tools/kit-compile.py --project` 扫描范围纳入 文风/（规则/ 已在，R2.2）；`tools/project-index.py` 文风//规则/ 首标 role=human；`contracts/project-config.schema.json` 增 optional `validation` 校验标准声明位（tierThreshold/cardScope/severityFloor，additive 不破代数，声明位先行——消费方随批次3 快诊断接入）；`core/test/kb-project.test.ts` 增「项目卡含文风目录」例 |
| P2 | kb-rag 亲和 + 图谱页 | 需求1/3 | ✅ 已落地 2026-10-10：①`core/src/kb.ts` 双根合并策略升级——去重（同 id 或归一 ref 两根命中只留项目侧，source=project）、同分 tie-break（分数为主，同分项目排前）、k 分配（各根独立 top-k ⊕ 去重排序截回 k，项目命中是补充不设保留席；total=全局+项目−双根重复，项目缺席时逐字零回归）、kbRead 项目回落返回体带 `source` 溯源；口径宁简内置，`kb-project.test.ts` 7→12 例钉死三条新语义；②`tools/kb-affinity.py` 卡↔消费者亲和对账收据（非门禁，kit-lint W3 口径原样不动）——四层消费面（modules ops 结构化 / flows 节点 kb·loads+散文 / skills 正文 / core/src 硬编码），孤儿=零正向引用只记账不失败，悬空分 structural（断链 exit 1）/textual（注释示例人裁）两级，收据落 projects/_reports/、重跑逐字节一致；③`tools/kb-graph-page.py` + `kb-graph-template.html` 知识图谱自包含页（kitapp 图谱交互的零依赖复刻：力导向 Canvas、节点拖拽/画布平移/滚轮缩放/悬停显名/分类图例点击隔离/度数定半径/枢纽名常显）——--project 并项目档（同 id 项目侧优先去重、项目卡描金环），写盘前零外部资源断言 + --selfcheck（形状/幂等/悬边丢弃钉住）+ 页面不带生成时刻（sha256 幂等），全局产物 kit/ 只读不回写 |
| P3 | 改相闭环 + 诊产物对齐 | 需求4 | ✅ 已落地 2026-10-10：①契约 `contracts/repair-plan.schema.json`（repair-plan@1——诊→改承载；tier 值域 S|A **schema 层不含 B**＝B 级绝不入单；status 生命周期 proposed→applied/rejected、applied→rolled_back，推进归人；diff 只回填不应用）；②执行件 `core/src/agent.ts` `mf_apply_repairs`（与 mf_analyze_card 同模式：改单内联/path＋目标 text/path → 逐条款产 unified diff，**绝不写盘**；prompt 纯函数 `buildCardRepairPrompt` 明示「只改本条款所涉，不做顺手美化」；B 级进单 INVALID_INPUT、条款不存在 CLAUSE_NOT_FOUND、repair 与卡面不一致 INVALID_INPUT——先全量静态校验再动 LLM）；③记账面 `tools/repair-apply.py`（validate 手工等价校验逐条点名 / dry-run 列清单＋盘上卡同源核账＋B 级拒绝点名 / status 状态推进落收据；**不做 diff 应用**——应用归宿主拿 diff 走 batch-edit 人裁；fixture＋--selfcheck 零写盘）；④诊产物过门 `tools/diagnosis-validate.py`（diagnosis-report@1 完整契约等价校验＋`--map` quality-scan 收据→诊断报告字段映射表＋--selfcheck；**不硬改 quality-scan 输出格式**——它是生产件，动输出要连动 core quality-cli 桥与测试，本批只做「映射表文档＋校验器」，validations[].status 转 items[].severity 留给 agent 裁决＝机器只出证据）；⑤qid 反向对账（诚实边界）：quality-scan 引擎半边**有**稳定 AE-id 体系（T 轨台账＋aesthetic.ts 实现面＋收据 validations[].name，kit-lint 已核账），但 v5.0 双轨设计下扫描器条款（T 轨）与卡条款（C 轨）刻意不同 id，逐条机械映射不存在、语义映射除 DECLARED_GAPS（AE-NAT-HIT→kb/rules/ai-trace）外无官方第二处——**不硬造**；prose-scan 细则（slop 词表/八维/套话族）与 zhuque-check 无条款 id 体系。反向对账待批次3：prose-scan 细则若要进改单先立条款 id（随本地快诊断服务化） |
| P4 | 收尾杂项 | — | ✅ 已落地 2026-10-10：①阶段动作清单——`docs/integration/host-integration.md` §六「项目阶段动作」五节点约定表（init 后 project-index build / 世界书·文风·规则大改后 kit-compile --project（先 --check 干跑）/ 交付·验收门后 project-index diff --receipt 落收据 / 会话段落后 memory 子命令 / 阶段收口 kb-affinity 对账，逐行注明命令与产出物），`tools/project-index.py` docstring 加交叉引用；②`core/src/minitools.ts` 脚本壳解释器可配置——python 壳走环境面 IEnv：`MINIFLOW_PYTHON`（与 compat.ts 同一旋钮）＞`STORYFLOW_PYTHON`＞缺省回退 `python`（零破坏；本机 python stub 环境例 r8-os02cd 的治本入口，配真 python 全路径即绿，测试断言未动）；③`tools/kit-compile.py --check` 干跑——内存重编译 vs 盘上产物逐键比对，一致 exit 0 / 不一致 exit 1（差异摘要：数量变化＋首个不一致 key）/ 盘上无产物 exit 1 提示先编译，全局与 --project 双模式，零写盘幂等零依赖；④`tools/rules-init.py` 防覆盖门——头部显著警示＋默认检测到存量卡带 rule-card@1 收敛字段（clauses/scanner_qids/format）即拒绝整批写入（一个不写，README 也不写），显式 `--force` 才整卡覆盖（选 --force 门而非自动合并字段——简单可靠，字段保留责任前置到人）；⑤文档收口（ROADMAP 本行＋规划 §9.5＋ARCHITECTURE §10） |
| — | 存量 ops 过堂（F） | 需求4 | module-lint 39 条 warning（meme_harvest planned、同槽多件）——随批次3 逐个归并或清退，不进本批次 |

## 四、批次3 · 缓做（架构重建后慢慢排期）——3a 波已开工（2026-10-10）

### 批次3a（本轮三包）

| 包 | 内容 | 边界 |
| --- | --- | --- |
| P5 拆·逆向 | ✅ 已落地 2026-10-10：①契约 `contracts/deconstruct.schema.json`（deconstruct-report@1 拆书报告——source/sampling（抽样策略+单元清单+expand 痕迹）/findings（claim 归因+evidence 样本内引文+provenance 单元回溯+candidate_card 草稿卡内嵌）/status draft→reviewed→landed）；②确定性采样器与回流通道 `tools/deconstruct.py`（sample 默认头/中/尾小样本、--expand 等距扩采、章节/场景/字数三切分、清单零正文、--dump 单单元限长；report 手工等价校验+摘要+证据覆盖度点名；land 人审前置——draft/landed 拒绝、rule-card@1 信封自检、同 id 卡已存在拒绝覆盖、全局落 `knowledge/deconstruct/<域>-<来源slug>.md` / 项目落 `projects/<id>/规则/` 并显式改写 pj-rules 命名空间、落完提示 kit-compile；--selfcheck 全链合成 fixture 自测零真实写盘）；③agent 归因工具 `mf_deconstruct`（`core/src/agent.ts`，与 mf_analyze_card 同模式——单元数超 6 显式拒绝、无样本内引文的 claim 拒绝（防编造）、rule_id 非 DC- 前缀拒绝（防搬运台账 id）、只产 status=draft 草稿绝不落卡；agent 工具环局部件，动词单表未动）；④四相一致性测试 `core/test/p5-deconstruct.test.ts` 8 例（注册/prompt 纪律/单元解析/实跑盖章与截断/阈值拒绝/草稿硬校验拒绝路径/前置拒绝/契约字段位；LLM 走 fetch 打桩） | 归因是语义工作走 LLM（agent 工具形态，打桩测试）✅；采样/组装/落卡是确定性件 ✅ |
| P6 快诊断服务化（S 级全量 · A 级适配器） | ✅ 已落地 2026-10-10（A 级真跑通只差用户侧权重回填）：①诊断动词 `diag_scan` 进 verbs 单表（27→28，CLI/HTTP/MCP 三脸自动派生；gen-verbs-doc/gen-openapi 双 --write 后 --check 绿）；②逻辑本体 `core/src/diagnosis.ts`——S 级 = `aesthetic.ts::runAestheticAsserts` 真身**进程内直调**（quality-cli 同一实现，无 Python/tsx 子进程税），findings 全量投影 `diagnosis-report@1` evidence[]（scanner=AE-id/location/metric/receipt），items 只由规则卡条款机械投影（建议=repair 反向表达，tier=B 恒不进；T 轨↔C 轨双轨诚实边界：条款 id 机械对上才建项，对不上的全跑只出证据并在 engines.s.note 点名，DECLARED_GAPS 同源挂 rule_ref 线索）；③`project-config.validation` 声明位变现：tierThreshold=通道门槛（不含 A 时 proposal=true 也不跑 laya）/ cardScope=装卡范围（global=knowledge/rules，project=项目 规则//文风/，both）/ severityFloor=items 产出下限，消费口径随响应 `applied_validation` 回显；④laya A 级适配（并入动词调用路径，无独立 py 件）：`proposal=true` 显式开启，预检 `tools/_vendor/laya-venv` venv＋`runs/laya-run-0923/student-v3` 权重，缺件显式 `LAYA_UNAVAILABLE`(503) 带回填指引（缺失路径＋tools/_vendor/README.md 口径＋回填后验证法），绝不回落 4B/API；在位则 venv 解释器直起 `tools/laya-scan.py --out` 结构化取数，rows 投影 evidence[]（scanner=qid，problem_p≥0.5 且卡条款机械无歧义才建 A 级项，known_weakness 自降）；⑤静默追写宿主协议 `docs/integration/silent-follow.md`（节拍/标红数据形状/保守三律/错误路径契约含 no-store 约定），host-integration §一 加行交叉引用，rest-api-reference §3.1 条目＋mcp-reference 动词清单同步；⑥`core/test/diag-scan.test.ts` 8 例（注册/缺省语义+S 级产出+落盘/契约字段位手工等价/tierThreshold 门槛/cardScope 双向/severityFloor/dims 域过滤/A 级缺失显式失败+指引文案）。**延迟实测**：S 级引擎本体 0–4ms；动词全链路稳态 2–3ms/次、进程内首调 163ms（一次性 schema 装载/词表探测）；CLI 脸墙钟 ≈1.6s（tsx 冷启动，进程税非诊断税）——<100ms 达标口径=长驻宿主稳态，无 Python spawn 制约。e2e：CLI 脸合成 fixture 全链通，产出报告过 `tools/diagnosis-validate.py` 契约校验 | 延迟预算 <100ms 若受 Python 子进程 spawn 制约，如实报告架构取舍，不为达标硬造——**架构取舍已做**：S 级走进程内直调不受 spawn 制约；A 级推理秒级起不进静默链路 |
| P7 存量 ops 过堂 + 杂项 | ✅ 已落地 2026-10-10：①三 lint 逐条 triage（全程 0 error）——module-lint 39→34：W-SLOT-CLASH ×5 修掉（plot 四组＋prose 一组同槽链化：留一个 spine 锚默认件、其余 slot 链到前一启用件＋also_fits 回落原锚，五个 flow 展开序逐字节不变）；占位件 ×3（continuity_check/docx_ingest/meme_harvest）desc 加「批次3 后排」标注（W-PLANNED 记账保留）；flow-lint 3→1：W-ENUM-DEAD ×2 接 `feeds_decision:route` 先验桥（region 同款不回填；topic 6.0.2 / prose 0.3.1）；**顺带修真 bug**：dialogue-polish 缺首锚回退到 after:novel-deai，topic 流 m4 打磨早于成稿、违反「强制末环节」声明——also_fits 首锚补 after:script-final 后展开序＝声明意图，其余 flow 逐字节不变；kit-lint 47→15：38 条「未用技能」系 checker 只认手画 graph、flow@3 全被跳过的系统性误报，kit-lint 补内核规则1 轻量展开（spine∪caps∩insert），剩 6 条为真实无 flow 选用；②图文视频核对：prose render-prompt-seedance 四件套齐全（op 声明／slot+caps／skills/render-prompt-seedance.md／kb/aesthetic/visual-poster＋kb/deconstruct/style-learning 双卡）＝「留库备用」现状坐实（无 flow 启用「视频提示词」cap）；③scripts/ops 四启动器（kit-core/web/app/guard .vbs）注入 MINIFLOW_PYTHON 指真 python 3.13（商店 stub exit 49 免疫），.vbs 纯 ASCII 保持，孪生 `cscript //B` 语法＋Run 执行自检全过（不触现役服务）；④杂项：diagnosis.ts 与 tools/_vendor/README.md 悬空指针修正（modules/detect 已于 0.8.0 删除，laya 权重口径收编进 _vendor/README.md「laya」节） | 凡涉及能力删留的裁决列出待拍板清单，不擅自删 op ✅（零删 op；待拍板 15 条：悬空 caps×2、screenplay 人工门×1、孤儿技能×1、未用技能×5、悬空知识×6，见批次3a 报告） |

### 批次3 后续（2026-10-11 用户裁决定盘）

| 项 | 裁决 | 说明 |
| --- | --- | --- |
| laya A 级 | **暂不规划**（用户 2026-10-11） | 代码侧已就绪封存：`diag_scan proposal=true` 适配器 + 权重缺失显式失败带回填指引；何时回填权重（`runs/laya-run-0923/student-v3` + `tools/_vendor/laya-venv`）由用户另行决定，不进任何排期 |
| 图文视频 | **停留在提示词层**（用户 2026-10-11） | `render-prompt-seedance` 产出视频提示词即终点，不做文生视频深度适配；prose 份四件套维持「留库备用」；drama 份不重建 |
| ComfyUI 对外接口 | **保留，暂不做深度适配** | `comfyui-script` 预设壳 + `AUTO_RULES` 关键词路由（production-preset.ts）保留为对外接口占位；patches 空占位不变；深度适配（真实 ComfyUI 工作流对接）待明确场景另立工单 |

### 批次3b · 知识库质量治理 + 能力安排复查（2026-10-11 追加，用户提出）

> 口径：先治库再评能力——15 条待拍板里近半的答案取决于语料本体的样子。SOTA 方法落到本仓语境＝实体归一（查重聚合）、图完整性审计（边/悬空/孤儿）、schema 覆盖度校验（rule-card@1 + 维度矩阵）、链路排名（亲和/消费面）；确定性工具出收据，语义判断带卡引用证据。

| 包 | 内容 | 边界 |
| --- | --- | --- |
| Q1 知识库体检 | ✅ 已落地 2026-10-11：①`tools/kb-health.py`（stdlib 确定性四账：inventory 全卡画像 / dups 查重候选（独异 gram IDF 加权压模板样板）/ edges 边审计（含回退标题伪边判别与净化视图）/ coverage 覆盖矩阵（缺口①qid 反向对账 + 缺口②确定性条款候选带 T 轨孪生标注）——收据落 projects/_reports/、重跑 sha256 逐字节一致，与 kb-affinity（卡↔消费者）互补管卡↔卡与卡↔标尺）；②agent 亲读高风险子集出 findings，报告 `projects/_reports/kb-health-20261011.md`；③分级处置 A×5 / B×4 / C×5 / D×5。**核心发现：语料本体健康（rule-card@1 16/16 合规 50 条款、卡间互引 131 笔成网、真重复 0），病在编译管线——kit-compile front() 不识 JSON frontmatter（knowledge/README.md 自家约定），115 词条 107 个 title 回落『---』、tags 全空、5998 边中 5992 条伪边、2 张 market 卡产物 id 错位（core/src/kb.ts 已有『已知缺陷』补丁自保，tags 打分全库死代码）＝A 类一处修三处收益**；次级：qid 7/26 认领（活缺口 13）、五校准包无 C 侧条款、pov-leak 校准包知识侧目录缺席（台账 calibrated、原卷在数据根）、4 张 SemIf 报告同名占位 | Q1 只读不动卡（knowledge/ 零改动、产物只读，kit-compile --check 一致为证） |
| Q2 聚合拉边补缺 | ✅ 已落地 2026-10-11（报告 `projects/_reports/kb-health-q2-20261011.md`）：**A 类直改 ×5**——①根因修复 `tools/kit-compile.py` `front()` 补 JSON frontmatter 解析（JSON 优先、YAML 裸键兜底向后兼容）＋全局重编译：title 回落 107→0、tags 115 全空→19 张有值、产物边 5998→6→0（6 条系四卷同名连坐，随②消解；「真边浮现」预期修正：真标题互涉在本库为 0——卡间导航走 131→137 笔 id 级互引，不走 mention 边）、2 张 market 卡 id 归位（product_vs_disk 差集清零）；消费面回归全绿：kit-compile --check 两次重编译逐键一致、core tsc 0 错 + vitest 474/475（唯一失败=已知环境例 r8-os02cd）、storyharness 148/148、kb-graph-page --selfcheck OK、三 lint 0 error（34/1/15 与基线同）、门禁双 --check 过；`core/src/kb.ts`『---』自保补丁**评估保留**（防宿主侧旧版产物缓存/旧工具项目档，kb.test.ts ④ 钉住，零运行成本）；②4 张 SemIf 报告 H1 补族名＋5 张报告补最小 frontmatter（id=路径 id/title/updated/provenance→cases.jsonl）；③2 张方法卡补 JSON 信封（user-style-rules 用户手改区特例不动）；④section-pipeline 补 updated；⑤index.json note 补 semif 报告豁免口径（A5-① R2.4 行实为 5 卡 7 条——记录不改史）。**B 类草案 ×4** 落 `projects/_reports/kb-merge-drafts/`（B1 同名四卷＝假重复不合并、由 A2 标题区分解掉；B2 六母型＝模板同构维持 catalog 单点；B3 b016×神豪＝相邻非重复，附 generated 目录不可直改互挂的告警；B4 规则卡标题模板＝记账不动）。**C 类草稿 ×5**：5 张 semif 校准包出身 rule-card@1 草稿卡落 `knowledge/deconstruct/*-draft.md` 待审区（status=draft＋-draft 后缀、DC- 条款 id、信封过 deconstruct land 自检；qid 认领 7/26→12/26、活缺口 13→8）＋C1/C2 认领对账、C4 pov-leak 三案落位建议（证据留数据根不搬运）、C5 sensory 豁免建议（`projects/_reports/kb-claim-drafts-20261011.md`）。**D 类 ×5** 移交清单入报告。四账收据重跑（Q1 件备份 `q1-receipts-20261011/`）：frontmatter 缺失 8→1、updated 缺失 9→1、同名组 1→0、dups 候选 8→11（3 对模板对出阈值＋3 对 dash-abuse 标题对进阈值——IDF 机制性噪声非语料病）。修正记录：slop-list 批D 口径句「daisy-chain 12/12」与卷面 TOTAL 50% 不符（语料零改写，待用户裁） | 语料是用户资产：合并=草案绝不静默合并；knowledge/ md 全域 gitignore，入库面＝产物 kit/hypergraph.rag.json＋index.json note＋docs |
| Q3 能力安排复查 | ✅ 已落地 2026-10-11（报告 `projects/_reports/capability-review-20261011.md`，不入库；待拍板清单更新版落本档下表，用户在此拍板）：①**15 条重判归并 6 裁决簇**（T1–T7）——悬空 cap×2 建议摘除（`作者之家`=前端切割退役残留、`卡克行分析`=蒸馏线死声明，工具本体不在仓库）；screenplay 人工门给两案利弊（四线都把 manual 门放「结构锁定」边界、唯 screenplay 全自动，建议补 `link:"manual"`，流程语义归用户）；flow-synthesize 建议保留记账（meta 装配手册 + skeleton-lint 人工链完整，verbs 无 flow_synthesize 系「生成器未实现」非卡死）；改编族四件套（adapt-triage/story-outline/adapt-episode-map/cold-open）建议整链留或整链清退（四 cap 无 flow 声明成簇，唯 `kb/formats/comic-drama-adapt` 卡 8 消费全在簇内跟簇走，与 render-prompt-seedance「留库备用」同口径）；topic-delivery-gate 建议补接线（topic flow m2 caps 补「交付对账」一行，技能自述「作为监管技能注入」）；structure 六母型卡维持 catalog 单点（**Q2 新事实改证据基础**：mention 图回归纯目录 0 边、导航真载体=137 笔 id 级互引→检索面零损失；六卡实测合计 1668 字→「9000 字封顶」论据不成立，真约束是 R8 激活粒度「选型后只装对应卡」）。②**ops×KB 覆盖矩阵**——域级零消费仅 semif-calibration（5 卡 8678 字，op=0/text=0，人工复查链路，留存形态待裁）；卡级空转两簇（structure 六母型、comic-drama-adapt）；裸奔 LLM op 4 处（topic-chief-aesthetic 应补对标库、其余三处合理：对账合同/实时热点/机器件）。③**最重要新发现 N1 benchmark 装载饥饿**：28 卡对标库纸面消费仅 plan#topic-proposal 一处 glob，且其 knowledge 声明序 `kb/aesthetic/*`（23 卡 29,453 字）在前——`core/src/assembler.ts` loadKnowledge 按声明序 first-fit、9000 字封顶超顶进 missing 回显，benchmark 28 卡几乎必然全数触顶＝纸面消费、饥饿装载（静态三证推断：assembler.ts:126–159 + module.json 声明序 + inventory 字数账；落地前先跑一次真实装载出收据）。评审零改动：modules/flows/skills/knowledge 未动，git 仅 docs 两文件 | 裁决权在用户；每条建议带可一句话否掉的具体理由 |

### 批次3b · Q3 能力安排待拍板清单（2026-10-11 评审产出，用户逐条回「同意 / 否」）

> 证据与完整理由见 `projects/_reports/capability-review-20261011.md` §一/§五。P7 原 15 条归并为 T1–T7 裁决簇（render-prompt-seedance 已按 2026-10-11「留库备用」裁决出清单），另附复查新发现 N1–N6。

| # | 项 | 原状 | 建议动作 | 一句话理由 |
| --- | --- | --- | --- | --- |
| T1 | 悬空 cap `作者之家`（modules/base） | 待拍板 | 摘除 cap 一词 | 前端切割退役残留，全仓仅 module.json 一处引用（_archive 交接回执为证） |
| T2 | 悬空 cap `卡克行分析`（modules/base） | 待拍板 | 摘除 cap 一词；蒸馏工具将来入库再按 op 形态重立 | 无 op 提供、distill-kakaxing 工具本体不在仓库；benchmark 消费已归 topic-proposal |
| T3 | screenplay 人工门（flow-lint 唯一 warn） | 待拍板（流程语义，两案） | **案①** m2 plot 补 `link:"manual"`（剧本 IR 锁定后人审放行再进分镜）／**案②** 维持全自动 | novel/topic/prose/test-dual 四线都把 manual 门放结构锁定边界，screenplay 是唯一例外；若要的就是试稿速跑选案② |
| T4 | 孤儿技能 flow-synthesize | 待拍板 | 保留 + 记账；warn 噪音归 N3 豁免票 | NL→flow@3 装配手册 + skeleton-lint 人工自检链完整可用；删了装配规范只剩 _archive |
| T5 | 改编族四件套（adapt-triage / story-outline / adapt-episode-map / cold-open + `kb/formats/comic-drama-adapt`） | 待拍板 | 记账维持（「留库备用」同口径）；**或确认弃漫改短线则整链清退**（4 cap+4 op+4 技能+1 卡一次做） | 四 cap 无任何 flow 声明、8 个消费全在簇内；语料域消费全健康、唯 comic-drama-adapt 卡跟簇走——别半删 |
| T6 | 未用技能 topic-delivery-gate（plan cap 交付对账） | 待拍板 | **案①** topic flow m2 caps 补「交付对账」（一行接线）／**案②** 维持备用 | 技能自述「作为监管技能注入」，创作约束移交单现无人对账；若认为 m2 人工环节已覆盖选案② |
| T7 | 悬空知识×6（kb/structure/ 六母型卡） | 待拍板 | 维持 catalog 单点（静态账显式回显）；噪音归 N3 豁免票 | 六卡 1668 字、137 笔 id 级互引可达、R8 激活粒度是设计不是缺陷；加 glob 反而破坏「选型后只装对应卡」 |
| N1 | **benchmark 装载饥饿（新发现，本轮最重要）** | 未立案 | 先跑一次 topic-proposal 真实装载出 missing 收据；属实则其 benchmark 消费改 pool/where 精选（R8 机制现成）或按需 kb_search 化 | 28 卡对标库在唯一消费 op 里排在 29k 字 aesthetic glob 之后，9000 字 first-fit 下近乎全灭——纸面消费、饥饿装载 |
| N2 | topic-chief-aesthetic 语料裸奔（新发现） | 未立案 | knowledge 补 `kb/benchmark/*`（或题材精选子集） | 审美终审 rubric 明写「以对标已出品爆款为强度标尺」，对标库在库却不引 |
| N3 | lint/affinity 豁免口径三件套（新发现） | 未立案 | kit-lint + kb-affinity 增三类豁免：目录可达（id 级互引覆盖）/ stage:meta / 人工链路证据件；另立工具票 | 六母型、flow-synthesize、semif 报告三类「孤儿」各有正当形态，长期挂账淹没真异常 |
| N4 | scene-breakdown 双胞胎语料零分化（新发现，kit-lint W8 在账） | 未立案 | 显式记账「同语料双 op 属意」；或给 drama 份补拍摄向语料（visual-poster） | plot 分场与 drama 分镜同技能同六卡，分化若真存在应落在语料面而非仅 prompt |
| N5 | orchestration-miner.md 示例引不存在卡（新发现，textual 悬空） | 未立案 | 修正示例 id（`kb/trope/saturation` → 盘上实存卡） | 示例数据陈旧，照抄示例会写出踩空引用 |
| N6 | topic#topic-report 硬编码 2 张梗卡（新发现） | 未立案 | 改 pool 声明或记账「刻意精选」 | 梗族库 generated 滚动重建，硬编码清单会陈旧；且它是 spine 锚、四线 m1 都跑 |

建议优先序：**N1（先出实测收据）＞ T6/T3/N2（两行级改动，补齐监管位与人工门）＞ T1/T2（死声明摘除）＞ N3（工具票）＞ T4/T5/T7（记账维持类，可不裁）**；N4/N5/N6 随手级。

> **2026-10-11 用户裁决注入**：①kit 纯粹化——不参与流程/契约/裁断，只提供知识。据此 **T6 改判「留库备用、不接线」**（交付对账属流程，归宿主）；pinax 采集表中 BeatPlan 管道、stop-boundary 程序复核、协议增强三类出清，只采方法论知识面；T3 人工门不违纯粹化（门是留人裁，红线 4），两案仍归用户。②其余基本同意。③硬要求：**整体质量可证提升**。

### 批次3c · 质量提升（2026-10-11 追加，按上裁决开工）

> KB 增双层组织：**板块 track**（人工职能维度：文风/编剧/立意/选材/情绪/连续性/通用，落卡面 frontmatter，additive）+ **聚类标签**（算法语义维度，kit-compile 编译期计算进产物不回写卡）+ **基于聚类的聚合索引**（kb_search 聚簇检索）。

| 包 | 内容 | 验收 |
| --- | --- | --- |
| R1 装载修复 + 质量基线 | N1 benchmark 饥饿装载实测出 missing 收据→属实则修复（pool/where 精选或 kb_search 化）；`tools/kb-eval.py` 探针评测 harness（MRR/recall@k）出 **before 基线收据** | missing 收据落盘；基线可复跑；N2 顺手挂 benchmark 知识 |
| R2 双层组织 + 聚合索引 | track 字段批量补（正文零改写）；kit-compile 编译期聚类（stdlib 词面 n-gram TF-IDF+凝聚聚类，簇标签/簇名进产物）；kb_search 聚簇检索；kb-graph-page 簇着色；kb-health 板块/簇视图 | **after 评测 ≥ before（硬门槛，不达标不上线）**；立意组空白确认入补缺清单 |
| R3 习惯通道 + 清单终版 | 习惯提炼通道（成稿/会话→习惯卡草稿→人审落库；user-style-rules 纳入板块视图）；T/N 终版表（T6 改判等纯粹化过滤落地）；立意组草稿题目清单（C 类待审） | 习惯卡草稿样例≥1；终版表用户可逐条回拍 |

## 五、每期通用纪律

1. **契约先行** —— 无 schema 不写实现
2. **测试不回归** —— core 433/434（r8-os02cd 环境例除外）+ storyharness 148/148 是每期底线
3. **报数必附收据** —— 无收据 = 删声明
4. **提交可 revert** —— 每期独立提交
5. **CI 绿才算完成** —— tsc 0 错 + 全量测试 + 三 lint 0 error
