"""r5-migrate · 门降级迁移（规范 R5 §四）

R5 之前，红蓝对抗被做成图上固定节点：`kind:"gate"` + `gate_role:"验收门"`，
每个阶段挂一扇门、每扇门都等人裁决——节点膨胀、串行屏障变多、编排不灵活。

R5 之后：
  · 域内质量由各 tool 自己的 `asserts` / `config` 承担（域内门自动放行）；
  · 人工裁决只保留在 **kit 域切换处**（`gate_role:"kit-boundary"`，内核自动派生）；
  · 旧门残留的 `gate_role` 值不再有意义 —— 本脚本删掉它，让节点退回「普通门」，
    再由优化器 R6 规则提议 remove-node（人来批）。

文本级迁移：只删 `"gate_role": "..."` 整行，不动其他字段与缩进风格。幂等。

用法：
    python tools/r5-migrate.py            # 迁移
    python tools/r5-migrate.py --check    # 只报告（CI 用）
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CHECK = "--check" in sys.argv

LEGAL = {None, "kit-boundary"}
NODE_OPEN = re.compile(r'^ {6}"([^"]+)"\s*:\s*\{\s*$')
NODE_CLOSE = re.compile(r"^ {6}\}\s*,?\s*$")
GATE_ROLE = re.compile(r'^ {8}"gate_role"\s*:\s*"([^"]*)"\s*,?\s*$')


def migrate_text(text: str, todo: set[str]) -> tuple[str, int]:
    """删掉 todo 节点块内的 gate_role 行。返回 (新文本, 删除行数)。"""
    out, cur, removed = [], None, 0
    for ln in text.split("\n"):
        m = NODE_OPEN.match(ln)
        if m and cur is None:
            cur = m.group(1) if m.group(1) in todo else "__skip__"
            out.append(ln)
            continue
        if cur is not None:
            if NODE_CLOSE.match(ln):
                cur = None
                out.append(ln)
                continue
            if cur in todo and GATE_ROLE.match(ln):
                removed += 1
                continue
        out.append(ln)
    return "\n".join(out), removed


def strip_dangling_commas(text: str) -> str:
    """删行后可能留下悬空逗号（gate_role 曾是块内最后一项）——统一清理。"""
    lines = text.split("\n")
    for i in range(len(lines) - 1):
        if lines[i].rstrip().endswith(",") and lines[i + 1].lstrip().startswith(("}", "]")):
            lines[i] = lines[i].rstrip()[:-1]
    return "\n".join(lines)


def main() -> int:
    changed, total = [], 0
    for fp in sorted(ROOT.glob("flows/*/flow.json")):
        text = fp.read_text(encoding="utf-8")
        flow = json.loads(text)
        todo = {
            nid for nid, n in flow["graph"]["nodes"].items()
            if n.get("kind") == "gate" and n.get("gate_role") not in LEGAL
        }
        if not todo:
            continue
        new_text, removed = migrate_text(text, todo)
        new_text = strip_dangling_commas(new_text)
        after = json.loads(new_text)  # 迁完必须是合法 JSON
        for nid in sorted(todo):
            if "gate_role" in after["graph"]["nodes"][nid]:
                print(f"ERROR {fp}: 节点 {nid} 的 gate_role 未能删除（定位失败）")
                return 1
        changed.append((fp.relative_to(ROOT).as_posix(), sorted(todo), removed))
        total += removed
        if not CHECK:
            fp.write_text(new_text, encoding="utf-8")

    tag = "check" if CHECK else "migrate"
    print(f"r5-migrate({tag}) ｜ {len(changed)} 个 flow ｜ {total} 处门降级（删除 legacy gate_role）")
    for f, ids, n in changed:
        print(f"  {f}: {n} 扇门 → {', '.join(ids)}")
    if CHECK and total:
        print("ERROR 仍有 legacy gate_role 待迁移")
        return 1
    if not changed:
        print("  已全部为 R5 形态（幂等）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
