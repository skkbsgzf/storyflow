"""产物正文纯净度检查（AE-OUTPUT-PURITY）。
扫描项目 md 产物，标记执行元数据污染行（节点/skill/轮次/kb 引用/输入清单/声明类）。
用法：python tools/check-purity.py <project> [file1 file2 ...]
命中即 exit=1（可接校验链）；正文区命中需人工转译成叙事后清除。
"""
import re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
KIT_MARK = Path(__file__).resolve().parent / "kit.json"
def proj_dir(name):
    # kit vendor 模式：本工具被 kit.py 拷贝进 <project>/kit/ 内时，
    # kit/ 上一级即项目根（kit.json 为标记）；常驻模式返回中心工作区路径。
    if KIT_MARK.exists():
        return ROOT
    return ROOT / "projects" / name


MARKERS = ["节点：", "节点 ", "skill：", "skill ", "件型声明", "隔离声明", "合规自查", "读表说明",
           "数据快照", "数据基线", "输入：", "结构宪法", "route=", "OUTPUT-FORMAT", "kb/",
           "世界观依据", "大纲轻量", "命题（用户裁决", "本批未读取", "未做任何 git"]
ALLOW = ("registry/", "snapshots/", "词汇表", "项目配置")

def scan(path):
    hits = []
    lines = path.read_text(encoding="utf-8").split("\n")
    region = "pre"  # pre = 首个 "## " 标题前（元数据高发区）
    for i, ln in enumerate(lines, 1):
        if re.match(r"^## ", ln):
            region = "body"
        if any(m in ln for m in MARKERS):
            hits.append((i, region, ln.rstrip()[:90]))
    return hits

def main():
    proj = proj_dir(sys.argv[1])
    files = [proj / f for f in sys.argv[2:]] if len(sys.argv) > 2 else             [f for f in sorted(proj.rglob("*.md")) if not any(str(f).replace("\\", "/").startswith(a) for a in ALLOW)]
    total = 0
    for f in files:
        hits = scan(f)
        for i, region, ln in hits:
            print(f"[{region}] {f.relative_to(ROOT)}:{i}: {ln}")
            total += 1
    print(f"--- {total} 处污染（pre=首个二级标题前，body=正文区，正文区命中需人工转译）")
    sys.exit(1 if total else 0)

main()
