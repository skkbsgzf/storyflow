"""flow-kit-apply · flow 节点声明迁移：skill + kb → kit + op（kit@1）

文本级迁移（不用 json.dumps 重写）——原 flow.json 有紧凑单行节点与展开多行两种风格，
整文件重序列化会炸出上百行噪声 diff。此处按行内定位替换，格式零损伤、幂等可复跑。

迁移纪律：
  1. 删掉无人读的 kb 字段（知识已并入 kit 的 knowledge，见 kit-migrate.py 的并集）
  2. 在 "skill": "X" 处补 "kit"/"op"（紧跟其后）：展开格式另起行并继承缩进，紧凑格式同行追加
  3. 已有 kit 的节点跳过（幂等）

用法：python tools/flow-kit-apply.py [--check]
"""
import json, re, sys, glob
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WRITE = "--check" not in sys.argv

SKILL2KIT = {}
for kp in sorted(glob.glob(str(ROOT / "kits" / "*" / "kit.json"))):
    k = json.loads(Path(kp).read_text(encoding="utf-8"))
    for op, spec in k["ops"].items():
        if spec.get("skill"):
            SKILL2KIT[spec["skill"]] = (k["id"], op)

KB_OWN_LINE = re.compile(r'\n[ \t]*"kb":\s*\[[^\]]*\]\s*,?')       # kb 独占一行（展开格式）
KB_INLINE = re.compile(r'"kb":\s*\[[^\]]*\]\s*,?\s*')              # kb 夹在行内（紧凑格式）
SKILL = re.compile(r'"skill": "([a-z0-9-]+)"(,?)')


def migrate(text: str) -> tuple:
    stats = {"kb": 0, "kit": 0}
    text, n = KB_OWN_LINE.subn("", text)
    stats["kb"] += n
    text, n = KB_INLINE.subn("", text)
    stats["kb"] += n

    def repl(m: re.Match) -> str:
        sid, comma = m.group(1), m.group(2)
        kit = SKILL2KIT.get(sid)
        if not kit:
            print(f"  !! 技能无 kit 归属: {sid}")
            return m.group(0)
        tail = m.string[m.end(): m.string.find("\n", m.end())]
        if tail.strip() == ",":  # 展开格式：skill 独占一行
            indent = re.search(r"[ \t]*$", m.string[: m.start()]).group(0)
            stats["kit"] += 1
            return f'{m.group(0)}\n{indent}"kit": "{kit[0]}",\n{indent}"op": "{kit[1]}",'
        if '"kit"' in m.string[m.end(): m.end() + 60]:  # 幂等：本处已迁移
            return m.group(0)
        stats["kit"] += 1
        return f'"skill": "{sid}", "kit": "{kit[0]}", "op": "{kit[1]}"{comma}'

    return SKILL.sub(repl, text), stats


total = {"files": 0, "kb": 0, "kit": 0}
for fp in sorted(glob.glob(str(ROOT / "flows" / "*" / "flow.json"))):
    p = Path(fp)
    src = p.read_text(encoding="utf-8")
    out, st = migrate(src)
    if out == src:
        print(f"  = {p.parent.name}（无需改动）")
        continue
    total["files"] += 1
    total["kb"] += st["kb"]
    total["kit"] += st["kit"]
    if WRITE:
        p.write_text(out, encoding="utf-8")
    print(f"  * {p.parent.name}: 收编 kb {st['kb']} 条 / 补 kit 引用 {st['kit']} 处")
    try:
        json.loads(out)
    except json.JSONDecodeError as e:
        sys.exit(f"  !! 迁移后 JSON 非法（{p.parent.name}）: {e}")

print(f"  合计 {total['files']} files ｜ kb {total['kb']} ｜ kit {total['kit']}")
print("  (--check：未写盘)" if not WRITE else "  已写盘，JSON 全部合法")
