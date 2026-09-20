# -*- coding: utf-8 -*-
"""amend-artifact · 改 done 节点产物的五步降级单命令（铁律 10 工具化）

背景：已完成节点的产物要修改必须走 flow_rerun；内核暂不支持时（如 iterate 实例重派发）
走五步降级路径。此前靠手工串步骤，R2 事故（v5 虚报扫描+补拍快照洗白）证明手工路径
撑不住——本工具把五步锁成一条命令，任何一步失败即中止，收据强制落盘。

用法：
  python tools/amend-artifact.py --project <id> --node <id> --file <相对路径> --reason "<为什么要绕流>" [--flow <flowId>]

五步（对应铁律 10）：
  ① 声明绕流意图        → journal 追加 note（actor=amend-artifact）
  ② 实跑校验并落盘收据  → check-purity.py 扫改动文件，输出写 内部/收据/
  ③ 修订对照表登记      → 内部/依据/修订对照表.md 追加一行
  ④ 重快照              → tools/snapshot.py capture
  ⑤ flow-verify 复检    → 无红档才算完成

退出码：0 = 五步全过；1 = 某步失败（已完成的步骤留档可追溯）。
"""
import argparse
import datetime as dt
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# 控制台代码页可能是 GBK：flow-verify/check-purity 输出含 ✓ 等非 GBK 字符时
# print 会 UnicodeEncodeError 假失败（五步实际已过、退出码却非 0）。
# 自身 stdout/stderr 强制 UTF-8（已兼容 UTF-8 的环境里是 no-op）。
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")


def run(cmd, **kw):
    return subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace", **kw)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True)
    ap.add_argument("--node", required=True)
    ap.add_argument("--file", required=True, help="相对项目目录的产物路径")
    ap.add_argument("--reason", required=True, help="绕流理由（空理由 = 拒绝执行）")
    ap.add_argument("--flow", default=None, help="flowId（缺省读 state.json 绑定，铁律 8）")
    a = ap.parse_args()

    proj = ROOT / "projects" / a.project
    target = proj / a.file
    if not proj.is_dir():
        print(f"[中止] 项目不存在: {proj}", file=sys.stderr)
        return 1
    if not target.is_file():
        print(f"[中止] 产物不存在: {target}", file=sys.stderr)
        return 1
    if not a.reason.strip():
        print("[中止] --reason 不能为空——绕流必须先声明意图（铁律 10 第①步）", file=sys.stderr)
        return 1

    sp = proj / "state.json"
    state = json.loads(sp.read_text(encoding="utf-8")) if sp.exists() else {}
    flow_id = a.flow or state.get("flowId")
    run_id = state.get("runId", "?")
    if not flow_id:
        print("[中止] 无法确定 flowId（state.json 无绑定且未传 --flow）——铁律 8：禁止凭记忆假设", file=sys.stderr)
        return 1
    node_state = (state.get("nodes") or {}).get(a.node) or {}
    if node_state.get("status") != "done":
        print(f"[提示] 节点 {a.node} status={node_state.get('status')!r}（非 done）——未完成节点请直接走 flow_submit，无需绕流", file=sys.stderr)
        return 1

    now = dt.datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    print(f"amend-artifact · {a.project} / {a.node} / {a.file}\n  理由: {a.reason}\n")

    # ── ① 声明绕流意图（journal note）──
    journal = proj / "journal.jsonl"
    note = {
        "ts": now,
        "runId": run_id,
        "event": "note",
        "actor": "amend-artifact",
        "nodeId": a.node,
        "detail": f"绕流意图声明：修改 done 产物 {a.file}｜理由：{a.reason}｜五步降级启动",
    }
    with open(journal, "a", encoding="utf-8") as f:
        f.write(json.dumps(note, ensure_ascii=False) + "\n")
    print("① 绕流意图已声明（journal note）")

    # ── ② 实跑校验并落盘收据 ──
    r = run([sys.executable, str(ROOT / "tools" / "check-purity.py"), a.project, a.file])
    receipt_dir = proj / "内部" / "收据"
    receipt_dir.mkdir(parents=True, exist_ok=True)
    receipt = receipt_dir / f"修订校验-{a.node}-{stamp}.md"
    receipt.write_text(
        "\n".join([
            "---",
            "artifact: 1",
            "id: tool.amend-artifact",
            "class: receipt",
            f"node: {a.node}",
            "round: 1",
            "version: v1",
            "state: draft",
            f"at: {now.replace('T', ' ')}",
            "by: tool/amend-artifact",
            "upstream:",
            f"  - {a.file}",
            "review: null",
            "---",
            "",
            f"# 修订校验收据 · {a.node}（{stamp}）",
            "",
            f"- 修订文件：`{a.file}`",
            f"- 绕流理由：{a.reason}",
            "- 校验工具：tools/check-purity.py（正文纯净度；标记台账 purity-markers.json）",
            f"- 校验退出码：{r.returncode}",
            "",
            "## 工具输出",
            "",
            "```",
            (r.stdout or "").strip() or (r.stderr or "").strip() or "（无输出）",
            "```",
            "",
        ]),
        encoding="utf-8",
    )
    if r.returncode != 0:
        print(f"[中止] ② 校验失败（退出码 {r.returncode}）——收据: {receipt.relative_to(ROOT)}", file=sys.stderr)
        print((r.stderr or r.stdout or "").strip()[-600:], file=sys.stderr)
        return 1
    print(f"② 校验通过，收据: {receipt.relative_to(ROOT)}")

    # ── ③ 修订对照表登记 ──
    ledger_dir = proj / "内部" / "依据"
    ledger_dir.mkdir(parents=True, exist_ok=True)
    ledger = ledger_dir / "修订对照表.md"
    if not ledger.exists():
        ledger.write_text(
            "# 修订对照表\n\n"
            "> 铁律 10 第③步：绕流修订逐条登记（amend-artifact 自动追加）。\n\n"
            "| 时间 | 节点 | 文件 | 理由 | 收据 |\n|---|---|---|---|---|\n",
            encoding="utf-8",
        )
    with open(ledger, "a", encoding="utf-8") as f:
        f.write(f"| {now} | {a.node} | `{a.file}` | {a.reason} | {receipt.name} |\n")
    print(f"③ 对照表已登记: {ledger.relative_to(ROOT)}")

    # ── ④ 重快照 ──
    r = run([sys.executable, str(ROOT / "tools" / "snapshot.py"), "capture", flow_id, a.project, a.node, "--files", a.file, "--note", f"绕流修订·{stamp}"])
    if r.returncode != 0:
        print(f"[中止] ④ 快照失败：{(r.stderr or r.stdout or '').strip()[-400:]}", file=sys.stderr)
        return 1
    print("④ 快照已重拍")

    # ── ⑤ flow-verify 复检（退出码为准：0=无红档；文本判红会误伤「无红档」字样）──
    r = run([sys.executable, str(ROOT / "tools" / "flow-verify.py"), a.project])
    print("⑤ flow-verify 复检:")
    print("\n".join((r.stdout or "").strip().splitlines()[-6:]))
    if r.returncode != 0:
        print("[中止] ⑤ 复检有红档——修订未完成，请按输出修复后重跑（收据与对照表已留档）", file=sys.stderr)
        return 1
    print("\namend-artifact · 五步全部通过 ✓")
    return 0


if __name__ == "__main__":
    sys.exit(main())
