"""worldbook-history · 创作历程归纳器（worldbook-history@1，零依赖）

把既有运行账本归纳成作者视角的「创作历程」——作者看见自己的思维链路，
总结精进；全部派生自已有记录，零新增记录负担：
  journal.jsonl                → 里程碑（开跑 / 门裁决 / 重做 / 编排调整 / 收束）
  snapshots/index.json         → 版本脉络（节点多轮 = 打回与重写热点，带轮次说明）
  decisions/*.json             → 思路定案（decision@1：by + evidence，R8 账本）
  registry/miner-findings.json → 复盘与建议（编排挖掘师 findings，带证据）
  世界书/历程/*.md              → 阶段总结（人/agent 撰写；正文内嵌供页面渲染）
  flow.json + state.json       → 阶段进度（模块 done/total + 重做计数）

产物 世界书/history.json 为派生件（重建即覆盖，工具独占写）。
机器不写总结：模块收口 / 门通过 / 完稿时由执行会话追加 世界书/历程/小结-*.md
（结论 / 取舍 / 教训 / 下一步建议）——这是创作纪律，不是机器闸。
消费方：worldbook.html #/h 创作历程视图（project-pages.build_wbdata 内嵌）。

用法：
  python tools/worldbook-history.py --root projects/<id> [--quiet]
"""
import json
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SEVERITY_ORDER = {"high": 0, "medium": 1, "low": 2}


def load_json(p, default=None):
    try:
        return json.loads(Path(p).read_text(encoding="utf-8"))
    except Exception:
        return default


def fmt_ts(ts):
    """ISO → MM-DD HH:MM（解析失败原样返回）。"""
    return ts[5:16].replace("T", " ") if isinstance(ts, str) and len(ts) >= 16 else (ts or "")


def build_phases(proj, flow, state):
    modules = (flow or {}).get("modules") or []
    nodes = (state or {}).get("nodes") or {}
    if not modules and not nodes:
        return []
    phases = []
    for m in modules:
        mid = m.get("id", "")
        title = m.get("title") or mid
        ns = [nid for nid in nodes if nid == mid or nid.startswith(mid + ".") or nid.startswith("itb-" + mid + ".")]
        done = sum(1 for nid in ns if (nodes[nid] or {}).get("status") == "done")
        rework = sum(1 for nid in ns if (nodes[nid] or {}).get("round", 1) > 1)
        phases.append({"id": mid, "title": title, "total": len(ns), "done": done, "rework": rework})
    # 计划外节点（实例化/裁撤残留）归入「计划外」
    known = set()
    for p in phases:
        for nid in nodes:
            if nid == p["id"] or nid.startswith(p["id"] + ".") or nid.startswith("itb-" + p["id"] + "."):
                known.add(nid)
    rest = [nid for nid in nodes if nid not in known]
    if rest:
        done = sum(1 for nid in rest if (nodes[nid] or {}).get("status") == "done")
        phases.append({"id": "-", "title": "计划外实例", "total": len(rest), "done": done,
                       "rework": sum(1 for nid in rest if (nodes[nid] or {}).get("round", 1) > 1)})
    return phases


def build_milestones(proj, cap=80):
    out = []
    for ln in (proj / "journal.jsonl").read_text(encoding="utf-8").splitlines() if (proj / "journal.jsonl").exists() else []:
        ln = ln.strip()
        if not ln:
            continue
        try:
            d = json.loads(ln)
        except Exception:
            continue
        ev = d.get("event")
        actor = d.get("actor", "")
        detail = d.get("detail", "")
        if ev == "run-start":
            out.append({"ts": fmt_ts(d.get("ts")), "kind": "run", "title": "开跑", "detail": detail})
        elif ev == "run-end":
            out.append({"ts": fmt_ts(d.get("ts")), "kind": "end", "title": "收束", "detail": detail})
        elif ev == "verdict":
            out.append({"ts": fmt_ts(d.get("ts")), "kind": "gate", "title": d.get("nodeId", ""), "detail": detail})
        elif ev == "rerun":
            out.append({"ts": fmt_ts(d.get("ts")), "kind": "rerun", "title": (d.get("nodeId", "") + " 重做").strip(), "detail": detail})
        elif ev == "note" and "overlay" in actor and "重编译" in detail:
            out.append({"ts": fmt_ts(d.get("ts")), "kind": "overlay", "title": "编排调整", "detail": detail, "refs": d.get("refs", [])})
    out.sort(key=lambda m: m["ts"])
    return out[-cap:]


def build_versions(proj, cap=12):
    idx = load_json(proj / "snapshots" / "index.json", {}) or {}
    snaps = idx.get("snapshots") or {}
    state = load_json(proj / "state.json", {}) or {}
    nodes = state.get("nodes") or {}
    out = []
    for node, runs in snaps.items():
        if not isinstance(runs, list):
            continue
        rounds = [{"round": r.get("round"), "ts": fmt_ts(r.get("ts")), "note": r.get("note", "")} for r in runs]
        if len(rounds) < 2 and not any(r["note"] for r in rounds):
            continue
        out.append({
            "node": node,
            "artifact": (nodes.get(node) or {}).get("lastArtifact", ""),
            "rounds": rounds,
        })
    out.sort(key=lambda v: (-len(v["rounds"]), v["node"]))
    return out[:cap]


def build_decisions(proj):
    ddir = proj / "decisions"
    out = []
    if ddir.is_dir():
        for p in sorted(ddir.glob("*.json")):
            d = load_json(p)
            if not isinstance(d, dict) or d.get("format") != "decision@1":
                continue
            out.append({
                "key": d.get("key", p.stem),
                "by": d.get("by", ""),
                "at": fmt_ts(d.get("at")),
                "picked": d.get("picked", []),
                "evidence": d.get("evidence", ""),
            })
    out.sort(key=lambda x: x["at"])
    return out


def build_findings(proj, cap=8):
    d = load_json(proj / "registry" / "miner-findings.json", {}) or {}
    fs = d.get("findings") or []
    fs = sorted(fs, key=lambda f: SEVERITY_ORDER.get(f.get("severity"), 9))[:cap]
    return [{"id": f.get("id", ""), "severity": f.get("severity", ""),
             "dimension": f.get("dimension", ""),
             "title": f.get("title", ""), "reason": f.get("reason", "")} for f in fs]


def build_summaries(proj):
    base = proj / "世界书" / "历程"
    out = []
    if base.is_dir():
        for p in sorted(base.glob("*.md")):
            text = ""
            try:
                text = p.read_text(encoding="utf-8")
            except Exception:
                pass
            title = p.stem
            for ln in text.splitlines():
                if ln.startswith("# "):
                    title = ln[2:].strip()
                    break
            try:
                mtime = datetime.fromtimestamp(p.stat().st_mtime).strftime("%m-%d %H:%M")
            except OSError:
                mtime = ""
            out.append({"title": title, "path": p.relative_to(proj).as_posix().replace("\\", "/"),
                        "mtime": mtime, "body": text[:20000]})
    return out


def build_history(proj):
    state = load_json(proj / "state.json", {}) or {}
    flow = load_json(proj / "flows" / (state.get("flowId") or "_") / "flow.json")
    if not isinstance(flow, dict):
        flow = load_json(ROOT / "flows" / (state.get("flowId") or "_") / "flow.json")
    phases = build_phases(proj, flow if isinstance(flow, dict) else None, state)
    milestones = build_milestones(proj)
    versions = build_versions(proj)
    decisions = build_decisions(proj)
    findings = build_findings(proj)
    summaries = build_summaries(proj)
    rework = sum(1 for v in versions if len(v["rounds"]) > 1)
    empty = not (phases or milestones or versions or decisions or findings or summaries)
    return {
        "format": "worldbook-history@1",
        "project": proj.name,
        "built_at": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "empty": empty,
        "phases": phases,
        "milestones": milestones,
        "versions": versions,
        "decisions": decisions,
        "findings": findings,
        "summaries": summaries,
        "stats": {
            "milestones": len(milestones),
            "reworkNodes": rework,
            "decisions": len(decisions),
            "findings": len(findings),
            "summaries": len(summaries),
        },
    }


def main():
    argv = sys.argv[1:]
    if "--root" not in argv:
        print(__doc__)
        sys.exit(1)
    root = Path(argv[argv.index("--root") + 1])
    proj = root if root.is_absolute() else ROOT / root
    if not proj.is_dir():
        sys.exit(f"[ABORT] 项目不存在：{proj}")
    h = build_history(proj)
    out = proj / "世界书" / "history.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(h, ensure_ascii=False, indent=1), encoding="utf-8")
    if "--quiet" not in argv:
        st = h["stats"]
        print(f"worldbook-history@1 → {out} ｜ 里程碑 {st['milestones']} ｜ 多轮节点 {st['reworkNodes']} ｜ "
              f"定案 {st['decisions']} ｜ 复盘 {st['findings']} ｜ 总结 {st['summaries']}")


if __name__ == "__main__":
    main()
