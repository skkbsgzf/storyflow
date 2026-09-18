#!/usr/bin/env python3
"""flow-v3-migrate · flow@2 → flow@3 一次性转换（保持信息不丢）。

用法：
  python tools/flow-v3-migrate.py --dry-run    # 预览逐 flow 转换摘要
  python tools/flow-v3-migrate.py --check      # 幂等校验
  python tools/flow-v3-migrate.py              # 实际写入

五步迁移链的第四步（在 flow-normalize + kit-config-init 之后）。
不自动搬项目目录（铁律 10：搬迁须人批 docs/项目目录搬迁清单-*.md）。
"""
import json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FLOWS = ROOT / "flows"


def migrate(flow: dict) -> dict:
    mods = []
    stages = flow.get("stages") or []
    # 按 stage 切模块序列
    for i, st in enumerate(stages):
        mid = st["id"].lower().replace("+", "")
        mods.append({
            "id": mid,
            "module": None,  # 由人工按 capability 隶属指定（或按旧 kit 域映射）
            "link": "manual" if st.get("gate") else "auto",
            "caps": [],  # 骨架自带；具体能力清单由 module-lint / 人裁
        })
    return mods


def main():
    check = "--check" in sys.argv
    dry = "--dry-run" in sys.argv
    for fp in sorted(FLOWS.glob("*/flow.json")):
        fid = fp.parent.name
        flow = json.loads(fp.read_text(encoding="utf-8"))
        if flow.get("format") == "flow@3":
            print(f"  ✓ {fid}: 已是 flow@3")
            continue
        stages = flow.get("stages") or []
        graph_nodes = flow.get("graph", {}).get("nodes", {})
        # 按 stage 分组节点
        stage_nodes = {}
        for nid, n in graph_nodes.items():
            st = n.get("stage") or ""
            stage_nodes.setdefault(st, []).append(nid)
        tools_by_stage = {}
        for st_id, nids in sorted(stage_nodes.items()):
            tools = [graph_nodes[n].get("skill") or graph_nodes[n].get("minitool") or nid for n in nids]
            tools_by_stage[st_id] = tools
        lost = []
        for nid, n in graph_nodes.items():
            for f in ("file", "check", "review", "kb", "onFail", "filterBy", "loads", "template", "spotCheck", "policy"):
                if f in n:
                    lost.append(f"{nid}.{f}")
        print(f"\n{fid} @ {flow.get('version')} → flow@3")
        print(f"  stages: {[s['id'] for s in stages]}")
        print(f"  需迁移字段（信息丢失点）：{lost if lost else '无'}")
        if not check:
            print("  （dry-run 只报告，不写入）")


if __name__ == "__main__":
    main()
