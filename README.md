# StoryFlow Kit · 故事创作的综合能力套件

> **把编剧与网文的方法论沉淀成可检索、可执行、可演化的知识库，让任何 agent 基于它进行创作、诊断与改写。**
> pi-agent-core 驱动的 agent runtime + 模块化 flow 编排 + HyperGraphRAG 知识库 + 确定性工具链 + 静态项目看板。
> 浏览器、Electron、CLI、MCP——同一个适配层接入。审核、打回、合规宿主自己写（我们有接入协议），运行时不含任何裁决逻辑。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![version](https://img.shields.io/badge/version-6.0.0-green.svg)](CHANGELOG.md)
![tests](https://img.shields.io/badge/tests-core%20498%20%2B%20harness%20161-brightgreen)

---

## 它是什么

StoryFlow Kit 把创作能力拆成**四相**，共用同一个知识库（KB），结构上保证「诊断、建议、修改」永远同源：

```
                知识库 KB（117 词条 · 规则卡 · 方法卡 · 世界书）
                     │  同一份规则定义
        ┌────────────┼────────────┬────────────┐
        ▼            ▼            ▼            ▼
      写（5 条生产线）  诊（毫秒级体检）  改（改单+diff 人审）  拆（样本→规则回流）
```

- **写**：4 条生产线（短剧剧本 / 长篇小说 / 成文流水线 / 选题调研），flow@3 声明式编排，产物自带溯源头。
- **诊**：`diag_scan` 毫秒级确定性体检（零 LLM）+ 语义级卡驱动诊断——**只出证据，不裁决**。
- **改**：`repair-plan@1` 改单契约——每条改动挂规则条款（rule_ref），产出 unified diff 交人审，可回滚；B 级主观审美绝不自动改。
- **拆**：从样本反向提炼规则卡回流知识库（抽样优先，防「全书记忆化」冒充拆书）。

**立场（这是特性，不是缺失）**：kit 是纯粹的——不参与流程裁决（裁决权在人与宿主）、不做前端应用（只交付一个静态项目看板）、不含审核合规（宿主域）、语料 md 是用户本地资产不入库。

---

## 在 agent 软件中使用（codex · workbuddy · dsh · 任意 MCP 客户端）

kit 的 28 个动词**三脸同源**（CLI / HTTP `/api/v1` / MCP），外部 agent 三种接法：

**① MCP 工具模式（最薄，推荐先试）**——把 core 的 MCP server 挂进你的 agent 软件：

```jsonc
// codex / workbuddy / dsh 的 MCP 配置
{ "mcpServers": { "storyflow-kit": { "url": "http://127.0.0.1:8421" } } }
```

挂上即得 28 个工具：`kb_search`（知识库聚簇检索）、`kb_read`（读卡）、`diag_scan`（毫秒级文本体检）、`worldbook_search`（项目世界书）、`flow_run/flow_next/flow_submit`（生产线推演）、`list_decisions`（决策事实账）……全表见 [`docs/Agent.md`](docs/Agent.md)。

**② 会话模式（全能力）**——经 8431 协议面开 kit 会话（`adapter/` 七端点 + SSE）：内部 agent 额外持有语义工具环——`mf_analyze_card`（对照规则卡诊）、`mf_apply_repairs`（按改单产 diff）、`mf_deconstruct`（拆书归因）。适配协议见 [`adapter/README.md`](adapter/README.md)，宿主接入范式见 [`docs/integration/host-integration.md`](docs/integration/host-integration.md)。

**③ 遵循入口**：改稿/创作的工作法沉淀在方法卡 `kb/method/revise-workflow`（`kb_read` 即得）——外部 agent 按卡行事，与 kit 内部 agent 同一纪律。

---

## 能力总览

| 域 | 能力 | 入口 |
|---|---|---|
| **知识库 KB** | 117 词条 · 12 域 · 板块（文风/编剧/立意/选材/情绪）· 编译期聚类 54 簇 · 双根检索（全局+项目）· 亲和对账 | `kb_search` `kb_read` |
| **生产线** | screenplay / novel / prose / topic（+test-dual）；flow@3 声明式编排 · overlay 运行时改写 · AND-join 批调度 · 编排挖掘 | `flow_*` |
| **快诊断** | S 级 13 检查毫秒级（含退化四组：复读/截断/占位/工程词泄漏）+ slop 词表 + 词汇表越权守卫；幅度可配（tierThreshold/cardScope/severityFloor） | `diag_scan` `quality_scan` |
| **改稿套件** | 七步 runbook 方法卡 + 改单契约 + diff 人审 + snapshot 回滚 + `project-init --import` 成稿收编 | 方法卡 `kb/method/revise-workflow` |
| **项目套件** | `--domain` 领域骨架（网文/剧本变体，自定义 JSON）· `--import` 导入 · 索引/增量/记忆本地化 · 项目级 RAG · 外部目录项目根 | `project-init.py` `project-index.py` `kit-compile.py` |
| **冷启动** | `openQuestions` 询问清单（图/视频场景强制拿到生图接口才开工）+ `sessionBrief` 项目自述注入会话简报 | 项目配置.json |
| **项目看板** | 静态自包含 HTML（七区：知识体系/世界书/大事记/RAG 图谱/知识表格/产物/诊改），幂等可分发；产物 md/txt 读写三通道；Cloudflare+token 任意设备查看 | `tools/dashboard.py` |
| **拆·逆向** | 样本抽样 → 归因 → 规则卡草稿 → 人审回流 KB | `tools/deconstruct.py` `mf_deconstruct` |
| **媒体（图文/视频）** | 提示词层能力在库（Seedance 分镜提示词）；契约七份（分镜表/美术资产/出图任务/回执/引擎能力声明）+ 出图计划/资产台账工具；`mediaEndpoints` 生图接口冷启动口 | `presets/image/` `tools/img-plan.py` |

规模：**28 动词 · 8 模块 69 ops · 40 技能卡 · 6 agent 剖面 · 41 契约 · 53 确定性工具 · 5 生产线**。core 测试 498/499、storyharness 161/161、三 lint 0 error。

---

## 快速开始（开发者）

依赖：Node ≥ 20、Python ≥ 3.11、一个 OpenAI 兼容模型端点。

```bash
git clone https://github.com/skkbsgzf/storyflow.git && cd storyflow
cd core && npm install && cd ../storyharness && npm install && cd ..

mkdir -p .external
cat > .external/storyharness.json <<'JSON'
{ "project": "demo", "provider": "zai", "model": "glm-5.3-flash", "apiKey": "你的KEY" }
JSON

# 拉起运行时（内核 8421 + 协议面 8431）
cd storyharness && npx tsx src/cli.ts web

# 无头跑一条生产线（screenplay，展开 20 节点）
npx tsx src/cli.ts headless "都市奇幻：修表铺祖传怀表能让时间倒转十分钟" --episodes 6
```

给现有项目挂知识库（改稿场景）：

```bash
$PY tools/project-init.py my-novel --upgrade --dir "D:\我的项目"     # 补骨架（13 件）
$PY tools/project-init.py my-novel --import "D:\我的项目\正文" --dir "D:\我的项目"  # 收编成稿+自动索引
$PY tools/kit-compile.py --project my-novel --root "D:\我的项目"      # 项目档 RAG
# 任意文档目录 → 知识库（通用 RAG）：
$PY tools/kit-compile.py --src <语料目录> --out output/hypergraph.json
```

> 本机 `python` 若是 Windows 商店 stub，用商店版完整路径（见 docs/工单）。冷启动时项目配置里的 `openQuestions` 会驱动会话 agent 向你询问题材/频道/单章字数等必要信息——图/视频场景必须提供生图接口。

---

## 仓库结构

```
storyflow/
├─ core/            # 编排内核（TS）：动词单表 28（CLI/HTTP/MCP 三脸）· flow@3 展开器 · KB 检索 · 快诊断 · MCP
├─ storyharness/    # agent 运行时（TS）：协议面 8431 · 执行环 · 会话简报 · 文件读写 API · 扩展包挂载
├─ adapter/         # 对外七端点协议 + 零依赖客户端（宿主接入面）
├─ agents/          # 角色剖面（改稿编辑/编剧/红队…）
├─ contracts/       # 41 份 JSON Schema（跨进程数据结构唯一真相）
├─ flows/           # 4+1 条生产线描述符（module@1 序列）
├─ modules/         # 8 模块能力注册表（69 ops = 技能卡挂载点）
├─ knowledge/       # 知识库源卡（本地层；入库的是编译产物 kit/）
├─ skills/          # 40 张技能卡
├─ presets/         # 领域骨架预设（skeletons/）+ 生产线预设 + 图像预设（image/）
├─ tools/           # 53 件确定性工具（三 lint / 扫描器 / 看板 / 拆书 / 编译器）
├─ scripts/         # 门禁生成器 + 运维件（三服务无窗启停）
├─ kit/             # 编译产物（hypergraph.rag.json + skills.tools.json）
├─ panel/FROZEN.md  # 退役墓碑（前 panel 应用已出仓，见 git 历史）
├─ projects/        # 运行数据（gitignore；会话/产物/索引/收据）
└─ docs/            # 规格与工单（ARCHITECTURE 是唯一入口）
```

## 文档地图

| 你要读的 | 去哪 |
|---|---|
| **内核架构规格（唯一入口）** | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| agent 接入（动词全表 + 三脸） | [`docs/Agent.md`](docs/Agent.md) |
| MCP / REST / SSE 参考 | [`docs/integration/`](docs/integration/) |
| 宿主适配范式（pinax 桥实证） | [`docs/integration/host-integration.md`](docs/integration/host-integration.md) |
| 看板 Cloudflare 部署 | [`docs/integration/dashboard-deploy.md`](docs/integration/dashboard-deploy.md) |
| 审核/打回接入协议 | [`docs/PROTOCOL-REVIEW.md`](docs/PROTOCOL-REVIEW.md) |
| 契约层导读 | [`docs/contracts.md`](docs/contracts.md) |
| 路线图与工单 | [`docs/ROADMAP.md`](docs/ROADMAP.md) · `docs/工单-*.md` |
| 历史决策（只读） | `docs/_archive/` |

## 明确边界（立场，不是缺口）

- **无审核/打回/红队/合规**：宿主自己写，接入协议 [`docs/PROTOCOL-REVIEW.md`](docs/PROTOCOL-REVIEW.md)。
- **无 UI 应用**：静态项目看板是唯一交付形态（固定模板自包含 HTML）；工作台、画布、生成页请交给宿主与插件/皮肤生态。
- **语料 md 不随仓库分发**：GitHub 上只有编译产物；md 是你的本地资产（放回即生效）。
- **不做多租户/云服务**：单机本地运行时，loopback 默认，口令可选；看板公网分发用你自己的 Cloudflare。
- **机器只出证据**：一切扫描/诊断只产证据与收据，语义裁决归 agent，端尾验收归人。

## 质量口径

| 面 | 基线 |
|---|---|
| core 测试 | 498/499（1 例本机 python stub 环境例） |
| storyharness 测试 | 161/161 |
| 三 lint | flow 0E/0W · module 0E/33W（存量记账）· kit 0E/2W（存量记账） |
| 门禁 | 动词表 / OpenAPI 逐字节一致（生成物，勿手改） |
| KB 治理 | 板块+聚类双层 · 亲和对账 · 体检工具（kb-health）· 检索质量探针评测 |

## License

MIT
