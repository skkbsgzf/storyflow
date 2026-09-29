# StoryHarness 底座架构 · 语料边界

本文件钉死 **底座（harness）** 与 **语料仓（corpus）** 的分界面。改任何一侧前先读这里。

## 一句话分工

- **底座 = 通用执行引擎**：pi agent 环、内核 HTTP 动词客户端、LLM provider 绑定、批调度器、协议面守护进程、清盘/交卷/收据。它**不认识**任何具体创作项目、流程或规则。
- **语料仓 = 领域内容**：`flows/ skills/ knowledge/ modules/` 与项目数据布局、flow-lint 等语料侧工具。它们通过**清单**向底座声明自己长什么样。

底座可以服务任意一个语料仓；换一个语料仓 = 换一份 `.storyharness.json`，不改底座代码。

## 分界面（唯一的三处注入点）

1. **工作区根** `workspaceRoot`
   解析顺序：`STORYHARNESS_WORKSPACE` 环境变量 → 包上一级（`PKG_ROOT/..`，v4 就地运行兼容）。

2. **语料布局** `CorpusLayout`（`config.ts`）
   ```
   projectsDir     项目数据根（相对 workspaceRoot）      默认 projects
   receiptsDir     交卷收据目录（相对项目根）            默认 内部/收据
   quarantineDir   派发清盘备份目录（相对项目根）        内部/harness-pi/backup
   lintTool        语料侧 lint 脚本（相对 workspaceRoot）tools/flow-lint.py
   lintCommand     lint 执行命令                        python
   ```
   来自 `<workspaceRoot>/.storyharness.json` 的 `corpus` 段；缺省回落 `V4_CORPUS`。

3. **内核地址** `kernelBase`
   解析顺序：`MINIFLOW_KERNEL` → 运行配置文件 → 清单 `kernel.base` → `http://127.0.0.1:8421`。

底座把这些注入后随 `KernelClient(base, workspaceRoot, corpus)` 下发全链路：`projectDir()` 拼项目路径、`flowLint()` 拼 lint 命令、收据/清盘走 `corpus.receiptsDir / quarantineDir`。除这三处外，底座源码内不应再出现任何语料仓专属的目录名字符串。

## 数据流（一个节点的一生）

```
flow_next(内核) → 任务包
  → 派发清盘（旧产物 → quarantineDir）
  → pi Agent 环（判定标尺随任务包注入，LLM 走 provider 绑定）
  → fs_write 落产物到 projectDir(file)
  → flow_submit(内核)
  → 写收据到 receiptsDir/harness-pi-*.json
```

底座只搬运任务包与产物，**不做任何质量裁决**（v5.0：语义裁决归 agent 对照语料卡；机器可查项归扫描器证据；提交链只剩确定性完整性）。

## 运行配置（密钥面，全部 gitignore）

`<workspaceRoot>/.external/storyharness.json`（旧名 `harness-pi.json` 兼容读）：
`provider / model / apiKey / baseUrl / project / maxParallel / thinking / tiers / kernelBase`。
`.external/` 在仓库 `.gitignore` 内——密钥只活在 gitignore 的文件或环境变量里，永不入库、永不回显。

## 换语料仓（可移植性验收）

1. 新仓根放一份 `.storyharness.json`，声明该仓的 `corpus` 布局与 `kernel.base`；
2. 起底座时 `STORYHARNESS_WORKSPACE=<新仓根>`（或把底座包放进新仓的上一级）；
3. `storyharness --version` 应打印新语料名与新 workspace 根，`status/run` 全部指向新仓——底座代码一行不改。

## 版本治理

- 底座版本 = `harness-pi/VERSION`（`loadVersion` 读取，缺省回落 `package.json`）。发版同改 `VERSION`、`package.json.version` 与 `CHANGELOG.md`。
- 语料仓版本 = 仓库根 `VERSION` / `CHANGELOG.md`（见 `AGENTS.md`）。两条版本线**互不绑定**：底座升级不动语料，语料增量（新 flow/技能）不动底座。


## runtime 节（0.4.0 · 工单 B1）

`.storyharness.json` 的 `runtime:` 节把「拉起谁」声明化：

```json
"runtime": {
  "kernel": { "command": "npx tsx src/cli.ts up --port {port}", "cwd": "core", "port": 8421, "health": "/" },
  "ui":     { "command": "python tools/serve.py {port}", "cwd": ".", "port": 8420, "health": "/" }
}
```

- `web` 对每个服务：有声明按声明拉起（`{port}` 占位替换、cwd 相对语料仓根），健康检查打 `health` 路径；
- **无 `runtime` 节 = 回落 v4 缺省**（`core up` + `tools/serve.py`）——向后兼容是回归测试项；
- 只声明化，不做插件系统（dsh 减法纪律）。子进程 stdio pipe+排水（0xC0000142 教训）。

