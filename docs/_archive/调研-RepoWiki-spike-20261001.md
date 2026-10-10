# 调研回执 · Repo Wiki spike（DeepWiki × NovelPedia 融合可行性）· 2026-10-01

> 工单 R8 第三项（零依赖插空项）。结论先行：**Storyflow 的世界书已经是一个"待渲染的 wiki 图谱"，
> 缺的只是三个只读投影件**——不需要引入 DeepWiki/NovelPedia 的任何运行时，融合点在产物层而非引擎层。
> 依据 = 本仓库既有事实（世界书契约 + worldbook_search + presets 目录），非外部产品体验转述。

## 一、三方能力对账

| 能力 | DeepWiki（Qoder 体验） | NovelPedia（自研方向） | Storyflow 现状（盘面事实） |
|---|---|---|---|
| 结构化图谱 | 代码仓库 → 实体/关系图 | 小说词条 → 关系网 | **已有**：`世界书/graph.json`（worldbook-graph@1，词条+边+一跳扩展），`kernel-view.loadWorldbookGraph` 单点装载 |
| 词条正文 | 源码文件即正文 | 卡片式条目 | **已有**：`世界书/<分类>/<词条>.md`（graph.json 存 path，正文在盘） |
| 检索 | 图遍历 + 代码引用 | 语义检索 | **已有**：`worldbookSearch`（标题>tag>摘要>bigram 打分 + 沿边一跳） |
| Diff/版本 | git commit 粒度 | 章节粒度 | **已有且更强**：修订历史按词条 revision（Pinax 侧），graph.json 带 built_at |
| 消费面 | 网站（只读 wiki） | 阅读器 | **缺**：只有 agent 工具面（worldbook_search verb）与 pedia.html 一个出口，没有"人读的 wiki 站" |

## 二、融合裁定：三个只读投影件（全部 Phase-1 可做，零内核改动）

1. **`worldbook-wiki` 生成器**（一个 minitool 或纯脚本）：消费 `graph.json` + 词条 md →
   静态 wiki 站（词条页 = md 渲染 + 反向链接 = 边的一跳 + 分类索引页）。
   这就是 DeepWiki 的"仓库 → 网站"动作，输入换成世界书。挂在 base 模块 `worldbook` op 旁。
2. **diff 页**：graph.json 的 `built_at` + 词条 md 的 mtime/revision → "上次写作后哪些设定变了"——
   NovelPedia 说的 Diff 机制，Storyflow 数据模型原生支持，只差渲染。
3. **wiki 面进 MCP**：R4 已给 `wb://graph` / `wb://entry` 两个 resource——wiki 生成器直接复用同一装载单点，
   agent 看到的与人看到的永不漂移（口径同 effective.json 的"单一事实源"纪律）。

## 三、不建议做的事

- 不引入向量库/语义检索：worldbookSearch 的确定性打分对 115 词条量级够用（hypergraph.rag.json 编译图已在 kb 侧验证过此路线）。
- 不做第二套词条存储：wiki 只是 graph.json + md 的**投影**，写路径仍归 writer agent 与 world-forge 节点——
  双写 = 双真相，违背仓库铁律。

## 四、下一步（待排期，不占本工单）

Phase-1（生成器 + diff 页）估 1 天，验收 = 真实项目世界书上生成静态站 + 一跳链接全通；
对外接口只有 `worldbook` op 的一个新产出一档，无契约变更。
