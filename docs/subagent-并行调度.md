# subagent 并行调度 · 宿主对接语义（M1.5）

> 内核职责：**派发就绪批 + 标注角色剖面**；宿主职责：**按剖面 spawn 对应 subagent**，收产物后 `flow_submit` 回交。
> 决策日志 #6 依然成立：任务包 = subagent 的全部工作上下文；磁盘真相 > 任何代理的会话记忆。

## 一、角色剖面（agents/*.profile.json）

| 剖面 | role | 主技能 | 隔离策略要点 |
| --- | --- | --- | --- |
| `scene-screenwriter` | screenwriter 编剧 | topic-proposal / script-drama-beat / scene-breakdown / script-final | 读全部生产上下文与批注回流 |
| `plot-redline` | red-reviewer 审核红方 | plot-redline | **journal 读侧拒绝生产推理与前轮回应**——防被同化/锚定；裁决建议仅供人工参考 |
| `story-analyst` | analyst 分析师 | topic-analysis-report / internet-feel / topic-zeitgeist / find-trope | 只读研究侧历史 |
| `story-choreographer` | choreographer 编排师 | structure-design / plot-choreographer | 结构决策史可读 |

剖面契约：`contracts/agent-profile.schema.json`。内核解析顺序：**节点显式 `profile` > 技能反向匹配 > 角色族缺省**。任务包携带 `profile` 投影（含 `journalReadPolicy`）。

## 二、派发循环（宿主实现要点）

> **M1.5 起的硬规矩（派发质量分析 R1 后生效）**：宿主**禁止手写「必读」清单**——spawn prompt 只能用 `flow_next --spawn-prompt`（或 MCP `spawn_prompt=true`）返回的 `spawnPrompt` 原样，它由内核从任务包渲染，含角色/项目背景卡/工具纪律/工作指令/交卷要求/禁止项六段。子代理交卷摘要首行必须复述「项目/阶段/交付物/受众」四要素，不符即弃稿重派。

```text
flow_next(project, {spawnPrompt:true})
  → awaiting_input { taskPackage, spawnPrompt, batch? }
     spawnPrompt = 派发头（角色剖面 + 背景卡 + 指令 + 交卷 + 禁止项，渲染自任务包）
     batch[] = 同批就绪的认知步（AND-join：全部活跃上游 done），逐项带 spawnPrompt
  → 宿主为每个 entry spawn 一个 subagent：prompt = entry.spawnPrompt 原样
  → subagent 产出 → flow_submit(project, nodeId, {content})
     内核以 LockDir 串行化并发提交；完整性断言 + 词汇表守卫不过 = rejected 打回
```


并行规则：
1. **同批可并行**：编剧写下一批场景与分析师跑热点互不依赖时，batch 一次给两个任务包，宿主各开一个 subagent。
2. **门是同步屏障**：AND-join 保证并行分支全部 done 后门才开启——审核在所有人交卷后才开始。
3. **审核隔离**：红方 subagent 的 system 种子里带 `journalReadPolicy`，宿主必须据此裁剪其可见 journal 切片（这是"冷读"的技术保证）。
4. **裁决权在人**：任何 subagent（含红方）的 verdict 只是建议；`flow_gate` 只接受用户输入。

## 三、重跑与缓存（配套语义）

- `flow_rerun {nodeId, dryRun:true}` → `{scope, cacheCandidates}`：确定性 core 步输入指纹未变者为缓存候选；
- 真跑时**执行时判定**：core 步 stale 后若上游重跑产物字节未变 → 缓存命中跳过重算（journal 记 `缓存命中`）；
- **认知步永远真重做**——send-back 后的创意重做本身就是目的；rerun 目标节点强制重跑；
- 门永不跳过：范围扫过门时重新挂起等裁决。

## 四、词汇表守卫（配套语义）

- 约定：`projects/<id>/词汇表.json = {project, own: [专名…]}`；
- 提交产物时，他项目 own 词命中即 **glossary block**（实证事故：守堤人「长河」串进拍魂）；本项目 own 词包含的词豁免（青川 ⊂ 青川河）；
- 未登记词汇表的项目守卫不启用——新项目开跑后应尽快登记 own 词表。
