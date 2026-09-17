"""prose-scan.py v2 · 成稿机味扫描：配额层 + 八维统计画像（可复跑的机械层）

配额层（依据：kb/formats/webnovel-fastfood「排比配额」/ kb/aesthetic/slop-list / 文风档 §三、§十二）：
  1. 三连排比：同章 ≤1 处（模板句三连 / 前缀或后缀同字三连）
  2. 「不是A（而）是B」假转折：全章 ≤2 处
  3. slop 高频词 + 突然/仿佛/似乎：逐词报数（突然/仿佛/似乎 全章 ≤2）
八维统计画像（依据：kb/aesthetic/ai-trace §检测器八维画像；平台检测=统计分布异常识别）：
  词汇多样性(2-gram proxy) / 句长波动 / 短语复现 / 标点节奏 / 对白比例 / 明喻密度 /
  叙事套话命中；第 8 维（语义平滑度）需向量模型，标「人工/评审官维度」。
语义层排比（管X叫Y 式）机器抓不全，交稿前仍需新读者官通读；本工具是网，不是终点。
用法：python tools/prose-scan.py <章.md> [更多章.md ...]
"""
import math
import re
import sys
from pathlib import Path

SLOP = ["值得注意的是", "重要{0,2}的是", "综上", "总之", "可以说", "真的", "确实", "其实",
        "显然", "某种程度", "一定程度上", "深入探讨", "赋能", "彰显", "沉浸式", "颗粒度"]
RHYTHM = ["突然", "仿佛", "似乎"]  # 文风档 §三：全章 ≤2
NOT_BUT = re.compile(r"不是[^。！？\n]{1,18}?[，。；][^。！？\n]{0,6}?(而是|是)")

# kb/aesthetic/slop-list v2 · 叙事套话黑名单（叙述层命中即候选病灶）
CLICHE = {
    "反应族": ["不由得一愣", "眉头紧锁", "皱了皱眉", "深吸一口气", "倒吸一口凉气", "倒吸凉气",
              "瞳孔猛地一缩", "瞳孔地震", "心中一动", "心里咯噔", "一怔"],
    "表情族": ["嘴角微微上扬", "嘴角勾起一抹弧度", "勾起一抹", "眼底闪过一丝", "眼中闪过一丝",
              "眸中精光一闪", "目光如炬", "脸色一沉", "闪过一丝复杂的情绪", "一丝不易察觉"],
    "氛围族": ["空气仿佛凝固", "气氛一时间有些微妙", "时间仿佛静止", "落针可闻", "空气凝固"],
    "限定族": ["不易察觉的", "说不清道不明", "某种复杂的情绪", "五味杂陈"],
    "万能副词族": ["无一例外", "不约而同", "整齐划一"],
}
SIMILE = re.compile(r"像|好似|如同|仿佛|宛如|恍若")
SIMILE_SHELL = ["仿佛", "宛如", "恍若", "恍如"]  # 文言壳：全章 ≤1（metaphor-zh §三）
SENT_SPLIT = re.compile(r"[。！？…]+")
PUNCT = "，。！？；：、…—「」『』“”"


def han_count(s):
    return len(re.findall(r"[\u4e00-\u9fff]", s))


def stats_profile(text):
    """八维统计画像（第 8 维语义平滑度需向量模型，标注为人工维度）"""
    han = han_count(text) or 1
    lines = []

    # 1. 词汇多样性（无分词环境用 2-gram unique ratio 作 proxy）
    bi = [text[i:i + 2] for i in range(len(text) - 1)
          if re.match(r"[\u4e00-\u9fff]{2}", text[i:i + 2])]
    div = (len(set(bi)) / len(bi)) if bi else 0
    flag = "⚠偏低" if div < 0.55 else ""
    lines.append(f"1 词汇多样性(2gram proxy)={div:.2f} {flag}(参考: 人工文本经验值 ≥0.6，平台线 0.55)")

    # 2. 句长波动（快餐文拟声单段/独词句是刻意节奏，大方差是形态特征——只盯「过平」方向）
    lens = [han_count(s) for s in SENT_SPLIT.split(text) if han_count(s) >= 2]
    if len(lens) >= 3:
        mean = sum(lens) / len(lens)
        std = math.sqrt(sum((x - mean) ** 2 for x in lens) / len(lens))
        flag = "⚠过平(句长均匀=机味信号)" if std < 2 else ""
        lines.append(f"2 句长: 均值{mean:.1f} 标准差{std:.2f} {flag}(过平<2 危险；快餐文大方差属正常形态)")

    # 3. 短语复现（4 字滑窗出现 ≥3 次）
    win = 4
    grams = {}
    clean = re.sub(r"[^\u4e00-\u9fff]", "", text)
    for i in range(len(clean) - win + 1):
        g = clean[i:i + win]
        grams[g] = grams.get(g, 0) + 1
    rep = sorted(((g, n) for g, n in grams.items() if n >= 3), key=lambda x: -x[1])[:5]
    if rep:
        rep_s = "；".join(f"「{g}」×{n}" for g, n in rep)
        lines.append(f"3 短语复现(4字≥3次): {rep_s}（专名复现可豁免，非专名复现=3gram 高危）")
    else:
        lines.append("3 短语复现(4字≥3次): 无")

    # 4. 标点节奏（标点间隔字符数的变异系数；平台自然值≈0.45）
    gaps = []
    cur = 0
    for ch in text:
        if ch in PUNCT:
            if cur > 0:
                gaps.append(cur)
            cur = 0
        else:
            cur += 1
    if len(gaps) >= 5:
        m = sum(gaps) / len(gaps)
        sd = math.sqrt(sum((x - m) ** 2 for x in gaps) / len(gaps))
        cv = sd / m if m else 0
        flag = "⚠过均匀" if cv < 0.3 else ""
        lines.append(f"4 标点节奏: 间隔均值{m:.1f} CV={cv:.2f} {flag}(平台自然值≈0.45)")

    # 5. 对白比例
    quotes = re.findall(r"「[^」]*」", text)
    qc = sum(han_count(q) for q in quotes)
    ratio = qc / han * 100
    flag = "⚠两极" if (ratio < 5 or ratio > 65) else ""
    lines.append(f"5 对白比例: {ratio:.0f}%（{len(quotes)} 句）{flag}(平台自然区间 5-65%)")

    # 6. 明喻密度（metaphor-zh §三：≤2 处/千字，按含标点总字数口径；文言壳 ≤1/章）
    sim = SIMILE.findall(text)
    rate = len(sim) / (len(text) / 1000) if text else 0
    shells = sum(len(re.findall(w, text)) for w in SIMILE_SHELL)
    flag = "⚠超配额" if rate > 2 else ""
    lines.append(f"6 明喻: {len(sim)} 处 = {rate:.1f}/千字 {flag}(配额≤2/千字)；文言壳(仿佛/宛如/恍若)×{shells}(≤1)")

    # 7. 叙事套话黑名单
    hits = []
    for fam, words in CLICHE.items():
        for w in words:
            n = len(re.findall(w, text))
            if n:
                hits.append(f"{w}×{n}")
    lines.append(f"7 叙事套话: {'；'.join(hits) if hits else '零命中'}（命中≠必改，过『删词句意受损吗』判定）")

    # 7b. 破折号（slop-list v2 · naturalness #13：装饰性破折号清零，仅歌谣断句/对话打断可留，≤1/章）
    dashes = len(re.findall("——", text))
    flag = "⚠超限(查是否装饰性滥用)" if dashes > 1 else ""
    lines.append(f"7b 破折号: {dashes} 处 {flag}(配额≤1/章，功能性保留口径：歌谣断句/对话被打断)")

    # 7c. 否定排比（slop-list v2.1 §三点五 S2/S3：叙述层清零口径）
    negpar = re.findall(r"不[一-鿿]{1,8}，不[一-鿿]{1,8}，[只仅]", text)
    reveal = re.findall(r"不是[^。！？\n]{1,14}。不是[^。！？\n]{1,14}。", text)
    if negpar or reveal:
        sample = "；".join((negpar + reveal)[:3])
        lines.append(f"7c 否定排比: ⚠{sample}（叙述层清零，改积极句式对照）")
    else:
        lines.append("7c 否定排比: 零命中")

    # 8. 语义平滑度（n-gram proxy：相邻句 bigram Jaccard；平台向量口径的粗糙近似）
    sents8 = [s.strip() for s in SENT_SPLIT.split(text) if han_count(s) >= 6]

    def bgs(s):
        h = re.sub(r"[^\u4e00-\u9fff]", "", s)
        return set(h[i:i + 2] for i in range(len(h) - 1)) if len(h) > 1 else set()

    sims, smooth = [], []
    for a, b in zip(sents8, sents8[1:]):
        A, B = bgs(a), bgs(b)
        if not A or not B:
            continue
        j = len(A & B) / len(A | B)
        sims.append(j)
        if j > 0.6 and len(smooth) < 3:
            smooth.append(f"「…{a[-10:]}」↔「{b[:10]}…」J={j:.2f}")
    if sims:
        m8 = sum(sims) / len(sims)
        flag = "⚠过顺(衔接缺思维断层)" if m8 > 0.45 else ""
        tail = f"；最顺对: {'；'.join(smooth)}" if smooth else ""
        lines.append(f"8 语义平滑度(ngram proxy): 相邻句均值 {m8:.2f} {flag}(>0.45 偏顺滑；n-gram 近似，非向量口径){tail}")
    else:
        lines.append("8 语义平滑度: 样本不足（向量口径归评审官/新读者官人工维度）")
    return lines


def clauses(text):
    """句 -> 子句（，、；分层），用于同句内排比检测"""
    out = []
    for sent in re.split(r"[。！？…]+", text):
        cs = [c for c in re.split(r"[，；、]+", sent) if len(c.strip()) >= 2]
        if cs:
            out.append(cs)
    return out


def scan(path):
    text = Path(path).read_text(encoding="utf-8")
    text = re.sub(r"^---.*?---", "", text, flags=re.S)  # 去 frontmatter
    text = re.sub(r"^#.*$", "", text, flags=re.M)       # 去标题
    findings = []

    # --- 1a. 模板句三连：相邻三句，首字相同 + 逗号位置相同 + 字长差 ≤1 ---
    sents = [s.strip() for s in re.split(r"(?<=[。！？])", text) if len(s.strip()) >= 4]
    for i in range(len(sents) - 2):
        a, b, c = sents[i], sents[i + 1], sents[i + 2]

        def shape(s):
            body = re.sub(r"[「」『』“”\s]", "", s)
            return (body[0], body.find("，"), len(re.sub(r"[^\u4e00-\u9fff]", "", body)))

        sa, sb, sc = shape(a), shape(b), shape(c)
        if sa[0] == sb[0] == sc[0] and abs(sa[2] - sb[2]) <= 1 and abs(sb[2] - sc[2]) <= 1:
            findings.append(("三连排比(模板句)", f"{a} ｜ {b} ｜ {c}"))

    # --- 1b. 同句内排比：相邻三子句，前两字或后两字相同 ---
    for cs in clauses(text):
        for i in range(len(cs) - 2):
            x, y, z = (c.strip() for c in cs[i:i + 3])
            if len(x) > 5 and x.startswith(("第一", "第二", "第三")):
                continue  # 编号列举豁免（画面分格/条目）
            if x[:2] == y[:2] == z[:2] or x[-2:] == y[-2:] == z[-2:]:
                findings.append(("三连排比(同句)", f"{x}，{y}，{z}"))

    # --- 2. 不是A（而）是B ---
    nb = [m.group(0) for m in NOT_BUT.finditer(text)]
    if len(nb) > 2:
        findings.append((f"不是A是B ×{len(nb)}(配额2)", " ｜ ".join(n.strip() for n in nb)))

    # --- 3. slop 词 + 节奏词 ---
    for w in SLOP + RHYTHM:
        n = len(re.findall(w, text))
        if n == 0:
            continue
        cap = " ≤2" if w in RHYTHM else ""
        findings.append((f"slop「{w}」×{n}{cap}", ""))

    return findings


def ai_index(path):
    """AI味指数 0-100（本地约束引擎口径；与朱雀 confidence 做对照校准）。
    透明加权：配额层（三连/不是A是B/slop/节奏词/否定排比）+ 八维关键数值
    （词汇多样性/句长方差/明喻密度/套话/破折号/平滑度）。
    经验带：≤15 干净 ｜ 16-30 配额内波动 ｜ 31-60 建议本地修 ｜ >60 高危（先本地改再送外部检测）。"""
    raw = Path(path).read_text(encoding="utf-8")
    text = re.sub(r"^---.*?---", "", raw, flags=re.S)
    text = re.sub(r"^#.*$", "", text, flags=re.M)
    han = han_count(text) or 1
    items, score = [], 0

    def add(w, reason):
        nonlocal score
        if w <= 0:
            return
        score += w
        items.append({"w": w, "reason": reason})

    fs = scan(path)
    triplets = sum(1 for f in fs if f[0].startswith("三连"))
    if triplets > 1:
        add(min((triplets - 1) * 12, 24), f"三连排比 {triplets} 处（超配额）")
    elif triplets == 1:
        add(4, "三连排比 1 处（配额内，须为豁免体）")
    nb = len(NOT_BUT.findall(text))
    if nb > 2:
        add((nb - 2) * 8, f"不是A是B {nb} 处（配额2）")
    for w in SLOP:
        n = len(re.findall(w, text))
        if n:
            add(min(6 * n, 18), f"slop「{w}」×{n}")
    rhythm_total = sum(len(re.findall(w, text)) for w in RHYTHM)
    if rhythm_total > 2:
        add((rhythm_total - 2) * 4, f"节奏词 {rhythm_total} 处（配额2）")

    bi = [text[i:i + 2] for i in range(len(text) - 1)
          if re.match(r"[\u4e00-\u9fff]{2}", text[i:i + 2])]
    div = (len(set(bi)) / len(bi)) if bi else 0
    if div < 0.55:
        add(15, f"词汇多样性 {div:.2f}（<0.55 平台线）")
    elif div < 0.6:
        add(8, f"词汇多样性 {div:.2f}（<0.6 经验值）")
    lens = [han_count(s) for s in SENT_SPLIT.split(text) if han_count(s) >= 2]
    if len(lens) >= 3:
        mean = sum(lens) / len(lens)
        std = math.sqrt(sum((x - mean) ** 2 for x in lens) / len(lens))
        if std < 2:
            add(15, f"句长标准差 {std:.2f}（过平=机味信号）")
    sim = len(SIMILE.findall(text))
    sim_rate = sim / (len(text) / 1000) if text else 0
    if sim_rate > 2:
        add(min(int((sim_rate - 2) * 3) + 3, 12), f"明喻 {sim_rate:.1f}/千字（配额2）")
    cliche_n = sum(len(re.findall(w, text)) for fam in CLICHE.values() for w in fam)
    if cliche_n:
        add(min(3 * cliche_n, 15), f"叙事套话 {cliche_n} 处")
    dashes = len(re.findall("——", text))
    if dashes > 1:
        add(min((dashes - 1) * 2, 8), f"破折号 {dashes} 处（配额1）")
    negpar = re.findall(r"不[一-鿿]{1,8}，不[一-鿿]{1,8}，[只仅]", text)
    if negpar:
        add(8, f"否定排比 {len(negpar)} 处")
    sents8 = [s.strip() for s in SENT_SPLIT.split(text) if han_count(s) >= 6]

    def bgs(s):
        h = re.sub(r"[^\u4e00-\u9fff]", "", s)
        return set(h[i:i + 2] for i in range(len(h) - 1)) if len(h) > 1 else set()

    sims = []
    for x, y in zip(sents8, sents8[1:]):
        A, B = bgs(x), bgs(y)
        if A and B:
            sims.append(len(A & B) / len(A | B))
    if sims:
        m8 = sum(sims) / len(sims)
        if m8 > 0.45:
            add(10, f"语义平滑度 {m8:.2f}（>0.45 偏顺滑）")

    return {"path": str(path), "chars": len(text), "han": han,
            "findings": [f[0] for f in fs],
            "aiIndex": max(0, min(score, 100)), "items": items}


def format_redlines(path, text=None):
    """格式红线（依据 kb/craft/user-style-rules R1-R3；仅对成文/交付类路径生效）：
    R1 「」直角引号不得进成文正文 ｜ R2 加粗滥用（正文≤1 处；报告≤2/千字） ｜ R3 箭头链禁用。
    格式问题独立于 AI味指数——它是约定，不是风格。"""
    rel = str(path).replace("\\", "/")
    if not re.search(r"对外交付|章节正文|终稿|正文|剧本", rel):
        return []
    raw = Path(path).read_text(encoding="utf-8")
    body = re.sub(r"^---.*?---", "", raw, flags=re.S)
    issues = []
    corner = len(re.findall(r"「[^」\n]{1,40}」", body))
    if corner:
        issues.append({"rule": "R1-引号口径", "n": corner, "limit": 0,
                       "note": "对白/强调须用“”（内层‘’）；「」不得进成文正文"})
    bold = len(re.findall(r"\*\*[^*\n]{1,60}\*\*", body))
    if re.search(r"章节正文|终稿|正文", rel):
        if bold > 1:
            issues.append({"rule": "R2-加粗滥用", "n": bold, "limit": 1,
                           "note": "正文段落禁装饰性加粗（全篇≤1 处，仅功能性）"})
    else:
        per1k = bold / (len(body) / 1000) if body else 0
        if per1k > 2:
            issues.append({"rule": "R2-加粗滥用", "n": bold, "limit": "≤2/千字",
                           "note": f"当前 {per1k:.1f}/千字——只用于真结论句"})
    arrows = len(re.findall(r"→|->|=>|＝>", body))
    if arrows:
        issues.append({"rule": "R3-箭头链", "n": arrows, "limit": 0,
                       "note": "推理/推进写成叙事句；思维链不出现在交付文档"})
    return issues


if __name__ == "__main__":
    import argparse
    import json as _json
    ap = argparse.ArgumentParser(description="prose-scan v2 · 本地机味扫描（配额层+八维画像+AI味指数；两级门的 L1）")
    ap.add_argument("files", nargs="+", help="章 .md 文件")
    ap.add_argument("--json", action="store_true", help="输出机器可读 JSON（含 AI味指数，供 zhuque-check --compare 对照）")
    a = ap.parse_args()

    if not a.json:
        print("prose-scan v2 · 配额层 + 八维统计画像（kb/aesthetic/ai-trace v1.1 · metaphor-zh · slop-list v2）")
    bad_files = 0
    out = []
    for p in a.files:
        fs = scan(p)
        ai = ai_index(p)
        red = format_redlines(p)
        ai["formatIssues"] = red
        out.append(ai)
        n_triplet = sum(1 for f in fs if f[0].startswith("三连"))
        nb_over = [f for f in fs if "不是A是B ×" in f[0] and int(re.search(r"×(\d+)", f[0]).group(1)) > 2]
        if a.json:
            continue
        print(f"\n== {p} ==")
        if not fs:
            print("  清。")
        for tag, ctx in fs:
            if tag.startswith("三连"):
                # 配额=每章1处：恰 1 处=配额内（须为文书体豁免或笑点本体），>1=超
                mark = "✗超配额" if n_triplet > 1 else "·配额内(须为豁免体)"
            else:
                mark = "·计数"
            print(f"  [{mark}] {tag}" + (f"  {ctx}" if ctx else ""))
        raw = Path(p).read_text(encoding="utf-8")
        raw = re.sub(r"^---.*?---", "", raw, flags=re.S)
        raw = re.sub(r"^#.*$", "", raw, flags=re.M)
        print("  ── 八维统计画像（ai-trace v1.1）──")
        for ln in stats_profile(raw):
            print(f"    {ln}")
        band = "干净" if ai["aiIndex"] <= 15 else "配额内波动" if ai["aiIndex"] <= 30 else "建议本地修改" if ai["aiIndex"] <= 60 else "高危（先本地改再送外部检测）"
        print(f"  ── AI味指数: {ai['aiIndex']}/100（{band}）──")
        for it in ai["items"]:
            print(f"    - {it['reason']}（+{it['w']}）")
        if red:
            print("  ── 格式红线（kb/craft/user-style-rules）──")
            for iss in red:
                print(f"    ✗ [{iss['rule']}] {iss['n']} 处（限 {iss['limit']}）{iss['note']}")
        if n_triplet > 1 or nb_over:
            bad_files += 1
    if not a.json:
        print(f"\n结论：超配额文件 {bad_files} 个（三连>1/章 或 不是A是B>2/章）；配额内命中=自行对照豁免条件（文书体/笑点本体/定场区不豁免）")
    else:
        print(_json.dumps(out[0] if len(out) == 1 else out, ensure_ascii=False, indent=2))
