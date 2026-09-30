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
    ap.add_argument("--file", help="单文件模式：目标文件（与 --ops 配对）")
    ap.add_argument("--ops", help="JSON 数组文件：[{old,new,count}]")
    ap.add_argument("--manifest", help="多文件模式：JSON 数组 [{file, ops:[...]}]，任一处不成立=整批拒绝零写入")
    ap.add_argument("--dry-run", action="store_true", help="只校验不落盘")
    ap.add_argument("--receipt", help="收据 JSON 落盘路径")
    a = ap.parse_args()

    multi = bool(a.manifest)
    if multi == bool(a.file or a.ops):
        print("[用法错误] 二选一：--file + --ops ｜ --manifest", file=sys.stderr)
        return 2

    try:
        if multi:
            entries = json.load(open(a.manifest, encoding="utf-8"))
            assert isinstance(entries, list) and entries
            items = [(e["file"], e["ops"]) for e in entries]
        else:
            items = [(a.file, json.load(open(a.ops, encoding="utf-8")))]
        units = []
        for path, ops in items:
            text, bom = load_file(path)
            assert isinstance(ops, list) and ops
            units.append({"file": path, "text": text, "bom": bom, "ops": ops})
    except Exception as e:
        print(f"[用法/读盘错误] {e}", file=sys.stderr)
        return 2

    all_diffs, rejected = [], False
    for u in units:
        errs = validate(u["text"], u["ops"])
        if errs:
            rejected = True
            print(f"[不成立] {u['file']} 共 {len(u['ops'])} 项，{len(errs)} 项：", file=sys.stderr)
            for e in errs:
                print("  - " + e, file=sys.stderr)
            continue
        new_text = u["text"]
        for op in u["ops"]:
            new_text = new_text.replace(op["old"], op.get("new", ""), op.get("count", 1))
        u["new_text"] = new_text
        all_diffs.append("\n".join(difflib.unified_diff(
            u["text"].splitlines(), new_text.splitlines(),
            fromfile=u["file"], tofile=u["file"] + " (batch)", lineterm="")))

    if rejected:
        print(f"[整批拒绝·零写入] {len(units)} 个文件，{sum(1 for u in units if 'new_text' not in u)} 个不成立", file=sys.stderr)
        return 1

    for d in all_diffs:
        print(d if d else "(无行级差异——整段替换恰好落在同一行)")

    if a.dry_run:
        print(f"[dry-run] {len(units)} 个文件、{sum(len(u['ops']) for u in units)} 项全部成立，未写入。")
        return 0

    receipt_entries = []
    for u in units:
        data = u["new_text"].encode("utf-8")
        if u["bom"]:
            data = b"\xef\xbb\xbf" + data
        with open(u["file"], "wb") as f:
            f.write(data)
        receipt_entries.append({
            "file": u["file"],
            "ops": len(u["ops"]),
            "sha_before": hashlib.sha256(u["text"].encode("utf-8")).hexdigest()[:12],
            "sha_after": hashlib.sha256(u["new_text"].encode("utf-8")).hexdigest()[:12],
        })
        print(f"[已写入] {u['file']} ｜ {len(u['ops'])} 项")

    if a.receipt:
        rec = {
            "tool": "batch-edit/v2",
            "at": dt.datetime.now().isoformat(timespec="seconds"),
            "mode": "manifest" if multi else "single",
            "files": len(units),
            "ops": sum(len(u["ops"]) for u in units),
            "entries": receipt_entries,
        }
        with open(a.receipt, "w", encoding="utf-8") as f:
            json.dump(rec, f, ensure_ascii=False, indent=1)
        print(f"[收据] {a.receipt}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
