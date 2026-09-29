# -*- coding: utf-8 -*-
"""cot-analyze · 思维链定量分析（beta 期，只读不写）

对项目的思维链存档与底账（trace/journal/metrics/metrics-summary）做机器可算的定量剖面，
输出报告到 stdout——定性结论由 cot-analyst skill 在此基础上做，无证据不立案。

用法:
  python tools/cot-analyze.py --project <id> [--root <repo>] [--out <报告.md>]
"""
import argparse
import datetime as dt
import json
import os
import sys
from collections import Counter, defaultdict


def load_jsonl(path):
    if not os.path.exists(path):
        return []
    out = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    out.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
    return out


def parse_iso(ts):
    try:
        return dt.datetime.fromisoformat(str(ts).replace("Z", "+00:00")).replace(tzinfo=None)
    except Exception:
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True)
    ap.add_argument("--root", default=os.getcwd())
    ap.add_argument("--out", help="报告落盘路径（缺省只打印 stdout）")
    a = ap.parse_args()
    root = os.path.abspath(a.root)
    proj = os.path.join(root, "projects", a.project)
    if not os.path.isdir(proj):
        print(f"项目不存在: {proj}", file=sys.stderr)
        return 1

    cot_dir = os.path.join(proj, "内部", "思维链")
    docs = sorted(f for f in os.listdir(cot_dir) if f.endswith(".md")) if os.path.isdir(cot_dir) else []
    trace = [t for t in load_jsonl(os.path.join(root, "trace", "cli.jsonl")) if t.get("project") == a.project]
    journal = load_jsonl(os.path.join(proj, "journal.jsonl"))
    metrics = load_jsonl(os.path.join(proj, "registry", "metrics.jsonl"))
    sp = os.path.join(proj, "registry", "metrics-summary.json")
    summary = {}
    if os.path.exists(sp):
        with open(sp, encoding="utf-8") as f:
            summary = json.load(f)

    L = []
    L.append(f"# 思维链定量分析 · {a.project}")
    L.append("")
    L.append(f"> 生成于 {dt.datetime.now().strftime('%Y-%m-%d %H:%M')} · 数据源：trace {len(trace)} 条 / journal {len(journal)} 行 / metrics {len(metrics)} 条 / 存档 {len(docs)} 份")
    L.append("> 定量部分机器可复算；定性结论归 cot-analyst skill，需引用本报告条目作为证据。")
    L.append("")

    # 一、存档清单
    L.append("## 一、思维链存档清单")
    L.append("")
    if docs:
        missing = []
        for d in docs:
            with open(os.path.join(cot_dir, d), encoding="utf-8") as f:
                if "本轮未提供推理注记" in f.read():
                    missing.append(d)
        L.append(f"- 存档 {len(docs)} 份：{', '.join('`' + d + '`' for d in docs)}")
        if missing:
            L.append(f"- **reasoning-missing**（存档时无推理注记，决策依据不可考）：{', '.join('`' + d + '`' for d in missing)}")
    else:
        L.append("- 无存档（beta 期每轮收口应跑 cot-capture）")
    L.append("")

    # 二、CLI 调用统计
    L.append("## 二、CLI 调用统计")
    L.append("")
    if trace:
        by_verb = defaultdict(lambda: [0, 0, 0])  # count, fail, ms
        for t in trace:
            v = by_verb[t.get("verb", "?")]
            v[0] += 1
            v[1] += 1 if t.get("exit", 0) not in (0, None) else 0
            v[2] += t.get("ms") or 0
        L.append("| 动词 | 次数 | 失败 | 累计耗时 |")
        L.append("|---|---|---|---|")
        for v, (c, f_, ms) in sorted(by_verb.items(), key=lambda x: -x[1][0]):
            L.append(f"| `{v}` | {c} | {f_} | {ms / 1000:.1f}s |")
        fails = [t for t in trace if t.get("exit", 0) not in (0, None)]
        if fails:
            L.append("")
            L.append("**失败调用**（重复失败 = 工具或数据侧有坑）：")
            for t in fails[-12:]:
                argv = " ".join(str(x) for x in t.get("argv", []))
                if len(argv) > 100:
                    argv = argv[:97] + "..."
                L.append(f"- `{t.get('exit')}` {dt.datetime.fromisoformat(str(t['ts']).replace('Z','+00:00')).strftime('%m-%d %H:%M')} `{argv}`")
        slow = sorted(trace, key=lambda t: -(t.get("ms") or 0))[:3]
        if slow and slow[0].get("ms", 0) > 5000:
            L.append("")
            L.append("**最慢调用 TOP3**（>5s 才列，瓶颈线索）：")
            for t in slow:
                argv = " ".join(str(x) for x in t.get("argv", []))[:90]
                L.append(f"- {t.get('ms', 0) / 1000:.1f}s `{argv}`")
    else:
        L.append("- 无 trace（BETA 标记开启前的调用不留痕）")
    L.append("")

    # 三、断言/裁决聚类（按节点）
    L.append("## 三、断言与裁决聚类（按节点）")
    L.append("")
    by_node = defaultdict(lambda: Counter())
    for m in metrics:
        if m.get("phase") not in ("submit", "core", "gate", "link", "boundary", "auto-gate"):
            continue
        c = by_node[m.get("nodeId", "?")]
        ass = m.get("asserts") or {}
        c["submits"] += 1
        c["block"] += ass.get("block", 0)
        c["pass"] += ass.get("pass", 0)
        c["retries"] = max(c["retries"], m.get("retries", 0))
        if m.get("verdict"):
            c[f"v:{m['verdict']}"] += 1
    if by_node:
        L.append("| 节点 | 提交 | 断言 P/B | 重试峰值 | 裁决分布 |")
        L.append("|---|---|---|---|---|")
        for nid, c in sorted(by_node.items()):
            verdicts = " ".join(f"{k[2:]}×{v}" for k, v in c.items() if k.startswith("v:")) or "-"
            L.append(f"| `{nid}` | {c['submits']} | {c['pass']}/{c['block']} | {c['retries']} | {verdicts} |")
        hot = [(n, c) for n, c in by_node.items() if c["block"] >= 2 or c["retries"] >= 2]
        if hot:
            L.append("")
            L.append("**热点节点**（block≥2 或重试≥2，优先反推 rubric/标尺问题）：")
            for n, c in hot:
                L.append(f"- `{n}`：block={c['block']} retries={c['retries']}")
    else:
        L.append("- 无提交相指标")
    L.append("")

    # 四、命中率（metrics-summary 读模型）
    L.append("## 四、上下文命中率（metrics-summary 读模型）")
    L.append("")
    kb = summary.get("knowledge") or []
    if kb:
        tot_o = sum(k.get("offered", 0) for k in kb)
        tot_u = sum(k.get("used", 0) for k in kb)
        L.append(f"- kb 卡事件摊开：{tot_u}/{tot_o} = {tot_u / max(tot_o, 1) * 100:.0f}%（字面口径，历史事件不回写）")
        zero = [k["id"] for k in kb if not k.get("used")]
        if zero:
            L.append(f"- 零命中卡 {len(zero)} 张：{'、'.join(zero[:10])}{'…' if len(zero) > 10 else ''}")
            L.append("  - 反推：注入收窄（set-tool remove_knowledge）或概念层校验，见 `tools/hitrate-recheck.mjs`")
    else:
        L.append("- 无 kb 统计（跑 flow_effect 生成 metrics-summary）")
    for n, s in (summary.get("byNode") or {}).items():
        if s.get("ctxOffered"):
            rate = s.get("hitRate", 0) * 100
            if rate < 40:
                L.append(f"- 低命中节点：`{n}` {s.get('ctxUsed', 0)}/{s['ctxOffered']} = {rate:.0f}%")
    L.append("")

    # 五、节奏与吞吐
    L.append("## 五、节奏与吞吐")
    L.append("")
    if journal:
        starts = [j for j in journal if j.get("event") == "run-start"]
        last = journal[-1]
        if starts:
            L.append(f"- run 起点共 {len(starts)} 次（rerun/重编译会再记 run-start）：首 {str(starts[0].get('ts'))[:19]} 末 {str(starts[-1].get('ts'))[:19]}")
        L.append(f"- 事件尾：{str(last.get('ts'))[:19]} {last.get('event')} {last.get('nodeId') or ''} {str(last.get('detail') or '')[:60]}")
        # 同节点相邻两次 submit 的间隔（返工节奏）
        submits = [j for j in journal if j.get("event") == "submit" and j.get("nodeId")]
        per_node = defaultdict(list)
        for s in submits:
            per_node[s["nodeId"]].append(parse_iso(s.get("ts")))
        rework = []
        for nid, tss in per_node.items():
            tss.sort()
            for a1, b1 in zip(tss, tss[1:]):
                if b1 and a1 and (b1 - a1).total_seconds() < 600:
                    rework.append((nid, (b1 - a1).total_seconds()))
        if rework:
            L.append(f"- **10 分钟内同节点重复提交 {len(rework)} 次**（返工节奏，联动上方热点节点）：" + "；".join(f"`{n}`{int(s)}s" for n, s in rework[:8]))
    else:
        L.append("- 无 journal")
    L.append("")

    report = "\n".join(L)
    print(report)
    if a.out:
        os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
        with open(a.out, "w", encoding="utf-8") as f:
            f.write(report + "\n")
        print(f"\n[报告已落盘: {a.out}]", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
