"""快照与重跑工具链（snapshot / diff / rerun-scope）
快照模型：
  projects/<id>/snapshots/<nodeId>/r<N>/<file>   内容副本（不可变）
  projects/<id>/snapshots/index.json             索引：hash / 时间 / 备注 / 输入指纹
输入指纹（input fingerprint）：节点执行时上游产物的哈希集合——下游重跑前先比对，
  未变的上游 = 缓存命中（Agent 上下文复用），变了才重算。
"""
import hashlib, json, shutil, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
KIT_MARK = Path(__file__).resolve().parent / "kit.json"
def proj_dir(name):
    # kit vendor 模式：本工具被 kit.py 拷贝进 <project>/kit/ 内时，
    # kit/ 上一级即项目根（kit.json 为标记）；常驻模式返回中心工作区路径。
    if KIT_MARK.exists():
        return ROOT
    return ROOT / "projects" / name



def sha1(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:12]

def sha1_bytes(data: bytes) -> str:
    return hashlib.sha1(data).hexdigest()[:12]

def load_index(project):
    p = proj_dir(project) / "snapshots" / "index.json"
    return json.load(open(p, encoding="utf-8")) if p.exists() else {"snapshots": {}, "inputs": {}}

def save_index(project, idx):
    p = proj_dir(project) / "snapshots" / "index.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    json.dump(idx, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

def capture(project, node, file_map, note="", flow="topic-selection"):
    """file_map: {保存名: 绝对路径或None}——None 表示登记占位（尚无内容）"""
    proj = proj_dir(project)
    idx = load_index(project)
    snaps = idx["snapshots"].setdefault(node, [])
    r = (snaps[-1]["round"] + 1) if snaps else 1
    ts = time.strftime("%Y-%m-%d %H:%M")
    out_dir = proj / "snapshots" / node / f"r{r}"
    out_dir.mkdir(parents=True, exist_ok=True)
    entry_files = {}
    strip = f"projects/{project}/"
    for name, src in file_map.items():
        if name.startswith(strip): name = name[len(strip):]
        if src and Path(src).exists():
            data = Path(src).read_bytes()
            dst = out_dir / name
            dst.parent.mkdir(parents=True, exist_ok=True)
            # 二进制产物（docx 等）按字节留档；文本按 utf-8 文本留档（hash 口径不变）
            if b"\x00" in data[:4096]:
                dst.write_bytes(data)
                entry_files[name] = {"hash": sha1_bytes(data), "path": f"snapshots/{node}/r{r}/{name}",
                                     "binary": True}
            else:
                text = data.decode("utf-8")
                dst.write_text(text, encoding="utf-8")
                entry_files[name] = {"hash": sha1(text), "path": f"snapshots/{node}/r{r}/{name}"}
        else:
            entry_files[name] = {"hash": None, "path": None}
    # 输入指纹：上游产物当前哈希（重跑前比对用）
    entry = {"round": r, "ts": ts, "note": note, "files": entry_files}
    snaps.append(entry)
    save_index(project, idx)
    return entry

def input_fingerprint(project, upstream_files):
    """upstream_files: [相对路径] → {path: hash}，供任务包/缓存命中比对"""
    proj = proj_dir(project)
    fp = {}
    for f in upstream_files:
        p = proj / f
        fp[f] = sha1(p.read_text(encoding="utf-8")) if p.exists() else None
    return fp

def diff_text(a_text: str, b_text: str) -> str:
    import difflib
    return "\n".join(difflib.unified_diff(a_text.splitlines(), b_text.splitlines(),
                                          "previous", "current", lineterm=""))

def main():
    import argparse
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("capture"); c.add_argument("flow"); c.add_argument("project"); c.add_argument("node")
    c.add_argument("--files", required=True, help="逗号分隔的文件名（相对项目目录）")
    c.add_argument("--note", default="")
    d = sub.add_parser("diff"); d.add_argument("project"); d.add_argument("node"); d.add_argument("--a", required=True); d.add_argument("--b", required=True)
    a = ap.parse_args()
    if a.cmd == "capture":
        # 流程身份约束：项目绑定的 flowId 与传参不一致即中止（同 project-pages，防串台）
        import json as _json, sys as _sys
        _proj = proj_dir(a.project)
        _bound = None
        for _sp in (_proj / "state.json", _proj / "run-state.json"):
            if _sp.exists():
                try: _bound = _json.load(open(_sp, encoding="utf-8")).get("flowId")
                except Exception: _bound = None
                if _bound: break
        if _bound and _bound != a.flow:
            _sys.exit("[ABORT] 流程身份不一致：项目 {} 绑定 flow='{}'，调用传入 '{}'。\n正确调用：snapshot capture {} {} ...".format(a.project, _bound, a.flow, _bound, a.project))
        # flow 装载：vendor 模式用 kit/flow.json（项目绑定快照）；常驻模式用 flows/<id>
        if KIT_MARK.exists():
            flow = json.load(open(ROOT / "kit" / "flow.json", encoding="utf-8"))
        else:
            flow = json.load(open(ROOT / "flows" / a.flow / "flow.json", encoding="utf-8"))
        if "graph" not in flow:
            # flow@3（模块序列）：手画图不存在，从内核 effective@2 取派生节点（R6 生效编排事实源）
            _eff = _proj / "registry" / "effective.json"
            if not _eff.exists():
                _sys.exit("flow@3 项目缺 registry/effective.json——先跑 flow_effect 生成生效编排")
            _nodes = _json.load(open(_eff, encoding="utf-8")).get("nodes", {})
            if a.node not in _nodes:
                _sys.exit("effective@2 中无节点 {}（先跑 flow_effect 刷新）".format(a.node))
            node = _nodes[a.node]
        else:
            node = flow["graph"]["nodes"][a.node]
        default_out = node.get("file") or node.get("output")
        names = [x.strip() for x in a.files.split(",") if x.strip()] or ([default_out] if default_out else [])
        proj = proj_dir(a.project)
        fmap = {n: str(proj / n) for n in names}
        entry = capture(a.project, a.node, fmap, note=a.note, flow=a.flow)
        print(json.dumps(entry, ensure_ascii=False, indent=2))
    elif a.cmd == "diff":
        idx = load_index(a.project)
        sa = [s for s in idx["snapshots"][a.node] if s["round"] == int(a.a)][0]
        sb = [s for s in idx["snapshots"][a.node] if s["round"] == int(a.b)][0]
        for name, meta in sb["files"].items():
            pa = (proj_dir(a.project) / "snapshots" / a.node / f"r{a.a}" / name)
            pb = (proj_dir(a.project) / "snapshots" / a.node / f"r{a.b}" / name)
            ta = pa.read_text(encoding="utf-8") if pa.exists() else ""
            tb = pb.read_text(encoding="utf-8") if pb.exists() else ""
            print(f"===== {name} =====")
            print(diff_text(ta, tb))

if __name__ == "__main__":
    main()
