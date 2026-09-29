#!/usr/bin/env python3
"""flow-export v1 · 生效编排 → 外部可消费形态（外部协议适配器）。

定位：把 flow@3 / 生效编排导出成任何 agent、任何引擎都能原生读懂的只读快照。
  - runbook（默认）：markdown 运行手册（自带 mermaid 图 + 输入面 + 节点明细 + 连接件）；
  - mermaid：纯图；
  - json：中性 JSON（节点/边/输入/组合/回显）。

单源纪律（R5 §一）：展开与 overlay 合成一律经 core/src/export-cli.ts 桥接内核真身
（Kernel::effectiveOf / effectiveFlow3），本脚本禁止重写任何派生逻辑——两套真相 = 本仓旧病。
导出是**只读快照**：唯一事实源仍是 flows/<id>/flow.json ⊕ overlays，禁止把导出物当编辑目标。

用法：
  python tools/flow-export.py --flow <flowId>  [--target runbook|mermaid|json] [--out <file>]
  python tools/flow-export.py --project <pid>  [--target ...] [--out <file>]

输出：stdout（UTF-8）；--out 落盘时 stdout 只留一行路径提示。
"""
import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TSX = ROOT / "core" / "node_modules" / ".bin" / "tsx.cmd"
CLI = ROOT / "core" / "src" / "export-cli.ts"


def main() -> int:
    ap = argparse.ArgumentParser(description="flow-export · 生效编排只读导出适配器")
    ap.add_argument("--flow", help="flow id（模板面导出）")
    ap.add_argument("--project", help="项目 id（生效面导出，含项目 overlay）")
    ap.add_argument("--target", choices=["runbook", "mermaid", "json"], default="runbook")
    ap.add_argument("--truncate", type=int, help="长值截断宽度（config 旋钮，缺省 80）")
    ap.add_argument("--out", help="写出文件（缺省打 stdout）")
    a = ap.parse_args()
    if bool(a.flow) == bool(a.project):
        ap.error("--flow 与 --project 恰好给一个")

    # Windows 控制台 GBK：显式 UTF-8，防「✓ 等字符 print 崩溃、实际已过却退出码非 0」的假失败
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

    cmd = [str(TSX), str(CLI), "--target", a.target]
    cmd += ["--flow", a.flow] if a.flow else ["--project", a.project]
    if a.truncate:
        cmd += ["--truncate", str(a.truncate)]
    if a.out:
        cmd += ["--out", a.out]
    p = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", cwd=str(ROOT))
    if p.stdout:
        print(p.stdout, end="")
    if p.returncode != 0:
        sys.stderr.write(p.stderr or "")
    return p.returncode


if __name__ == "__main__":
    sys.exit(main())
