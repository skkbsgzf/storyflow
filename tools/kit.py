"""kit · 创作者工具链 vendor 器（拷贝自治模型）

理念：kit 提供 90% 创作者需要的工具链；项目初始化时**拷贝一份进项目**（<project>/kit/），
创作者拥有副本——可以改、可以自己管版本；上游更新不自动覆盖，用 status/diff 看差异自行取舍。

用法：
  python tools/kit.py vendor <project> [--flow <flowId>]   # 拷贝工具链进项目（已有文件跳过，--force 覆盖）
  python tools/kit.py status <project>                     # 副本 vs 上游：一致/已修改/上游已更新
  python tools/kit.py diff  <project> <file>               # 查看某文件与上游的差异

vendor 集（项目内可独立运行）：check-purity / worldbook / export-doc / snapshot / serve + flow.json 快照。
"""
import hashlib, json, sys
from datetime import datetime
from pathlib import Path

TOOLS = Path(__file__).resolve().parent
WORKSPACE = TOOLS.parent
VENDOR_SET = ["check-purity.py", "worldbook.py", "export-doc.py", "snapshot.py", "serve.py"]
ROOT_LINE = "ROOT = Path(__file__).resolve().parent.parent"
KIT_MARK = "kit.json"

def sha1(t): return hashlib.sha1(t.encode("utf-8")).hexdigest()[:12]

def load_manifest(project):
    m = project / "kit" / KIT_MARK
    if m.exists():
        return json.loads(m.read_text(encoding="utf-8"))
    return None

def bound_flow(project):
    for sp in (project / "state.json", project / "run-state.json"):
        if sp.exists():
            try:
                fid = json.loads(sp.read_text(encoding="utf-8")).get("flowId")
                if fid:
                    return fid
            except Exception:
                pass
    return None

def vendored_file_text(name, project_root):
    """vendor 模式改写：ROOT 行后注入 kit.json 感知（proj_dir 逻辑随源文件自带）。
    serve.py 额外把默认端口定为 8425，避免与工作区实例抢端口。"""
    return (TOOLS / name).read_text(encoding="utf-8")

def cmd_vendor(project, flow_id=None, force=False):
    kit = project / "kit"
    kit.mkdir(parents=True, exist_ok=True)
    manifest = load_manifest(project) or {
        "kitVersion": "1.0.0", "project": project.name,
        "vendoredAt": datetime.now().isoformat(timespec="seconds"), "files": {}
    }
    # 流程快照：优先项目绑定
    fid = flow_id or bound_flow(project)
    if fid:
        src = WORKSPACE / "flows" / fid / "flow.json"
        if src.exists() and (force or not (kit / "flow.json").exists()):
            (kit / "flow.json").write_text(src.read_text(encoding="utf-8"), encoding="utf-8")
            manifest["flow"] = {"id": fid, "version": json.loads(src.read_text(encoding="utf-8")).get("version")}
    copied = skipped = 0
    for name in VENDOR_SET:
        dst = kit / name
        src_text = vendored_file_text(name, project)
        if dst.exists() and not force:
            skipped += 1
            continue
        dst.write_text(src_text, encoding="utf-8")
        manifest["files"][name] = {"source": f"tools/{name}", "upstreamSha1": sha1(src_text)}
        copied += 1
    manifest["vendoredAt"] = datetime.now().isoformat(timespec="seconds")
    (kit / KIT_MARK).write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if not (kit / "KIT.md").exists():
        (kit / "KIT.md").write_text(KIT_MD, encoding="utf-8")
    print(f"vendored: 新拷 {copied} · 保留 {skipped}（--force 覆盖）→ {kit}")

def cmd_status(project):
    manifest = load_manifest(project)
    if not manifest:
        print("未 vendor：先跑 python tools/kit.py vendor " + project.name); sys.exit(1)
    kit = project / "kit"
    for name in VENDOR_SET:
        meta = manifest["files"].get(name)
        dst = kit / name
        if not dst.exists():
            print(f"[缺失] {name}"); continue
        local = sha1(dst.read_text(encoding="utf-8"))
        if not meta:
            print(f"[未登记] {name}"); continue
        if local == meta["upstreamSha1"]:
            cur = TOOLS / name
            up = sha1(cur.read_text(encoding="utf-8")) if cur.exists() else "?"
            print(f"[一致] {name}" + ("" if up == local else "（上游已有更新，可 diff 取舍）"))
        else:
            print(f"[已修改] {name}（创作者自治：你的版本；上游更新见 diff）")

def cmd_diff(project, name):
    kit = project / "kit" / name
    src = TOOLS / name
    if not kit.exists() or not src.exists():
        print("文件不存在"); sys.exit(1)
    import difflib
    a = src.read_text(encoding="utf-8").splitlines()
    b = kit.read_text(encoding="utf-8").splitlines()
    d = list(difflib.unified_diff(a, b, fromfile="上游 tools/" + name, tofile="项目 kit/" + name, lineterm=""))
    print("\n".join(d) if d else "（无差异）")

KIT_MD = """# 创作者工具箱（kit）

本目录是**你项目的工具链副本**——改坏了就删掉重 vendor，改顺手了就是你自己的版本。

## 常用命令（在项目根运行）

    python kit/check-purity.py <project>        # 产物正文纯净度检查
    python kit/worldbook.py tree <project>      # 世界书结构树
    python kit/worldbook.py check <project>     # 世界书一致性
    python kit/export-doc.py <src.md> <out.docx> --plain   # md → docx（需 pip install python-docx）
    python kit/snapshot.py capture <flow> <project> <node> --files <f>   # 快照留档
    python kit/serve.py 8426                    # 本地预览（项目根）

## 版本自治

- `kit.json` 记录每个文件拷贝时的上游指纹；
- `python tools/kit.py status <project>` 看哪些改过、哪些上游有更新；
- `python tools/kit.py diff <project> <file>` 看差异；**更新与否由你决定，上游不自动覆盖**。
"""

def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "vendor":
        project = WORKSPACE / "projects" / sys.argv[2]
        flow = None
        if "--flow" in sys.argv: flow = sys.argv[sys.argv.index("--flow") + 1]
        cmd_vendor(project, flow, force="--force" in sys.argv)
    elif cmd == "status":
        cmd_status(WORKSPACE / "projects" / sys.argv[2])
    elif cmd == "diff":
        cmd_diff(WORKSPACE / "projects" / sys.argv[2], sys.argv[3])
    else:
        print(__doc__)

main()
