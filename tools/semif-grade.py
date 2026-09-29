"""semif-grade.py — SemIf 条款体检卷判分（批A 模板，后续条款复用）。

输入两份 jsonl：
  --results  semif-score direct 模式输出（id/option_ids/probabilities/…）
  --gold     人裁金标（id/gold/basis；可选 clause 分组标签，缺省按 id 前缀查 --clauses）
  --clauses  可选 JSON：{"前缀": "条款名"} 映射；无则整卷一个条款。

输出：逐题表 + 按条款一致率 + 置信分带（≥0.9 / <0.7）到 stdout；
     --report <path> 时同内容落 md（附 results 内嵌的 gguf sha256 / prompt_sha256 钉版信息）。
约定（2026-09-22 小测验教训）：判分只出证据不裁决；一致率对比基准=视角泄漏条款 5/5。
"""
import argparse, io, json, collections


def load_jsonl(p):
    return [json.loads(l) for l in io.open(p, encoding="utf-8") if l.strip()]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--results", required=True)
    ap.add_argument("--gold", required=True)
    ap.add_argument("--clauses", help="JSON: id前缀→条款名")
    ap.add_argument("--hi", type=float, default=0.9, help="高置信带下界")
    ap.add_argument("--lo", type=float, default=0.7, help="低置信带上界（应升agent）")
    ap.add_argument("--report", help="可选 md 落盘路径")
    a = ap.parse_args()

    results = {r["id"]: r for r in load_jsonl(a.results)}
    golds = load_jsonl(a.gold)
    prefix_map = json.load(io.open(a.clauses, encoding="utf-8")) if a.clauses else {}

    def clause_of(g):
        if "clause" in g:
            return g["clause"]
        for k, v in prefix_map.items():
            if g["id"].startswith(k):
                return v
        return "本卷"

    by_clause = collections.defaultdict(list)
    lines, pins = [], {}
    miss = 0
    for g in golds:
        r = results.get(g["id"])
        if not r:
            lines.append(f"MISSING {g['id']}")
            miss += 1
            continue
        m = r.get("model", {})
        pins["gguf_sha256"] = (m.get("gguf") or {}).get("sha256", "")
        pins["revision"] = m.get("revision", "")
        scores = dict(zip(r["option_ids"], r["probabilities"]))
        pred = max(scores, key=scores.get)
        conf = max(scores.values())
        p_gold = scores.get(g["gold"], 0.0)
        ok = pred == g["gold"]
        c = clause_of(g)
        by_clause[c].append((ok, conf))
        lines.append(
            f"{g['id']:<16} {c:<6} gold={g['gold']:<12} pred={pred:<12} "
            f"P(gold)={p_gold:.3f} {'OK' if ok else 'MISS'}  {g.get('basis','')}")

    out = []
    out.append("== 逐题 ==")
    out += lines
    if miss:
        out.append(f"!! {miss} 题缺结果行")
    out.append("")
    out.append("== 一致率 ==")
    tot_ok = tot = 0
    for c, v in sorted(by_clause.items()):
        ok = sum(1 for o, _ in v if o)
        tot_ok += ok
        tot += len(v)
        hi = [(o, p) for o, p in v if p >= a.hi]
        lo = [(o, p) for o, p in v if p < a.lo]
        out.append(
            f"{c}: {ok}/{len(v)} | hi-conf(≥{a.hi}): {sum(1 for o,_ in hi if o)}/{len(hi)} 对"
            f" | lo-conf(<{a.lo}, 应升agent): {len(lo)} 条")
    out.append(f"TOTAL: {tot_ok}/{tot} = {tot_ok/max(tot,1):.0%}")
    out.append("")
    out.append(
        f"钉版：revision={pins.get('revision','?')} gguf_sha256={pins.get('gguf_sha256','?')[:16]}…")
    out.append("口径：证据即收据不裁决；P 值只排复核优先级，禁止当放行闸。")
    text = "\n".join(out)
    print(text)
    if a.report:
        io.open(a.report, "w", encoding="utf-8").write(
            f"# SemIf 体检卷判分\n\n输入：{a.results}\n\n```\n{text}\n```\n")


if __name__ == "__main__":
    main()
