---
{
  "id": "kb/method/revision-loop",
  "type": "deconstruct-protocol",
  "title": "多轮精修循环协议（判分→定向修订→防劣化收敛）",
  "dimension": "method",
  "version": "1.0.0",
  "status": "active",
  "applies_to": ["long-form", "short-drama", "comic-drama"],
  "routes": ["all"],
  "provenance": {
    "source": "factory",
    "refs": [
      "arxiv:2303.17651 Self-Refine（NeurIPS 2023）：反馈必须具体可执行（actionable）才有改进；2-4 轮后收益递减、可平台化甚至劣化",
      "arxiv:2410.02603 Agents' Room（Google DeepMind，ICLR 2025）：orchestrator + 专业化写作角色 + 共享 scratchpad，优于单 agent 一稿到底",
      "github:google-deepmind/dramatron：分层生成（title→characters→beats→location→dialogue），只与人协作不自动出稿",
      "kb/aesthetic/ai-trace §检测器校准：对着检测分优化会走向更隐蔽的模板——目标是结构自然度本身，不是分数",
      "实证：iterative refinement 收益递减（Learn Prompting / ACM 自评消融）"
    ]
  },
  "updated": "2026-09-17"
}
---

# 多轮精修循环协议

**标尺**：一轮改透三处，胜过三轮各摸一遍。循环的产出物是「定向修订」，不是「再来一遍」。

## 一、循环形状（判分 → 定向修订 → 复判）

1. **判分**（novel-judge）：五维锚点评分 + 最差三处定向反馈（引原文、说病灶、给方向）；
2. **定向修订**（novel-deai 四遍法口径）：只动被点名的位置，逐处过「该改/该保留」判定；禁止趁机全文再润——循环会放大过度编辑；
3. **复判**：同标尺重评，总分必须 ≥ 上轮；
4. **终止**：满足任一即停——总分 ≥40 且无单维 <6（可交付）｜轮数达 3（上限）｜Δ<0.5（收敛）。

## 二、防劣化纪律（红线）

1. **降分回滚**：复判总分 < 上轮 → 本轮修订整体回滚，保留上轮文本（宁可不改，不许改坏）；
2. **禁分赃式优化**：以判分表为参照系可以，把它当目标函数函数化不行——为凑「对话活性」硬塞交锋、为凑「节奏地形」硬造短句，都会产生新的模板腔（ai-trace 校准条款同样适用于自评分）；
3. **每轮反馈只开三炮**：最差三处之外的观察记入评审表「备查」，不进本轮修订；
4. **角色分立**（Agents' Room 本地化）：判分与修订不得同为一次思维链——判分按 novel-judge 合同独立过一遍（读前轮评分表、写评审表落盘），修订按 novel-deai 合同独立执行；共享的是评审表文件（scratchpad），不是同一段思维链。

## 三、与既有环节的分工

| 环节 | 管什么 | 不管什么 |
| --- | --- | --- |
| 内核断言 / prose-scan | 机械配额（三连/不是A是B/节奏词/slop 词/八维统计） | 读感 |
| novel-deai 四遍法 | 声口/处境/比喻/机味的全稿清扫 | 收敛判定 |
| novel-judge 循环 | 读感上限（哪里最差、改到几分为止） | 配额 |
| gate（用户） | 验收 | — |

## 四、轮次记账

每轮评审表落盘 `内部/评审表-<对象>-r<N>.md`，总分曲线（r1→r2→…）写进修订对照表小节头部；无评分曲线的多轮修订 = 黑箱循环，打回。
