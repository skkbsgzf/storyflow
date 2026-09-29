# storyharness · 创作任务 harness 底座（pi 原生 Workflow 执行器）

排期：`docs/排期-python原生workflow执行器-20260924.md`（本包 = 排期 Q0/Q1 的落地，底座改为**开源 pi agent**——`@earendil-works/pi-agent-core` + `pi-ai` @0.87.1，不自研 LLM 环）。

> **版本见 `VERSION` / `CHANGELOG.md`；底座与语料仓的分界面见 `ARCHITECTURE.md`。** 本包是**语料无关**的通用执行引擎：工作区根与语料布局经 `<workspace>/.storyharness.json` 清单注入，换语料仓不改底座代码（缺省回落 v4 布局，就地运行零改动）。看版本/注入结果：`npm run start -- --version`。

## 架构

- **编排事实单源**：TS 内核（R5 纪律）。harness 只通过 HTTP 面（`MINIFLOW_KERNEL`，默认 8421）调动词：`flow_next` 拿任务包 → 执行 → `flow_submit` 交卷（过内核完整性闸）。
- **LLM**：pi-ai `Models.streamSimple`。内置 provider 目录原生含 `zai`（GLM 全家族，`ZAI_API_KEY` 鉴权）、openai、anthropic、deepseek…；自定义端点（mock/网关）走 `createProvider + setProvider`。
- **工具环**（pi `AgentTool`）：fs_tree/read/write/grep（项目内越界拒绝）、mf_worldbook_search（GraphHyperRAG）、mf_whereami、mf_list_decisions、mf_quality_scan、flow_lint。
- **护栏**：执行器不把 run 状态动词交给 agent 自由调用——`flow_submit` 由 harness 在产物落盘后确定性调用；门/manual 连接件 = flow_next 返回非 awaiting_input，harness 停下报告等人。

## 用法

```bash
# 一次性配置（<workspace>/.external/storyharness.json，git 忽略区；旧名 harness-pi.json 兼容读）：
# { "kernelBase": "...", "project": "p-xxx", "provider": "zai", "model": "glm-5.3", "apiKey": "...", "maxParallel": 3, "thinking": "medium",
#   "tiers": { "default": {"provider":"zai","model":"glm-5.3-flash"}, "high": {"provider":"zai","model":"glm-5.3"} } }
npm run start -- web                        # 一键拉栈：内核 8421 + serve.py 8420 + 协议面 8431，开浏览器（工作台对话页签=pi 单脑）
npm run start -- headless "<题材>" --episodes 1 --project p-xxx   # 冷启动建项目+跑排期，stdout NDJSON 事件流
npm run start -- status --project p-xxx     # 盘面
npm run start -- run-node --project p-xxx   # 执行一个节点并交卷（--dry 只跑不交）
npm run start -- run --project p-xxx        # 批循环：AND-join 并发（--max 并发数，--batches 批上限）
npm run start -- serve --port 8431          # 协议面：/status /start /stop + agent 会话 API（含 turn SSE）
npm run start -- lint [flow]                # flow-lint
npm test                                    # 单测（node:test + tsx，16 用例）
npm run verify:pack                         # 最小第二包立证（demos/mini-pack，临时端口 18990-18992，退出码即验收结果）
```

- **单脑双驱**：交互对话与产线执行是同一个 pi Agent。对话环工具含 flow 生命周期六动词
  （flow_list/init/run/next/submit/resume）；`flow_gate`/`set_decision` 不入环（门裁决归人，铁律 6）。
- **会话落盘**：chat 与 executor 全程写 `<project>/内部/sessions/<sid>.jsonl`——网页「对话」页签可见全部对话与工具往返。
- **换脑接线**：`web` 把 `.storyharness.json` 的 `agent.base` 指到 8431，生成器注入 `DATA.agentApi`，
  工作台对话页签零渲染改动切到 pi 脑；serve 会话 API 镜像内核形状（delta/tool_call/tool_result/round/done/error）。
- **per-op 档位**：任务包 model_tier 信号 → `tiers` 表选模型；缺档时显式打降档声明（不默默降档）。
- **thinking 旋钮**：`thinking: off|low|medium|high` → pi `Agent.thinkingBudgets`；zai 全推理模型，
  `makeStreamFn` 显式 maxTokens=32768（默认值会被思维链吃光致 content 空）。
- **真模型示例**：`PI_PROVIDER=zai PI_MODEL=glm-5.3 ZAI_API_KEY=<key>`（apiKey 写配置文件亦可，进程内落 env）。
- **工作台接驳**：对话视图头栏「▶ 执行器」按钮拉 serve /status，可一键启动批循环。

## 状态

- ✅ Q0-Q4（骨架/单节点/档位/批调度/协议面）＋ 0.3.0 产品化第一批 + 0.4.0（manifest runtime 节 / 项目并发锁 / SSE /events）＋ 0.4.1（dry 语义钉死：不落产物不交卷只出收据遥测，事件带 dry:true；锁 O_EXCL 原子写；transcript events 字段；verify:pack 第二包回归）
- **dry 语义**：`--dry` = 走一遍生成与工具环但**不落产物文件、不交卷**，只写收据与遥测（headless/serve 事件带 `"dry":true`）；dry 会话中 agent 无 fs_write 工具
- ✅ 实弹：p-sh-verify headless 首批（topic-report 交卷通过，工具 3 次，收据+会话+产物三落盘）；
  p-sh-demo2 20 节点全链由前置驱动器跑通（2026-09-24，journal 108 条）
- ⏳ soak 全程对照（20 节点）与 Q5 正式 A/B 验收（建议 model_tier=high 下重跑）
- 遗留：长任务包流式截断展示；llm 调用无 timeout（写手可挂 >100s，待加）；transcript events 的前端消费 = 工单 C-A5（契约已钉死）

## 分析手法工具（mf_analyze_curve / mf_analyze_character）

- **剧情曲线**：按 `knowledge/aesthetic/emotion-curve.md` 六型判别卡分析正文 → JSON（curve_type/confidence/segments 逐段张力/violations 失衡条款/suggestions 换轨建议+铺垫代价）；
- **人物塑造**：出场/台词归属确定性统计 + character 卡三维（欲望/对抗/真相）与弧线评分 + 关系对；
- 方法论卡经内核 `kb_read` **动态装载**（KB 是分析手法的唯一事实源）；`CLI：analyze curve|character --file <项目内路径>`。
- 事件字段注意：pi-ai 流的正文增量在 **`ev.delta`**（不是 `ev.text`）——漏接 = 静默空输出。

## 已知坑（pi 底座接入实录）
## 已知坑（pi 底座接入实录）

- 自定义 provider 的 Model 字段必须**完整**（reasoning/input/cost 必填，baseUrl 必须写进 model 对象）——缺字段会在流解析深处爆 `undefined.includes`；
- provider 未配置 key 时报 `Provider is not configured`——env key 是 `envApiKeyAuth` 的解析源；
- 进程退出需显式 `process.exit`（pi 事件流残留句柄触发 libuv 断言）。
