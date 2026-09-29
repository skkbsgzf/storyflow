# skillrouter-mcp

**Advisory tool router for MCP.** A zero-dependency Node stdio MCP server that turns your Skills into a registry of tools, keeps them connected over MCP, and ranks the whole tool pool per request — so the agent sees a shortlist *with the full pool still one call away*.

> 定位一句话：**小模型搭配 agent 做「调度」，不当「闸门」**。`route` 永不隐藏或禁用任何工具，只排序分档；终裁权在 agent；`report` 把「建议 vs 实际」回填成自进化信号。

---

## 为什么要有这个

把一堆能力接进一个 MCP 宿主之后，两笔账会先爆：

1. **工具表 token 账**：每一轮对话都要为整张工具表付费，哪怕 95% 的工具这一轮根本不会用。
2. **冷启动账**：CLI 形态的服务每次调用都要重启进程。我们在生产 harness（miniflow，一个创作任务编排内核）里实测过：bash 起 tsx 每次冷启动 ≈103 秒，一轮任务 22 次调用 = **37.8 分钟纯握手**；另一个 4B 判官模型逐次冷加载 15 次 = **22 分钟**（每次 88 秒）。改成进程常驻的 MCP 之后，同样这批调用降到毫秒级（`flow_list` 4ms / `whereami` 120ms / `quality_scan` 403ms）。

skillrouter 把问题拆成两半：

- **Convert（转换）**：`import_skill` 解析 `SKILL.md` frontmatter（`tools:` 或 `bind.minitools:`），`import_module_json` 单向读入能力注册表，`import_from_mcp` 直连任意 stdio MCP server 拉它的 `tools/list`——你的技能和别的 MCP 服务，都变成可被调度的工具池，不用手工抄写。
- **Schedule（调度）**：`route(request, context)` 返回**全量候选**的相关度排序 + `primary / secondary / background` 三档 + 依赖正确的执行 DAG。过滤报告、打分构成（tag/desc/hist 分项）、引擎备注全部可见——没有任何东西静默消失。

## 设计理念

**1 · 建议不裁决。** `route` 的返回值里没有 `excluded` 字段，`visibility.hidden` 恒为 0。排序再差也只是建议；agent 每一轮都有权推翻它，而推翻本身（`overridden_in` / `suggested_but_unused`）会被 `report` 记下来，成为下一轮排序的先验。调度器最忌讳的事——把「相关」做成「可用」——在这里被接口层面禁掉了。

**2 · 确定性优先，模型可插拔。** 默认引擎 `deterministic-v0`：CJK bigram + ASCII 词元在 capability_tags / keywords / 描述上打分，叠加历史先验，零延迟零依赖可离线。模型引擎（`local-llm` chat 端点 / `laya-v1` typed-decisions 单前向）出每工具相关度，按 blend 与确定性混合；**超时或坏输出回落 deterministic 并在 `engine_note` 里注明**——路由自身永远不会因为模型挂了而阻塞。我们明确反对逐工具冷加载判官（实测 88 秒/次会把路由变得比它要消灭的冷启动更慢）：要用模型，请常驻。

**3 · 自进化靠回填，不靠训练。** `evaluate` 只出确定性信号（非空 / JSON 合法 / 词面覆盖率），`report` 落执行历史并聚合 `suggestion_vs_actual`：采纳率、被推翻在哪、建议了没用上的是谁。这些就是下一轮 `route` 的 history prior——**闭环不需要任何训练 run**。

**4 · 单向导入，不造第二真相。** 三种导入全部只读源、只在 `SKILLROUTER_HOME` 落注册表，不写回任何源文件。你的 skill / module.json / 别的 MCP server 依然是唯一事实源；skillrouter 只持有「可调度视图 + 执行历史」。

## 数据表现

**延迟（deterministic-v0，本机 Node 20）：**

| 工具池规模 | 轮数 | avg | p50 | p95 | max |
|---|---|---|---|---|---|
| 48 tools | 150 | **1.37 ms** | 1.29 ms | 1.89 ms | 3.6 ms |

（复现：`node test/bench.mjs 150`，混合 4 类查询文本。）

**自测：** `node test/selftest.mjs` → **25/25 PASS**。覆盖：握手与 11 工具清单、route 分档且不隐藏、无关请求 primary 允许为空、local-llm 失败可见回落、evaluate 确定性信号、report 建议vs实际落盘、SKILL.md 导入往返、`import_from_mcp` 自环冒烟、模型回包 `toolkit/id` 前缀与裸 id 双形归一（R3 回归）。

**节省估算口径（诚实版）：** `report.total_savings.saved_ratio_estimate` 按**字符量**估算注入面收窄，不是 token 实测；早期 `false_negative` 由 report 数据随时间回填，数字薄的时候服务器会直说，不冒充准确率。

**动机侧实测（生产 harness，为什么值得做）：** 22 次 CLI 冷启动 ≈37.8 分钟 → 进程常驻后整批毫秒级；判官逐次冷加载 88s×15 = 22 分钟 → 常驻 + 确定性优先是硬要求，不是口味。

## 快速开始

```bash
node src/server.mjs            # stdio MCP server（零依赖，Node ≥18）
node test/selftest.mjs         # 端到端自测
node test/bench.mjs 150        # 延迟基准
```

宿主注册（Qoder / Claude Desktop 风格配置）：

```json
{ "mcpServers": { "skillrouter": {
  "command": "node",
  "args": ["/abs/path/to/skillrouter/src/server.mjs"],
  "env": { "SKILLROUTER_HOME": "/abs/path/.skillrouter" }
} } }
```

状态目录（`SKILLROUTER_HOME`，默认 `~/.skillrouter/`）：`registry.json` · `toolkits/` · `skill_groups.json` · `execution_history/<yyyymmdd>/<req_id>.json` · 可选 `config.json`：

```json
{
  "engine": "deterministic-v0",
  "llm": { "endpoint": "http://127.0.0.1:8080/v1/chat/completions", "model": "local", "timeout_ms": 15000 },
  "llm_blend": 0.6,
  "thresholds": { "required": 0.7, "optional": 0.5 }
}
```

## MCP 工具（11 个）

| tool | 作用 |
|---|---|
| `route` | 全候选排序 + 三档 + 执行 DAG；`group_filter` 可收窄注入面 |
| `evaluate` | 工具输出后的确定性信号（非空 / JSON / 覆盖率） |
| `report` | 聚合执行报告 → execution_history + suggestion_vs_actual |
| `list_toolkits` / `register_toolkit` | 列出 / 注册工具包 |
| `import_skill` | SKILL.md frontmatter → toolkit |
| `import_module_json` | 能力注册表 module.json 单向导入 |
| `import_from_mcp` | 连任意 stdio MCP，整体拉取 tools/list（幂等覆盖） |
| `create_group` / `list_groups` / `auto_group` | 分组管理与标签相似度自动分组建议（confirm 才落盘） |

典型循环：`route` → agent 自己执行建议的工具 → `evaluate` 每个输出 → `report` 回填 → 下一次 `route` 带上更好的先验。

## route 返回（截选）

```json
{
  "engine": "deterministic-v0",
  "engine_note": "deterministic-v0（无模型冷启动口径）",
  "candidates": [
    { "tool_id": "flow_next", "toolkit": "miniflow-kernel", "relevance": 0.83,
      "score_parts": { "tag": 0.5, "desc": 1.0, "hist": 0.6, "llm": null },
      "rank": 1, "tier": "primary", "reason": "确定性相关性" }
  ],
  "suggestion": { "primary": ["flow_next", "flow_submit"], "secondary": ["snapshot"] },
  "execution_dag": { "levels": [["flow_next"], ["flow_submit"]] },
  "visibility": { "total": 6, "hidden": 0, "note": "建议制调度：永不隐藏或禁用工具，只排序分档；agent 终裁" }
}
```

## 诚实边界

- `evaluate` 只量表面信号（非空 / JSON 合法 / 词面覆盖）——**语义质量归 agent 或判官模型**，本包故意不提供质量闸。
- `total_savings` 是字符量估算，不是 token 实测。
- `false_negative` 率靠 report 数据随时间回填，早期数字薄，服务器会如实说明。
- `import_from_mcp` 是 tools/list **快照**导入：源 server 动词变更后需重跑导入（幂等覆盖同名 toolkit）。

## License

MIT
