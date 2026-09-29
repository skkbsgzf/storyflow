#!/usr/bin/env python3
"""style_data · 文风指纹训练集构造器（全量，自动打标，零人裁金标依赖）。

三类语料：
  pengpai     异兽迷城 raw/ 1306 章（正·目标文风）
  other_human 十日终焉.txt / 诸神愚戏.txt（正·其他真人）
  ai          本仓在档 AI 成稿（负·过拟合痕迹携带者）

自动题面（阈值源自 语言DNA.md 画像 + slop-list 词表，脚本内单点定义）：
  style.rhythm.v1.noul / style.punct.v1.noul / style.dialogue.v1.noul /
  slop.banned.v1.noul / style.time-word.v1.noul / style.density.v1.score
配对题面：
  style.real.v1.choice（真人块 × AI 块 随机配对）

用法：
  laya-venv python tools/laya-ft/style_data.py --out dataset-style/v02 --per-class 500 \
      --exclude dataset-style/test.jsonl,dataset-style/held.jsonl
"""
import argparse, json, random, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).parent
PENGPAI_RAW = Path("D:/写作/04_风格蒸馏/异兽迷城-彭湃/raw")
OTHER_TXT = [Path("D:/写作/04_资料/下载小说语料/十日终焉.txt"),
             Path("D:/写作/04_资料/下载小说语料/诸神愚戏.txt")]
AI_FILES = [  # v0.2：每项目只收终稿——正文/终稿是近似重复文本，v0.1 双收造成跨 split 近重复泄漏
    "projects/p-kunxiu-001/04-写作/终稿.md",
    "projects/p-kunxiu-002/04-写作/终稿.md",
    "projects/p-yaomo-fx-001/03-写作/终稿.md",
    "projects/p-yaomo-fx-002/03-写作/终稿.md",
    "projects/p-wxl-001/03-写作/终稿.md",
    "projects/p-slj-001/03-写作/终稿.md",
    "projects/p-slj-007/03-写作/终稿.md",
    "projects/ccwd-fq/03-写作/终稿.md",
]
TIME_WORDS = ["很快", "几秒后", "两秒后", "忽然", "一时间", "顿了顿", "下一秒", "片刻后"]
BANNED = ["赋能", "深耕", "聚焦", "助力", "打造", "引领", "全方位", "闭环", "抓手", "底层逻辑",
          "顶层设计", "降本增效", "颗粒度", "未来可期", "前景广阔", "拭目以待", "谱写",
          "注入了新的活力", "里程碑", "以下是关于", "希望以上信息"]

def clean(text: str) -> str:
    if text.lstrip().startswith("---"):
        text = re.sub(r"^---[\s\S]*?---\n", "", text)
    text = re.sub(r"^#{1,3} .*$", "", text, flags=re.M)
    text = re.sub(r"^>\s.*$", "", text, flags=re.M)
    return re.sub(r"\n{3,}", "\n\n", text).strip()

def blocks_of(text: str, size=420):
    buf, out = [], []
    for para in [p.strip() for p in text.split("\n") if p.strip()]:
        buf.append(para)
        if sum(len(x) for x in buf) >= size:
            out.append("\n".join(buf)); buf = []
    if buf:
        out.append("\n".join(buf))
    return [b for b in out if 150 <= len(b) <= 1200]

def feats(b: str):
    sents = [s for s in re.split(r"[。！？\n]", b) if s.strip()]
    n_sent = max(1, len(sents))
    paras = [p for p in b.split("\n") if p.strip()]
    n_para = max(1, len(paras))
    k = len(b) / 1000
    dq = re.findall(r"“[^”]*”", b)
    return {
        "avg_sent_len": round(sum(len(s) for s in sents) / n_sent, 1),
        "short_ratio": round(sum(1 for s in sents if len(s) <= 15) / n_sent, 2),
        "oneline_ratio": round(sum(1 for p in paras if len(p) <= 15) / n_para, 2),
        "dialogue_ratio": round(sum(len(x) for x in dq) / max(1, len(b)), 2),
        "quote_pairs": len(dq),
        "said_tags": len(re.findall(r"[说道问喊笑答][^。]{0,4}[:：]|笑着说道|冷冷说道", b)),
        "ellipsis_lines": sum(1 for p in paras if re.fullmatch(r"…+|。{6}", p.strip())),
        "ellipsis": b.count("…"),
        "dash_per_k": round(b.count("——") / k, 2),
        "excl_per_k": round(b.count("！") / k, 2),
        "time_hits": sum(b.count(w) for w in TIME_WORDS),
        "banned_hits": sum(b.count(w) for w in BANNED),
        "chars": len(b),
    }

def rhythm_label(f):  return f["avg_sent_len"] <= 32 and f["short_ratio"] >= 0.30 and f["oneline_ratio"] >= 0.10
def punct_label(f):   return (f["ellipsis_lines"] >= 1 or f["ellipsis"] >= 2) and f["dash_per_k"] < 4 and f["excl_per_k"] >= 2
def dialogue_label(f): return 0.15 <= f["dialogue_ratio"] <= 0.40 and f["quote_pairs"] >= 2
def banned_label(f):  return f["banned_hits"] >= 1
def time_label(f):    return f["time_hits"] / max(1, f["chars"] / 1000) >= 1  # v0.2 由彭湃分布重定标：≥2/千字仅 11% 命中（p90=2），≥1/千字 true≈40%

def pollute(text: str, rng) -> str:
    """合成污染：随机 1-2 个 BANNED 词插入句间，造 slop.banned true 例。
    自然语料该词表命中≈0（真人网文与本仓 AI 流程产出都已清洗），不增强则该题退化为常数题（v0.1 true率仅 1-2%）。"""
    parts = [p for p in re.split(r"(?<=[。！？\n])", text) if p]
    for w in rng.sample(BANNED, k=min(2, len(BANNED))):
        parts.insert(rng.randrange(len(parts) + 1), w)
    return "".join(parts)

def bin_gold(flag):   return {"true": 1.0 if flag else 0.0, "false": 0.0 if flag else 1.0}
def density_gold(f):
    hits = sum(x for x in (rhythm_label(f), punct_label(f), dialogue_label(f), time_label(f)) if x)
    return {"probabilities": {str(i): (1.0 if i == min(3, hits) else 0.0) for i in range(4)}}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="dataset-style")
    ap.add_argument("--per-class", type=int, default=500)
    ap.add_argument("--pairs", type=int, default=200)
    ap.add_argument("--pollute", type=float, default=0.15,
                    help="合成污染块比例（随机插 1-2 个 BANNED 词造 slop.banned true 例；自然命中≈0）")
    ap.add_argument("--exclude", default="",
                    help="jsonl 路径（逗号分隔）：其 state 文本块禁入本集（跨版本 train/test 防泄漏）")
    ap.add_argument("--seed", type=int, default=20260926)
    a = ap.parse_args()
    rng = random.Random(a.seed)
    spec = json.loads((HERE / "style.questions.spec.json").read_text(encoding="utf-8"))["questions"]
    stats = {"polluted": 0, "excluded": 0}
    ban_texts = set()
    for pth in filter(None, a.exclude.split(",")):
        for line in Path(pth.strip()).read_text(encoding="utf-8").splitlines():
            if line.strip():
                s = json.loads(json.loads(line)["state"])
                ban_texts.update(v for v in s.values() if isinstance(v, str) and len(v) >= 100)

    def collect(paths, kind, cap):
        out = []
        for rel in paths:
            p = Path(rel) if Path(rel).is_absolute() else ROOT / rel
            if not p.exists():
                print(f"[warn] 缺 {p}", file=sys.stderr); continue
            txt = clean(p.read_text(encoding="utf-8", errors="replace"))
            for b in blocks_of(txt):
                text = b
                if rng.random() < a.pollute:  # 先污染后提特征：标签与文本保持一致
                    text = pollute(b, rng)
                    stats["polluted"] += 1
                out.append({"kind": kind, "text": text, "f": feats(text)})
        rng.shuffle(out)
        return out[:cap]

    pp = collect([str(p) for p in sorted(PENGPAI_RAW.glob("*.txt"))], "pengpai", a.per_class)
    oh = collect([str(p) for p in OTHER_TXT], "other_human", a.per_class)
    ai = collect([str(ROOT / rel) for rel in AI_FILES], "ai", a.per_class)
    print(f"[data] pengpai={len(pp)} other_human={len(oh)} ai={len(ai)}", file=sys.stderr)

    out_rows = []
    def emit_single(kind, text, f, origin):
        gold = {
            "style.rhythm.v1.noul": bin_gold(rhythm_label(f)),
            "style.punct.v1.noul": bin_gold(punct_label(f)),
            "style.dialogue.v1.noul": bin_gold(dialogue_label(f)),
            "slop.banned.v1.noul": bin_gold(banned_label(f)),
            "style.time-word.v1.noul": bin_gold(time_label(f)),
            "style.density.v1.score": density_gold(f),
            "style.origin.v1.choice": {"probabilities": {t: (1.0 if t == origin else 0.0)
                                                         for t in ("pengpai", "other_human", "ai")}},
        }
        qs = {q: spec[q] for q in gold if q in spec}
        out_rows.append({"case_id": f"{kind}-{len(out_rows):05d}", "kind": kind, "text": text,
                         "questions": json.dumps(qs, ensure_ascii=False),
                         "gold": json.dumps(gold, ensure_ascii=False)})
    def emit_ok(t):
        if t in ban_texts:
            stats["excluded"] += 1
            return False
        return True
    for b in pp:
        if emit_ok(b["text"]): emit_single("pengpai", b["text"], b["f"], "pengpai")
    for b in oh:
        if emit_ok(b["text"]): emit_single("other_human", b["text"], b["f"], "other_human")
    for b in ai:
        if emit_ok(b["text"]): emit_single("ai", b["text"], b["f"], "ai")

    humans = [r for r in out_rows if r["kind"] in ("pengpai", "other_human")]
    ais = [r for r in out_rows if r["kind"] == "ai"]
    rng.shuffle(humans); rng.shuffle(ais)
    qs_pair = spec["style.real.v1.choice"]
    for i in range(min(a.pairs, len(humans), len(ais))):
        human, airow = humans[i % len(humans)], ais[i % len(ais)]
        a_first = rng.random() < 0.5
        gold_choice = "A" if a_first else "B"
        qs = {"style.real.v1.choice": qs_pair}
        gold = json.dumps({"style.real.v1.choice": {"probabilities": {"A": 1.0 if gold_choice == "A" else 0.0,
                                                                     "B": 1.0 if gold_choice == "B" else 0.0}}},
                          ensure_ascii=False)
        out_rows.append({"case_id": f"pair-{i:05d}", "kind": "pair",
                         "textA": human["text"] if a_first else airow["text"],
                         "textB": airow["text"] if a_first else human["text"],
                         "questions": json.dumps(qs, ensure_ascii=False), "gold": gold})

    outdir = Path(a.out); outdir.mkdir(parents=True, exist_ok=True)
    rng.shuffle(out_rows)
    lines = []
    for r in out_rows:
        state = ({"文本A": r["textA"], "文本B": r["textB"]} if r["kind"] == "pair"
                 else {"场景文本": r["text"]})
        lines.append(json.dumps({"case_id": r["case_id"], "state": json.dumps(state, ensure_ascii=False),
                                 "questions": r["questions"], "gold": r["gold"]}, ensure_ascii=False))
    n = len(lines)
    n_train, n_held = int(n * 0.80), int(n * 0.90)  # v0.2：held 10%（v0.1 仅 33 行，选轮=抽签）
    (outdir / "train.jsonl").write_text("\n".join(lines[:n_train]), encoding="utf-8")
    (outdir / "held.jsonl").write_text("\n".join(lines[n_train:n_held]), encoding="utf-8")
    (outdir / "test.jsonl").write_text("\n".join(lines[n_held:]), encoding="utf-8")
    summary = {}
    for r in out_rows:
        summary[r["kind"]] = summary.get(r["kind"], 0) + 1
    rates = {}
    for row in out_rows:
        if row["kind"] == "pair":
            continue
        for qid, gv in json.loads(row["gold"]).items():
            if "true" in gv:
                d = rates.setdefault(qid, [0, 0])
                d[0] += gv["true"]; d[1] += 1
    (outdir / "style-summary.json").write_text(json.dumps(
        {"rows": n, "train": n_train, "held": n_held - n_train, "test": n - n_held,
         "by_kind": summary, "polluted_blocks": stats["polluted"],
         "excluded_leak": stats["excluded"],
         "noul_true_rate": {k: round(v / c, 3) for k, (v, c) in rates.items()}},
        ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps({"outdir": str(outdir), "rows": n, **summary}, ensure_ascii=False, indent=1))

if __name__ == "__main__":
    main()
