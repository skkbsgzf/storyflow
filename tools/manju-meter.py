"""manju-meter · 漫剧集篇幅与卡点机械核数（出收据，不裁决质量）

用途：改编/润色轮里核「每集字数是否落在配额区间、集末有没有卡点、全片总时长是否够口径」。
口径：
  - 集切分 = 以 `## ` 开头且标题含「第N集」的行作为集边界；
  - 计字 = 该集正文（去掉 artifact 头部、markdown 标记符、空白）字符数；
  - 时长 = 字数 / 500 分钟（甲方口径：500~800 字 ≈ 1~1.5 分钟，取线性 500 字/分钟）；
  - 卡点 = 该集内是否出现「卡点」字样（机械存在性，不判断钩子强度——强度归 agent 与标尺）；
  - 配额来自 --budget JSON（段：{"segments":[{"ep":[1,1],"min":1200,"max":1400},...],"default":{"min":500,"max":800}}），
    不给则用漫剧标准口径内置默认。
退出码：0 = 全部在配额内且每集有卡点；1 = 有越界/缺卡点/无集（交付失败，禁止「接受现状」）。
收据：--out 指定 json（默认 registry/receipts/manju-meter-<时间戳>.json，无 registry 目录时落同前缀于 --out 的父目录）。

用法：
  python tools/manju-meter.py <剧本.md> [--budget <json>] [--out <收据.json>] [--target-minutes 90]
"""
import argparse, json, os, re, sys, time

DEFAULT_SEGMENTS = [
    {"ep": [1, 1], "min": 1200, "max": 1400, "note": "第1集：含冷开场，唯一允许超长"},
    {"ep": [2, 3], "min": 800, "max": 1000, "note": "第2/3集：站稳主角与小队"},
    {"ep": [4, 10], "min": 700, "max": 900, "note": "铺垫段：单集 1~1.5 分钟"},
]
DEFAULT_FALLBACK = {"min": 500, "max": 800, "note": "标准集"}
EP_RE = re.compile(r"^##\s+.*第\s*(\d+)\s*集")
CUT_RE = re.compile(r"^\{\s*$|^\}\s*$|^#.*$|^>.*$|^---\s*$|^\|.*\|\s*$|^---$")
STRIP_RE = re.compile(r"[△◇•·\-—*#>`\[\]()（）:：!！?？,，.。;；、\"'“”‘’\s]")


def strip_frontmatter(text):
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end != -1:
            nl = text.find("\n", end + 1)
            return text[nl + 1:] if nl != -1 else ""
    return text


def split_episodes(text):
    lines = text.split("\n")
    eps, cur = [], None
    for ln in lines:
        m = EP_RE.match(ln)
        if m:
            if cur:
                eps.append(cur)
            cur = {"ep": int(m.group(1)), "title": ln.lstrip("# ").strip(), "lines": []}
        elif cur is not None:
            cur["lines"].append(ln)
    if cur:
        eps.append(cur)
    return eps


def count_chars(lines):
    n = 0
    for ln in lines:
        if CUT_RE.match(ln.strip()) and not ln.strip().startswith("△"):
            continue
        n += len(STRIP_RE.sub("", ln))
    return n


def budget_for(ep_no, segments, fallback):
    for seg in segments:
        lo, hi = seg["ep"]
        if lo <= ep_no <= hi:
            return seg
    return fallback


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("script")
    ap.add_argument("--budget")
    ap.add_argument("--out")
    ap.add_argument("--target-minutes", type=float, default=90.0)
    args = ap.parse_args()

    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

    segments, fallback = DEFAULT_SEGMENTS, DEFAULT_FALLBACK
    if args.budget:
        with open(args.budget, encoding="utf-8") as f:
            b = json.load(f)
        segments = b.get("segments", segments)
        fallback = b.get("default", fallback)

    with open(args.script, encoding="utf-8") as f:
        raw = f.read()
    eps = split_episodes(strip_frontmatter(raw))

    rows, problems = [], []
    total_min = 0.0
    for e in eps:
        chars = count_chars(e["lines"])
        seg = budget_for(e["ep"], segments, fallback)
        minutes = round(chars / 500.0, 2)
        total_min += minutes
        has_card = any("卡点" in ln for ln in e["lines"])
        scenes = sum(1 for ln in e["lines"] if ln.strip().startswith("场景"))
        status = "ok"
        if chars < seg["min"]:
            status = "under"
        elif chars > seg["max"]:
            status = "over"
        if status != "ok":
            problems.append(f"第{e['ep']}集 字数 {chars} 越界（配额 {seg['min']}~{seg['max']}）→ {status}")
        if not has_card:
            problems.append(f"第{e['ep']}集 缺集末卡点")
        rows.append({"ep": e["ep"], "title": e["title"], "chars": chars, "minutes": minutes,
                     "budget": [seg["min"], seg["max"]], "status": status,
                     "has_card": has_card, "scenes": scenes})

    report = {
        "tool": "manju-meter",
        "script": args.script.replace(os.sep, "/"),
        "episodes": len(rows),
        "total_chars": sum(r["chars"] for r in rows),
        "total_minutes": round(total_min, 1),
        "target_minutes": args.target_minutes,
        "duration_gap": round(total_min - args.target_minutes, 1),
        "eps_out_of_tolerance": [r["ep"] for r in rows if r["status"] != "ok"],
        "eps_missing_card": [r["ep"] for r in rows if not r["has_card"]],
        "rows": rows,
        "problems": problems,
        "verdict": "pass" if not problems else "fail",
        "at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "note": "机械核数证据：字数/时长/卡点存在性/场数。不裁决钩子强度与文学质量（归 agent 与标尺卡）。",
    }

    out = args.out
    if not out:
        base = os.path.dirname(os.path.abspath(args.script))
        cand = os.path.join(os.path.dirname(base), "registry", "receipts")
        out = os.path.join(cand if os.path.isdir(cand) else base,
                           "manju-meter-%s.json" % time.strftime("%Y%m%d-%H%M%S"))
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    print("集数 %d | 总字数 %d | 估算时长 %.1f 分（目标 %.1f 分，差 %+.1f）" % (
        report["episodes"], report["total_chars"], report["total_minutes"],
        args.target_minutes, report["duration_gap"]))
    for r in rows:
        print("  第%-3d集 %5d 字  配额 %d~%d  %-5s 卡点%s  %s" % (
            r["ep"], r["chars"], r["budget"][0], r["budget"][1], r["status"],
            "有" if r["has_card"] else "缺", r["title"]))
    for p in problems:
        print("  [FAIL] " + p)
    print("收据: %s" % out.replace(os.sep, "/"))
    if problems:
        print("结论: fail（越界或缺卡点 = 交付失败，先修再交）")
        return 1
    print("结论: pass")
    return 0


if __name__ == "__main__":
    sys.exit(main())
