"""产物正文纯净度检查（AE-OUTPUT-PURITY）。
扫描项目 md 产物，标记执行元数据污染行（节点/skill/轮次/kb 引用/输入清单/声明类）。
用法：python tools/check-purity.py <project> [file1 file2 ...]
命中即 exit=1（可接校验链）；正文区命中需人工转译成叙事后清除。

标记唯一台账：knowledge/aesthetic/purity-markers.json（core/src/aesthetic.ts 引擎同源共享，
两边不各写一套——改台账=两边同时生效）。scope：成文产物与对外交付；
小纲/大纲/意见书/世界书是过程件，合法承载流程词汇，不在本扫描管辖（评审目录亦豁免）。
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
KIT_MARK = Path(__file__).resolve().parent / "kit.json"
MARKERS_LEDGER = ROOT / "knowledge" / "aesthetic" / "purity-markers.json"


def proj_dir(name):
    # kit vendor 模式：本工具被 kit.py 拷贝进 <project>/kit/ 内时，
    # kit/ 上一级即项目根（kit.json 为标记）；常驻模式返回中心工作区路径。
    if KIT_MARK.exists():
        return ROOT
    return ROOT / "projects" / name


def load_regexps():
    try:
        data = json.loads(MARKERS_LEDGER.read_text(encoding="utf-8"))
        return [re.compile(x) for x in data.get("regex", [])]
    except Exception as e:
        print(f"[warn] 纯净度标记台账不可读（{MARKERS_LEDGER.name}: {e}），扫描不适用", file=sys.stderr)
        return []


REGEXPS = []
# 扫描范围 = 纯净度的管辖对象：成文产物与对外交付（与引擎 aesthetic.ts 同口径）。
# 快照/台账切片/输入材料/评审件合法承载流程词汇，不在管辖内（旧版 ALLOW 因绝对路径
# startswith 恒假而从未生效，此处改为按目录白名单收集，从根上修掉）。
SCAN_DIRS = ("对外交付", "章节正文", Path("内部") / "稿本")


def scan_targets(proj):
    out = []
    for d in SCAN_DIRS:
        base = proj / d
        if base.exists():
            out.extend(sorted(base.rglob("*.md")))
    out.extend(p for p in sorted(proj.glob("*.md")) if re.search(r"剧本|试稿|正文", p.name))
    return out


def scan(path):
    hits = []
    lines = path.read_text(encoding="utf-8").split("\n")
    region = "pre"  # pre = 首个 "## " 标题前（元数据高发区）
    for i, ln in enumerate(lines, 1):
        if re.match(r"^## ", ln):
            region = "body"
        if any(r.search(ln) for r in REGEXPS):
            hits.append((i, region, ln.rstrip()[:90]))
    return hits


def main():
    REGEXPS.extend(load_regexps())
    proj = proj_dir(sys.argv[1])
    files = [proj / f for f in sys.argv[2:]] if len(sys.argv) > 2 else scan_targets(proj)
    total = 0
    for f in files:
        hits = scan(f)
        for i, region, ln in hits:
            print(f"[{region}] {f.relative_to(ROOT)}:{i}: {ln}")
            total += 1
    print(f"--- {total} 处污染（pre=首个二级标题前，body=正文区，正文区命中需人工转译；标记台账 {MARKERS_LEDGER.name}；范围=对外交付/章节正文/稿本+根级剧本）")
    sys.exit(1 if total else 0)


main()
