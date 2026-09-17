"""发布打包：把工作区冻结成可验证的发布包（「打包验证 / 工作区改跑」两层分离）。

用法：
    python tools/package.py                 # 构建发布包到 dist/release-<版本>/
    python tools/package.py --start 8430    # 构建并在 8430 端口启动验证实例
    python tools/package.py --code XXX      # 建议的邀请码（仅拼进输出命令）

分层口径：
    · 开发层 = 工作区原目录（serve.py 默认 8420）——新代码在这里改和跑，内容随时变
    · 验证层 = dist/release-<版本>（--root 挂给独立 serve.py 实例）——冻结快照，
      验收/外发/回归都指向它，不受开发侧并发写入干扰（杜绝「验证到一半页面变了」）
升级流程：工作区改完 → 门禁全绿 → package.py 重打包 → 验证实例换新包。
"""
import argparse
import datetime
import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"

# 顶层收集清单（验证包的最小完备集：页面 + 服务 + 工具链 + 真相源）
TOP = ["tools", "flows", "kits", "knowledge", "skills", "contracts", "templates", "docs"]
COPY_TREE = ["core"]  # 保留内核源码（CLI 重跑用），排除其 node_modules/.tmp/dist
PROJECT_EXCL_DIRS = {"snapshots", "registry", "node_modules"}
PROJECT_EXCL_FILES = {"journal.jsonl"}


def git_meta():
    try:
        commit = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT,
                                capture_output=True, text=True).stdout.strip()
        dirty = bool(subprocess.run(["git", "status", "--porcelain"], cwd=ROOT,
                                    capture_output=True, text=True).stdout.strip())
    except Exception:
        commit, dirty = "unknown", True
    return commit, dirty


def bound_projects():
    """有绑定/配置的项目 → [(pid, flowId)]，用于打包前刷新页面。"""
    out = []
    for sp in sorted((ROOT / "projects").glob("*")):
        pid = sp.name
        if not sp.is_dir() or pid.startswith(("_", "demo-")) and False:
            continue
        flow = None
        for name in ("state.json", "run-state.json"):
            f = sp / name
            if f.exists():
                try:
                    flow = json.loads(f.read_text(encoding="utf-8")).get("flowId")
                except Exception:
                    flow = None
                if flow:
                    break
        if flow or (sp / "项目配置.json").exists():
            out.append((pid, flow))
    return out


def ignore_projects(dir_, names):
    return [n for n in names if n in PROJECT_EXCL_DIRS or n in PROJECT_EXCL_FILES]


def ignore_core(dir_, names):
    return [n for n in names if n in {"node_modules", ".tmp", "dist", "__pycache__"}]


def ignore_top(dir_, names):
    return [n for n in names if n in {"__pycache__", ".tmp"}]


def sha1(p: Path):
    h = hashlib.sha1()
    h.update(p.read_bytes())
    return h.hexdigest()[:12]


def main():
    ap = argparse.ArgumentParser(add_help=False)
    ap.add_argument("--start", nargs="?", const="8430", default=None)
    ap.add_argument("--code", default=None)
    ap.add_argument("--keep", action="store_true", help="保留旧包（默认清空 dist 重打）")
    a = ap.parse_args()

    commit, dirty = git_meta()
    ts = datetime.datetime.now().strftime("%Y%m%d-%H%M")
    ver = f"{commit}{'-dirty' if dirty else ''}-{ts}"
    out = DIST / f"release-{ver}"

    # 1) 打包前先刷新所有项目页（包里内嵌的必须是当前盘上真相）
    for pid, flow in bound_projects():
        if not flow:
            print(f"[skip] {pid}: 无流程绑定（未初始化）")
            continue
        r = subprocess.run([sys.executable, str(ROOT / "tools" / "project-pages.py"), flow, pid],
                           capture_output=True, text=True, cwd=str(ROOT))
        print(("  ✓ " if r.returncode == 0 else "  ✗ ") + f"{pid} ← {flow} " + (r.stdout.strip().splitlines() or [""])[-1][:60])

    # 2) 清空 dist（除非 --keep）并拷贝
    if DIST.exists() and not a.keep:
        for d in DIST.iterdir():
            shutil.rmtree(d) if d.is_dir() else d.unlink()
    out.mkdir(parents=True, exist_ok=True)
    n_files = 0
    for top in TOP:
        src = ROOT / top
        if src.exists():
            shutil.copytree(src, out / top, ignore=lambda d, names: ignore_top(d, names))
    shutil.copytree(ROOT / "core", out / "core", ignore=ignore_core)
    projs = out / "projects"
    projs.mkdir(exist_ok=True)
    for sp in sorted((ROOT / "projects").iterdir()):
        if not sp.is_dir() or sp.name.startswith("_"):
            continue
        shutil.copytree(sp, projs / sp.name, ignore=ignore_projects)
    for f in ROOT.glob("*.md"):  # 根级说明（AGENTS/README 等）
        shutil.copy2(f, out / f.name)

    # 3) MANIFEST
    manifest = {
        "package": out.name,
        "version": ver,
        "commit": commit,
        "dirty": dirty,
        "builtAt": datetime.datetime.now().isoformat(timespec="seconds"),
        "sourceRoot": str(ROOT),
        "projects": [pid for pid, _ in bound_projects()],
        "entry": {
            "verify": f"python tools/serve.py {a.start or 8430} --root {out}" + (f" --code <邀请码>" if a.code else ""),
            "dev": "python tools/serve.py 8420",
        },
        "note": "验证层=冻结快照（改验证意见不影响工作区）；开发层=工作区（新代码改和跑）。升级：重打包换新包。",
    }
    (out / "MANIFEST.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    for p in out.rglob("*"):
        if p.is_file():
            n_files += 1
    manifest["files"] = n_files
    (out / "MANIFEST.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    size = sum(p.stat().st_size for p in out.rglob("*") if p.is_file())
    print(f"\n包已就绪: {out}  （{n_files} 文件 / {size // 1024 // 1024} MB / commit {commit}{'·dirty' if dirty else ''}）")
    print(f"验证层: python tools/serve.py {a.start or 8430} --root \"{out}\"" + (f" --code {a.code}" if a.code else ""))
    print(f"开发层: python tools/serve.py 8420   （工作区，改和跑）")

    # 4) 可选：立即拉起验证实例
    if a.start:
        subprocess.Popen([sys.executable, str(ROOT / "tools" / "serve.py"), str(a.start),
                          "--root", str(out)] + (["--code", a.code] if a.code else []),
                         cwd=str(ROOT))
        print(f"验证实例已启动: http://127.0.0.1:{a.start}/projects/p-fq-001/workflow.html")


if __name__ == "__main__":
    main()
