# StoryFlow · 轻量、可玩的故事 Kit

> 一个「故事 kit 提供者」的运行时：**pi-agent-core 驱动的 agent runtime + 模块化 flow + MCP + 确定性工具链 + 可插拔语料**。
> 浏览器、Electron、移动端通过同一个适配层接入。审核、打回、合规——宿主自己写（我们有接入协议），运行时不含任何审核逻辑。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![version](https://img.shields.io/badge/version-0.9.0-green.svg)](CHANGELOG.md)

---

## 定位

**轻量、可玩性高的故事 kit 提供者。** 你拿到的是一台「故事生产线」：
输入题材与集数，四条按用途归一的生产线（短剧剧本 / 长篇小说 / 成文流水线 / 选题）替你把故事跑出来；
**推演模式**（点点点剧情 galgame，内置扩展包 `packs/deduce`）让你亲手玩剧情走向。运行时保持最简：

```
pi-agent-core（agent 执行环）
  + module（module@1 能力注册表）
  + mcp（MCP 三面动词）
  + tool（确定性工具链，名称即功能带版本）
  + flow（flow@3 生产线，按用途归一）
  + 杂仓（kit：技能工具注册表 + HyperGraphRAG 向量图 + 生图/资产 seam）
```

## v0.8 的六个结构决定

1. **零 demo、零项目细节**——flows 只按用途命名（screenplay/novel/prose/topic），不带题材不带角色。
2. **运行时精简**——上述六件套之外的一切（前端源码、判官、质量扫描器、红队、审核流）不在运行时。
3. **Skill 即 Tool**——40 个内置技能全部以 `skill.*` 工具注册（名称即功能 + 版本号 + 使用约束），见 `kit/skills.tools.json`；用户自导技能另册。
4. **knowledge = 一个 HyperGraphRAG 文件**——`kit/hypergraph.rag.json`（115 词条 / 5998 关系边）；松散 md 是本地可插拔层（引擎现读盘），不上传 GitHub。
5. **无审核层**——合同/审核/约束/红队整体退役。宿主要做审核？`docs/PROTOCOL-REVIEW.md` 三条接入通道（gate 暂停点 / 事后审 / 对话内审）。
6. **适配层**——`adapter/`：一个 base URL + 一个口令 + 七个端点，浏览器/Electron/移动端同构接入，参考客户端 `storyflow-client.mjs` 零依赖。

## 快速开始

依赖：Node ≥ 20、Python ≥ 3.11、一个 OpenAI 兼容模型端点。

```bash
cd core && npm install && cd ../storyharness && npm install && cd ..

mkdir -p .external
cat > .external/storyharness.json <<'JSON'
{ "provider": "zai", "model": "glm-5.3-flash", "apiKey": "你的KEY" }
JSON

# 拉起运行时（内核 8421 + 协议面 8431 + 浏览器）
cd storyharness && npx tsx src/cli.ts web

# 或无头跑一条生产线
npx tsx src/cli.ts headless "都市奇幻：修表铺祖传怀表能让时间倒转十分钟" --episodes 6

```

MCP：`cd core && npm run build` 后在任意 MCP 宿主注册 `node dist/mcp.js`（20 个内核动词）。

## 可插拔层（改文件即生效）

| 想改什么 | 动哪里 | 生效 |
|---|---|---|
| 提示词语料（去AI味/文风/编排） | `knowledge/` 本地 md（引擎现读盘） | 即时；改后 `python tools/kit-compile.py` 重建向量图 |
| 技能 | `skills/*.md`（40 张卡 → `kit/skills.tools.json` 注册表） | `python tools/kit-skills.py` 重建 |
| 生产线 | `flows/screenplay|novel|prose|topic/flow.json` | `python tools/flow-lint.py` 过 0 error |
| 能力注册 | `modules/*/module.json` | 重启内核 |
| 运行配置 | `.external/storyharness.json` | 即时/重启 |

注意：`knowledge/**/*.md` 不进 git（见 `knowledge/.gitignore`）——它是你的本地语料资产；
GitHub 上只有编译产物 `kit/hypergraph.rag.json`。克隆后把你的 md 放回 `knowledge/` 即恢复全部语料。

## 目录

```
core/            编排内核（flow@3 引擎 / verbs / overlay / MCP / agent 对话流）
storyharness/    运行时（serve 协议面 / 批调度 / 执行环 / 会话 JSONL / packs/ 扩展包 / desktop 壳；前端源码不在本仓库）
adapter/         适配层：接口协议 + 零依赖参考客户端
kit/             杂仓：skills.tools.json（技能工具注册表）+ hypergraph.rag.json（知识向量图）
flows/           四条用途生产线（screenplay / novel / prose / topic）
modules/         module@1 能力注册表（8 模块）
skills/          技能源卡（本地；编译进 kit）
knowledge/       提示词语料（本地；编译进 kit）
tools/           确定性工具链 + kit 编译器（kit-skills / kit-compile）
contracts/       flow@3 / overlay JSON Schema
docs/            规格 + 审核接入协议（PROTOCOL-REVIEW）
```

## 审核在哪

**不在运行时里。** 我们不内置判官、打分、红队、合规。宿主要审核：
gate 暂停点自己裁决 / 事后 rerun 定点重跑 / 对话内只读档旁听——三条通道见
[`docs/PROTOCOL-REVIEW.md`](docs/PROTOCOL-REVIEW.md)。

## License

[MIT](LICENSE) © 2026 skkbsgzf。致谢：agent 基座 pi-agent-core（MIT）；视觉对标参考
[agegr/pi-web](https://github.com/agegr/pi-web)（MIT，借鉴发生在内部门面）；本地建议面引擎
[SkillRouter](https://github.com/skkbsgzf/SkillRouter)。
