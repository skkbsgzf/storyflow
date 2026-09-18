---
artifact: 1
id: meta.orchestration-mine
class: opinion
node: mine
round: 2
version: v1
state: draft
at: 2026-09-19 03:50
by: skill/orchestration-miner
upstream:
  - registry/mine-package.json
  - registry/miner-findings.json
review: null
---

# 编排挖掘报告 · p-fq-001（novel-fanqie v2.2.1）

> 第二轮挖掘（run-mu3kjmhg-coltmb，journal 433 事件）。第一轮发现已并入 `_918test-自检报告.md`
> §五（P1-P3），本轮不重复；本轮 5 条 findings 全文见 `registry/miner-findings.json`，均有 journal 行级证据。

## TL;DR

项目最贵的问题不在写作质量本身，在**需求变更没有前置吸收口**：gate-r1 五连打回全是用户改题，每改一次 7 节点全量失效（stale ×93）。其次是 S4 的「细节/代入感」打回暴露**标尺饥荒**——novel-chapter 已装最接近的卡仍盲改 8 轮。另有 gate-final 悬置 40h+ 待人裁、绕流降级路径无工具、计量盲区记账三条。

## 发现清单（按严重度）

1. **[structure/high] 命题澄清缺位**——9-16 当日 gate-r1 五连 send-back（命题 v1→v4+流程重构），用户 pass 判词里自己总结的四问（新在哪/给谁看/话题度/爽点逆位）应是开工前的确认单而不是返工撞出来的教训。拍板：选题骨架前置命题确认步，或命题项目 overlay 置 gate-r1 manual。
2. **[quality/high] 代入感知识缺口**——gate-final 判词三项不满（细节不够/无代入感/不清晰）同属感官细节维度；novel-chapter 已装 scene-value+ai-trace，库内无更对口标尺。提案 patch（待批）：新建 `kb/aesthetic/sensory-detail` 卡并装入 novel-chapter。
3. **[structure/high] gate-final 悬置**——r25 终稿快照在、验收门开着，40h+ 无裁决（journal:430-431 后无 verdict）。人工动作：flow_gate 出裁决；机制侧建议 gate-open 超 24h 出 due 提醒。
4. **[coverage/medium] 降级路径无工具**——audit 2 分钟 rerun ×3 是绕流事故的手工补救；五步降级无单命令载体，虚报风险（R2 事故）未根除。拍板：`tools/amend-artifact.py` 工具化。
5. **[cost/medium] 计量盲区**——无 metrics.jsonl（先于 D 修复），不重拍，记账收敛。

## 拍板清单（需人点头，永不自动落地）

- [ ] 选题模块前置「命题四问确认」（结构）或 gate-r1 manual（策略）
- [ ] gate-open 超 24h due 提醒（内核增强）
- [ ] tools/amend-artifact.py 五步降级单命令化（tool 开发）

## 待批 patch（flow_optimize 已登记，--apply 需人工确认）

- M2：novel-chapter add_knowledge ← sensory-detail 新卡（先建卡再生效）
