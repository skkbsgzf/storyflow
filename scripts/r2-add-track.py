#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""r2-add-track · 批次3c R2：knowledge/ 全卡批量补 track 板块字段（additive，正文零改写）。

一次性脚本（跑完即归档不入 git 的收据域）：逐卡在 frontmatter 里追加一行 "track": "<板块>"，
无 frontmatter 的卡（仅 craft/user-style-rules 用户手改区）前置最小 JSON 信封只含 track。
板块映射 = 逐卡亲读定案（见 knowledge/README.md「track 板块」节与 ROADMAP 批次3c R2 行）：
  文风｜编剧｜选材｜情绪｜连续性｜通用（立意组确认空白，本批不出现——R3 写题目）。
红线：除 frontmatter 追加行外一个字节都不许动——脚本对每个文件先留 before 快照，
写后断言「去重后 diff 只含新增行且新增行全部落在 frontmatter 区内」。
"""
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
KB = REPO / "knowledge"
SNAP = REPO / "projects" / "_reports" / "r2-md-snapshot"

TRACKS = ("文风", "编剧", "立意", "选材", "情绪", "连续性", "通用")

# 相对 knowledge/ 路径 → track（120 张全量；semif 五卷按子目录归文风）
MAPPING: dict[str, str] = {}


def _put(prefix: str, track: str) -> None:
    for p in sorted(KB.glob(prefix)):
        if p.name.upper() == "README.MD":
            continue
        MAPPING[p.relative_to(KB).as_posix()] = track


# ── 文风（21）：词句层——AI 味/去模板化/比喻/感官/风格档/成文约束/文风学习/校准五卷 ──
for f in ("aesthetic/ai-detection-sources.md", "aesthetic/ai-trace.md", "aesthetic/metaphor-zh.md",
          "aesthetic/naturalness-zh.md", "aesthetic/sensory-detail.md", "aesthetic/slop-list.md",
          "aesthetic/style-routes.md", "craft/prose-constraints.md", "craft/user-style-rules.md",
          "deconstruct/ai-trace-dashabuse-draft.md", "deconstruct/ai-trace-negpattern-draft.md",
          "deconstruct/ai-trace-revealstack-draft.md", "deconstruct/craft-similesuspend-draft.md",
          "deconstruct/dialogue-daisychain-draft.md", "deconstruct/style-learning.md",
          "rules/ai-trace.md"):
    MAPPING[f] = "文风"
for sub in ("daisy-chain", "dash-abuse", "neg-pattern", "reveal-stack", "simile-suspend"):
    _put(f"semif-calibration/{sub}/*.md", "文风")

# ── 编剧（27）：故事设计——人物/冲突/对白/钩子/节奏/反转/场景/结局/可视化/结构母型 ──
for f in ("aesthetic/character.md", "aesthetic/conflict-escalation.md", "aesthetic/dialogue.md",
          "aesthetic/ending.md", "aesthetic/hook-3s.md", "aesthetic/pacing-density.md",
          "aesthetic/reversal.md", "aesthetic/scene-value.md", "aesthetic/unreasonable-highlight.md",
          "aesthetic/visual-poster.md", "rules/character.md", "rules/conflict.md", "rules/dialogue.md",
          "rules/ending.md", "rules/hook.md", "rules/pacing.md", "rules/reversal.md",
          "rules/scene.md", "rules/visual.md", "structure/ascent.md", "structure/barbell-return.md",
          "structure/catalog.md", "structure/dual-line.md", "structure/episodic-fate.md",
          "structure/episodic-webnovel.md", "structure/revenge.md", "structure/save-the-cat.md"):
    MAPPING[f] = "编剧"

# ── 选材（51）：题材/市场/对标/梗族/设定/平台/合规 ──
_put("benchmark/*.md", "选材")
_put("trope/*.md", "选材")
for f in ("market/brief-four-questions.md", "market/constraints.md", "market/internet-feel-formulas.md",
          "market/market-structure.md", "market/meme-rules.md", "market/setting-rules.md",
          "market/topic-anatomy.md", "rules/meme.md", "rules/platform.md", "rules/setting.md",
          "aesthetic/platform-compliance.md"):
    MAPPING[f] = "选材"

# ── 情绪（2）／连续性（3）──
MAPPING["aesthetic/emotion-curve.md"] = "情绪"
MAPPING["rules/curve.md"] = "情绪"
MAPPING["continuity/state-ledger.md"] = "连续性"
MAPPING["continuity/worldbook.md"] = "连续性"
MAPPING["rules/continuity.md"] = "连续性"

# ── 通用（16）：横切流程/总纲/监管/评审/形态/工程方法/拆书协议 ──
for f in ("aesthetic/constitution.md", "aesthetic/oversight.md", "aesthetic/perspective-review.md",
          "aesthetic/redline-scoring.md", "craft/convolution-waves.md", "craft/highlight-loop.md",
          "craft/section-pipeline.md", "deconstruct/protocol.md", "formats/comic-drama-adapt.md",
          "formats/method-brief.md", "formats/webnovel-fastfood.md", "formats/webnovel-longform.md",
          "method/longform-engineering.md", "method/revision-loop.md", "rules/deconstruct.md"):
    MAPPING[f] = "通用"

FM_RE = re.compile(r"\A---\r?\n(.*?)\r?\n---(\r?\n)?", re.S)


def added_lines_must_be_frontmatter(before: str, after: str) -> None:
    """红线断言：after 相对 before 只增不改不删，且新增行全部落在 frontmatter 围栏内（含前置信封）。"""
    b, a = before.splitlines(), after.splitlines()
    assert len(a) >= len(b), "出现删行"
    m = FM_RE.match(after)
    assert m, "frontmatter 围栏缺失"
    fm_end = m.end(2) or m.end(1)  # 闭围栏（含其换行）之前都算 frontmatter 区
    fm_lines = after[:fm_end].count("\n") + 1  # 围栏区行数（1-based 上界）
    bi = ai = 0
    while bi < len(b) and ai < len(a):
        if b[bi] == a[ai]:
            bi += 1
            ai += 1
            continue
        assert ai + 1 <= fm_lines, f"新增行不在 frontmatter 区（第 {ai + 1} 行）：{a[ai]!r}"
        ai += 1  # 新增行：跳过
    assert bi == len(b), "出现改写行"


def main() -> int:
    # 盘上全卡 vs 映射表对账：一张不缺、一张不多
    disk = sorted(p.relative_to(KB).as_posix() for p in KB.rglob("*.md")
                  if p.name.upper() != "README.MD")
    miss = [f for f in disk if f not in MAPPING]
    extra = [f for f in sorted(MAPPING) if f not in set(disk)]
    if miss or extra:
        print(f"[ABORT] 映射表与盘不对齐：缺映射 {miss}；多映射 {extra}")
        return 1
    bad = {v for v in MAPPING.values()} - set(TRACKS)
    if bad:
        print(f"[ABORT] 非法板块值：{bad}")
        return 1
    assert "立意" not in set(MAPPING.values()), "立意组确认空白，本批不得出现"

    changed = 0
    for rel in disk:
        p = KB / rel
        text = p.read_text(encoding="utf-8")
        track = MAPPING[rel]
        m = FM_RE.match(text)
        if m:
            head = m.group(1)
            if re.search(rf'"track"\s*:', head) or re.search(rf"^track\s*:", head, re.M):
                print(f"[SKIP] 已有 track：{rel}")
                continue
            lines = head.splitlines()
            # 找首「键」行的缩进（跳过花括号行——{ 独占一行时它的缩进不代表键层级）
            indent = next((l[: len(l) - len(l.lstrip())] for l in lines
                           if l.strip() and not l.lstrip().startswith(("{", "}"))), "  ")
            new_head = lines[0].rstrip()
            new_head = "\n".join([new_head, f"{indent}\"track\": \"{track}\"," ] + lines[1:])
            after = text[: m.start(1)] + new_head + text[m.end(1):]
        else:
            # 无 frontmatter（user-style-rules 手改区）：前置只含 track 的最小 JSON 信封
            after = f'---\n{{\n  "track": "{track}"\n}}\n---\n' + text
        import json as _json
        fm_ok = FM_RE.match(after)
        try:
            ok = _json.loads(fm_ok.group(1))
            assert isinstance(ok, dict) and ok.get("track") == track
        except Exception as e:  # noqa: BLE001
            print(f"[ABORT] {rel} 追加后 frontmatter 非法 JSON：{e}")
            return 1
        added_lines_must_be_frontmatter(text, after)
        SNAP.mkdir(parents=True, exist_ok=True)
        sp = SNAP / rel
        sp.parent.mkdir(parents=True, exist_ok=True)
        if not sp.exists():
            sp.write_text(text, encoding="utf-8", newline="\n")
        p.write_text(after, encoding="utf-8", newline="\n")
        changed += 1
    print(f"track 批量补完成：{changed} 张卡改动（映射 {len(MAPPING)} 张）")
    from collections import Counter
    print("板块分布：", dict(Counter(MAPPING.values())))
    return 0


if __name__ == "__main__":
    sys.exit(main())
