# _918test 自检报告：命中率反推 · tool 改进措施 · flow 编排合理性

> 范围：验证层三项目全自动重拍（p-fq-001 / p-key-soul / p-ts-001，全部 completed）。
> 数据源：各项目 registry/metrics-summary.json、metrics.jsonl、journal.jsonl、_918test/ 标尺存档、本轮提交日志。
> 性质：编排挖掘师（orchestration-miner）剖面的 findings 证据化报告——只提案，结构类改动进拍板清单。

## 一、命中率总检（思维链/上下文命中）

| 项目 | events | 知识卡 | 命中卡 | 总引用 | 名义命中率 |
|---|---|---|---|---|---|
| p-fq-001 | 37 | 53 | 17 | 27/173 | 16% |
| p-key-soul | 40 | 49 | 13 | 20/192 | 10% |
| p-ts-001 | 48 | 49 | 13 | 20/179 | 11% |

**先说计量本身的三处失真（不看这三条，数字会骗人）**：

1. **标尺卡计量盲区（最重要）**：提交侧 `ctx.ids` 取自节点声明的上游 kb（如 内部/kb-market.md），**不包含 dispatch 注入的标尺卡 id**（metrics.jsonl 实证：tropes 派发 offered=8 含 13 张梗族卡中的 6 张，提交侧 ids 却是另外 4 个节点声明项）。后果：注入的标尺卡**永远测出 0%**，与产物是否真引用无关——本次梗卡明明在头部与正文引用了 dalian-nuezha 等 5 张卡，计数仍为 0。
   → **修法**：`flow_submit` 把该节点最近一次 dispatch 的 `ctx.ids` 合并进提交侧提取清单（内核 doSubmit 单点改）。修完后梗族卡的真实命中率才有意义。
2. **glob 当分母**：`kb/trope/*`、`kb/market/*`、`kb/aesthetic/*`、`kb/benchmark/*` 以通配符形态各占一条分母（永无命中）→ 注入侧应在派发时展开 glob，或聚合时排除 pattern 项。
3. **重试计入 submits**：find-trope submits=3 实为 1 次接受+2 次打回重交；topic-zeitgeist submits=5 同理。**retries 应单列**，否则 tool 效率 ω 的成本口径被打回污染。

**去伪后的真实图景**：

- **上游产物件 handoff 健康**：圣经/大纲/报告/小纲/终稿互引 hitRate 0.4-0.75，「下一章只读章账」交接语义成立
- **最优 tool**：plot.episodic-outline 4/4=100%、plot.world-forge 5/7=71%（世界书骨架模板天然可引用）
- **最差注入选**：plot.plot-redline offered 28-58 卡 / used 5-6——五道门共用一张全量注入清单，意见书这种结构化短文天然引用不了 58 张卡
- **共性黑洞**：kb/aesthetic/ai-trace offered 14-18 / used 1-2（每个成文步都注入，只有终稿真用）；13 张梗族卡全量注入 find-trope，实际引用 ≤5

## 二、逐 tool 改进措施

| tool | 本轮实测 | 改进措施 |
| --- | --- | --- |
| search.find-trope | submits 2-3（含打回），梗族卡 0% | ① 注入收窄：新增 config knob `tropeFilter`（按 direction 关键词/题材类型筛卡），13 张全量改 ≤5 张 ② 梗卡 rubric 显式要求「对标件」小节列 kb/benchmark id（benchmark filterBy 依赖） |
| search.material-dissect | submits=0（zeitgeist=false 跳过） | 被跳过时 byTool 记 `skipped` 显式态，别隐没（区分「没跑」与「跑了没交」） |
| search.topic-zeitgeist | p-ts submits=5 异常 | ① 重试单列 retries ② 离线/无检索环境时产物应带「降级口径」标注字段 |
| search.topic-analysis-report | ctxUsed 3-4/11-12，相对健康 | 第五节「约束移交单」与 kb/market/constraints 的对账给官方模板（本次手工对齐最耗时） |
| plot.plot-redline | offered 28-58 / used 5-6，注入最重产出最薄 | 按门裁剪注入：每道门的意见书只注入它自己要查的 4-6 条 rubric 卡；policy=降权时注入宽度联动再减 |
| plot.world-forge | ctxUsed 5/7=71%（最优） | 保持；多文件输出（圣经+index.json+条目）进 outputContract，断言覆盖全部产出而非仅主文件 |
| plot.episodic-outline | ctxUsed 4/4=100% | 保持；其标尺（structure/fastfood/pacing 直接可引用）可作为其他步的注入范本 |
| prose.novel-chapter | submits 8 / 3 章（4 次打回） | spawn 头部内嵌「提交前自查卡」：摘要行、章末钩表面信号词、排比/节奏词配额——把打回前置成自检（本次 4 次打回里 3 次可自检拦截） |
| check_trope_combo（core） | 静默通过 | 通过时 journal 留一行证据（现在只有失败可见） |
| check_aesthetic_asserts（core） | 拦截有效（章末钩 2 次） | audit 报告已落盘，保持 |
| prose.novel-deai / dialogue-polish / script-final | submits 1-2 | 正常；script-final 注意禁词表前置（见共性 2） |
| kb_load（core） | benchmark filterBy 工作正常（梗卡.对标件→装载 4 张） | 保持 |
| render_html（delivery） | 交付页正常 | 保持 |

**共性（跨 tool）**：

1. `headerTemplate` 只渲染 YAML 头，不含正文骨架——「标题后须紧跟 > 摘要」制造了本轮 **5+ 次打回**（最大单源）。模板应附 `# 标题` + `> 摘要` 占位骨架。
2. 任务包应下发「本项目禁词表」（他项目 own 词汇的投影）：本轮 glossary 打回 2 次（老周/思维链/魏峥），写手事前不知道雷在哪。
3. **enum 型 input 不吃项目配置**：两份 配置.json 都写 `route: "dual"`，state.inputs 落的是默认 `"hot"` → 双版本基线支线（kb/market 结构里唯一的对照实验）**两条线都没激活**。修 config→input 绑定（内核）。
4. 计量盲区与 glob 分母（见一）。

## 三、flow 编排合理性

### novel-fanqie（v2.2.1，单线+菱形+iterate）

- ✅ S1 五路并行+AND 汇流：发散步齐活再聚合，无饿死；combo 紧跟 tropes，相性失败即时反馈
- ✅ zeitgeist 门控（input 开关）：模板文跳过实时解剖，本轮实测有效
- ✅ chapter iterate 宿主逐实例提交 + `--seal` 收口：运行顺畅，committed 清零/回边谓词都对
- ⚠️ **audit 后置**：三章全部封口才跑断言——第 1 章的章末钩问题要等三章写完才暴露。合理性改进（结构类，需拍板）：audit 挂进 chapter 循环（每章提交后即时断言）或 iterate 每实例触发轻量 AE 检查
- ✅ polish 合并终稿 + gate-final 评审步：位置合理

### topic-selection（v5.1.2，五阶段菱形三出口）

- ✅ 五阶段入口/门/回退边显式编码，scope=本阶段，全程无死锁无饿死
- ❌ **baseline 支线失效**：`when route=dual` 依赖 enum input，而 enum 不吃配置（共性 3）→ 「双版本对照」这一设计目前是**声明的谎言**。修绑定前，要么 CLI 显式传 `--route dual`，要么把 route 从 enum 降为 string——需拍板选修法
- ✅ delivery 挂 gate-r5 之后自动渲染：收尾零人工
- ⚠️ 老项目（p-key-soul/p-ts-001）无 项目配置.json 时代欠账：本次包内补齐，开发层待同步

### 分层机制（验证层/开发层）本身

- ✅ 全程 `--root` 指向冻结包，开发层零污染；包内重跑→重生成页面→8430 即时可见，闭环成立
- ⚠️ dist 包 core 无 node_modules：本次借开发层内核 + `--root` 绕过；正式方案=打包时 `npm ci --omit=dev` 或包内 README 声明

## 四、拍板清单（结构类/内核类，需人批）

| # | 事项 | 类型 | 理由 |
|---|---|---|---|
| D1 | flow_submit 合并 dispatch 标尺卡进 ctx.ids | 内核（计量） | 不修则标尺卡命中率永久 0%，R5 §五主指标失真 |
| D2 | enum input 支持 config 绑定 | 内核（数据） | route=dual 失效 → 对照实验无法开展 |
| D3 | audit 前置进 chapter 循环 | flow 结构 | 断言反馈从「三章后」提前到「每章」 |
| D4 | find-trope/plot-redline 注入收窄（新增 knob 或按门裁剪） | kit config | 0% 长尾是注入过宽的直接后果 |
| D5 | headerTemplate 附正文骨架 + 任务包下发禁词表 | 派发器 | 消灭本轮 7 次打回中的 7 次（摘要行+禁词全部前置） |

## 五、低风险提案（flow_optimize 可自动并入）

- P1 topic-selection 两项目 overlay 追加 `set-input route=dual`（在 D2 修复后生效）
- P2 plot-redline 各门注入清单按门裁剪（set-tool knowledge 收窄，非结构）
- P3 find-trope 增 `tropeFilter` config 声明（kit.json config 表，kit-lint 可校验）

## 七、第一层改造落地（2026-09-19 追记）

本报告 §一 的结论「kb 标尺卡命中率 ~10%」经复核为**计量口径缺陷**，不是知识消费缺陷：
`extractCtxUsage` 只做字面 id 匹配（`text.includes("kb/trope/xxx")`），而小说/剧本正文
永远不会包含技术路径——31 张标尺卡结构性测出接近 0。头部 100% 命中也是假象：
artifact@1 头部本来就写着路径，量的是「头部格式正确」，不是「知识被用上」。

### 已落地（module-flow-v3 分支）

- **概念词命中层**（`core/src/metrics.ts`）：每张 kb 卡从 标题/小节标题/加粗词 生成签名词
  （CJK 2..4-gram + 整段 run + 拉丁词），全库文档频率（DF ≤35%，语料 <12 张不启用）滤掉
  跨卡万金油词；产物**正文**含任一签名词即计概念命中。字面层保留为保底。
  - 2-gram 须正文现身 ≥1 且全卡 ≥2 才保留（跨词边界碎渣如「物审/美标/级标」只出现一次）；
  - ≥3 字 n-gram 与整段 run 不做 TF 管制（保住「好感结算中」「白手套的复仇」这类只出现
    一次、却会原样落进产物的标志性短语）；
  - 拉丁词 ≥3 字符（全大写缩写放宽到 2），按词边界匹配（「na」不得命中「natural」）。
- **内核接线**：`kernel.ts` submit 相传 `{ root: repoRoot }`，新口径对后续运行自动生效
  （metrics.jsonl 为 append-only，历史事件保留旧口径记录，不回写）。
- **重检工具**：`tools/hitrate-recheck.mjs --project <id>`——按 artifact@1 头部 node/round
  对齐事件与产物，旧/新口径逐事件对照，输出知识族汇总与「双零名单」（改写型漏计下限）。
- **单测**：`core/test/metrics-concept.test.ts` 4 例（字面照旧 / 概念命中 / 无关不误报 /
  拉丁词边界）；顺手对齐 `flows.test.ts` 到 flow@3（图级检查跑 expandFlow3 派生描述符，
  产物准入加 `NN-模块名/`）。

### ccwd-fq 重检数字（同一批产物，两套口径）

| 口径 | kb 卡去重 | 事件摊开 | aesthetic | trope | craft | structure |
|---|---|---|---|---|---|---|
| 旧（纯字面） | 3/33 = 9% | 3/61 | 0/25 | 2/9 | 0/12 | 0/2 |
| 新（字面+概念） | 19/33 = **58%** | 24/61 | 10/25 | 6/9 | 4/12 | 2/2 |

新口径仍为 0 的 14 张卡是真实改写型漏计下限（如 hook-3s 的「开场钩子」——正文只是
*执行*了钩子，不会写出这个词），这批才是 §二 注入收窄提案（P2/P3）的真正输入。

### 后续（第二/三层，待排期）

- 第二层：module-lint 对 glob 展开 >8 张卡的注入点报 W（注入收窄）
- 第三层：metrics-summary 分层报告——结构命中（上游件）与标尺命中（kb 卡）分列，
  避免标题式「总命中率」继续掩盖两类信号的本质差异
