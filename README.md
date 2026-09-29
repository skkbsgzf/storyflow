# StoryFlow · 轻量、可玩的故事 Kit

> 一个「故事 kit 提供者」的运行时：**pi-agent-core 驱动的 agent runtime + 模块化 flow + MCP + 确定性工具链 + 可插拔语料**。
> 浏览器、Electron、移动端通过同一个适配层接入。审核、打回、合规——宿主自己写（我们有接入协议），运行时不含任何审核逻辑。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![version](https://img.shields.io/badge/version-0.9.0-green.svg)](CHANGELOG.md)

---

## 一 · 代码架构

### 1.1 两个进程 + 一层适配

```
                       ┌─────────────────────────────────────────┐
                       │            消费者（任意形态）              │
                       │   浏览器页面 · Electron 壳 · 移动 App      │
                       └───────────────┬─────────────────────────┘
                                       │ adapter/（REST + SSE，一个 base URL + 一个口令）
                       ┌───────────────▼─────────────────────────┐
                       │   storyharness serve        :8431        │
                       │   协议面：会话/生产线/面板/包门禁/附件       │
                       │   ┌─────────────────────────────────┐   │
                       │   │ 执行环（pi-agent-core）           │   │
                       │   │  chat.ts  交互对话回合            │   │
                       │   │  executor.ts 生产线节点执行        │   │
                       │   │  tools.ts  工具环（含 skill→tool）│   │
                       │   │  scheduler.ts 批调度（AND-join）  │   │
                       │   └─────────────────────────────────┘   │
                       │   ┌─────────────────────────────────┐   │
                       │   │ packs/ 扩展包挂载表（S1–S5）       │   │
                       │   │  packs/deduce 推演模式（galgame）  │   │
                       │   └─────────────────────────────────┘   │
                       └───────┬─────────────────────┬───────────┘
                               │ HTTP /api/verbs/:v  │ 子进程
                       ┌───────▼──────────┐   ┌──────▼──────────┐
                       │  core :8421      │   │ tools/（Python） │
                       │  flow@3 编排引擎  │   │ lint/scan/export │
                       │  verbs·overlay   │   │ kit 编译器        │
                       │  MCP 面·kb 图检索 │   └─────────────────┘
                       └──────────────────┘
```

- **core（:8421）** 是编排事实的唯一源：flow@3 描述符 → 展开计划（expandFlow3）→ 生效编排（effectiveFlow3 + overlay）→ 任务包派发。前端与 harness 都不重算编排。
- **storyharness（:8431）** 是 agent 运行时：同一 pi-agent-core 执行环支撑「交互对话」与「生产线节点执行」两种驱动；会话全文、用量、产物收据逐条落盘（JSONL）。
- **扩展包（packs/）** 是玩法层：manifest 声明 pages/apis/config，serve 挂载表装载；项目级门禁（启停不重启）；模板项目随包、首写落地工作区。

### 1.2 源码地图（约 2.6 万行，全部可读）

| 目录 | 规模 | 内容 | 关键文件 |
|---|---|---|---|
| `core/src/` | 12.5k 行 TS | flow@3 引擎、动词单表（20 verb，MCP 同表）、overlay 生效编排、kb 图检索、agent 对话流 | `modules.ts`（expandFlow3）、`verbs.ts`（动词单表）、`overlay.ts`、`kb.ts`（HyperGraphRAG 装载）、`mcp.ts` |
| `storyharness/src/` | 6.1k 行 TS | 协议面 serve、批调度、执行环、会话 JSONL、附件、包架构 | `serve.ts`（全端点）、`executor.ts`（执行环）、`scheduler.ts`、`tools.ts`（工具环 + skill→tool）、`packs.ts`/`packgate.ts`/`packctx.ts`（扩展包三件）、`attachments.ts` |
| `storyharness/packs/` | 1.4k 行 TS | 扩展包：`deduce/`（推演引擎 engine + galgame 页面 + 生图 seam + 模板项目） | `pack.ts`（包入口 render/handle）、`engine/deduce.ts` |
| `tools/` | 9.2k 行 Python/JS | 确定性工具链：三 lint 守门、质量扫描、docx 导出（自带完整性检查）、快照、kit 编译器 | `flow-lint.py`、`module-lint.py`、`kit-lint.py`、`kit-skills.py`、`kit-compile.py`、`export-doc.py` |
| `adapter/` | 协议 + 客户端 | 七端点接口协议 + 零依赖 JS 客户端 | `storyflow-client.mjs` |
| `contracts/` | JSON Schema | flow@3 / overlay / artifact 头 / module@1 | — |

### 1.3 一次「跑批」的生命周期（数据流）

```
headless "题材" 或 POST /start
  → flow_run（core：输入表态 → 展开计划 → registry 落盘）
  → 循环：flow_next 领任务包（指令 + 技能标尺 + 产物契约，判定语料现读盘）
      → pi 执行环跑 agent（工具环 40 skill.* + fs + 检索 + 附件）
      → 产物落盘 + artifact 头（确定性完整性检查：字段/计数/残渣）
      → flow_submit 交卷 → snapshot 留档 → journal 记账
  → 批内 AND-join 全绿 → 下一批；manual gate 挂起等宿主（审核接入点，见 PROTOCOL-REVIEW）
  → 产物：剧本.md / 章节 / 推演草稿 + 全量会话与用量遥测
```

### 1.4 四个扩展点（全部声明式）

| 扩展点 | 声明位置 | 消费者 | 示例 |
|---|---|---|---|
| 生产线 | `flows/<用途>/flow.json`（module@1 序列 + caps） | core 展开器 | `flows/screenplay` |
| 能力/技能 | `modules/<模块>/module.json` 的 ops（技能卡 = 约束 + 标尺引用） | 任务包装载 + 执行环 skill→tool | `modules/plot`（15 ops） |
| 语料 | `knowledge/**/*.md`（本地可插拔层）→ 编译进 `kit/hypergraph.rag.json` | kb 检索 + 任务包判定标尺 | `knowledge/rules`（17 条去 AI 味条款） |
| 扩展包 | `storyharness/packs/<包>/pack.json` + manifest 三扩展点（pages/apis/config） | serve 挂载表 | `packs/deduce` |

---

## 二 · Kit 能力范畴

### 2.1 四条生产线（flows/，按用途归一）

| 生产线 | 用途 | 结构 | 代表产物 |
|---|---|---|---|
| `screenplay` | 短剧剧本 | 3 模块段（选题 → 世界观/结构/编排 → 剧本），展开 20 节点 | 剧本.md（万字级） |
| `novel` | 长篇小说 | 5 模块段（大纲 → 章节卷积成稿，逐章 iterate） | 终稿.md + 逐章 |
| `prose` | 成文流水线（被 novel 引用的专科层） | 4 模块段（三层稿并行 → 拼装盖章 → 打磨） | 章节正文 |
| `topic` | 选题调研 | 5 模块段（报告 → 套路 → 素材解构，含 manual gate 演示） | 选题报告.md |

每条线：输入在开跑前显式表态（enum 无默认值——选择必须有事实）；产物自带 artifact 头（来源/轮次/上游可溯源）。

### 2.2 推演模式（packs/deduce · 内置扩展包）

点点点剧情推演，galgame 式界面（立绘/对话框/四象限选项/笔记本）：

- 每拍引擎出 **4 个候选反应**（叙事功能四象限：推进/回避/意外/自由）+ 四维打分（人设/推动/OOC 风险/情绪），**作家只点选**——可自写、可换一批、可回退。
- 分数是**建议面**：排序标注、永不构成闸（页脚常驻注记）。
- 导入小说/设定一键生成剧本；生图 seam（ComfyUI 透明立绘 / dashscope / 占位）。
- 「收尾成稿」把拍序列串成纯正文场景草稿（存 `推演/场景草稿.md`）。
- 模板项目 `template-推演` 随包，首次使用自动落地工作区。

### 2.3 能力注册表（modules/ · 8 模块 · 72 ops · 40 skill · 66 caps）

| 模块 | ops | 技能 | 职责 | 代表能力 |
|---|---|---|---|---|
| `base` | 24 | 1 | 确定性底座：质量扫描/纯度检查/台账切片/快照 | scan_quality、check-purity、export-doc |
| `plot` | 15 | 15 | 剧情编排：结构/编排/分场/伏笔/子线/红线 | structure-design、plot-choreographer、subplot-weave |
| `prose` | 13 | 13 | 文学成文：三层稿（台词/场景/设定）+ 成文师拼装 + 去 AI 味 | layer-voices、layer-scenes、prose-assembler、novel-deai |
| `topic` | 7 | 6 | 选题调研：报告/套路/素材/时代感/网感 | topic-report、find-trope、internet-feel |
| `plan` | 4 | 4 | 策划：世界观 forge/圣经/大纲 | world-forge、novel-bible、episodic-outline |
| `delivery` | 4 | — | 交付：docx（自带完整性检查）/渲染页 | export-doc、render_html |
| `search` | 4 | — | 检索基建：kb 装载/搜索/读取 | kb_search、kb_load |
| `drama` | 1 | 1 | 分镜剧本专精 | script-drama-beat |

40 张技能卡全部编译为 `skill.*` 工具（`kit/skills.tools.json`：名称即功能 + 版本号 + 使用约束），执行环强制装载——agent 按需自取标尺。

### 2.4 语料层（knowledge/ · HyperGraphRAG）

| 域 | 卡数 | 内容 |
|---|---|---|
| benchmark | 28 | 判分基准题面（离线体检用） |
| aesthetic | 23 | 审美观（视角/口语/书面/节奏…） |
| rules | 17 | **去 AI 味条款**（禁句式/ quotas / 结构指纹，agent 对照裁决） |
| trope | 13 | 剧情套路卡（按需装载的候选库） |
| structure | 8 | 结构模式（thesis/barbell/dual-line…） |
| craft | 5 | 手艺卡（节管线/用户文风/散文约束） |
| market | 7 | 市场面（平台/档期/受众） |
| formats | 4 | 产物格式契约 |
| method/deconstruct/continuity | 6 | 方法论/拆书/连续性 |

编译产物 `kit/hypergraph.rag.json`：**115 词条 / 5998 关系边 / 12 域**——kb 检索的向量图形态。
源 md 是**本地可插拔层**：改卡即生效（引擎现读盘）、不进 git、可整包替换成你自己的语料。

### 2.5 工具链（tools/ · 48 件，全部确定性脚本）

| 类 | 代表 |
|---|---|
| 守门 lint | flow-lint（flow@3）/ module-lint（module@1）/ kit-lint（注册表一致性） |
| 质量证据 | quality-scan（27 条扫描器聚合）/ laya-scan（学生头直扫）——**只出证据不裁决** |
| 产物 | export-doc（docx，自带源/导出计数/残渣三重检查）/ render_html |
| 坐标感知 | whereami（项目/节点/必读输入）/ snapshot（产物留档）/ flow-verify |
| kit 编译器 | kit-skills（技能→工具注册表）/ kit-compile（语料→HyperGraphRAG） |
| 协作 | batch-edit（同文件多点多改单事务）/ intent-graph（立意图）/ author-home |

### 2.6 明确边界（不是缺口，是立场）

- **无审核/打回/红队/合规**：宿主自己写，三条接入通道见 [`docs/PROTOCOL-REVIEW.md`](docs/PROTOCOL-REVIEW.md)。
- **前端源码不在本仓库**：serve 自带兜底门面；适配层协议见 [`adapter/README.md`](adapter/README.md)。
- **语料 md 不随仓库分发**：GitHub 上只有编译产物；md 是你的本地资产（放回即生效）。
- **不做多租户/云服务**：单机本地运行时，loopback 默认，口令可选。

---

## 三 · 快速开始

依赖：Node ≥ 20、Python ≥ 3.11、一个 OpenAI 兼容模型端点。

```bash
cd core && npm install && cd ../storyharness && npm install && cd ..

mkdir -p .external
cat > .external/storyharness.json <<'JSON'
{ "project": "template-推演", "provider": "zai", "model": "glm-5.3-flash", "apiKey": "你的KEY" }
JSON

# 拉起运行时（内核 8421 + 协议面 8431 + 浏览器）
cd storyharness && npx tsx src/cli.ts web

# 无头跑一条生产线（screenplay，展开 20 节点）
npx tsx src/cli.ts headless "都市奇幻：修表铺祖传怀表能让时间倒转十分钟" --episodes 6

# 推演模式（点点点剧情，galgame 式；内置扩展包自动挂载）
#   浏览器打开 http://127.0.0.1:8431/deduce
```

MCP：`cd core && npm run build` 后在任意 MCP 宿主注册 `node dist/mcp.js`（内核动词与 HTTP 面同表）。

## 四 · 质量口径

- storyharness：**94/94** 测试（含包门禁 11 条、kit 接线 3 条）；tsc 0 错。
- core：**298/298** 测试（29 文件）；三 lint（flow/module/kit）0 error。
- 全链实证：p-sh-fresh01 短剧 20/20 节点零中止、分镜 19.7KB；世界书落位条款首战通过（10 卡全落规范位）。

## 五 · License

[MIT](LICENSE) © 2026 skkbsgzf。致谢：agent 基座 pi-agent-core（MIT）；视觉对标参考
[agegr/pi-web](https://github.com/agegr/pi-web)（MIT，借鉴发生在内部门面）；本地建议面引擎
[SkillRouter](https://github.com/skkbsgzf/SkillRouter)。
