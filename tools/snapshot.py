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
    texts = {}
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
                texts[name] = text
                # 留档禁换行翻译：旧版 write_text 在 Windows 注入 CRLF，留档字节与索引 hash 口径漂移
                with open(dst, "w", encoding="utf-8", newline="") as fh:
                    fh.write(text)
                entry_files[name] = {"hash": sha1(text), "path": f"snapshots/{node}/r{r}/{name}"}
        else:
            entry_files[name] = {"hash": None, "path": None}
    # 输入指纹：上游产物当前哈希（重跑前比对用）
    entry = {"round": r, "ts": ts, "note": note, "files": entry_files}
    fp = collect_inputs(project, texts)
    entry["inputs"] = fp if fp else "unavailable"
    if fp:
        idx["inputs"][node] = {"round": r, "fp": fp}  # 该节点最近一轮的输入账，供 diff 归因
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


def collect_inputs(project, texts):
    """工单②：从被拍产物的头部 upstream 块采集输入指纹（声明即证据，不另造源）。
    texts: {保存名: 文本内容（原始换行，勿经 universal newlines）}。
    内核口径复刻 core/src/ids.ts contentSha12：去 BOM、切头部、trimStart 后取正文 sha1 前 12。
    返回 {文件: [{path, declared, on_disk, status}]}；无 upstream 声明的文件不出现在结果里
    （由调用方回显 inputs=unavailable）。"""
    proj = proj_dir(project)
    out = {}
    for name, text in texts.items():
        if not text:
            continue
        lines = text.splitlines()[:40]  # 头部区之内才认
        ups, inblock = [], False
        for ln in lines:
            if ln.startswith("upstream:"):
                inblock = True
                continue
            if inblock:
                if ln.startswith("  - "):
                    ups.append(ln[4:].strip())
                elif not ln.startswith(" "):
                    inblock = False
        items = []
        for u in ups:
            path, _, decl = u.rpartition("@")
            p = proj / path
            cur = None
            if p.exists():
                raw = p.read_bytes()
                if b"\x00" in raw[:4096]:
                    cur = sha1_bytes(raw)  # 二进制无头部口径，按全量字节
                else:
                    cur = content_sha12_text(raw.decode("utf-8", "replace"))
            status = "match" if cur == decl else ("missing" if cur is None else "drift")
            items.append({"path": path, "declared": decl, "on_disk": cur, "status": status})
        if items:
            out[name] = items
    return out


def content_sha12_text(text):
    """复刻 core/src/ids.ts bodyOf+sha12：文本→原始 utf-8 字节 sha1 前 12（不做换行翻译）。"""
    norm = text.lstrip("﻿")
    if norm.startswith("---"):
        end = norm.find("\n---", 3)
        if end >= 0:
            norm = norm[end + 4:].lstrip(" \t\r\n")
    return hashlib.sha1(norm.encode("utf-8")).hexdigest()[:12]


def restore(project, node, rnd, file, out=None, force=False):
    """工单①：把 snapshots/<node>/r<N>/<file> 装回工作区。
    out 缺省 = 原相对路径；目标现值 hash 与该节点最新快照轮不符（说明快照后又有手改）时须 --force。
    返回收据 dict（restore 不改快照本体，只写工作区文件）。"""
    proj = proj_dir(project)
    idx = load_index(project)
    snaps = idx["snapshots"].get(node)
    if not snaps:
        return {"error": "no-snapshot", "node": node}
    entry = next((s for s in snaps if s["round"] == int(rnd)), None)
    if not entry:
        return {"error": "no-round", "node": node, "round": rnd,
                "available": [s["round"] for s in snaps]}
    meta = entry["files"].get(file)
    if not meta or not meta.get("path"):
        return {"error": "no-file", "node": node, "round": rnd, "file": file,
                "available": [k for k, v in entry["files"].items() if v.get("path")]}
    src = proj / meta["path"]
    if not src.exists():
        return {"error": "snapshot-missing", "want": str(src)}
    dst = Path(out) if out else proj / file
    cur = None
    if dst.exists() and not out:
        cur = sha1(dst.read_text(encoding="utf-8"))
        latest = snaps[-1]
        lmeta = latest["files"].get(file, {})
        if cur != lmeta.get("hash") and not force:
            return {"error": "dirty-target", "target": str(dst), "disk_hash": cur,
                    "latest_snapshot_hash": lmeta.get("hash"),
                    "hint": "目标在最新快照后又被改过，确认覆盖请加 --force"}
        # 自审修正（09-23 冒烟事故）：旧轮回装=覆盖现行版，同样是回滚，须显式 force
        if int(rnd) < latest["round"] and not force:
            return {"error": "rollback-round", "target": str(dst),
                    "disk_round": latest["round"], "want_round": int(rnd),
                    "hint": "装回的不是最新轮，会覆盖现行版；确认返工请加 --force，只想看内容用 --out 预览"}
    data = src.read_bytes()
    dst.parent.mkdir(parents=True, exist_ok=True)
    if meta.get("binary"):
        dst.write_bytes(data)
        after = sha1_bytes(data)
    else:
        # 读回统一 LF 口径，写出禁翻译——防 Windows 下 \n→\r\n 二次转义
        text = data.decode("utf-8", "replace").replace("\r\n", "\n")
        with open(dst, "w", encoding="utf-8", newline="") as fh:
            fh.write(text)
        after = sha1(text)
    return {"restored": str(dst), "from": meta["path"], "snapshot_hash": meta["hash"],
            "disk_hash_before": cur, "disk_hash_after": after,
            "round": int(rnd), "node": node, "file": file}

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
    rs = sub.add_parser("restore")
    rs.add_argument("project"); rs.add_argument("node"); rs.add_argument("--r", required=True, help="快照轮次 N")
    rs.add_argument("--file", required=True, help="相对项目目录的保存名")
    rs.add_argument("--out", default=None, help="落别处（预览用），缺省装回原路径")
    rs.add_argument("--force", action="store_true", help="目标在最新快照后又被手改时仍要覆盖")
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
    elif a.cmd == "restore":
        r = restore(a.project, a.node, int(a.r), a.file, out=a.out, force=a.force)
        if r.get("error"):
            print(json.dumps(r, ensure_ascii=False, indent=2))
            sys.exit(1)
        print(json.dumps(r, ensure_ascii=False, indent=2))
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
