---
artifact: 1
id: meta.orchestration-mine
class: opinion
node: mine
round: 1
version: v1
state: draft
at: 2026-09-19 03:50
by: skill/orchestration-miner
upstream:
  - registry/mine-package.json
  - registry/miner-findings.json
review: null
---

# 编排挖掘报告 · ccwd-fq（caocao-wudalang flow@3 首跑）

> 第一轮挖掘（run-mu79dix0-k0fxpq，journal 77 事件 / R6 模块化 demo 全程）。
> 4 条 findings 全文见 `registry/miner-findings.json`，均有 journal 行级或代码行级证据。

## TL;DR

R6 首跑暴露的最硬问题在**能力四环断环**：交付终点 export-doc 无内核执行体，flow 停格在最后 1 个节点永不能 completed，且 module-lint 拦不住（声明层齐全）。其次是注入过宽（61 卡次 34 零命中，概念层重检后仍 14 张真实零消费）、AE-CONT-* 声明挂错层、语义断言在 auto 评审下零消费——后三条共同指向同一件事：**声明了很多检查，但没有一条真的被谁消费**。

## 发现清单（按严重度）

1. **[coverage/high] export-doc 无执行体**——journal 三次 warn（含一次前端按钮触发的推进），节点保持未执行。拍板：module-lint 增 E 级「spine op 必须有内核执行体」+ 补 export-doc minitool。
2. **[ctx/high] 注入过宽**——novel-deai 装 10 张 0 命中、novel-bible 带着未选中梗族卡跑全程。概念层重检（hitrate-recheck）把口径从 9% 修到 58% 后，剩余零命中才可裁。提案 patch（待批）：novel-deai 收到 ≤5 张、novel-bible 剔未选梗卡。
3. **[coverage/medium] AE-CONT-* 挂错层**——校验器按设计只对成文产物切片（aesthetic.ts:208），声明却挂在伏笔卡/拼装稿上必空转；章节正文三份章档反而零 submit 覆盖。提案 patch（待批）：挪声明到产出章节正文的 op。
4. **[coverage/medium] 语义断言零消费**——7 条 CURVE 系语义断言归评审，auto 评审步却交卷即 pass，三类门全部同秒过。「机器不装懂」是对的，缺「真的有谁读」。拍板：内核把 unverified 清单注入评审步任务包，或显式降权记账。

## 拍板清单（需人点头，永不自动落地）

- [ ] module-lint E 级：spine op 必须有内核执行体（minitools.ts / minitools.json）
- [ ] 补 export-doc minitool（docx 导出，复用 tools/export-doc.py 断言逻辑）
- [ ] 评审步任务包注入 unverified 清单（内核增强）

## 待批 patch（flow_optimize 已登记，--apply 需人工确认）

- N2：novel-deai knowledge 收窄 ≤5 张；novel-bible 剔未选梗卡
- N3：AE-CONT-* 声明挪至成文产物 op（module.json + kit.json 同步）

## ⚠ 口径警告：R1 自动提案批次暂不可 apply

optimize.json 里另有 52 条 R1 类提案（某卡装载 N 次、引用 0 次 → 建议删），由
proposeFromMetrics 按 metrics-summary 的**旧字面口径**自动派生。概念层重检已证明其中
多数卡真实被消费（character/conflict-escalation/highlight-loop/prose-constraints 均有
概念命中）——**批量 apply 会误删在工作的标尺**。处置：等 proposeFromMetrics 换新口径
（或逐条过 hitrate-recheck 复核）后再批。本次 2 条 miner patch（N2/N3）不受此影响：
它们依据的是重检后的数字。
