"""_918test 驱动助手：flow_next 大输出落盘，只打印决策要点。
用法：python next.py <pkgRoot> <projectId> [--spawn]
"""
import json
import subprocess
import sys
from pathlib import Path

pkg, pid = sys.argv[1], sys.argv[2]
spawn = "--spawn-prompt" in sys.argv
out_dir = Path(pkg) / "_918test"
out_dir.mkdir(exist_ok=True)
r = subprocess.run(
    ["npx", "tsx", "src/cli.ts", "flow_next", "--project", pid, "--root", pkg]
    + (["--spawn-prompt"] if spawn else []),
    cwd=str(Path(__file__).resolve().parent),
    capture_output=True, text=True, encoding="utf-8", shell=True)
raw = r.stdout or r.stderr
try:
    d = json.loads(raw)
except Exception:
    print("RAW:", raw[:600])
    sys.exit(1)
(out_dir / f"last-{pid}.json").write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding="utf-8")
st = d.get("status")
print("status:", st)
if st == "awaiting_input":
    tp = d.get("taskPackage") or {}
    ins = tp.get("instruction") or {}
    print("node:", d.get("nodeId"), "| skill:", ins.get("skill"), "| output:", tp.get("outputContract", {}).get("path") if isinstance(tp.get("outputContract"), dict) else tp.get("output"))
    batch = d.get("batch") or []
    for b in batch:
        print("  batch:", b.get("nodeId"), "<-", (b.get("taskPackage", {}).get("instruction") or {}).get("skill"))
    text = ins.get("text") or ""
    print("标尺头 800 字:\n", text[:800])
    hd = tp.get("headerTemplate") or tp.get("artifactHeader") or ""
    if hd:
        print("头部模板:\n", str(hd)[:400])
elif st == "suspended":
    print("gate:", (d.get("gate") or {}).get("nodeId"), "round", (d.get("gate") or {}).get("round"))
else:
    print(json.dumps({k: d.get(k) for k in ("nodeId", "reason", "blockers")}, ensure_ascii=False)[:300])
print("完整输出:", out_dir / f"last-{pid}.json")
