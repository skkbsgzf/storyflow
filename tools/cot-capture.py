# -*- coding: utf-8 -*-
"""cot-capture · 思维链存档（beta 期）

每轮执行收口时跑一次，把本轮的执行链拼装成单份文档：
  journal（内核事件）+ metrics（断言/命中/裁决）+ trace/cli.jsonl（CLI 调用留痕）
  + --note 推理注记（执行人当场写的「为什么这么写」，不事后补写）。

用法:
  python tools/cot-capture.py --project <id> [--note <推理注记.md>] [--root <repo>] [--force]

输出:
  projects/<id>/内部/思维链/<NNN>-<runid>-<时间戳>.md   （本轮思维链）
  projects/<id>/内部/思维链/.cursor.json                （行数游标，续轮增量）

门控: repo 根存在 BETA 标记文件才落盘（beta 测试期开关）；--force 可绕过。
纪律: 过程元数据的合法居所（AE-OUTPUT-PURITY 的宿主侧），绝不回写产物正文。
"""
import argparse
import datetime as dt
import json
import os
import sys


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
                    pass  # 尾部半行（并发写）跳过
    return out


def read_cursor(cot_dir):
    p = os.path.join(cot_dir, ".cursor.json")
    if os.path.exists(p):
        try:
            with open(p, encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {"journal": 0, "metrics": 0, "trace": 0, "seq": 0}


def write_cursor(cot_dir, cur):
    with open(os.path.join(cot_dir, ".cursor.json"), "w", encoding="utf-8") as f:
        json.dump(cur, f, ensure_ascii=False, indent=1)


def fmt_ts(ts):
    return (ts or "").replace("T", " ")[:19]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True)
    ap.add_argument("--note", help="推理注记 md 文件（执行人当场写的决策依据/取舍）")
    ap.add_argument("--root", default=os.getcwd())
    ap.add_argument("--force", action="store_true", help="非 beta 期也强制落盘")
    a = ap.parse_args()

    root = os.path.abspath(a.root)
    if not a.force and not os.path.exists(os.path.join(root, "BETA")):
        print("非 beta 期（repo 根无 BETA 标记），跳过存档。--force 可强制。")
        return 0

    proj = os.path.join(root, "projects", a.project)
    if not os.path.isdir(proj):
        print(f"项目不存在: {proj}", file=sys.stderr)
        return 1

    cot_dir = os.path.join(proj, "内部", "思维链")
    os.makedirs(cot_dir, exist_ok=True)
    cur = read_cursor(cot_dir)

    journal_all = load_jsonl(os.path.join(proj, "journal.jsonl"))
    metrics_all = load_jsonl(os.path.join(proj, "registry", "metrics.jsonl"))
    trace_all = load_jsonl(os.path.join(root, "trace", "cli.jsonl"))

    journal = journal_all[cur.get("journal", 0):]
    metrics = metrics_all[cur.get("metrics", 0):]
    trace = [t for t in trace_all[cur.get("trace", 0):] if t.get("project") == a.project]

    if not journal and not metrics and not trace:
        print("无新事件（journal/metrics/trace 均无增量），不产生空存档。")
        if a.note:
            print("注意：--note 提供的推理注记未落档（无增量窗口可挂）。"
                  "若注记属于刚结束的一轮，请检查上一份存档是否漏挂；若属下一轮，留到收口时再传。",
                  file=sys.stderr)
        return 0

    state = {}
    sp = os.path.join(proj, "state.json")
    if os.path.exists(sp):
        with open(sp, encoding="utf-8") as f:
            state = json.load(f)
    run_id = state.get("runId") or (journal[0].get("runId") if journal else "?")
    flow_id = state.get("flowId") or "?"

    nodes = state.get("nodes") or {}
    node_lines = []
    for nid, ns in nodes.items():
        node_lines.append(f"| {nid} | {ns.get('status','?')} | r{ns.get('round', 0)} | {ns.get('verdict') or '-'} |")

    seq = int(cur.get("seq", 0)) + 1
    now = dt.datetime.now()
    fname = f"{seq:03d}-{str(run_id).replace('run-', '')}-{now.strftime('%Y%m%d-%H%M')}.md"

    # ---- 组装 ----
    L = []
    L.append("---")
    L.append("format: cot@1")
    L.append(f"project: {a.project}")
    L.append(f"flow: {flow_id}")
    L.append(f"run: {run_id}")
    L.append(f"seq: {seq}")
    L.append(f"captured_at: {now.isoformat(timespec='seconds')}")
    L.append(f"journal_lines: {len(journal)}")
    L.append(f"cli_calls: {len(trace)}")
    L.append("---")
    L.append("")
    L.append(f"# 思维链存档 #{seq} · {a.project}")
    L.append("")
    L.append(f"> 流程 `{flow_id}` · run `{run_id}` · 窗口：本轮增量（journal {len(journal)} 行 / CLI 调用 {len(trace)} 次 / 指标 {len(metrics)} 条）。")
    L.append("> 性质：beta 期执行链留档——过程元数据合法居所，供 cot-analyst 事后分析，非交付物。")
    L.append("")

    # 一、节点收口状态
    L.append("## 一、节点收口状态")
    L.append("")
    if node_lines:
        L.append("| 节点 | 状态 | 轮次 | 终局裁决 |")
        L.append("|---|---|---|---|")
        L.extend(node_lines)
    else:
        L.append("（state.json 无节点记录）")
    L.append("")

    # 二、CLI 调用流水（tool 调用的机器真相）
    L.append("## 二、CLI 调用流水")
    L.append("")
    if trace:
        L.append("| 时间 | 动词 | 退出码 | 参数 |")
        L.append("|---|---|---|---|")
        for t in trace:
            argv = " ".join(str(x) for x in t.get("argv", []))
            if len(argv) > 110:
                argv = argv[:107] + "..."
            L.append(f"| {fmt_ts(t.get('ts'))} | {t.get('verb','?')} | {t.get('exit','?')} | `{argv}` |")
    else:
        L.append("（本窗口无 trace 记录——若 trace/cli.jsonl 尚未开启，此段为空属预期，勿补写）")
    L.append("")

    # 三、内核事件时间线
    L.append("## 三、内核事件时间线（journal）")
    L.append("")
    if journal:
        L.append("| 时间 | 事件 | 节点 | 摘要 |")
        L.append("|---|---|---|---|")
        for e in journal:
            det = str(e.get("detail") or "").replace("|", "\\|")
            if len(det) > 90:
                det = det[:87] + "..."
            L.append(f"| {fmt_ts(e.get('ts'))} | {e.get('event','?')} | {e.get('nodeId') or '-'} | {det} |")
    else:
        L.append("（无新 journal 事件）")
    L.append("")

    # 四、指标摘录（断言/命中/重试/裁决）
    L.append("## 四、指标摘录（metrics）")
    L.append("")
    rows = [m for m in metrics if m.get("phase") in ("submit", "core", "gate", "link", "boundary", "auto-gate")]
    if rows:
        L.append("| 时间 | 节点 | 相 | 断言 P/B | 重试 | 裁决 | ctx 装/中 | 命中卡 |")
        L.append("|---|---|---|---|---|---|---|---|")
        for m in rows:
            ctx = m.get("ctx") or {}
            ass = m.get("asserts") or {}
            hits = ctx.get("hitIds") or []
            hit_s = " ".join(h.replace("kb/", "") for h in hits)
            if len(hit_s) > 60:
                hit_s = hit_s[:57] + "..."
            L.append(
                f"| {fmt_ts(m.get('ts'))} | {m.get('nodeId','?')} | {m.get('phase')} "
                f"| {ass.get('pass',0)}/{ass.get('block',0)} | {m.get('retries',0)} "
                f"| {m.get('verdict') or '-'} "
                f"| {ctx.get('offered',0)}/{ctx.get('used',0)} | {hit_s or '-'} |"
            )
    else:
        L.append("（无 submit/core/gate 相指标）")
    L.append("")

    # 五、推理注记
    L.append("## 五、推理注记（执行人当场所写）")
    L.append("")
    if a.note:
        if os.path.exists(a.note):
            with open(a.note, encoding="utf-8") as f:
                L.append(f.read().strip())
            L.append("")
        else:
            L.append(f"（--note 指向的文件不存在：{a.note}——显式回显，不静默吞掉）")
            L.append("")
    else:
        L.append("（本轮未提供推理注记——机器侧可见「做了什么」，缺「为什么这么做」；")
        L.append("分析侧应把本档标为 reasoning-missing，勿凭猜测脑补决策依据）")
        L.append("")

    # 六、待分析信号（自动快查）
    L.append("## 六、待分析信号")
    L.append("")
    flags = []
    for m in rows:
        ass = m.get("asserts") or {}
        if ass.get("block", 0):
            flags.append(f"- 断言打回：`{m.get('nodeId')}` block={ass['block']}（{fmt_ts(m.get('ts'))}）")
        if m.get("retries", 0):
            flags.append(f"- 重试：`{m.get('nodeId')}` retries={m['retries']}")
        if m.get("verdict") == "send-back":
            flags.append(f"- 人工打回：`{m.get('nodeId')}`（{fmt_ts(m.get('ts'))}）")
        ctx = m.get("ctx") or {}
        if ctx.get("offered", 0) and not ctx.get("used", 0) and m.get("phase") == "submit":
            flags.append(f"- 零命中提交：`{m.get('nodeId')}` 装载 {ctx['offered']} 项 0 命中（旧口径字面计量，注意口径）")
    if not flags:
        L.append("- 本窗口无打回/重试/零命中信号。")
    else:
        L.extend(flags)
    L.append("")

    out = os.path.join(cot_dir, fname)
    with open(out, "w", encoding="utf-8") as f:
        f.write("\n".join(L))

    cur2 = {
        "journal": len(journal_all),
        "metrics": len(metrics_all),
        "trace": len(trace_all),
        "seq": seq,
    }
    write_cursor(cot_dir, cur2)
    print(f"思维链已存档: {os.path.relpath(out, root)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
