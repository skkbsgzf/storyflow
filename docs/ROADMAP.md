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
| P1 | 项目知识生产面 | 需求1 | project-init 骨架增 文风/、规则/ 目录＋卡模板（rule-card@1）；kit-compile --project 纳入两目录；校验标准声明位（project-config.schema 增 optional validation，additive 不破代数，消费随批次3） |
| P2 | kb-rag 亲和 + 图谱页 | 需求1/3 | 双根合并策略升级（同分项目优先、去重、k 分配）；tools/kb-affinity.py 卡↔消费者对账（孤儿卡清单收据）；tools/kb-graph-page.py 自包含力导向图谱页（kitapp 图谱交互的零依赖复刻：拖拽/缩放/悬停/分类图例） |
| P3 | 改相闭环 + 诊产物对齐 | 需求4 | contracts/repair-plan.schema.json（契约先行）；core mf_apply_repairs 工具（按 repair 策略产修订 diff，**不直接写盘**，B 级条款拒绝进入＝D5 决议）；tools/repair-apply.py 校验/投影；diagnosis-report@1 校验器；扫描器条款↔卡反向对账（无 id 体系则如实报不可对账，不硬造） |
| P4 | 收尾杂项 | — | 阶段动作清单（节点→rebuild/compile 约定）；minitools.ts 解释器可配置（python stub 治本尝试）；kit-compile --check 干跑；rules-init.py 字段保留/退役警示；文档收口 |
| — | 存量 ops 过堂（F） | 需求4 | module-lint 39 条 warning（meme_harvest planned、同槽多件）——随批次3 逐个归并或清退，不进本批次 |

## 四、批次3 · 缓做（架构重建后慢慢排期）

| 项 | 前置 | 说明 |
| --- | --- | --- |
| 本地快诊断服务化 | rule + diagnosis-report 契约；**laya 环境回填**（本机 `runs/` 权重与 `tools/_vendor/laya-venv` 缺位） | S 级确定性 <100ms；A 级 laya 学生头；静默追写默认保守（只标高置信 1–2 条）；绝不让大模型进静默链路 |
| 图文视频能力 | 声明式口径（规则进 KB，工具是执行器） | seedance 族按需求4 归并口径重建 |
| 拆 · 逆向 | rule 契约 | `deconstruct.schema.json` + 采样/归因/规则卡沉淀/复用回路 |

## 五、每期通用纪律

1. **契约先行** —— 无 schema 不写实现
2. **测试不回归** —— core 433/434（r8-os02cd 环境例除外）+ storyharness 148/148 是每期底线
3. **报数必附收据** —— 无收据 = 删声明
4. **提交可 revert** —— 每期独立提交
5. **CI 绿才算完成** —— tsc 0 错 + 全量测试 + 三 lint 0 error
