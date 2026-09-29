# 规则语料库（knowledge/rules/）· v5.0 批A

生成：tools/rules-init.py｜2026-09-21｜源台账 90 条 → T 27（quality-scan 工具化）+ X 13（删除）+ C 50（本库）。

消费方：orchestrator 依「选题报告+剧本+前文」做激活决策（R8 记账：by+evidence+未激活回显）；
装载仍走 K1 `op.knowledge` 单点（受 9000 字封顶约束，按域选卡，禁全塞）。

- `kb/rules/ai-trace` — 结构机味（2 条）｜激活提示：m3.成文、polish、端尾验收
- `kb/rules/character` — 人物（4 条）｜激活提示：m2.编剧、m3.成文
- `kb/rules/conflict` — 冲突（5 条）｜激活提示：m2.编剧
- `kb/rules/continuity` — 连续性（1 条）｜激活提示：m3.成文（每章动笔前）
- `kb/rules/curve` — 情绪曲线（4 条）｜激活提示：m2.编剧
- `kb/rules/deconstruct` — 拆解纪律（4 条）｜激活提示：调研/拆书
- `kb/rules/dialogue` — 对白（3 条）｜激活提示：m3.成文、polish
- `kb/rules/ending` — 结局（3 条）｜激活提示：m2.编剧、端尾验收
- `kb/rules/hook` — 钩子（3 条）｜激活提示：m1.选题、m2.编剧、成稿端尾
- `kb/rules/meme` — 梗（2 条）｜激活提示：m1.选题、m3.成文
- `kb/rules/pacing` — 节奏与密度（6 条）｜激活提示：m2.编剧、m3.成文
- `kb/rules/platform` — 卡点（1 条）｜激活提示：m2.编剧、端尾验收
- `kb/rules/reversal` — 反转（4 条）｜激活提示：m2.编剧、m3.成文
- `kb/rules/scene` — 场景（4 条）｜激活提示：m2.编剧、m3.成文
- `kb/rules/setting` — 设定底座（2 条）｜激活提示：m1.选题、m2.编剧
- `kb/rules/visual` — 视觉可拍性（2 条）｜激活提示：m2.分镜、m3.成文
