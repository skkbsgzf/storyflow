"""stage · Stage 封装包管理（list / validate / tree）

Stage = 可复用能力段的标准化封装（stage@1）：命名、版本、适用品类、可导入、可市场分发。
flow 由 Stage 拼接而成；本工具负责包的清单与校验（拼接编译为后续里程碑）。

用法：
  python tools/stage.py list                 # 全部 Stage 一览
  python tools/stage.py validate [stageId]   # 校验（schema 必备字段 + 引用完整性 + 命名注册表核对）
  python tools/stage.py tree <stageId>       # 打印 Stage 子图结构
命中 error 即 exit=1（可接校验链）。
"""
import json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STAGES = ROOT / "stages"
REG = json.loads((ROOT / "tools" / "minitools.json").read_text(encoding="utf-8"))
REQUIRED = ["format", "id", "name", "version", "applicability", "entry", "nodes", "edges"]

def load_all():
    out = {}
    for d in sorted(STAGES.iterdir()):
        sj = d / "stage.json"
        if d.is_dir() and sj.exists():
            out[d.name] = json.loads(sj.read_text(encoding="utf-8"))
    return out

def validate(sid, s):
    errors, warnings = [], []
    for k in REQUIRED:
        if k not in s:
            errors.append(f"缺必备字段 {k}")
    if s.get("format") != "stage@1":
        errors.append(f"format 必须为 stage@1（当前 {s.get('format')}）")
    if s["id"] != sid:
        errors.append(f"id 与目录名不一致（{s.get('id')} ≠ {sid}）")
    if not re.match(r"^[a-z][a-z0-9-]*$", s["id"]):
        errors.append(f"id 命名不合法（小写字母开头，仅小写字母/数字/连字符）")
    if not s.get("applicability"):
        errors.append("applicability 为空——Stage 必须声明适用品类")
    nodes, edges = s.get("nodes", {}), s.get("edges", [])
    if s.get("entry") and s["entry"] not in nodes:
        errors.append(f"entry '{s['entry']}' 不在节点中")
    if s.get("gate"):
        g = nodes.get(s["gate"], {})
        if not g:
            errors.append(f"gate '{s['gate']}' 不在节点中")
        elif g.get("kind") not in ("gate", "srd"):
            warnings.append(f"gate '{s['gate']}' kind={g.get('kind')}（建议 gate/srd）")
    for e in edges:
        for side in ("from", "to"):
            if e.get(side) not in nodes:
                errors.append(f"边 {e.get('id','?')} 端点不存在: {e.get(side)}")
        tf = e.get("transform", "")
        if not tf:
            warnings.append(f"边 {e.get('id','?')} 无 transform 标注")
            continue
        p, _, rest = tf.partition(".")
        if p == "skill":
            if not (ROOT / "skills" / f"{rest}.md").exists():
                errors.append(f"skill '{rest}' 无对应技能文件")
            elif rest not in REG.get("skills", {}):
                warnings.append(f"技能 '{rest}' 未登记中文名")
        elif p == "core":
            if rest not in REG.get("minitools", {}):
                errors.append(f"minitool '{rest}' 未登记")
            elif REG["minitools"][rest].get("impl") == "planned":
                warnings.append(f"minitool '{rest}' 为 planned（内核未实现）")
        elif p == "sm":
            if tf not in REG.get("edgeSemantics", {}):
                warnings.append(f"编排语义 '{tf}' 未登记（注册表 edgeSemantics）")
        else:
            errors.append(f"未知前缀 '{p}.'——{tf}")
    for o in s.get("outputs", []):
        if o.get("node") not in nodes:
            errors.append(f"outputs 引用不存在节点: {o.get('node')}")
    return errors, warnings

def tree(sid, s):
    print(f"{s['name']}（{s['id']}@{s['version']}）  适用: {','.join(s.get('applicability', []))}")
    nodes, edges = s.get("nodes", {}), s.get("edges", [])
    outs = {e["from"] for e in edges} - set(nodes)
    order, seen = [], set(s.get("entry", ()) or [])
    frontier = [s.get("entry")] if s.get("entry") else []
    while frontier:
        nxt = []
        for n in frontier:
            order.append(n)
            for e in edges:
                if e["from"] == n and e["to"] not in seen and e["to"] in nodes:
                    seen.add(e["to"]); nxt.append(e["to"])
        frontier = nxt
    seen_ordered = [n for n in dict.fromkeys(order) if n in nodes]
    rest = [n for n in nodes if n not in seen_ordered]
    for n in seen_ordered + rest:
        m = nodes[n]
        mark = "◆" if m.get("kind") in ("gate", "srd") else "·"
        echo = "（出口）" if n in outs else ""
        print(f"  {mark} {n}  {m.get('title','')}")

def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "list"
    all_s = load_all()
    if cmd == "list":
        for sid, s in all_s.items():
            print(f"{sid:20s} {s.get('name',''):10s} v{s.get('version','-'):8s} 适用: {','.join(s.get('applicability', []))}")
    elif cmd == "validate":
        targets = sys.argv[2:] or list(all_s)
        te = tw = 0
        for sid in targets:
            s = all_s.get(sid)
            if not s:
                print(f"ERROR [{sid}] stage 包不存在"); te += 1; continue
            errs, warns = validate(sid, s)
            for e in errs: print("ERROR", sid, e); te += 1
            for w in warns: print("WARN ", sid, w); tw += 1
        print(f"--- {len(targets)} stages ｜ {te} errors ｜ {tw} warnings")
        sys.exit(1 if te else 0)
    elif cmd == "tree":
        sid = sys.argv[2]
        tree(sid, all_s[sid])
    else:
        print(__doc__)

import argparse

if __name__ == "__main__":
    main()
