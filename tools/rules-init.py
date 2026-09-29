#!/usr/bin/env python3
"""rules-init · v5.0 批A-1：断言台账 → knowledge/rules/ 规则语料卡生成器。

依据 docs/v5.0工单-断言体系退役与规则语料化.md §二：
  T 轨（有确定性校验器）→ 归 quality-scan 工具链（core/src/quality-cli.ts 桥），不进语料；
  X 轨（红蓝/监管/随协议作废）→ 直接删，不进语料；
  C 轨（其余全部）→ 本脚本转成按域分组的原子规则卡，喂 orchestrator 当可激活语料。

纪律：
  - 规则原文一字不改（台账是事实源，去闸化靠卡头语义声明，不做有损改写）；
  - 每条保留来源 AE-id，可回溯；
  - 幂等：重跑覆盖卡片；--dry-run 只打印分诊结果。
"""
import json
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
def _ledger_path():
    """v5.0 批B-3：台账已退役归档（只读）。分诊表可重跑，但不再认在库原件。
    （不 import tools/lintlib.py —— lintlib.tracks() 反向加载本脚本，会成环。）"""
    for rel in ("projects/_archived/assertions-ledger-v5.0.0/assertions.json",
                "knowledge/aesthetic/assertions.json"):
        p = ROOT / rel
        if p.exists():
            return p
    raise SystemExit("找不到断言台账（在库与归档两处均无）——无法分诊")


LEDGER = _ledger_path()
OUT_DIR = ROOT / "knowledge" / "rules"

# T 轨：27 条已被确定性校验器覆盖（v5.0 工单 §二 T 轨清单）
TRACK_T = {
    "AE-PROSE-SLOP", "AE-PROSE-NOTBUT", "AE-PROSE-TRIPLET", "AE-PROSE-RHYTHM",
    "AE-AI-QUOTA", "AE-NAT-HIT", "AE-OUTPUT-PURITY", "AE-CH-LEN", "AE-WNF-HOOK",
    "AE-CONT-KNOW", "AE-CONT-ITEM", "AE-CONT-FORESHADOW", "AE-BEAT-FORMAT",
    "AE-SCRIPT-FRONT", "AE-SCRIPT-FIELDS", "AE-SCRIPT-BRACKET", "AE-SCRIPT-PURITY",
    "AE-DENSITY-WORDS", "AE-MEME-POINT", "AE-REPORT-DENSITY", "AE-HOOK-EVENT",
    "AE-CARD-END", "AE-VIS-EMPTY", "AE-COMPLIANCE", "AE-STRUCT-CAUSE",
    "AE-CHOREO-GAP", "AE-CHOREO-BOUNDS",
}
# X 轨：13 条直接死（红蓝 6 + 监管 3 + 随协议作废 4）
TRACK_X = {
    "AE-RED-PREDICT", "AE-RED-SAFE", "AE-RED-INVENTORY",
    "AE-PR-VIEW", "AE-PR-CAUSE", "AE-PR-ITER",
    "AE-OVER-CONTRACT", "AE-OVER-REWRITE", "AE-ROUTE-EXCLUSIVE",
    "AE-EXISTS", "AE-SKIP-NON-BEAT", "AE-WNF-BATCH", "AE-WNF-PLATFORM",
}
# 域 → orchestrator 激活提示（何时该装载；仅提示，选择权在激活决策并记账）
WHEN = {
    "hook": ["m1.选题", "m2.编剧", "成稿端尾"],
    "pacing": ["m2.编剧", "m3.成文"],
    "curve": ["m2.编剧"],
    "character": ["m2.编剧", "m3.成文"],
    "conflict": ["m2.编剧"],
    "scene": ["m2.编剧", "m3.成文"],
    "reversal": ["m2.编剧", "m3.成文"],
    "dialogue": ["m3.成文", "polish"],
    "visual": ["m2.分镜", "m3.成文"],
    "platform": ["m2.编剧", "端尾验收"],
    "ending": ["m2.编剧", "端尾验收"],
    "ai-trace": ["m3.成文", "polish", "端尾验收"],
    "deconstruct": ["调研/拆书"],
    "continuity": ["m3.成文（每章动笔前）"],
    "setting": ["m1.选题", "m2.编剧"],
    "meme": ["m1.选题", "m3.成文"],
}
DOMAIN_CN = {
    "hook": "钩子", "pacing": "节奏与密度", "curve": "情绪曲线", "character": "人物",
    "conflict": "冲突", "scene": "场景", "reversal": "反转", "dialogue": "对白",
    "visual": "视觉可拍性", "platform": "卡点", "ending": "结局", "ai-trace": "结构机味",
    "deconstruct": "拆解纪律", "continuity": "连续性", "setting": "设定底座", "meme": "梗",
}


def main() -> int:
    dry = "--dry-run" in sys.argv
    ledger = json.loads(LEDGER.read_text(encoding="utf-8"))
    entries = ledger["asserts"]
    names = {e["name"] for e in entries}
    leak = (TRACK_T | TRACK_X) - names
    if leak:
        print(f"处置表引用了台账不存在的 id（先核对再重跑）: {sorted(leak)}")
        return 2

    c_track = [e for e in entries if e["name"] not in TRACK_T and e["name"] not in TRACK_X]
    by_domain = defaultdict(list)
    for e in c_track:
        by_domain[e["dim"]].append(e)

    print(f"台账 {len(entries)} = T(工具化) {len(TRACK_T)} + X(删除) {len(TRACK_X)} + C(语料) {len(c_track)}")
    for d, es in sorted(by_domain.items()):
        print(f"  rules/{d}.md  {DOMAIN_CN.get(d, d)}  ×{len(es)}")
    if dry:
        return 0

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    today = datetime.now().strftime("%Y-%m-%d")
    for d, es in sorted(by_domain.items()):
        fm = {
            "id": f"kb/rules/{d}",
            "type": "rule-corpus",
            "title": f"{DOMAIN_CN.get(d, d)}域规则语料（断言台账退役迁移，agent 可激活条款）",
            "dimension": d,
            "version": "1.0.0",
            "status": "active",
            "activation_hint": WHEN.get(d, ["按域由 orchestrator 判断"]),
            "provenance": {
                "source": "v5.0 批A：knowledge/aesthetic/assertions.json 台账 C 轨迁移（tools/rules-init.py 生成，规则原文零改动）",
                "refs": sorted(e["name"] for e in es),
            },
            "updated": today,
        }
        lines = ["---", json.dumps(fm, ensure_ascii=False, indent=2), "---", ""]
        lines += [
            f"# {DOMAIN_CN.get(d, d)}域规则语料 · kb/rules/{d}",
            "",
            "> **本卡是语料不是闸**（v5.0 拍板：只用 agent，不用断言）。",
            "> 优先级语义：`block`=最高优先（agent 评审无解释不得放过）；`major`=次优先；`minor`=提示。",
            "> 原文中的「判 block/major」是台账历史措辞，一律读作优先级，**不构成提交拦截**。",
            "> 能确定性计数的条款不在此卡（归 quality-scan 工具链出收据证据）。",
            "",
        ]
        for e in sorted(es, key=lambda x: (x["level"] != "block", x["level"] != "major", x["name"])):
            tgt = e.get("target") or ""
            lines.append(f"- **【{e['name']}｜{e['level']}】** {e['rule']}" + (f"（对象：{tgt}）" if tgt else ""))
        (OUT_DIR / f"{d}.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

    idx = [
        "# 规则语料库（knowledge/rules/）· v5.0 批A",
        "",
        f"生成：tools/rules-init.py｜{today}｜源台账 90 条 → T 27（quality-scan 工具化）+ X 13（删除）+ C {len(c_track)}（本库）。",
        "",
        "消费方：orchestrator 依「选题报告+剧本+前文」做激活决策（R8 记账：by+evidence+未激活回显）；",
        "装载仍走 K1 `op.knowledge` 单点（受 9000 字封顶约束，按域选卡，禁全塞）。",
        "",
    ]
    for d, es in sorted(by_domain.items()):
        idx.append(f"- `kb/rules/{d}` — {DOMAIN_CN.get(d, d)}（{len(es)} 条）｜激活提示：{'、'.join(WHEN.get(d, []))}")
    (OUT_DIR / "README.md").write_text("\n".join(idx) + "\n", encoding="utf-8")
    print(f"已写 {len(by_domain)} 张域卡 + README → {OUT_DIR}")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
