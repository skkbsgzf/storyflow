# AGENTS.md · StoryFlow Kit 工作区指引

给在本仓库工作的 agent 的必读摘要。深度文档见 `docs/Agent.md`（内核接入总览 + 维护纪律）与 `docs/规范-*.md`（各工单规格，铁律散布其中）。

## 仓库是什么

「故事 kit 提供者」运行时：pi-agent-core 驱动的 agent runtime + 模块化 flow@3 编排 + MCP + 确定性工具链 + 可插拔语料。**两个进程 + 一层适配**：

- **core（:8421，`core/src/`，TS + vitest）** — 编排事实唯一源：flow@3 描述符 → expandFlow3 → overlay 生效编排；动词单表（CLI/HTTP/MCP 三脸同源）+ kb 图检索。依赖 `../adapters`（`@storyflow/adapters`，file: 依赖）。
- **storyharness（:8431，`storyharness/src/`，TS + node:test）** — agent 运行时：协议面 serve、执行环（executor/chat/tools）、批调度（AND-join）、会话 JSONL、扩展包三件（packs/packgate/packctx）。**无内置包**——deduce（推演）已整体挪出至 `D:\storyflow-deduce\`，挂载机制保留（工作区 `<ws>/packs/` 或 manifest `runtime.packs` 可挂）。
- **tools/（Python ≥ 3.11）** — 确定性工具链：三 lint（flow-lint / module-lint / kit-lint）、quality-scan（只出证据）、export-doc、kit 编译器（kit-compile / kit-skills）、kit.py（vendor 器）。
- **声明面**：`flows/`（生产线，module@1 序列）｜`modules/`（能力注册表，module.json 的 ops = 技能卡）｜`knowledge/`（语料卡，本地层）｜`contracts/`（JSON Schema 契约）｜`skills/`｜`agents/`（档案）｜`presets/` + `assertion-presets/`。
- **adapter/**（对外七端点协议 + 零依赖客户端）与 **adapters/**（fs/path/proc 适配实现）是两个不同目录，勿混。
- `projects/` 是运行数据，整个目录不入 git。
- **发布口径**：本仓库与 GitHub 提交仓库直接对应，入库即公开。代码与提交里不含项目数据——`projects/` 运行数据、`.external/` 的 apiKey、真实语料 md 一律不入库，测试用合成 fixture，别把真实项目数据写进代码或提交。
- **前端已切离本仓（2026-10-02）**：门面（home.ts）、页面生成器（serve.py/project-pages.py/模板页/package.py/author-home.py/page-lint.mjs）、根 index.html 全部退役；deduce 扩展包整体挪出（`D:\storyflow-deduce\`）。**勿在本仓重建 v4 形态 UI（工作台/画布/生成页）**——唯一的例外是《工单-20261002-官方adapter能力面与panel》定义的官方面：`adapter/` 能力声明 + `panel/` 零构建组件范本（会话/文件/世界书/RAG 四能力，可打包浏览器插件独立运行）。被切代码存档与 v4 收拢见 `docs/交接回执-前端切割与v4收拢-20261002.md` 与 `D:\storyflow-extracts\`。

## 常用命令

```bash
# ⚠ node_modules 随仓库提交（core ≈6.5k、storyharness ≈11.9k tracked 文件）：
#   不要顺手 npm install / 升级依赖 / 清理 node_modules——会重写上万 tracked 文件。

cd core && npm test                    # vitest 全量，必须全绿；单文件: npx vitest run test/<file>.test.ts
cd core && npm run build               # tsc 全量类型检查（core 无独立 typecheck script）
cd storyharness && npm test            # node:test via tsx 全量
cd storyharness && npm run typecheck   # tsc --noEmit

node scripts/gen-verbs-doc.mjs --check # 门禁 1（仓库根跑），不一致 exit 1
node scripts/gen-openapi.mjs --check   # 门禁 2（仓库根跑）

python tools/flow-lint.py / module-lint.py / kit-lint.py   # 三 lint，0 error
python tools/kit-compile.py            # 改 knowledge/ 语料后重编译 → kit/hypergraph.rag.json
python tools/kit-skills.py             # 技能卡 → kit/skills.tools.json 注册表

cd storyharness && npx tsx src/cli.ts web   # 拉起运行时（内核 8421 + 协议面 8431；无页面服务，自动打开的是协议面落地页）
```

环境：Node ≥ 20、Python ≥ 3.11、OpenAI 兼容端点配置在 `.external/storyharness.json`（不入库）。

## 架构红线（改代码前必读）

1. **动词单表**：`core/src/verbs.ts` 是内核对外能力唯一声明源，CLI / HTTP（`/api/verbs` legacy + `/api/v1`）/ MCP 三面全部由它派生。改动词只改这一处，然后跑 `node scripts/gen-verbs-doc.mjs --write`（`docs/Agent.md` 第三节表格是生成物，勿手改）和 `node scripts/gen-openapi.mjs --write`（`contracts/http-openapi-v1.json` 是生成物，勿手改）。legacy `contracts/http-openapi.json` 冻结在 v1.2，不回改。
2. **双根不许合一**：repoRoot（flows/modules/knowledge/contracts/skills/…）与数据根（`projects/<id>/` 运行数据）是两个根。历史上合成一处导致注册表静默解析为空。
3. **FS 抽象层**：`core/src`（除 `abstraction/` 与六个豁免宿主入口：cli.ts / export-cli.ts / quality-cli.ts / ids.ts / kernel.ts 等）**禁止 import `node:fs` / `node:path` / `node:child_process`**。缺省实现走 `core/src/abstraction/defaults.ts` 注册表（未注册 = 抛错点名，不静默写盘）；宿主经 `registerAdapters({ fs, path, proc })` 注入。`core/test/defaults-registration.test.ts` 钉住死表。
4. **人的动词不进 agent 工具环**：`flow_gate` / `set_decision` / `ig_commit` / `ig_exclude` 刻意不给机器——门与边界裁决归人，宿主自动化循环交卷后必须停下等人裁。
5. **证据与裁决分离**：quality_scan 等扫描只出 findings + 收据文件路径，数值线不构成提交闸；一切「已扫描 / 残留 N 处」类声明必须引用收据路径，无收据 = 删声明。
6. **决策必须有来源**：`set_decision` 的 `by` + `evidence` 必填（缺了进 issues 不进 values）；ig_propose 带 p 必须带有效 scorer（semif-4b / laya-student / jev-api），不编造概率。
7. **skill_patch 提案制**：默认 proposed 不生效，须显式 approve。
8. **语料是本地层**：`knowledge/**/*.md` 全部 gitignore（README 除外），引擎现读盘、改卡即生效；GitHub 上只有编译产物 `kit/hypergraph.rag.json`。技能卡编译为 `skill.*` 工具注册表 `kit/skills.tools.json`。
9. **运行时无审核/合规逻辑**——是立场不是缺口，宿主自己写，接入协议见 `docs/PROTOCOL-REVIEW.md`。
10. **MCP 资源/提示**：改 `mcp.ts` 里的 `MCP_RESOURCES` / `MCP_PROMPTS` 两张表本身，注册与测试自动跟上；不要在注册处硬写 URI 字符串。
11. **改任一面**（CLI/HTTP/MCP 的路由、工具名、参数）→ 同步 `docs/integration/` 对应文件（mcp-reference / rest-api-reference / sse-events / embedding-modes）。

## 已知坑

- **SSE 事件源是 `journal.jsonl` 台账（磁盘真相），不是进程内总线**；部分 kind 刻意不投影（`JOURNAL_TO_SSE` 显式 null，不是漏）。心跳常量有测试钉住。
- CLI 脸冷启动税实测 ≈103s（`npx tsx`）——宿主侧集成默认走 MCP，脚本化才用 CLI。
- 文档、注释、commit message 全中文；commit 用 `fix(core):` / `docs:` / `chore:` 式前缀 + 中文描述。
- 本机 `python` 指向 Windows 商店 stub（exit 49 无输出）；真身是商店版 3.13：`/c/Users/Administrator/AppData/Local/Microsoft/WindowsApps/PythonSoftwareFoundation.Python.3.13_qbz5n2kfra8p0/python.exe`。起 `tools/serve.py` 等要用完整路径（`web` 命令内部 spawn `python` 同样会踩）。**内核脚本壳也硬编码 `python`**（core/src/minitools.ts），所以 core 全量测试在本机有一例环境性失败（r8-os02cd 的「脚本壳超时」D#14，stub 秒退 49 吃不到超时路径）——把真 python 放上 PATH（关掉应用执行别名）即愈，非代码问题。
- 本机用户环境变量 `STORYHARNESS_WORKSPACE` 指向 storymasterv4（另一个项目的工作区）——从计划任务/新终端起本仓服务必须显式 `set STORYHARNESS_WORKSPACE=D:\storyflow-kit`，否则 hub/workspace 静默落到 v4。**长驻服务别从 agent 会话进程树里起**（会被环境周期性回收；serve.py / next dev / core 子进程全中过招）。现成做法：`%TEMP%\start-kit.bat`（三件套：core 8421 / web 8431 / kitapp dev 30142，bat 内已钉工作区）+ `schtasks /Create /SC ONCE` 一次性触发，跑完删任务。curl 调 8431 记得 `--noproxy "*"`（本机系统代理会截 127.0.0.1 的请求）。
- 会话产物 JSONL、项目状态都在数据根 `projects/<id>/` 下，排障先看那里而不是进程日志。
