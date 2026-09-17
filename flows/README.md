# flows/ · 工作流目录

> 形态：flow@1 描述符（format + inputs + graph，用户可读硬约束）。执行 = harness 任务包循环（`flow_run / flow_next / flow_submit / flow_resume`），宿主 Agent 用自己的 token 执行认知步，core/minitool 步在 toolkit 进程内零 token 执行。

## 图示

- 总览页（浏览器打开）：**`flows/graphs.html`**（flow 分页 + 「世界书体系」独立页签：双变体模板/结算五件/各项目实况，节点按步型着色，产物节点带圆点标记，条件/可选边为虚线；悬停节点看 skill/minitool 详情）
- 每条 flow 目录内：`graph.svg`（静态图）+ `graph.mmd`（mermaid 源，Obsidian/GitHub 直接渲染）
- 再生成：`python3 tools/render-flow.py`（确定性，零依赖；flow.json 改动后重跑即可）


## 命名规范

- **flow = 一条端到端生产线**（有独立交付物）；stage 是 flow 内部的段落，验收门是段落间的关卡。**不为一个 stage 单开 flow**；
- 可复用能力段封装为 **Stage 包**（stages/<id>/，stage@1：命名/版本/适用品类/可导入/市场分发）——选题 Stage 同时适用剧本与小说；文笔润色、格式规范、上架审核同理；flow = Stage 拼接，**不为 Stage 单开 flow**；
- 命名 = `<交付品类>-<形态/平台变体>`（小写连字符）：novel-fanqie（番茄快餐网文）、episode-script（单集剧本）；
- **id 一经发布即冻结**（项目 state 绑定 + 测试 fixture 引用），语义变化只改显示名（title/displayName）并在 changelog 记录；换 id = 新 flow，不是改名。

## 流水线地图

```text
                       ┌────────────────────────────┐
                       │  book-deconstruct（工具线）  │
                       │  拆书 → KB 候选 → 人工入库   │──┐
                       └────────────────────────────┘  │ 供给 benchmark/trope/archetype
                                                          ▼
用户需求 ──► 短剧成稿线 topic-selection v5（id 沿用历史，现为端到端生产线）──────────► outline-production（编排线）──► episode-script（剧本线）
            市场/找梗/组合校验/热点/分析             分集功能表/卡点表/红队冷读        逐集流水：台账切片→分拍→
            →方案五节+前三章剧本→红队→交付            →死点提案→人工门                 断言+台账双校验→红队抽检

独立形态线：novel-longform（长篇网文）── 开书 → 卷纲 → 逐章流水（同一台账/断言/红队机制）
```

| flow | 版本 | 状态 | 上游 | 说明 |
| --- | --- | --- | --- | --- |
| `topic-selection` | 3.0.0 | **可联调** | 用户需求 | 升级点：梗组合相性校验（core）、结构级去机味（ai-trace）、产物对齐剧本范围——选题方案五节 + 前三章详细剧本（拍级三件套）；第一阶段到剧本为止 |
| `outline-production` | 0.1.0 | draft | topic-selection | 分集大纲与编排三表；大纲级红队冷读者测试 |
| `episode-script` | 0.1.0 | draft | outline-production | 逐集流水：台账切片→分拍写作→断言+台账双校验→原子提交→红队抽检 |
| `book-deconstruct` | 0.1.0 | draft | （工具线） | 拆书六槽位→KB 候选条目→人工确认入库；喂养 benchmark/trope/archetype 层 |
| `novel-longform` | 0.1.0 | draft | 用户需求 | 长篇网文形态：三层问答开书→卷纲→逐章流水；台账+断言+红队同机制 |
| `novel-fanqie` | 1.0.0 | **可联调** | 用户需求 | 番茄快餐抽象线：热梗选题（gate-r1）→开书→章纲（红方 agent 复核非门）→三章成稿→去AI味终稿（gate-final）；两道用户门，中间不打断 |

## draft 条例

1. `status: "draft"` 的 flow 结构与绑定关系已评审，**M1 运行时就绪后联调激活**；激活时去掉 draft 后缀并升 0.2.0。
2. draft flow 引用的 minitool 若未实现（如 `continuity_slice / continuity_commit`），在 `harness.note` 中标注依赖；实现规格见对应 KB 条目（`kb/continuity/state-ledger`）。
3. 全部 flow 共享四条铁律：**裁决权默认人工**（`allow_agent_verdict: false`）、**block 断言清零才收稿**、**正文与台账原子提交**、**红方意见书是验收门必读件**。

## minitool 依赖清单（flows 引用 → 实现状态）

| minitool | 引用方 | 状态 |
| --- | --- | --- |
| `kb_load` | 全部 flow | M2 实现（规格：按 ID/glob 取件注入任务包） |
| `kb_search` | book-deconstruct、find-trope | M2 实现 |
| `check_trope_combo` | topic-selection、find-trope、deconstruct-book | M2 实现（相性/禁忌来自 KB 条目 meta） |
| `check_aesthetic_asserts` | outline/episode/novel/deconstruct | M2 实现（断言表 66 条，输入产物 → 逐条三态报告） |
| `render_html` | topic-selection | M3 实现（v3 `sm.topic-delivery` 模式通用化） |
| `continuity_slice` / `continuity_commit` | episode-script、novel-longform | M2 实现（规格：kb/continuity/state-ledger 五类台账） |
