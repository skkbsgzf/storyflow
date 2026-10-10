#!/usr/bin/env python3
"""rules-init · v5.0 批A-1：断言台账 → knowledge/rules/ 规则语料卡生成器。

> ⚠ 防覆盖警示（批次2.5 P4）：**重生成会整卡覆盖**。knowledge/rules/ 现卡已带
> rule-card@1 收敛字段（clauses / scanner_qids / format）——那是批A 之后人工/工具逐卡
> 收敛进去的，生成器输出里没有。重跑前必须先做字段保留；本脚本现在默认检测到存量
> 收敛字段即**拒绝整批写入**（一个文件都不写，不做半新半旧混合盘），确要覆盖必须
> 显式加 ``--force``（整卡覆盖语义，收敛字段照样被抹掉——后果自担）。

依据 docs/v5.0工单-断言体系退役与规则语料化.md §二：
  T 轨（有确定性校验器）→ 归 quality-scan 工具链（core/src/quality-cli.ts 桥），不进语料；
  X 轨（红蓝/监管/随协议作废）→ 直接删，不进语料；
  C 轨（其余全部）→ 本脚本转成按域分组的原子规则卡，喂 orchestrator 当可激活语料。

纪律：
  - 规则原文一字不改（台账是事实源，去闸化靠卡头语义声明，不做有损改写）；
  - 每条保留来源 AE-id，可回溯；
  - 幂等：重跑覆盖卡片；--dry-run 只打印分诊结果；
  - 防覆盖：检测到目标卡带 rule-card@1 收敛字段即默认拒绝（见顶部警示），--force 才覆盖。
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
    return None


_LEDGER = None
def LEDGER_PATH():
    """懒解析：开源发布形态没有归档台账（v0.8 起审核层整体退役）——返回 None，
    分诊表仍可用（TRACK_T/TRACK_X 是硬编码清单，不依赖台账内容）。"""
    global _LEDGER
    if _LEDGER is None:
        _LEDGER = _ledger_path()
    return _LEDGER

LEDGER = None  # 兼容旧引用；实际取用走 LEDGER_PATH()
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

# 防覆盖门（批次2.5 P4）：收敛字段指纹——卡头 frontmatter 出现任一即视为「现卡已收敛」。
# 生成器输出不含这两样（clauses/scanner_qids 是批A 后人工逐卡收敛的，format 是收编标记），
# 所以「带指纹的存量卡」被整卡覆盖 = 收敛成果丢失，这正是本门要挡的事故。
CONVERGENCE_HINTS = ("rule-card@1", '"clauses"')


def _has_convergence(p: Path) -> bool:
    """卡头（--- 界定的 frontmatter）是否带 rule-card@1 收敛字段。读不了 = 视为没带。"""
    try:
        text = p.read_text(encoding="utf-8")
    except OSError:
        return False
    head = text.split("---", 2)[1] if text.startswith("---") else ""
    return any(h in head for h in CONVERGENCE_HINTS)


def main() -> int:
    dry = "--dry-run" in sys.argv
    force = "--force" in sys.argv
    lp = LEDGER_PATH()
    if not lp:
        print("无断言台账（开源发布形态）——分诊表仅供 lint 引用，规则卡生成跳过。")
        return 0
    ledger = json.loads(lp.read_text(encoding="utf-8"))
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

    # ── 防覆盖门（批次2.5 P4）：先全量体检再动笔，拒绝时一个文件都不写（README 也不写，
    #    不做「卡没动、README 先翻新」的半新半旧盘）。整卡覆盖会抹掉现卡的
    #    rule-card@1 收敛字段（clauses/scanner_qids/format）——故默认拒绝，--force 才放行。
    guarded = sorted(
        d for d in by_domain
        if _has_convergence(OUT_DIR / f"{d}.md")
    )
    if guarded and not force:
        print("检测到存量卡已带 rule-card@1 收敛字段（clauses/scanner_qids/format），"
              "重生成会整卡覆盖将其抹掉：")
        for d in guarded:
            print(f"  {OUT_DIR / (d + '.md')}")
        print("重跑前必须先做字段保留（把 clauses/scanner_qids/format 摘出来，覆盖后回填）；"
              "确要整卡覆盖请显式加 --force。本次未写任何文件。")
        return 1

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
