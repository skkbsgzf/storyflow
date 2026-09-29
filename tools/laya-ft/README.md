# laya-ft · Laya 中文学生模型训练管线（编剧 + 文学写作判断层）

> 分工：本仓出题面（Question Spec）、数据管线脚本、验收脚本；训练按本包「训练执行体」跑；
> **训练完交回本仓出体检报告（accept.py）。2026-09-24 人裁修订：accept 为离线体检（known-weakness 标注＋重训选题依据），不是部署闸——学生上岗不设过闸前置，弱项随扫描输出如实标签。见 `docs/人裁-laya唯一引擎-20260924.md`。**
> 上游依据：`docs/调研-Jev与SystemOne决策层-20260923.md` + 甲方《固定问题集自优化方案》
> + 本仓对照实验（tools/laya-exp/：Laya 零样本 zh 仅 53%/33%，必须领域微调）。
>
> **v0.2.0（2026-09-23 训练轮）**：题面 14→19 题（编剧+文学机器类快决策全量，见下）；
> 训练执行体落地为本仓 `train_head.py` + `fit_temperature.py`；本轮教师端 = 本机 4B daemon
> （强 API 端点未提供——**偏差如实记**：学生成绩上限=教师自一致性；接强 API 教师重标属 v2 工单）。

## 资产

| 文件 | 作用 |
|---|---|
| `questions.spec.json` | **Question Spec v0.2.0**：19 个 qid（11 noul / 5 choice / 3 score），每题 rubric_ref 指向真实知识卡（semif 校准包 / slop-list / hook-3s / scene-value / dialogue / emotion-curve / pacing-density / reversal / sensory-detail / ai-trace / conflict-escalation / perspective-review / metaphor-zh / user-style-rules R7）。v0.2 新增 5 题：`slop.neg-pattern` / `slop.reveal-stack` / `craft.daisy-chain` / `craft.simile-suspend`（semif 已校准/试点条款进学生）+ `drama.hook-type`（短剧四型钩判别） |
| `state_builder.py` | 项目稿件 → 增强 state（场景文本 + 人设卡 + 章节位置 + 视角人物）。**师生输入同构**：教师标注与线上推理用同一组装器 |
| `label_gss.py` | 教师标注 + GATE-1 自一致性（K=5 采样，频率即软标签分布）。后端：`daemon`（本机 Qwen3.5-4B）/ `api`（强模型）。v0.2 起支持**断点续跑**（out 逐行 append，重启认领已标对）+ **分层抽样**（--limit 跨文件打散） |
| `export_train.py` | 标注 → Laya typed-decisions 训练格式，train/held/test = 70/15/15（held 供 GATE-2 拟温度，test 供 GATE-3 验收，均不进训练） |
| `train_head.py` | **训练执行体**（官方 notebook 本地化）：multilingual 暖启动、冻结 encoder+act_head 只训 head/type_emb/scorer（~9M 参数）、proper reward 损失、按 held 一致率选 best epoch 落盘；产物 `laya.load` 可直读 + train-log.json |
| `fit_temperature.py` | 训后校准：held 上按 `temp_bucket(题型,选项数)` 网格拟合温度写回学生 config（置信度走 system_one 真实通路；样本 <8 的桶不拟合，如实回显） |
| `accept.py` | **验收（本仓执行）**：GATE-2 校准 ECE<0.10（分类型拟合温度）／GATE-3a 逼近教师（≥自一致性−3pt）／GATE-3b 碾压多数类+随机双基线／附加闸1 dash-abuse 19 题金标卷 ≥4B 基线 79%／附加闸2 感受类 lint |

## Question Spec v0.2（19 题）

qid 命名 `<来源>.<维度>.v1.<原语>`，**qid 永不复用**——rubric 改动 = 新 qid 或 spec 升版本。
每题 `rubric_ref` 可溯源到知识卡；`state_requires` 声明证据字段（RAG 位）。

| 原语 | qid |
|---|---|
| noul | semif.pov-leak / semif.dash-abuse / slop.ai-trace / craft.sensory-concrete / aesthetic.conflict-clear / aesthetic.dialogue-push / craft.ending-hook / **slop.neg-pattern / slop.reveal-stack / craft.daisy-chain / craft.simile-suspend**（加粗=v0.2 新增） |
| choice | semif.dash-abuse / aesthetic.scene-value / aesthetic.dialogue-defect / craft.curve-type / **drama.hook-type** |
| score | aesthetic.hook-strength / aesthetic.pacing-density / aesthetic.reversal-setup |

**红线（accept.py 会拦）**：感受类整题禁入（instructions 含 好看/有趣/精彩/好不好 即 FAIL）；
choice 选项 ≤20；score 档位 3-5；instructions 避免双重否定。

## 管线五步（本仓执行 1-3，Qoder 执行 4，本仓执行 5）

```bash
# ① 组装案例（师生同构 state）
python tools/laya-ft/state_builder.py --project p-kunxiu-001 \
    --file 04-写作/终稿.md --chunk 500 --out cases.jsonl

# ② GATE-1 教师自一致性试点（50 案例；主力教师=强 API，第二意见=本机 4B daemon）
python tools/laya-ft/label_gss.py --cases cases.jsonl --limit 50 --samples 5 \
    --backend api --endpoint <Qoder 提供的 chat/completions URL> --model <模型名> \
    --api-key-env TEACHER_API_KEY --out labeled-gate1.jsonl --report gate1-report.json
# 判定：qid 均值 >0.75 放行 / 0.60-0.75 磨 rubric 措辞 / <0.60 拆子维度（新 qid 重走）

# ③ 正式标注（GATE-1 放行的 qid；目标 1200-2000 案例）→ 导出训练集
python tools/laya-ft/label_gss.py ... --out labeled.jsonl
python tools/laya-ft/export_train.py --labeled labeled.jsonl --outdir dataset

# ④ 训练 v1（本仓执行体；venv=tools/_vendor/laya-venv）
laya-venv python tools/laya-ft/train_head.py --base <multilingual snapshot> \
    --train dataset/train.jsonl --held dataset/held.jsonl --out student-v1
laya-venv python tools/laya-ft/fit_temperature.py --student student-v1 --held dataset/held.jsonl

# ⑤ 本仓验收
laya-venv python tools/laya-ft/accept.py --student <学生目录> --test dataset/test.jsonl \
    --labeled labeled.jsonl
```

## 训练执行体说明（v1 · train_head.py 已落地）

- **底座**：multilingual snapshot（本地 `D:/hf-cache/hub/models--convaiinnovations--laya`，mmBERT-base 768×22，不走网络）暖启动，**冻结 encoder+act_head 只训决策头**（head/type_emb/scorer ~9M）
- **损失**：proper reward（log score + spherical；score 桶 −RPS）；epochs 6 起步；**训练只碰 train.jsonl**，选轮只看 held
- **交付物**：①学生权重目录（laya.load 可加载，含 config）②train-log.json（loss/一致率曲线）
  ③dataset/ 三个 split 的 sha256 清单 ④spec 版本号（写进 config.training）
- **环境**：huggingface.co 直连被墙——`HF_ENDPOINT=https://hf-mirror.com`；venv 在
  `tools/_vendor/laya-venv`（torch 2.14 + transformers 5.17 + laya 0.3.6 已验证）

## 验收口径（accept.py 自动出报告，本仓判读）

| 闸 | 线 |
|---|---|
| GATE-2 校准 | 分类型拟合温度后 ECE < 0.10（multilingual 出厂 ECE 0.387，不拟合的置信度无意义） |
| GATE-3a 逼近教师 | 学生-教师一致率 ≥ 教师自一致性均值 − 3pt |
| GATE-3b 双基线 | 逐题碾压多数类基线与均匀随机基线（官方教训：基座曾低于多数类基线） |
| 附加闸 1 | dash-abuse 19 题金标卷 ≥ 4B 基线 79%（同卷同口径） |
| 附加闸 2 | 感受类 lint 零违例 |

**分流语义（部署后）**：置信 >0.85 自动出证据 / 0.60-0.85 转人工复核 / <0.60 直接人工。
**红线**：学生输出 = 证据与复核优先级，永远不进提交链当闸；感受类维度不训练
（m4 三分法：机器类进学生，感受类归读者面板，agent 类归强模型）。
