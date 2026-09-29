#!/usr/bin/env python3
"""batch-edit.py · 同文件多处修改的原子批量器（一次调用、全批校验、单一 diff）

为什么要有它：逐处 Edit 把「27 处修订」摊成 27 次串行调用＋27 段碎片 diff——
改动之间互不可见，回滚要逐处走，diff 评审被拉长成刷屏。本工具把整批替换
收进一条命令：先对当前磁盘内容做全批校验，任一处不成立（缺失/多义/计数不符）
= 整批拒绝、零写入；全批成立 = 一次落盘并输出唯一一份 unified diff。

口径与纪律：
- 这是「编辑文件」的批量形态，不是 sed/awk 的复活：ops 用字面字符串（非正则），
  与 Edit 工具同一匹配语义（精确子串＋唯一性计数）。铁律 4（长内容只经工具落盘）不变。
- 适用：同一文件 >=3 处、各处改法不同（删/换/改标点）的散点修订。1-2 处仍用 Edit。
- 收据：--receipt 落一份 JSON（时间/文件/前hash/后hash/ops 计数/diff 行数），
  报数必附收据（v5.0 证据即收据）。

用法：
  python tools/batch-edit.py --file <path> --ops <ops.json> [--dry-run] [--receipt <path>]
  ops.json = [ {"old": "...", "new": "...", "count": 1}, ... ]
  count 省略默认 1；new 省略 = 删除该子串；old==new 拒绝。
退出码：0=已写入（或 dry-run 全通过）；1=校验拒绝（零写入）；2=用法/读盘错误。
"""
import argparse, difflib, hashlib, json, sys, datetime as dt

# Windows GBK 控制台防线：diff/提示含 ⚠ 等字符不得让打印崩在写盘前（09-24 实踩）
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


def load_file(path):
    with open(path, "rb") as f:
        raw = f.read()
    bom = raw.startswith(b"\xef\xbb\xbf")
    text = raw.decode("utf-8-sig" if bom else "utf-8")
    return text, bom


def validate(text, ops):
    errs = []
    for i, op in enumerate(ops):
        old = op.get("old")
        new = op.get("new", "")
        cnt = op.get("count", 1)
        if not isinstance(old, str) or old == "":
            errs.append(f"op[{i}] 缺 old 或为空串")
            continue
        if old == new:
            errs.append(f"op[{i}] old==new（空改动，删掉这条）")
            continue
        found = text.count(old)
        if found != cnt:
            errs.append(f"op[{i}] 命中 {found} 次，声明 {cnt} 次 ｜ old 开头：{old[:24]!r}")
    return errs


def main():
    ap = argparse.ArgumentParser(description="同文件多处修改的原子批量器")
    ap.add_argument("--file", required=True)
    ap.add_argument("--ops", required=True, help="JSON 数组文件：[{old,new,count}]")
    ap.add_argument("--dry-run", action="store_true", help="只校验不落盘")
    ap.add_argument("--receipt", help="收据 JSON 落盘路径")
    a = ap.parse_args()

    try:
        text, bom = load_file(a.file)
        ops = json.load(open(a.ops, encoding="utf-8"))
        assert isinstance(ops, list) and ops
    except Exception as e:
        print(f"[用法/读盘错误] {e}", file=sys.stderr)
        return 2

    errs = validate(text, ops)
    if errs:
        print(f"[整批拒绝·零写入] {a.file} 共 {len(ops)} 项，{len(errs)} 项不成立：", file=sys.stderr)
        for e in errs:
            print("  - " + e, file=sys.stderr)
        return 1

    new_text = text
    for op in ops:
        new_text = new_text.replace(op["old"], op.get("new", ""), op.get("count", 1))

    diff = "\n".join(difflib.unified_diff(
        text.splitlines(), new_text.splitlines(),
        fromfile=a.file, tofile=a.file + " (batch)", lineterm=""))
    print(diff if diff else "(无行级差异——整段替换恰好落在同一行)")

    if a.dry_run:
        print(f"[dry-run] {len(ops)} 项全部成立，未写入。")
        return 0

    data = new_text.encode("utf-8")
    if bom:
        data = b"\xef\xbb\xbf" + data
    with open(a.file, "wb") as f:
        f.write(data)
    print(f"[已写入] {a.file} ｜ {len(ops)} 项 ｜ diff {sum(1 for l in diff.splitlines() if l.startswith(('+', '-')) and not l.startswith(('+++', '---')))} 行变动")

    if a.receipt:
        rec = {
            "tool": "batch-edit/v1",
            "at": dt.datetime.now().isoformat(timespec="seconds"),
            "file": a.file,
            "ops": len(ops),
            "sha_before": hashlib.sha256(text.encode("utf-8")).hexdigest()[:12],
            "sha_after": hashlib.sha256(new_text.encode("utf-8")).hexdigest()[:12],
            "diff_lines": diff.count("\n") + 1,
        }
        with open(a.receipt, "w", encoding="utf-8") as f:
            json.dump(rec, f, ensure_ascii=False, indent=1)
        print(f"[收据] {a.receipt}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
