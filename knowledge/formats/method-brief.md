---
{
  "id": "kb/formats/method-brief",
  "type": "format-standard",
  "title": "编排交底标尺（工具账·手法账·情节曲线账，随大纲交付）",
  "dimension": "format",
  "version": "1.0.0",
  "status": "active",
  "applies_to": ["comic-drama", "short-drama", "long-form"],
  "routes": ["all"],
  "provenance": {
    "source": "client-feedback",
    "refs": [
      "甲方口径 2026-09-23：「你之前的编排技巧并没有用到很多的 skill……每次通过 MCP 起这个服务的时候，把你用了哪些工具、用了哪些手法、怎么设计的情节曲线，跟随故事大纲一起交付」",
      "SkillRouter 包 tools/skillrouter/（route 排序 + report 回填 execution_history）",
      "内核命中率口径 core/src/metrics.ts::extractCtxUsage（字面 + 概念签名词，唯一事实源）"
    ]
  },
  "updated": "2026-09-23"
}
---

# 编排交底标尺

**标尺**：大纲交卷时必须随一件「编排交底」，回答甲方三个问题——**用了哪些工具、用了哪些手法、情节曲线是怎么设计出来的**。本件是**台账的汇总，不是 agent 的自述**：每个数字都要能追到一处磁盘台账，追不到就直书「查无」。

## 一、三账必填

| 账 | 必填内容 | 事实源（唯一） |
| --- | --- | --- |
| **工具账** | 本节点跑过哪些 tool（kit.op）、派发/交卷各几次、完整性检查 pass/block/warn、config 旋钮实际取值与来源；内核动词调用（次数/失败/墙钟/通道 CLI 或 MCP）；SkillRouter 的**建议 vs 实际**（adoption_rate、越权改用、建议未用） | `projects/<id>/registry/metrics.jsonl`｜`trace/cli.jsonl`｜`$SKILLROUTER_HOME/execution_history/` |
| **手法账** | 装了哪些标尺卡（`op.knowledge` 声明 vs 派发实装，两者不一致要报漂移）、产物真正吃进哪些（命中判定）、**装了没用的**逐条列名并说明为什么、同域可用而未用的手法 op 清单 | `modules/<kit>/module.json`｜metrics 的 `ctx.ids/ctx.hitIds`｜`extractCtxUsage` 重算 |
| **情节曲线账** | 曲线/节奏类标尺是否命中及其签名词依据；产物正文里关于曲线主型·换轨点·节拍分段的**原文回指（带行号）**；影响曲线的决策（取值 + `by` + `evidence`，无 evidence 直标「无据」）；曲线相关旋钮取值 | 同上｜交付物正文｜`projects/<id>/decisions/*.json` |

## 二、查无口径（本件的核心纪律）

- 台账不存在或为空 = 写 **`查无：<为什么没有> + 怎么补齐`**，禁止用形容词（"充分运用""精心设计"）填空，禁止把"没记账"说成"没用过"。
- 命中率只报**字面 + 概念**这一套口径（内核定义），禁止在交底件里另发明第二套命中判据。
- `route` 只出建议、`report` 才落账：**没调 report 就没有调度账**——这时曲线账照写，工具账 1.4 写查无。
- 数字与文字冲突时以数字为准；正文回指只摘录原文，不改写、不概括后冒充原文。

## 三、产出与形态

- **人写不算交付**：本件只能由 `delivery.method-brief`（`tools/method-brief.mjs`）产。agent 或人要补解释，只能写进第六节「补充说明」，一行一条、**必须署名且指回第五节某一条账根**，否则视同自述（铁律 10）。
- 两条入口，同一套账：
  - 手工：`node tools/method-brief.mjs --project <id> --artifact <项目内相对路径> [--node <id>] [--quote-cap <n>] [--route-home <dir>] [--no-upstream]`
  - flow 节点：内核 script 壳 spawn（JS 壳走 `node`，位置参数 = 上游 md + 本节点 output，附 `--node/--flow/--config`；`config` 里 `@default:key` 哨兵按「未调过」回落默认）。
- 落位：手工口径 `交付/编排交底-<产物名>.md`；节点口径 = 节点声明的 `output`（如 `<NN>-交付/编排交底.md`）。R6 头部八项齐全，`by: module/delivery.method-brief`；机器收据 `内部/收据/method-brief-<产物名>-<stamp>.json`（含 `gaps` 缺口清单——报数必附此件）。
- 旋钮（`modules/delivery/module.json` 的 `ops.method-brief.config`）：`upstream`（是否展开直接上游，默开）· `quoteCap`（正文回指行数上限，默认 16）· `routeHome`（SkillRouter 数据家；指错=调度账查无，不等于没调过）。
- 挂位：作为大纲/剧本交付节点的**同节点并产随件**或后置薄节点；改图属结构级，须人批（R5）。
