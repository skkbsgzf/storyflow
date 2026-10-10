# 规范-生产线预设-PP1 · Production Preset v1

> 「选一条生产线」的用户面（对标 DSH 用户 Preset：web novel / screen play / comfyui script / world bible / short story）。
> 预设 = manifest（适配哪些 flow）+ 每条 flow 一份可选 overlay——**全部用既有 flow-overlay@1 契约表达，不新增 patch kind**。
> 与断言预设（AP1，`assertion-presets/`，管门点拦控行为）是正交概念；本预设管「编排从哪条生产线走、裁掉/追加哪些模块工具」。

## 一、文件布局

```
presets/<id>/preset.yml              # manifest：name/description/flows[{flowId}]
presets/<id>/overlay.<flowId>.json   # 该 flow 的 overlay（完整 flow-overlay@1，schema 校验）
```

`flows` 里声明但无 overlay 文件 = 该 flow 按缺省流水线跑（web-novel / screen-play 就是这样）。

## 二、装载语义

- 选择入口：`kernel.flow_run(flowId, projectId, inputs, { preset: "<id>" })`；
  未知预设 → `INVALID_INPUT` 大声失败。选定后随 `state.preset` 持久（run-state schema v1.0.4 增补）。
- 生效编排合成序：**flow.json ⊕ 出厂 overlay.default ⊕ 预设 overlay ⊕ 项目 overlay ⊕ kit 边界派生**——
  预设是「出厂的可选变体」，插在出厂层与项目层之间，不新增任何优先级规则；
  项目运行时 overlay 仍能在它之上继续调。
- 预设 overlay 存在但非法（schema 不过 / flowId 不符）→ flow_run 大声失败——出厂随包的数据坏了
  必须响亮，「裁掉 m4」静默失效 = 用户拿到完整流水线还以为生效了，是最坏结局。
- 跨 run 一致性：preset 参与 overlayHash → 计划漂移检测自动覆盖（改预设文件 = 下次 advance 重编译）。
- 宿主枚举：`kernel.listPresets()`（broken 照常列出）。

## 三、flow@3 可用的裁剪/追加通道（勘察结论）

flow@3 展开器（modules.ts::effectiveFlow3）实际消费 `set-policy / set-module / insert-tool / set-tool / set-input / set-link` 六种；
`place-node / remove-node` 等是 flow@2 图语义。因此：

- **裁模块**：`set-module {id, remove: true}`（本版新增语义，与 caps 互斥）——模块间连接按剩余序重派生，
  无需手工补边；remove 不存在的实例进 unsupported（不静默）。
- **追加工具**：`insert-tool {module, tool, slot}`——**只能插目标模块自己 ops 里的 op**
  （启用集合 = spine ∪ capability∩caps ∪ 显式 insert，逐模块解析）。
  跨模块复用 = 把 op 注册进目标模块（本次：`render-prompt-seedance` 从 prose 复制进 drama.ops，
  bySkill 歧义台账记账，见 kits.test.ts）。
- **spine 永远启用**：caps=[] 裁不掉骨架工具——裁模块只能用 remove，不能用空 caps 表达。

## 四、随包预设

| 预设 | flow | overlay |
|---|---|---|
| web-novel | novel | 无（完整流水线） |
| screen-play | screenplay | 无（完整流水线） |
| world-bible | novel | set-module remove m3/m4/m5——只留选题+剧本 IR（世界书/人设/红队） |
| comfyui-script | screenplay | insert-tool m3 render-prompt-seedance + set-tool 定档 shotSec=5 |
| short-story | topic | set-module remove m5——剧本成品即止，裁掉交付页 |

（分析报告中的 `topic-selection` flow 在本仓库不存在，short-story 落在 topic 流水线上。）

## 五、Phase 2：跨流水线级联（已落地）与剩余 backlog

**chain-flow 的落地形态 = `kernel.flow_chain(fromProjectId, toFlowId, opts)`**（不是 overlay patch）：
overlay 只作用于单条 flow 的编排组合，「Flow A 产物喂 Flow B」是 run 级操作——需要新项目、
素材在盘、双边接力留痕，patch 表达不了。语义：

1. 源项目产物按调用方清单**确定性搬运**到新项目 `00-素材/`（缺文件即 `FILE_MISSING`，不静默跳过）；
2. 以显式输入开跑目标流水线（`preset` 透传，必填输入须调用方给足——内核不猜值）；
3. 双边 journal 接力留痕：源记 `chain-out`、目标记 `chain-in`（journal-event 契约已增补两枚举值）；
4. 目标 flow 用 `sourceMaterials` 输入声明「素材优先/验收+补全」语义（novel 已有，screenplay 本版增补）——
   转换本身由目标流水线的 agent 步消费在盘素材完成，内核不做隐式转换。

剩余 backlog：
- 转换技能 `novel-to-storyboard` / `storyboard-to-comfy`（知识内容 + 真实模型验收）——
  现阶段级联的转换由目标流水线既有步骤（plot 结构/分场 + drama 分镜）消费素材完成。
- Auto 预设路由（意图分析 → 自动选预设）——需要产品口径（关键词规则还是模型判定）。
- 生产线预设的 CLI/HTTP 面（`--preset` flag / GET presets）——内核 API 已就绪。

## 六、验证

`core/test/production-preset.test.ts`：manifest/overlay 装载与大声失败、set-module remove
（expander 单测：裁剪/留痕/不存在进 unsupported）、kernel e2e × 4（world-bible 无 m3-m5、
comfyui-script 展开图含 m3.render-prompt-seedance、short-story 无 m5、缺省完整流水线 +
未知预设拒绝 + state.preset 持久）。全量 31 文件 / 325 用例。
