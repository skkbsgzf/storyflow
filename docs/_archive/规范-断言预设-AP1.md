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

**两处门点一律经 `Kernel.assertionMount(eff, projectDir)` 取挂载**（§七＋§九 的单点入口）。
门点不许各自 `assertionPresets.mountFor()`——那样覆盖与三级选择链在一个门点生效、另一个不生效，
正是本仓「同一事实两处实现必漂移」的病灶。

## 五、preset 选择与状态

- 活跃预设三级链见 §九（`KernelOptions.assertionPreset` > `policy.defaultPreset` > `novel-fanqie`）。
- progressive 状态在 Kernel 进程内（StandingMount），组合文件热重载即重置；落盘持久化是 backlog。
- 预设故障的可见性：`list()` 的 `broken` 字段；门点透传事实由调用方记 journal/diag。

## 六、验证

`core/test/assertion-preset.test.ts`：discovery 健康检查分级、resolve/mount/broken、热重载、
when 求值器、策略矩阵（warn-only/strict/block-critical+progressive/条件/透传/hint/summary 开关）、
真实系统预设 schema 漂移防护、kernel 双预设 e2e（同一污染产物：缺省打回 / minimal 放行）。

`core/test/ap1-override.test.ts`（工单 R2 新增，20 用例）：§七 三类覆盖的执行器合成与
`effectiveFlow3` 解析（含形状非法一律 unsupported）、§九 三级链端到端、§十 摘要落 state
并随下游任务包下发。

---

# 增补（工单 R2，2026-10-01）：覆盖、选择链与诊断注入

> §七/§九/§十 是设计稿编号，实现先于成文——本节按落库现实补写，并显式标注与设计稿的两处偏离。
> §八 工单未要求、磁盘亦无对应实现，编号留空不虚构内容。

## 七、断言覆盖 patch（运行时调制，不改预设文件）

预设文件是**框架级事实源**（system 根 first-root-wins），项目不能去改它；项目级的「这条太陡/这条本轮不用/
这条该加进来」走 overlay。三种 kind 是**内容类**改动（与 `set-tool` 同档），不是结构类——所以它们参与
生效编排合成、计入 `appliedCount`，但不进「结构类永不自动落地」那条纪律。

| kind | 语义 | 必填字段 | 消费者 |
|---|---|---|---|
| `set-assertion-preset` | 改**已声明**断言的调制参数（`gateMode` / `warnThreshold` / `blockThreshold` / `when` / `hintTemplate`） | `assertions: string[]`（≥1）＋ `patch` 对象 | `applyAssertionOverrides` |
| `disable-assertion` | 免拦人**不免检查**：证据照出、status 降为 warn、progressive 不计数 | `assertion: string` | 同上 |
| `insert-assertion` | 向指定组新增一条该预设没声明的断言 | `group` ＋ `assertion`，`patch` 可选 | 同上 |

三条纪律：

1. **派生不改原挂载**。`MountCache` 的站立挂载按 stamp 进程内共享，覆盖属于项目/预设层——写回原挂载
   等于让别的项目吃到本项目免掉的条款（跨项目污染，本仓既有事故形态）。所以 `applyAssertionOverrides`
   深复制 `composition.groups[].assertions[]`，只改副本。
2. **progressive 计数与原挂载共享同一个 Map**。计数口径是「断言类型」，不是「挂载来源」；同一轮里抬阈值
   不该让人清零重来。反之 `disable-assertion` 明确**不计数**——免掉的条款不该在换回预设后背著历史欠账。
3. **引用不到就回显，不静默**。`presetId` 与当前挂载不符、目标断言该预设没声明（应走 insert）、
   组不存在、该组已声明同名断言——四类各落 `ignored` 一句带原因的说明，由 `Kernel.assertionMount`
   写进诊断通道（`<项目>/registry/diagnostics.jsonl`，kind=`assert`，scope=`assertionOverride`）。
   「面板填了阈值不生效」必须是可见事实，不许是隐形故障（R7 §一「声明了就得有人读」）。

**偏离设计稿 ①**：设计稿签名是 `applyAssertionOverrides(mount, overrides): StandingMount`，实现返回
`OverrideReceipt = { mount, applied, ignored }`——只回挂载就无法履行纪律 3（调用方拿不到未生效清单，
只能静默）。`overrides` 为空时原样返回入参挂载，不多造一层派生。

解析侧（`core/src/modules.ts::effectiveFlow3`）只做**形状校验**：`gateMode` 限三值、阈值须 ≥1 的整数、
`patch` 不接受白名单外的键、`assertions` 非空、`insert` 须齐 `group`+`assertion`。
**存在性校验推迟到挂载期**——解析时还不知道活跃预设是哪个（§九 的链在门点才收敛），
在此判存在性会把「换个预设就合法」的 patch 误杀。形状不过 → `unsupported`；存在性不过 → `ignored`＋诊断。

`status: "proposed"` 的覆盖一律不参与合成（与 R5 提案制同一条纪律：待批 = 未生效）。

**已知边界（backlog，不装作不存在）**：`insert-assertion` 的新断言只有**扫描器真会发出的类型**才有效——
`registry.ts` 是「跑一次 `runAestheticAsserts`、按声明类型过滤」的薄注册表，插一个 `AE-GHOST` 这种
查无此题的类型不会报错，只会永远匹配不上（= 声明了没人读）。内核侧尚无 AE 类型全集可用于校验，
补法要么从 `aesthetic.ts` 导出枚举做挂载期校验，要么让未匹配的声明落诊断。本轮选择：**如实记在规范里 + 测试锁定
「未声明类型透传」的现有语义**，不在解析期假装有校验。

## 九、预设选择三级链

`Kernel.assertionMount()` 单点判定，门点不各自实现：

```
KernelOptions.assertionPreset        （宿主/测试显式点名 —— 最高）
  > flow.policy.defaultPreset ⊕ set-policy:defaultPreset   （编排层，随生效编排走）
    > novel-fanqie                   （仓库出厂缺省）
```

- **为什么宿主压编排**：宿主是运行时的所有者（临时数据根、测试隔离、多租户都靠它），编排表是项目内的表单。
  让 `flow.json` 反过来覆盖宿主点名，等于测试无法锁定自己声明的档位。
- `policy.defaultPreset` 与 `link_default`/`adapt` 同级，进 `POLICY_KEYS` 白名单；值须非空串，否则 `unsupported`。
- **它参与 `overlayHash` 指纹**（指纹载荷 = `{m: flow.modules, p: policy}`）。所以换预设 = 编排变了 = 触发
  `replan`（受影响下游置 `pending`+`stale`）。这是有意的：预设调制的是裁决，换预设后旧结论不可沿用。
  **偏离设计稿 ②**：设计稿把 defaultPreset 当「一个字符串配置项」，未提 replan 后果；实现未额外加豁免通道。
- 坏 id 不抛错：`mountFor()` 静默返回 undefined ⇒ 门点**无调制**，确定性完整性照旧拦
  （preset 是调制器，不是闸门的总开关——「预设查不到所以什么都不查」是能力倒退，不许发生）。

## 十、诊断注入 taskPackage

门点把策略摘要写进 `RunState`（运行时事实），`buildTaskPackage` 原样随任务包下发：

| 字段 | 位置 | 写入方 | 消费方 |
|---|---|---|---|
| `diagnosticSummary` | `state.json` / `task-package` | doSubmit、check_\* 两处门点 | 下游执行 agent（宿主整包交予模型） |
| `diagnosticFrom` | `state.json` | 同上，成对写入 | 读侧判断摘要出自哪个节点 |

- 摘要行格式：`<断言类型>[<gateMode>/<progressive 档>×<累计次数>] <策略提示>｜证据：<现场 detail>`。
  现场必带——只报条款名（「artifact-header 没过」）等于让接手的人重新考古一遍，
  §十 的用途「下游不必重新踩同一个坑」就落空。
- check_\* 节点的摘要按产物逐条前缀路径（`内部/稿本/x.md → …`），多产物不混成一坨；
  同时落进检查报告 `gateSummary` 字段（收据，可回溯）。
- **三态口径**：字段缺省 = 本项目还没走过门点；空串 = 走过但无调制（本轮没触发条款，或
  `diagnosticEnabled: false`，或预设不可用）；非空 = 有调制事实。三者不许混同，前端与验收读侧据此分辨。
- 摘要**只是提示，不构成判决**：它不改 `blocked()` 的任何输入，也不进验收闸判据（口径见 2026-09-24
  「自设数值阈值不构成提交闸」人裁）。

