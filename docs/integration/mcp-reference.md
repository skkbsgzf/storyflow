# MCP 面参考 · miniflow

> 事实源三张表，全在码里：`core/src/verbs.ts` 的 `VERBS`（动词）+ `core/src/mcp.ts` 的 `MCP_RESOURCES`（资源）与 `MCP_PROMPTS`（提示）。
> 启动：`cd core && npm run mcp`（= `tsx src/mcp.ts`），或构建后 `node dist/mcp.js`。
> 传输：**stdio**。server 标识 `{ name: "miniflow", version: "0.1.0" }`。
> SDK 版本实量：**1.30.0**（`package.json` 声明 `^1.7.0`）。本文所有 API 形状按 1.30 的真实签名写（`registerResource` 的四参重载、`ResourceTemplate` 的 `list` 必填位、`registerPrompt` 的 `argsSchema`）——工单卡面上写的 1.7 是个估计值，落码时以盘面为准。

## 一、工具从哪来

`buildMcpServer(kernel)` 逐条遍历 `VERBS` 注册工具，**没有第二份清单**：

```ts
VERBS.forEach((def, i) => server.registerTool(def.name, {
  description: def.description, inputSchema: specs[i].inputSchema }, handler))
```

⇒ **动词数 = 工具数**。当前 **27 个工具**，名字与[总览的动词表](../Agent.md#三动词表生成的不手写)逐字相同
（`flow_list` / `flow_run` / `flow_init` / `cfg_template` / `flow_next` / `flow_submit` / `flow_resume`
/ `flow_gate` / `flow_rerun` / `flow_effect` / `flow_mine` / `skill_patch` / `flow_optimize`
/ `flow_overlay` / `set_decision` / `list_decisions` / `kb_search` / `kb_read` / `worldbook_search`
/ `ig_load` / `ig_propose` / `ig_commit` / `ig_exclude` / `ig_sync` / `whereami` / `snapshot` / `quality_scan`）。

新增动词只改 `verbs.ts` 一处，MCP 面自动跟上——**这是本轮之后不许破的规矩**。

## 二、参数：VerbParam → zod 派生

`zodOf(p)` 是唯一映射函数。**定义已上移到 `verbs.ts`**（R4）：HTTP 的前置校验与 OpenAPI 生成要吃同一份形状，MCP 不能反过来被它们依赖；`mcp.ts` 转出这一对面以保持旧 import 源。单测直接对表断言「MCP 面 = 表」：

| `VerbParam.type` | zod | 备注 |
| --- | --- | --- |
| `string` | `z.string()` | 带 `enum` 时 → `z.enum([...])` |
| `number` | `z.number()` | |
| `boolean` | `z.boolean()` | |
| `record` | `z.record(z.string(), z.unknown())` | 自由形状 JSON 对象 |
| `string[]` | `z.array(z.string())` | |

必填/可选：`required: true` → 裸 base（并 `describe(desc)`）；否则 `base.optional().describe(p.desc)`。
`desc` 与 CLI usage 同源，所以**宿主看到的参数说明和终端帮助是同一句话**。

> CLI 的 `flag`（kebab 长旗标）只是终端外观；HTTP body / MCP args / 内核入参一律用归一化 `name`（camel）。

## 三、返回值

工具结果是单条 text content，内容为 `JSON.stringify(输出, null, 2)`。
动词的原生返回形状见各动词实现（`verbs.ts` 的 `run` → `kernel.*`），错误路径见下一节。

## 四、错误语义

`handler` 计时 + try/catch：成功 `exit:0`，异常 **重新抛出**（MCP 层转成 tool error）并记 `exit:1`。
内核侧异常多为 `KernelError { code, http, message }`，例如：

| code | 触发例 |
| --- | --- |
| `UNKNOWN_FLOW` | `flow_run --flow` 指到不存在的 flow |
| `NO_PROJECT` / `NO_RUN` / `NO_NODE` | 项目目录、run-state、目标节点不存在 |
| `INVALID_INPUT` | 路径越出项目目录 / 必填缺失 |
| `NODE_NOT_AWAITING` / `INVALID_VERDICT` | 门语义不符（非 awaiting 态提交裁决 / 裁决值不在枚举） |
| `BAD_ARGS` / `BAD_OVERLAY` / `BAD_TEMPLATE` | 入参折不平 / overlay 非法 / 配置模板不合法 |
| `DECISION_INVALID` | 决策缺 `by`/`evidence`（R8：无来源即拒） |
| `INTENT_INVALID` / `INTENT_MISSING` | 立意图候选带 `p` 却无有效 scorer / 图不存在 |

领域错误（`DecisionError` / `IntentError` / `CfgTemplateError`）在 `verbs.ts` 出口统一折成
`KernelError` 带 4xx 出去——**不会**因为它们报 500。

⇒ 宿主侧**按 `code` 分支，不要嗅探 message 文本**。

## 五、BETA 期留痕

`traceMcp()` 与 CLI 写同一处 `trace/cli.jsonl`（同形状 + `via:"mcp"`）。规则：

- 仓库根存在 `BETA` 标记文件时才写；**不在位就什么都不写**。
- 写失败静默，绝不影响动词返回。
- 长参数截断到 120 字，不把正文灌进台账。

用途：内核动作走 MCP 后，若不留痕，`tools/method-brief.mjs` 的工具账会整体瞎掉。

## 六、资源面（四类只读 · 清单本身是一张表）

工单卡面上写的 `wb://graph` 这类**前缀名落不了地**：世界书、运行态、产物全是**项目级**数据，
资源必须按项目寻址。所以模板带变量，变量值按 `encodeURIComponent` 进出（项目 id 允许含中文）：

| 资源名 | URI 模板 | 内容 | 读不到时 |
| --- | --- | --- | --- |
| `wb-graph` | `wb://{project}/graph` | 世界书归纳图全图（`worldbook-graph@1`）：`entries[id,cat,title,tags,summary,path]` ＋ `relations[a,b,weight,src]` ＋ `counts` ＋ `built_at` | 项目无世界书：错误文本直接给出重建命令（`worldbook_index`），不静默回空图 |
| `wb-entry` | `wb://{project}/entry/{id}` | 单词条正文卡片 ＋ 其全部一跳关系（对端标题、`weight`、证据 `src`，按 weight 降序） | 查无此条：错误文本带回找路径（先读 `wb://{project}/graph` 取清单） |
| `flow-state` | `flow://{project}/state` | 实时运行态切片：state ⊕ 生效编排指纹（`overlayHash`/`planHash`）⊕ overlay ⊕ 指标 ⊕ 旁路诊断 ⊕ 决策面 ⊕ `revision`。**与 HTTP 的 `/api/projects/<id>/live` 同源同形**，不含产物正文 | 未开跑＝`state: null`（这是事实，不是错误） |
| `artifact-content` | `artifact://{project}/{+path}` | 已登记产物正文。`{+path}` 是 RFC 6570 的保留展开——不写 `+` 的话路径里的 `/` 匹配不上 | **只读 `registry/artifacts.json` 里登记过的**：未注册＝读不到，与 HTTP 面同一判定，因此路径穿越天然无效 |

清单的单一事实源是 `MCP_RESOURCES`：注册、`resources/list`、本文表格、`core/test/r8-verbs.test.ts` 四处读同一张表。

- `resources/list` 由表逐条展开成**实体 URI**：项目来自 `projects/` 一级目录，`_` 前缀的仓库级容器（`_archived`）不算项目；没有世界书的项目不占资源位。
- 单次回显上限 `LIST_CAP = 300`，**超限不静默裁**：`truncated` 字段如实标出客户端在看几分之几。
- 内核侧异常一律折成 JSON-RPC 应用错误（`ErrorCode.InvalidParams`），不把服务端崩掉——一个坏 flow 不该让整面失效。
- 模板匹配回来的变量是**百分号编码**的（SDK 不解码），解码单点在 `mcp.ts::decVar`；非法转义序列原样交出，让「读不到」成为可见事实而不是被静默改字。

## 七、提示面（两个 · 只摆事实，不下结论）

| 提示名 | 参数（★＝必填） | 产出 |
| --- | --- | --- |
| `review-worldbook`（世界书体检） | `project` ★、`q`、`cat`、`k` | 分类分布、孤儿词条（图中无任何关系边）、缺摘要词条（检索打分吃不到 summary）、给了 `q` 再附检索命中与一跳扩展 |
| `gate-assist`（裁决辅助） | `project` ★、`node` | 门悬置多久、被裁节点声明（生效编排＝flow ⊕ overlay ⊕ 边界派生）、本轮已登记产物与确定性完整性结果、旁路诊断计数、四种裁决各自的后果与凭据（`token`/`round`） |

清单同样是表（`MCP_PROMPTS`），参数形状由 `promptShape()` 从表派生。两个模板**刻意不下结论**：
语义判断（设定是否自洽、这个门该不该放）归评审者对照 `knowledge/rules/` 语料卡；数值证据只记账，不构成打回闸。
`gate-assist` 在未开跑的项目上返回一行说明（「先 flow_run——没有运行态就没有可裁的门」），而不是抛错。

## 八、握手与测试

`buildMcpServer(kernel)` 不绑定 transport，测试用 `InMemoryTransport.createLinkedPair()` 两端接线真握手：
`tools/list` 的名字序列必须**逐字等于** `VERBS`，`resources/templates/list` 等于 `MCP_RESOURCES`，
`prompts/list` 等于 `MCP_PROMPTS`。用例见 `core/test/r8-verbs.test.ts`（含中文项目 id 的 URI 往返、未注册产物拒读、无世界书重建提示）。

## 九、尚未实现（诚实面）

| 项 | 状态 |
| --- | --- |
| 资源变更通知（`notifications/resources/list_changed` / 订阅） | **未实现**（待排）。R5 的 SSE 卡只点事件流，没点资源通知，不顺手做；可复用的形状已经在了——`watchDir` 已由 `core/src/project-stream.ts` 接上，且按 FS1 §五 只当「提示重读」，正确性走节拍对账 |
| 交付时自动注册进宿主 | **不做**（交付不自动注册，宿主自行添加） |

## 十、注册示例（以宿主配置为准，字段名各家不同）

```json
{
  "mcpServers": {
    "miniflow": {
      "command": "node",
      "args": ["D:/storyflow-kit/core/dist/mcp.js"]
    }
  }
}
```

未构建时用 tsx 直跑源码：`"command": "npx", "args": ["tsx", "src/mcp.ts"]`，cwd 设为 `core/`。
**换机 / 新 clone 后必须先 `cd core && npm run build`**，否则 `dist/mcp.js` 不存在。

## 十一、纪律

- 不要在 MCP 面手抄动词清单（包括「只暴露常用 7 个」这种收敛）——要收敛就在 `verbs.ts` 加 `group`/标记，让三面共享。
- 不要把 `flow_gate` 的裁决代做（它是人的动词）。
- 资源与提示**只读盘面事实**：新增第 5 类资源要同时改 `MCP_RESOURCES` 与它的读回调，别在注册处硬写 URI 字符串（那是第五份副本）。
- 产物正文只经登记表闸门（`registry/artifacts.json`）读出；不要在资源面另开一条「按路径直读」的口子——那条口子就是旧 `serve.py` 泄露 29M 个人信息的那种病灶。
- 交付不自动注册进宿主。
