# -*- coding: utf-8 -*-
"""tools/tests · 判定型工具的 unittest 夹具

运行：python -m unittest discover -s tools/tests -v   （仓库根执行）
夹具约定：临时项目/流程以 "_ut" 前缀落在真实 projects/ 与 flows/ 下
（工具的 ROOT 由 __file__ 锚定，不接受外部根目录），tearDown 强制清理。
"""
import json
import sys
import shutil
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent  # tools/tests/util.py → 仓库根
PREFIX = "_ut"


def fresh_name(kind):
    return f"{PREFIX}-{kind}-{datetime.now().strftime('%H%M%S%f')}"


def rm(name):
    for base in ("projects", "flows"):
        p = ROOT / base / name
        if p.exists():
            shutil.rmtree(p, ignore_errors=True)


def make_project(name, flow_id, done_nodes=None, outputs=None):
    """建临时项目：state.json + registry/artifacts.json + snapshots/index.json"""
    proj = ROOT / "projects" / name
    (proj / "registry").mkdir(parents=True, exist_ok=True)
    (proj / "snapshots").mkdir(parents=True, exist_ok=True)
    state = {
        "flowId": flow_id,
        "runId": "run-ut",
        "status": "running",
        "nodes": {nid: {"status": "done", "round": 1} for nid in (done_nodes or [])},
    }
    (proj / "state.json").write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    (proj / "registry" / "artifacts.json").write_text(
        json.dumps({"artifacts": outputs or []}, ensure_ascii=False), encoding="utf-8")
    (proj / "snapshots" / "index.json").write_text(
        json.dumps({"snapshots": {}}, ensure_ascii=False), encoding="utf-8")
    return proj


def make_flow(flow_id, node_outputs):
    """建临时 flow@2：graph.nodes 只带 output 声明"""
    fd = ROOT / "flows" / flow_id
    fd.mkdir(parents=True, exist_ok=True)
    flow = {
        "id": flow_id,
        "format": "flow@2",
        "graph": {"nodes": {nid: {"kind": "agent", "output": out} for nid, out in node_outputs.items()},
                  "edges": []},
        "outputs": [],
    }
    (fd / "flow.json").write_text(json.dumps(flow, ensure_ascii=False, indent=2), encoding="utf-8")
    return fd / "flow.json"


def add_submit_record(project, path, node="n1"):
    """registry/artifacts.json 追加一条 host-submit 提交记录（flow-verify 的 kts 依据）"""
    p = ROOT / "projects" / project / "registry" / "artifacts.json"
    d = json.loads(p.read_text(encoding="utf-8"))
    d["artifacts"].append({"path": path, "node": node, "producer": "host-submit",
                           "ts": datetime.now(timezone.utc).isoformat()})
    p.write_text(json.dumps(d, ensure_ascii=False), encoding="utf-8")


def python_exe():
    """可再生成子进程的真解释器（MS Store 存根 sys.executable 无法 spawn 自身，Errno 22）"""
    cand = Path(sys.base_prefix) / "python.exe"
    if cand.exists():
        return str(cand)
    return "python"


def run_tool(*argv):
    """以仓库根为 cwd 跑一个 tools/ 脚本（首参若是相对路径，锚定到仓库根），返回 (rc, stdout, stderr)"""
    import subprocess
    argv = list(argv)
    if not Path(argv[0]).is_absolute():
        argv[0] = str(ROOT / argv[0])
    r = subprocess.run([python_exe(), *argv], cwd=str(ROOT), capture_output=True,
                       text=True, encoding="utf-8", errors="replace", timeout=120)
    return r.returncode, r.stdout, r.stderr
