# 规范-断言预设-AP1 · Assertion Preset v1

> 对标 DSH Agent Presets 的四层架构，把「哪些断言在哪个门点生效、怎么拦」从内核硬编码抽成声明式组合文件。
> 设计原则沿用 v5.0 工单 §三：内核不再写死任何断言闸——**预设不声明 = 不生效；预设声明 = 可审计的可配置闸**。

## 一、四层架构

| 层 | 文件（core/src/assertion-preset/） | 职责 |
|---|---|---|
| L0 Discovery | `discovery.ts` | 扫描 preset 根，健康检查（存在→YAML→schema 四级），broken 照常列出 |
| L1 Registry | `index.ts` | `AssertionPresets` 服务：list / resolve / mount / mountFor（内核静默入口） |
| L2 Mount | `mount.ts` | 站立挂载缓存：解析一次共享；stamp（mtime+size）变化 = 新 generation（progressive 清零） |
| L3 Composition | `resolver.ts` + `contracts/assertion-preset.schema.json` | gate-preset.yml 声明式组合（组/断言/gateMode/阈值/条件/提示模板） |

支撑件：`types.ts`（契约）、`when.ts`（安全条件表达式求值器，无 `new Function`）、
`registry.ts`（AE-* 声明 → `runAestheticAsserts` 执行的薄注册表）、`executor.ts`（策略层）。

## 二、目录与 trust

```
<repoRoot>/assertion-presets/<id>/gate-preset.yml   # system（框架自带）
<repoRoot>/assertion-presets/<id>/preset.yml        # 元数据（name/description，可选）
<数据根>/assertion-presets/<id>/…                    # user（项目自定义；同名时 system 优先）
contracts/assertion-preset.schema.json    # 组合文件 schema（schema.ts SCHEMA_IDS 已注册）
```

系统自带 4 个预设：`novel-fanqie`（缺省）、`screenplay-audio`、`prose-light`、`minimal`。
`KernelOptions.assertionPreset` 选活跃预设；预设缺失/损坏 → `mountFor()` 返回 undefined，
门点按无预设处理（**透传，不拦死流水线**）。

## 三、门控语义（executor.ts）

策略层输入 `Validation[]`，输出策略后的 `Validation[]` + 逐条 `GateOutcome` + 诊断摘要：

- **warn-only**：失败永不阻断（block 一律降级 warn）。
- **block-critical**：确定性 block 恒拦；warn 连续失败达 `blockThreshold`（缺省 5）才升级为 block。
- **strict**：任何失败都拦（warn 升级 block）。
- **未声明类型**：原样透传——预设只调制它声明的东西。
- **条件**：组 `disabled` 成立 → 整组跳过；断言 `when` 不成立 → 该结果本轮丢弃。
  求值失败时 `when` fail-open（保持启用）、`disabled` fail-closed（不禁用），坏表达式朝「少拦」倾斜。
- **progressive**：计数按断言类型累计（失败 +1），`progressiveResetMs` 超期回滚；
  阈值缺省 warn=2 / block=5。
- **hintTemplate**：`{{count}}`/`{{type}}` 占位，附加到 detail；`diagnosticEnabled: false` 关摘要。

`when`/`disabled` 可用标识符：`nodeType`、`nodeId`、`pathClass`、`relPath`、`round`、`isChapter`、`hasWorldbook`。

## 四、接入点（只有两处）

1. **提交链（kernel-run.ts doSubmit）**：integrity/header/glossary 结果经策略层后再 `blocked()`。
   v5.0 契约不变：AE-\* 质量闸不进提交链。
2. **check_\* 节点（minitools.ts runCoreNode，非 scan 模式）**：preset 声明的 AE-\* 类型由注册表
   补跑（跑一次 `runAestheticAsserts` 按声明过滤），与 integrity 结果一起过策略层后裁决。
   `scan_quality` 保持 v5.0 证据语义，不做任何拦截面。

## 五、preset 选择与状态

- 活跃预设：`KernelOptions.assertionPreset` > 缺省 `novel-fanqie`。
- progressive 状态在 Kernel 进程内（StandingMount），组合文件热重载即重置；落盘持久化是 backlog。
- 预设故障的可见性：`list()` 的 `broken` 字段；门点透传事实由调用方记 journal/diag。

## 六、验证

`core/test/assertion-preset.test.ts`：discovery 健康检查分级、resolve/mount/broken、热重载、
when 求值器、策略矩阵（warn-only/strict/block-critical+progressive/条件/透传/hint/summary 开关）、
真实系统预设 schema 漂移防护、kernel 双预设 e2e（同一污染产物：缺省打回 / minimal 放行）。
