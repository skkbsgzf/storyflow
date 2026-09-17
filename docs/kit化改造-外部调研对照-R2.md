# kit 化改造 · 外部调研对照 R2

> 触发：用户同步来两份材料——① 一份「写作 AI 项目调研 + Writing Harness Toolkit 规范设计」（离线产出，纯训练知识）；② 指向会话 `sess_d28c3ca7`，评价「特别是这个任务，我怎么弄他都很低效」。
> 承接：`docs/kit化改造-定向调研-R1.md`（同目录）
> 日期：2026-09-17 ｜ 一句话：**这份材料不该当分类依据，该当每个 kit 的内部结构——它和我 R1 提的域轴是正交的两条轴。**

---

## 一、先回答"为什么低效"：`sess_d28c3ca7` 体检

会话日志落在 `~/.zcode/cli/rollout/model-io-sess_d28c3ca7-*.jsonl`（51 MB / 272 条完整请求-响应）。逐条解析后的画像：

| 指标 | 实测值 | 判读 |
| --- | --- | --- |
| 模型调用 | **272 次**，跨 **11 个 turn**（每 turn 24.7 次） | 单 turn 内调用密度极高 |
| 模型档位 | **272/272 全部 GLM-5.3-Flash（lite 档）** | 违反 AGENTS.md「模型档位纪律」——架构与技能判断全在轻量档执行 |
| 累计 input | **57,306,227 tok** | — |
| 累计 output | 248,088 tok | **输入:输出 ≈ 230:1** —— 它在"读"，不在"产" |
| 上下文增长 | 62k → **374k tok**（单调不降） | 无任务包切割，每轮重放全史；末段单次调用已 374k |
| 工具面 | **25 个工具全开**（263/272 次调用） | 与 R1 报告 R3「工具面全开」同病 |
| 工具调用 | 270 次：**Bash 122** / Edit 41 / Read 39 / Write 34 / TodoWrite 16 / WebFetch 10 / WebSearch 8 | Bash 占 45% |
| Bash 用途 | **81 次是内联 `python -c`** | 其中开头连续 6 次都在**解析自己的 rollout jsonl** |
| 累计耗时 | 114.2 min | 1 次 60 s 超时（call#31） |
| 实际动作 | Edit `prose-scan.py` ×8 / `kernel.ts` ×4 / `novel-judge.md` ×4；Write 第1/2章；WebSearch ×8（断网失败） | 是"改内核 + 改技能 + 写正文 + 自我取证"的混合会话 |

### 三条低效机制（都可修，且都指向本次 kit 化）

1. **确定性分析动作没有被工具化** → 81 次内联 python，其中反复手搓同一件事：解析 rollout jsonl、统计 token、算分布。**每次重写一遍脚本**，脚本本身又进上下文。→ 这正是 kit 化里 **engine kit 该收的第一等公民**：`rollout-forensics.py` / `session-stats.py` 一条命令出这份体检表。
2. **没有任务包切割** → 上下文 62k→374k 单调增长，24.7 次/turn 的调用都在重放全史，输入输出比 230:1。→ 对应 R1 报告的 K1/K2（背景卡 + 派发头）；把"改内核""改技能""写正文"拆成三个独立任务包，输入量掉一个数量级。
3. **档位与工具面双重失控** → 全程 lite + 25 工具全开。→ AGENTS.md 已有纪律（模型档位 / K3 工具面最小化），但**没有执行点**。

---

## 二、那份材料的定位：它是"机制轴"，不是"分类轴"

材料提议的顶层结构是六层：`generation / validation / world-state / iteration / orchestration / io`。

**这是按"机制类型"分的轴，不是按"创作工种域"分的轴。** 它回答"一个能力是生成、是校验、还是状态读写"，不回答"这个能力属于找素材、编剧情还是写文笔"。

对照 R1 §二已列出的**七个既有分类轴**——材料的六层会变成**第八个轴**（机制类型）。而且它和仓库里已有的分类**高度重叠**：

- `validation` ↔ 已有的 minitool `impl: check-*`、74 条断言、`prose-scan.py`
- `orchestration` ↔ 已有的 `flow@1` + 内核七动词 + gate
- `io` ↔ 已有的 `tools/*.py` 文件侧
- `iteration` ↔ 已有的 `flow_rerun` + `novel-deai` 多轮精修内环 + `kb/method/revision-loop`

也就是说：**材料的六层里有四层仓库已经有了，而且实现得更深**（见 §三）。

### 但它的贡献是真的：六层正好该做「每个 kit 的内部结构」

R1 里我提出的四个待修正问题，其中 **P1（tool kit 与前三类不同轴）** 的解法就在这里：

- **对外**（flow 编排看得到的一层）＝ **域轴**：search / plot / canon / prose / review / delivery
- **对内**（每个 kit 的成员怎么组织）＝ **机制轴**：就是这个材料的六层
- **跨域**＝ engine 底座（确定性工具，不属于任何域）

两条轴正交，各管一层，**不是二选一**。材料把机制轴放到顶层，所以它必然和 repo 的 L1/minitool 打架；放到 kit 内部，它立刻变成有用之物。

---

## 三、逐模块对照：材料提议 vs 仓库现状

| 材料模块 | 仓库现状 | 判定 |
| --- | --- | --- |
| `ConsistencyChecker`（人物/时间线/地点/设定/因果） | `kb/continuity/state-ledger` 五类台账 + `layer-canon` 设定官（知情范围/台账增量/人设矛盾）+ `worldbook.py check` + `continuity_*` minitool（**planned 未实现**） | **已有骨架，缺执行**：台账是"人写进层稿"，无自动抽取与机械校验 |
| `StyleLinter`（词/句/修辞/段落四层） | `tools/prose-scan.py`（236 行）已扫：slop 词表、节奏词（突然/仿佛/似乎 ≤2）、`不是A而是B` 正则、cliché 词典、明喻与文言壳配额 | **已有且更贴中文**：材料的 StyleGuide 接口更结构化，可借其**形制**，不必重写 |
| `ReadabilityScorer`（Flesch-Kincaid 等） | `pacing-density` + prose-scan 的句长统计 | **部分**：西文可读性指标对中文快餐网文意义有限，不建议照搬 |
| `PlotLogicValidator`（情节逻辑） | 74 条 `AE-*` 断言（hook/density/card/conflict/end/reversal/meme…）+ `check_aesthetic_asserts` | **已有且更强** |
| `EditorAgent`（多维度评审） | `plot-redline` 四视角代入（目标读者/一般读者/资深编剧/甲方）+ `novel-judge` + `first-reader` 盲读内环 | **已有且更强**：材料是"打分器"，仓库是"换人代入" |
| `validation_pipeline`（CI 式管道） | `flow_submit` 校验链（Schema → 硬断言 → 完整性 → 词汇表守卫 → 注册/快照）+ `flow-verify` | **已有且更强** |
| `human_gates`（人工审批点） | `gate-r1…r5` + `quality.allow_agent_verdict:false` **由运行时强制**，agent 无动词可绕 | **已有且更强** |
| `workflow.json`（阶段/迭代/审批声明） | `flow@1`：就绪批并行（AND-join）、iterate 节点（节点=工种/实例=一次执行）、门为同步屏障、`flow-lint` 静态校验 | **已有且更强**；材料的 schema 缺门强制、缺 iterate、缺并行语义 |
| `generation_history.json` + `rollbackTo` | `registry/artifacts.json` + `snapshots/<node>/r<N>/`（内容哈希）+ `journal.jsonl`（可回放）+ `flow_rerun` | **已有且更强**（内容寻址 vs 版本号） |
| `world_state`（JSON 注册表） | 世界书体系（词条/台账/章账）+ `worldbook.py`（init/check/tree） | **已有**：非图谱、无向量，但对当前体量够用 |
| `fact-extractor + vector store`（LAURA） | 无。台账增量靠 `layer-canon` 手写 | ⚠️ **真缺口（半）**：见 §四 |
| **World Info 触发注入**（NovelAI） | **无**。`layer-canon` 的 inputs 是「World Book **全量**」 | ⚠️ **真缺口**：见 §四 |
| **经验库**（Reflexion） | **无**。教训以一次性文档存在（`subagent-派发质量分析-R1.md`、`绕流改稿事故分析-R2.md`），不可检索、不进上下文 | ⚠️ **真缺口**：见 §四 |
| 分层检索（HiRA 三层） | 无检索。`assembler` 是「上游产物摘录 + kb 装载」，`kb_search` 为 **planned** | ⚠️ **真缺口**：见 §四 |
| `context-manager`（摘要压缩） | `assembler` 只有 `clip()` 截断（上/下游产物均摊 800 字/件），非分层摘要 | **部分**：截断会丢中段，是当前上下文质量隐患 |
| `contrastive-decoder` | 无，且 **架构前提排除**：harness 模式零模型调用，token 全由宿主出 | ❌ **不适用** |
| `MenuBank` 三分记忆（情景/语义/程序） | 情景 ↔ journal；语义 ↔ 世界书词条；程序 ↔ 文风档/slop-list | **已映射**：材料只是给了命名 |

---

## 四、三个真缺口：值得从材料里吸收的

| # | 缺口 | 为什么值得做 | 落点 |
| --- | --- | --- | --- |
| **G1** | **关键词触发注入**（World Info 式懒装载） | `layer-canon` 拿的是「World Book 全量」——《诡秘之主》级全本跑起来，世界书会先把预算吃满，然后写手看到的还是被 `clip()` 截断的中段。触发注入＝按本章实体的词面命中注入对应词条，**这是当前预算矛盾的正解** | canon kit 的 `world_state` 机制面；与 R1 §六 的 canon 域合并做 |
| **G2** | **检索式取数**（含分层：大纲层/段落层/事实层） | `kb_search` / `kb_read` 至今 planned，5 个技能绑了 `kb_search`（触达即 blocked）；写手取数靠宿主考古。分层检索是 HIRa 的可借鉴处——不同粒度检索不同层 | engine kit 的 L1 工具 + assembler 增强 |
| **G3** | **可检索经验库**（Reflexion 式） | 仓库已有三份高质量事故复盘（R1 派发质量 / R2 绕流改稿 / 本 R2 的会话体检），但它们是**文档**：不进上下文、不按情境检索。而 §一 的诊断证明"没工具就每次重来" | 新增 `kb/experience/*`（typed entry）＋ 在派发头按节点类型注入相关教训 |

---

## 五、三个不建议采纳（写清楚原因，免得日后反复）

1. **contrastive decoding（双模型对比解码）**——harness 模式的硬前提是 `toolkit 零模型调用、token 由宿主出`（蓝图 §九-2）。引入它等于破前提，且需要两个模型同时在线。
2. **用材料的 `workflow.json` 取代 `flow@1`**——材料的 schema 是直线流水线思维：没有门的人工裁决强制、没有 iterate 实例语义、没有 AND-join 就绪批并行、没有静态校验。**仓库现有的是超集**，回退会直接丢失 R2 事故后加固的纪律。
3. **照搬 readability 指标**——Flesch-Kincaid / TTR 等为英文设计；中文快餐网文的质量轴是"节奏地形 + 钩子密度 + 梗存活"，仓库的 `pacing-density` + prose-scan 句长统计更贴靶心。

---

## 六、材料最大的盲区：验证链只校验「文本」，不校验「谁改的」

材料的 validation_pipeline 全部作用于文本内容：语法 → 一致性 → 风格 → 评分。但仓库用血换来的教训是另一件事：

> `docs/绕流改稿事故分析-R2.md`：S4 三次改稿**没有一次走 flow**，全部直接改文件 + 补拍快照；交付头虚报"全稿过扫描"。事故不是靠工具发现的，是靠甲方人眼揪出一句排比。盘点结果：13 处黄档 / 4 处红档，**无一曾触发报警**。

**写作 harness 的真正"编译器错误"不是句子没写好，而是产物绕过了验证管道却获得了合规外观。** 所以必须保留并强化仓库已有的这一层：注册表内容哈希（K7b 待做）、`flow-verify` 漂移探测、收据纪律（声称"已扫描"必须引用落盘收据）。

材料若被原样采纳，这一层会整个消失——**这是我不建议以它为主干的最硬理由。**

---

## 七、综合结论：kit@1 加一个 `facets` 面

把材料的贡献落进 R1 的模型：

```jsonc
// kits/canon/kit.json —— 域轴在顶层（对外），机制轴在 facets（对内）
{
  "format": "kit@1",
  "id": "canon",
  "name": "设定与连续性 kit",
  "axis": "domain",
  "members": {
    "skills":    ["world-forge", "novel-bible"],
    "knowledge": ["kb/continuity/worldbook", "kb/continuity/state-ledger"],
    "minitools": ["continuity_check", "continuity_slice", "continuity_commit"],
    "profiles":  ["story-analyst"]
  },
  "facets": {                                  // ← 材料六层落在这里
    "generation":  ["world-forge", "novel-bible"],
    "validation":  ["continuity_check", "worldbook-check"],
    "world_state": { "read": "kb/continuity/*", "write": "台账增量",
                     "inject": "trigger-injector（G1 新增）" },
    "iteration":   { "policy": "打回分场卡，不在正文层圆谎" }
  },
  "ops": [ /* 工种面，见 R1 §五 */ ]
}
```

flow 节点仍只引用 `{kit, op}`——**编排者永远只看到域轴，机制轴是 kit 的实现细节**。这样：材料有用、分类不增轴、P1（tool kit 不同轴）自动解决。

---

## 八、修正后的落地顺序

| 批次 | 内容 | 变化 |
| --- | --- | --- |
| **K1 装载复位** | `buildTaskPackage` 真正装载知识（R1 §三-3.1 的断路） | 不变（最高优先，纯收益） |
| **K1.5 会话取证工具化**（新增） | engine kit 收 `rollout-forensics.py`：一条命令出 §一 那张体检表（调用数/档位/工具分布/上下文曲线/输入输出比） | **来自 §一 诊断**：81 次内联 python 的替代品；以后每次"觉得低效"都能十分钟定量 |
| **K1.6 经验库入库**（新增） | 三份事故复盘 → `kb/experience/*`，按节点类型在派发头注入 | **来自 G3** |
| **K2 声明收敛** | `kits/**/kit.json` + `{kit,op}` 引用 + `facets` | 增加 facets |
| **K3 分类定轴** | 域轴定案（R1 §六 5 域 + engine 底座） | 不变 |
| **K4 缺口补位** | G1 触发注入（canon kit）→ G2 检索分层（engine + assembler） | **来自 §四** |

---

## 九、待你确认

1. §一 的三条低效机制，与你体感是否一致？（尤其"确定性分析没工具化"和"全程 lite 档"这两条）
2. 材料按 §三/§四 处理——**吸收三缺口、拒绝三项、六层降为 kit 内部 facets**，认可吗？
3. §六 那条"验证链必须管权限不只管文本"，是否作为不可退让项写进改造约束？
4. 是否要我先把 **K1.5（会话取证工具）**做出来？它是纯增量、不依赖任何待拍板项，而且做出来当场就能复核 §一 的数字。

---

## 附 · 复现 §一 体检

```bash
python - <<'EOF'
import json, collections
p = r"C:\Users\Administrator\.zcode\cli\rollout\model-io-sess_d28c3ca7-5bb2-419b-aa59-3725ceded6ed.jsonl"
rows = [json.loads(l) for l in open(p, encoding="utf-8") if l.strip()]
u = lambda d: (d.get("response") or {}).get("usage") or {}
tin = sum(u(d).get("inputTokens", 0) for d in rows)
tout = sum(u(d).get("outputTokens", 0) for d in rows)
print(f"调用 {len(rows)} 次 | input {tin:,} | output {tout:,} | 比 {tin//max(1,tout)}:1")
print("模型:", collections.Counter((d.get("model") or {}).get("modelId") for d in rows))
tc = collections.Counter(t.get("name") for d in rows for t in ((d.get("response") or {}).get("toolCalls") or []))
print("工具:", tc.most_common())
EOF
```
