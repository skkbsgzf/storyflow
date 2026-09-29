# StoryFlow · 底座 + 语料包的 AI 创作运行时

> StoryHarness 运行时内核的开源发布。一个把「AI 帮你写剧本/小说」从聊天框变成**可编排生产线**的本地运行时：
> flow@3 编排引擎 + 协议面守护 + MCP 三面 + 确定性工具链，而**去 AI 味、文风模仿、剧情编排的提示词语料全部是磁盘上的可插拔文件**。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![version](https://img.shields.io/badge/version-0.7.2-green.svg)](CHANGELOG.md)

---

## 这是什么

StoryFlow 把创作拆成三层：

```
┌──────────────────────────────────────────────────────────────┐
│  语料层（preset · 全部是磁盘文件，热读，改完即生效）            │
│  knowledge/  规则卡·知识卡·去AI味条款·文风条款·剧情编排知识     │
│  skills/     编剧/文学/检测各专科的作业技能卡                   │
│  flows/      flow@3 编排模板（短剧线/长篇线/选题线…）           │
│  modules/    module@1 能力注册表（能力必须有家）                │
├──────────────────────────────────────────────────────────────┤
│  运行时                                                        │
│  core/            编排内核（:8421）flow 引擎·verbs·overlay·MCP │
│  storyharness/    协议面守护（:8431）批调度·会话·判官证据·SSE   │
│  tools/           确定性工具链（lint/scan/export/snapshot…）    │
├──────────────────────────────────────────────────────────────┤
│  消费者（可选，本仓库发布不含前端源码，serve 自带兜底门面）       │
│  浏览器工作台 / MCP 客户端 / 任何能发 HTTP 的东西               │
└──────────────────────────────────────────────────────────────┘
```

三条设计立场：

1. **前后端解耦是硬边界**——内核与协议面只讲 HTTP/SSE/JSON（接口清单见 `docs/`），前端只是消费者之一。开发者可以完全基于开放的后端代码改造自己的界面。
2. **提示词本体可插拔**——「去 AI 味」「文风模仿」「剧情编排」不是写死在代码里的 prompt，而是 `knowledge/`、`skills/` 下的版本化文本卡；引擎每次派发**现读盘**，改文件即生效，删文件即降级，不进代码库也能挂自己的语料。
3. **证据不裁决**——机器判分（快判官/扫描器）只产出复核优先级证据，永远不构成拦截闸；语义裁决归模型与人。

## 快速开始

依赖：Node ≥ 20（本机 24 实测）、Python ≥ 3.11、一个 OpenAI 兼容的模型端点（如 ZAI）。

```bash
# 1) 装依赖（两个包各自独立）
cd core && npm install && cd ..
cd storyharness && npm install && cd ..

# 2) 配模型端点（.external 不入库，自己建）
mkdir .external
cat > .external/storyharness.json <<'JSON'
{ "provider": "zai", "model": "glm-5.3-flash", "apiKey": "你的KEY" }
JSON

# 3) 一键拉起（内核 8421 + 协议面 8431 + 浏览器）
cd storyharness && npx tsx src/cli.ts web

# 4) 或者无头跑一条完整生产线（20 节点短剧流）
npx tsx src/cli.ts headless "都市奇幻：修表铺祖传怀表能让时间倒转十分钟" --episodes 6
```

MCP 接入（在 Claude Desktop / Qoder / 任何 MCP 宿主里用同一批动词）：

```bash
cd core && npm run build
# 宿主配置里注册：node dist/mcp.js（20 个内核动词：flow_* / whereami / snapshot / quality_scan …）
```

## 前后端接口

| 面 | 端口 | 形态 | 文档 |
|---|---|---|---|
| 编排内核 | 8421 | HTTP `POST /api/verbs/:verb`（flow_run/flow_next/flow_gate/whereami/snapshot/quality_scan…）+ 工作台静态页 | `docs/底座规格-miniflow-harness.md` |
| 协议面 | 8431 | REST + SSE（`/status` `/start` `/stop` `/events`、会话 CRUD、`/api/panel/*`、`/api/kernel-verb` 白名单代理） | `storyharness/src/serve.ts`（路由即文档）+ `docs/规范-项目文件与流程配置-R4.md` |
| MCP | stdio | 三面动词：事实面（内核内联）/ 建议面（skillrouter）/ 判断面 | `core/src/mcp.ts` |

前端仓库不在本发布内：serve 对未知路径自带 `home.ts` 兜底门面，任何静态托管指向 8431 亦可。

## 可插拔语料（preset 层怎么玩）

| 想改什么 | 动哪个文件 | 生效时机 |
|---|---|---|
| 去 AI 味条款 | `knowledge/rules/*.md`（域卡，50 条） | 下次派发现读 |
| 文风模仿 | `skills/` 文风卡 + `knowledge/craft/`·`knowledge/rules/` 文风条款 | 同上 |
| 剧情编排知识 | `knowledge/plot/`、`knowledge/craft/`、`knowledge/trope/` | 同上 |
| 新增一条生产线 | `flows/<名字>/flow.json`（flow@3） | `flow_run` 可选 |
| 新增/挂载能力 | `modules/<模块>/module.json`（module@1） | 重启内核 |
| 旋钮（字数档/模型档/判官开关） | `.external/storyharness.json`（运行配置）+ overlay | 即时/重启 |

纪律：`tools/module-lint.py` + `tools/kit-lint.py` + `tools/flow-lint.py` 是语料层的守门人，改完跑一遍，0 error 才算数。

## 目录导览

```
core/            编排内核：flow@3 引擎、verbs 单表、overlay 生效编排、MCP 面、agent 对话流
storyharness/    运行时产品：serve 协议面、批调度 scheduler、pi-agent 执行环、会话 JSONL、
                 判官证据（evidence-only）、遥测、MCP/toolchain 桥
tools/           确定性工具链：flow-lint / module-lint / kit-lint / quality-scan / laya-scan /
                 export-doc（自带完整性检查）/ snapshot / whereami / worldbook / batch-edit …
knowledge/       提示词语料：规则卡 50 条（C 轨）+ 知识卡 + 文风/编排/去AI味条款（全部可插拔）
skills/          专科技能卡：选题/编剧/文学/分镜/交付/检测
flows/           flow@3 生产线模板（短剧/长篇/选题/推演）
modules/         module@1 能力注册表（topic/plan/plot/prose/drama/delivery/detect/search/base）
contracts/       JSON Schema：flow@3 / overlay / artifact 头 / 指标
docs/            规格文档：底座规格 + R4-R8 规范 + 版本宣告 + 设计稿
demos/mini-pack  最小语料包样例（npm run verify:pack 可自验）
```

## 规格文档（docs/）

- `底座规格-miniflow-harness.md` —— 总纲
- `规范-项目文件与流程配置-R4.md` → `规范-生成式flow与运行时编排-R5.md` → `规范-模块化flow与工具箱-R6.md` → `规范-开源部署与可调面-R7.md`（**可调面唯一真源表**）→ `规范-规则语料与orchestrator激活-v6.md` → `规范-候选库与选择面-R8.md`
- `版本宣告-v4.0.0.md` / `v5.0.0.md` —— 代际口径

## License

[MIT](LICENSE) © 2026 skkbsgzf。致谢：视觉对标 [agegr/pi-web](https://github.com/agegr/pi-web)（MIT；令牌值与布局几何的借鉴发生在内部门面，本发布不含前端源码）；本地建议面引擎 [SkillRouter](https://github.com/skkbsgzf/SkillRouter)。
