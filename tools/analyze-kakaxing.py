#!/usr/bin/env python3
"""kakaxing 语料分析：题材×热度、八段式策划案解析、句式与梗族挖掘。确定性、零 LLM。"""
import json, re, sys
from collections import Counter, defaultdict
from pathlib import Path

DATA = Path(__file__).resolve().parents[1] / "src/kakaxing-Json/data"

def load(name):
    recs = []
    with open(DATA / name, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    recs.append(json.loads(line))
                except Exception:
                    pass
    return recs

def hot2w(h):
    if not h: return 0.0
    h = str(h)
    m = re.match(r"([\d.]+)\s*亿", h)
    if m: return float(m.group(1)) * 10000
    m = re.match(r"([\d.]+)\s*万", h)
    if m: return float(m.group(1))
    try: return float(re.sub(r"[^\d.]", "", h) or 0) / 10000
    except Exception: return 0.0

SEG_LABELS = ["剧名", "频类", "题材", "一句话卖点", "共情点", "爽点内核", "剧情主线", "创新亮点"]
def parse_planning(tp):
    """八段式按序号位置解析（第 3 段常缺'题材'标签）。返回 dict 或 None。"""
    if not tp: return None
    parts = re.split(r"\n?\s*[1-8]、\s*", tp.strip())
    parts = [p.strip() for p in parts if p.strip()]
    if len(parts) < 7: return None
    out = {}
    for i, p in enumerate(parts[:8]):
        # 去掉段内可能存在的"标签："
        p = re.sub(r"^(剧名|频类|题材|一句话卖点|共情点|爽点内核|剧情主线|创新亮点)[：:]\s*", "", p)
        # 剧名段剥书名号
        if i == 0:
            m = re.search(r"《(.+?)》", p)
            p = m.group(1) if m else p
        out[SEG_LABELS[i]] = p
    return out if len(out) >= 7 else None

def main():
    recs = load("scriptrawstone.jsonl")
    print(f"corpus: {len(recs)}")

    # ---- 八段式解析率 ----
    parsed = []
    for r in recs:
        p = parse_planning(r.get("topPlanning"))
        if p: parsed.append((r, p))
    print(f"planning parsed: {len(parsed)} ({100*len(parsed)/len(recs):.1f}%)")

    # ---- 分区题材×热度 ----
    def genre_heat(region, field="scriptThemeAi"):
        gh = defaultdict(lambda: [0, 0.0])
        for r in recs:
            if r.get("regionType") != region: continue
            h = hot2w(r.get("topHot"))
            if h <= 0: continue
            for g in re.split(r"[,，、]", r.get(field) or ""):
                g = g.strip()
                if g: gh[g][0] += 1; gh[g][1] += h
        return gh
    for region in ("CN", "NA"):
        gh = genre_heat(region)
        rows = sorted(gh.items(), key=lambda x: -(x[1][1] / x[1][0]))
        print(f"\n--- {region} avg heat (n>=20) top15 ---")
        for g, (c, hs) in rows[:15]:
            print(f"  {g}: n={c} avg={hs/c:.0f}w")

    # ---- 共情点公式 ----
    gong = Counter()
    for r, p in parsed:
        m = re.match(r"中国?([\d\-至to]+)岁?", p.get("共情点", ""))
        if m: gong[m.group(1)] += 1
    print("\n共情点人群 Top10:", gong.most_common(10))

    # ---- 一句话卖点句式（开头模式）----
    pat = Counter()
    for r, p in parsed:
        s = p.get("一句话卖点", "")
        if "重生" in s[:12]: pat["重生开局"] += 1
        if re.search(r"(竟|居然|却已?)(全)?(成|变)(了?)", s): pat["反差揭示（竟成X）"] += 1
        if re.match(r"^[^，]{2,14}，", s): pat["两段式（短前提，强反转）"] += 1
        if re.search(r"[！!]", s): pat["感叹收尾"] += 1
        if re.search(r"(当众|全场|众人)", s): pat["当众桥段"] += 1
    print("\n卖点句式（样本 %d）:" % len(parsed), pat.most_common())

    # ---- 标题公式 ----
    tpat = Counter()
    for r, p in parsed:
        t = p.get("剧名") or r.get("scriptName") or ""
        if re.search(r"(重生|重回|重返|回到)", t): tpat["重生题"] += 1
        if re.search(r"(后|了)$", t): tpat["完成态收尾（…后/…了）"] += 1
        if re.search(r"，", t): tpat["双段标题"] += 1
        if re.search(r"(全成|都成|竟是|变成)", t): tpat["反差揭示题"] += 1
    print("标题公式:", tpat.most_common())

    # ---- 梗演化链：创新亮点 → 对标剧 ----
    chains = Counter()
    for r, p in parsed:
        c = p.get("创新亮点", "")
        for m in re.finditer(r"《(.+?)》", c):
            chains[m.group(1)] += 1
    print("\n对标剧被引 Top15:", chains.most_common(15))

    # ---- 爽点内核聚类 ----
    shuang = Counter()
    kw = ["打脸", "当众", "马甲", "身份", "逆袭", "反杀", "护短", "认亲", "追妻", "重生", "复仇", "宠", "跪", "揭穿"]
    for r, p in parsed:
        c = p.get("爽点内核", "")
        for k in kw:
            if k in c: shuang[k] += 1
    print("爽点内核关键词:", shuang.most_common())

    # ---- Top 热度样例 ----
    withhot = sorted(((hot2w(r.get("topHot")), r, p) for r, p in parsed if hot2w(r.get("topHot")) > 0), key=lambda x: -x[0])
    print(f"\n--- Top10 热度（共 {len(withhot)} 有热度）---")
    for h, r, p in withhot[:10]:
        print(f"{h:.0f}w [{r.get('scriptGrade')}] {p.get('剧名')} | 卖点: {p.get('一句话卖点','')[:60]}")

if __name__ == "__main__":
    main()
