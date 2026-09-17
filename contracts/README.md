# contracts/ · miniflow 标准本体

六份 JSON Schema（draft 2020-12）是全部插件与内核数据模型的**唯一权威定义**——「标准 = contracts/」，不绑定任何框架（决策日志 #7）。

| Schema | 层 | 一句话 |
| --- | --- | --- |
| `minitool.schema.json` | L1 能力插件 | 带输入/输出 Schema 的可执行文件，任何语言 |
| `flow-pack.schema.json` | L2 领域包 | 目录 + manifest 即发布 |
| `task-package.schema.json` | 内核 | 宿主获得的全部上下文（节点域、哈希锚定、预算裁剪） |
| `run-state.schema.json` | 内核 | run 状态机（现网 run-state.json 兼容迁移目标） |
| `artifact.schema.json` | 内核 | 产物注册表条目（未注册 = 不可交付） |
| `journal-event.schema.json` | 内核 | append-only 事件流 |

**第三方接入最小路径**：写 L1 = 一个带 schema 的可执行文件；写 L2 = 一个目录 + manifest。不需要学任何框架。

**使用方式**：TS 内核（M1）由 schema 生成类型；Python 侧用 `jsonschema` 直读校验；`tools/*.py` 的 CLI 校验是这些 schema 在 M0 的手工等价物。

规格全文见 `docs/底座规格-miniflow-harness.md`。
