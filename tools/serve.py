"""本地应用服务器（替代 python -m http.server）：
- 响应带 no-store 缓存头（防画布页吃旧缓存）
- 冷启动自动配置：打开 projects/<id>/workflow.html 时自动补齐项目目录骨架
  （模块目录 + registry/snapshots/内部），外发页缺失或陈旧（模板/flow/effective 比页面新）
  自动重生成，`?regen=1` 强制；启动时后台 sweep 补齐所有缺页项目
- POST /_kit/save：页面批注/意见/编辑内容直接写盘（限工作区内 .md/.json，原子写）——不再弹「另存为」
- --code <邀请码>：启用访问门——访客须输入邀请码，通过后写 Cookie 放行
- --tunnel：尝试 cloudflared quick tunnel 外发到公网（需已安装 cloudflared），
  隧道地址写入 /_kit/tunnel.json，页面「⚙ 设置 → 外发」会显示

用法：python tools/serve.py [port] [root] [--code <邀请码>] [--tunnel]
默认 8420；根目录默认从脚本位置反推（tools/.. = 工作区根），不依赖启动时 CWD。
"""
import functools
import hashlib
import http.server
import json
import re
import shutil
import subprocess
import sys
import threading
import urllib.parse
from datetime import datetime
from pathlib import Path

PORT_DEFAULT = 8420
PROJ_ID_RE = r"[A-Za-z0-9._-]{1,64}"
PAGE_NAME = "workflow.html"


def project_flow_id(proj: Path):
    """流程身份以项目盘上绑定为准（铁律 8）：state.json → 项目配置.json。"""
    for name in ("state.json", "项目配置.json"):
        p = proj / name
        if p.exists():
            try:
                fid = json.loads(p.read_text(encoding="utf-8")).get("flowId")
            except Exception:
                fid = None
            if fid:
                return str(fid)
    return None


def module_dirs(ws: Path, fid: str, proj: Path):
    """模块目录名（冷启动建目录口径）：优先内核 effective@2 composition 的 dir（派生真相），
    否则按 flow@3 声明静态兜底（序号+模块名，模块名取 modules/<id>/module.json）——
    与 tools/project-pages.py 的两个视图同口径，禁止第三套。"""
    dirs = []
    eff = {}
    ef = proj / "registry" / "effective.json"
    if ef.exists():
        try:
            eff = json.loads(ef.read_text(encoding="utf-8"))
        except Exception:
            eff = {}
    comp = eff.get("composition") if eff.get("format") == "effective@2" else None
    if comp:
        items = list(comp.values()) if isinstance(comp, dict) else list(comp)
        dirs = [str(c.get("dir") or "") for c in items if isinstance(c, dict)]
    else:
        flow = {}
        fp = ws / "flows" / fid / "flow.json"
        if fp.exists():
            try:
                flow = json.loads(fp.read_text(encoding="utf-8"))
            except Exception:
                flow = {}
        for i, inst in enumerate(flow.get("modules") or []):
            mid = str(inst.get("module") or "")
            name = ""
            md = ws / "modules" / mid / "module.json"
            if md.exists():
                try:
                    name = json.loads(md.read_text(encoding="utf-8")).get("name") or ""
                except Exception:
                    name = ""
            dirs.append(f"{i + 1:02d}-{name or mid or i + 1}")
    out = []
    for d in dirs:
        d = d.strip().replace("\\", "/").strip("/")
        if d and not d.startswith(".") and "/" not in d and d not in out:
            out.append(d)
    return out


def regen_pages(ws: Path, flow, project):
    """重生成项目工作台页（project-pages.py）。显式 UTF-8 解码，防 GBK 控制台假失败。"""
    proc = subprocess.run(
        [sys.executable, str(ws / "tools" / "project-pages.py"), str(flow), str(project)],
        capture_output=True, text=True, cwd=str(ws),
        encoding="utf-8", errors="replace")
    return proc.returncode == 0, ((proc.stdout or "") + (proc.stderr or "")).strip()[-500:]


def ensure_project_ready(ws: Path, pid: str, force=False):
    """冷启动自动配置（幂等）：目录骨架 + 外发页。
    页面缺失，或模板/flow/effective 比页面新（陈旧）才重生成；regen 失败不删旧页、不抛异常。"""
    proj = ws / "projects" / pid
    if not proj.is_dir():
        return {"ok": False, "reason": "项目不存在"}
    fid = project_flow_id(proj)
    if not fid:
        return {"ok": False, "reason": "无流程绑定（state.json / 项目配置.json 均无 flowId）"}
    if not (ws / "flows" / fid / "flow.json").exists():
        return {"ok": False, "reason": f"flow 不存在：{fid}"}
    created = []
    for d in module_dirs(ws, fid, proj) + ["registry", "snapshots", "内部"]:
        p = proj / d
        if not p.is_dir():
            p.mkdir(parents=True, exist_ok=True)
            created.append(d)
    page = proj / PAGE_NAME

    def newer(a, b):
        return a.exists() and b.exists() and a.stat().st_mtime > b.stat().st_mtime

    stale = force or not page.exists() \
        or newer(ws / "tools" / "workflow-page-template.html", page) \
        or newer(ws / "flows" / fid / "flow.json", page) \
        or newer(proj / "registry" / "effective.json", page)
    res = {"ok": True, "flow": fid, "created": created, "regenerated": False, "regenError": ""}
    if stale:
        ok, log = regen_pages(ws, fid, pid)
        res["regenerated"] = bool(ok)
        if not ok:
            res["regenError"] = log
    return res


def cold_start_sweep(ws: Path):
    """服务启动时后台补齐：有流程绑定但没有 workflow.html 的项目自动冷启动（缺失才补，陈旧页不动）。"""
    proot = ws / "projects"
    if not proot.is_dir():
        return
    for proj in sorted(proot.iterdir()):
        if not proj.is_dir() or proj.name.startswith("_"):
            continue
        if (proj / PAGE_NAME).exists() or not project_flow_id(proj):
            continue
        r = ensure_project_ready(ws, proj.name)
        note = r.get("regenError") or (",".join(r.get("created") or []) or "页面已就绪")
        print(f"[cold-start] {proj.name}: {'ok' if r.get('ok') else 'FAIL'} {note}", flush=True)

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    directory_path = None     # 服务根（Path）
    gate_code = None          # 邀请码（None = 不启用访问门）
    gate_hash = None          # 邀请码 sha1 前 16 位（Cookie 值）
    tunnel = {"active": False, "url": "", "error": ""}
    anno_lock = threading.Lock()
    provision_lock = threading.Lock()   # 冷启动重生成串行化（防并发双写页）

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Expires", "0")
        super().end_headers()

    workspace = None         # 工作区根（main 里赋值）；写接口的可写范围

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", 0) or 0)
            body = json.loads(self.rfile.read(length).decode("utf-8")) if length else {}
            if self.path == "/_kit/history":
                name = str(body.get("name", "")); content = str(body.get("content", ""))
                label = str(body.get("label", "自动保存"))
                if not name or not content:
                    self._json({"ok": False, "error": "name/content 必填"}, 400); return
                entries = self._hist_append(name, content, label)
                self._json({"ok": True, "count": len(entries)})
                return
            if self.path == "/_kit/save":
                self._kit_save(body)
            elif self.path == "/_kit/anno":
                self._kit_anno(body)
            elif self.path == "/api/archive-project":
                self._api_archive_project(body)
            elif self.path == "/api/save":
                self._api_save(body)
            elif self.path == "/api/import-flow":
                self._api_import_flow(body)
            elif self.path == "/api/regen":
                self._api_regen(body)
            elif self.path == "/api/import-demo":
                self._api_import_demo(body)
            else:
                self._json({"ok": False, "error": "unknown endpoint"}, 404)
        except Exception as e:
            self._json({"ok": False, "error": f"{type(e).__name__}: {e}"}, 400)

    def _history_dir(self, name):
        safe = re.sub(r"[^A-Za-z0-9._-]", "_", name)
        return Path(self.workspace).resolve() / ".history" / safe

    def _hist_entries(self, hd):
        idx = hd / "index.json"
        if not idx.exists(): return []
        try:
            return json.loads(idx.read_text(encoding="utf-8")).get("entries", [])
        except Exception:
            return []

    def _hist_append(self, name, content, label):
        hd = self._history_dir(name)
        hd.mkdir(parents=True, exist_ok=True)
        entries = self._hist_entries(hd)
        hid = datetime.now().strftime("%Y%m%d-%H%M%S") + "-" + hashlib.sha1(content.encode("utf-8")).hexdigest()[:6]
        (hd / (hid + ".md")).write_text(content, encoding="utf-8")
        entries.append({"id": hid, "ts": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                        "label": label, "file": hid + ".md", "chars": len(content)})
        entries = entries[-50:]
        (hd / "index.json").write_text(json.dumps({"name": name, "entries": entries}, ensure_ascii=False, indent=1), encoding="utf-8")
        return entries

    def _json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_bytes(self, data: bytes, ctype: str):
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _ws(self):
        return Path(self.workspace).resolve()

    def _regen_pages(self, flow, project):
        """重生成项目工作台页（project-pages.py）。"""
        return regen_pages(self._ws(), flow, project)

    def _cold_start(self, pid, force=False):
        """冷启动自动配置（带锁串行）：目录骨架 + 外发页缺失/陈旧重生成。"""
        if not re.fullmatch(PROJ_ID_RE, pid or "") or pid.startswith("_"):
            return {"ok": False, "reason": "项目 id 非法"}
        with NoCacheHandler.provision_lock:
            return ensure_project_ready(self._ws(), pid, force=force)

    def _cold_start_page(self, info):
        """冷启动后页面仍缺失（新建项目 regen 失败等）时的兜底说明页。"""
        rows = "".join(
            f"<li><code>{k}</code>: {v}</li>" for k, v in info.items() if v)
        html = f"""<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>项目尚未就绪</title>
<style>body{{font-family:system-ui,sans-serif;background:#f4f1ea;color:#262420;display:flex;
min-height:100vh;align-items:center;justify-content:center;margin:0}}
div{{background:#fffdf9;border:1px solid #d9d2c5;border-radius:10px;padding:28px 34px;max-width:640px}}
h1{{font-size:18px;margin:0 0 8px}}p,li{{font-size:13px;color:#6b6455}}code{{background:#efe9dc;border-radius:4px;padding:1px 5px}}</style>
</head><body><div><h1>项目冷启动未完成，工作台页未能生成</h1>
<p>目录骨架已尽量补齐；页面生成失败的原因如下（可在服务端日志看到完整输出）：</p><ul>{rows}</ul>
<p>修复后刷新本页即可自动重试；也可带 <code>?regen=1</code> 强制重生成。</p></div></body></html>"""
        self.send_response(404)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(html.encode("utf-8"))))
        self.end_headers()
        self.wfile.write(html.encode("utf-8"))

    def _api_save(self, body):
        rel = str(body.get("path", "")).strip()
        content = body.get("content")
        if not rel or content is None:
            self._json({"ok": False, "error": "path/content 必填"}, 400); return
        ws = self._ws()
        p = (ws / rel).resolve()
        if p.suffix.lower() not in (".md", ".json") or not str(p).startswith(str(ws)):
            self._json({"ok": False, "error": "path 不合法（限工作区内 .md/.json）"}, 400); return
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(str(content), encoding="utf-8")
        self._json({"ok": True, "saved": rel})

    def _kit_save(self, body):
        """页面 saveFile 的直写盘端点（批注/意见/编辑内容）——此前只有路由没有实现，
        POST 必 400，前端落到浏览器「另存为」兜底打扰用户（用户实测）。
        契约同 _api_save：{name|path, content}，限工作区内 .md/.json，原子写。"""
        rel = str(body.get("name") or body.get("path") or "").strip()
        content = body.get("content")
        if not rel or content is None:
            self._json({"ok": False, "error": "name/content 必填"}, 400); return
        ws = self._ws()
        p = (ws / rel).resolve()
        if p.suffix.lower() not in (".md", ".json") or not str(p).startswith(str(ws.resolve())):
            self._json({"ok": False, "error": "path 不合法（限工作区内 .md/.json）"}, 400); return
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(p.suffix + ".tmp")
        tmp.write_text(str(content), encoding="utf-8")
        tmp.replace(p)
        self._json({"ok": True, "path": rel})

    def _kit_anno(self, body):
        """多人批注单条追加：{project, key, anno} —— 服务端读改写合并进
        projects/<project>/内部/批注与意见.json（带锁原子写，避免多浏览器整文件互冲）。"""
        project = str(body.get("project", "")).strip()
        key = str(body.get("key", "")).strip()
        anno = body.get("anno")
        if (not re.fullmatch(r"[A-Za-z0-9._-]{1,64}", project or "")
                or not key or not isinstance(anno, dict)):
            self._json({"ok": False, "error": "project/key/anno 必填（project 限 id 字符）"}, 400); return
        ws = self._ws()
        p = (ws / "projects" / project / "内部" / "批注与意见.json").resolve()
        if not str(p).startswith(str(ws.resolve())):
            self._json({"ok": False, "error": "path 不合法"}, 400); return
        clean = {k: anno[k] for k in ("id", "quote", "text", "by", "ts") if anno.get(k) is not None}
        if not clean.get("text"):
            self._json({"ok": False, "error": "anno.text 必填"}, 400); return
        with NoCacheHandler.anno_lock:
            data = {}
            if p.exists():
                try:
                    data = json.loads(p.read_text(encoding="utf-8"))
                except Exception:
                    data = {}
            annos = data.get("annos") if isinstance(data.get("annos"), dict) else {}
            lst = annos.setdefault(key, [])
            lst.append(clean)
            data["annos"] = annos
            data["savedAt"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            p.parent.mkdir(parents=True, exist_ok=True)
            tmp = p.with_suffix(".json.tmp")
            tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
            tmp.replace(p)
        total = sum(len(v) for v in annos.values())
        self._json({"ok": True, "path": str(p.relative_to(ws.resolve())), "total": total})

    def _api_archive_project(self, body):
        """W-项目管理 · 归档式删除：projects/<id> 整目录移入 projects/_archived/<id>-<时间戳>/
        ——从清单消失（生成器跳过 _ 前缀），数据可随时找回；_ 前缀目录与当前工作区白名单目录拒动。"""
        import shutil
        from datetime import datetime
        pid = str(body.get("project", "")).strip()
        if not pid or pid.startswith("_") or re.search(r'[\\/:*?"<>|]', pid):
            self._json({"ok": False, "error": f"项目 id 非法: {pid!r}"}, 400); return
        ws = self._ws()
        src = (ws / "projects" / pid).resolve()
        if not src.is_dir():
            self._json({"ok": False, "error": f"项目不存在: {pid}"}, 404); return
        arch_root = (ws / "projects" / "_archived").resolve()
        arch_root.mkdir(parents=True, exist_ok=True)
        dst = arch_root / f"{pid}-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
        shutil.move(str(src), str(dst))
        self._json({"ok": True, "archived": pid, "to": str(dst.relative_to(ws.resolve()))})

    def _api_import_flow(self, body):
        """项目换绑流程：更新绑定 flowId/flowVersion（state.json 优先，旧布局兜底），运行状态保留。"""
        project, flow_id = str(body.get("project", "")), str(body.get("flowId", ""))
        ws = self._ws()
        fj = ws / "flows" / flow_id / "flow.json"
        if not fj.exists():
            self._json({"ok": False, "error": f"flow 不存在：{flow_id}"}, 404); return
        version = json.loads(fj.read_text(encoding="utf-8")).get("version", "")
        rebound = None
        for name in ("state.json", "run-state.json"):
            sfp = ws / "projects" / project / name
            if not sfp.exists():
                continue
            try:
                sd = json.loads(sfp.read_text(encoding="utf-8"))
            except Exception:
                continue
            sd["flowId"], sd["flowVersion"] = flow_id, version
            sfp.write_text(json.dumps(sd, ensure_ascii=False, indent=2), encoding="utf-8")
            rebound = name
            break
        if not rebound:
            self._json({"ok": False, "error": f"项目无运行状态文件：{project}"}, 404); return
        ok, log = self._regen_pages(flow_id, project)
        self._json({"ok": ok, "project": project, "flow": flow_id, "version": version,
                    "rebound": rebound, "log": log})

    def _api_regen(self, body):
        project, flow_id = str(body.get("project", "")), str(body.get("flowId", ""))
        if not project or not flow_id:
            self._json({"ok": False, "error": "project/flowId 必填"}, 400); return
        ok, log = self._regen_pages(flow_id, project)
        self._json({"ok": ok, "log": log})

    def _api_import_demo(self, body):
        """官方 Demo 一键导入：复制 demos/<flow> 为新项目（配置+输入已就绪），生成工作台页。"""
        flow_id = str(body.get("flowId", ""))
        ws = self._ws()
        src = ws / "demos" / flow_id
        if not (src / "项目配置.json").exists():
            self._json({"ok": False, "error": f"暂无 {flow_id} 的官方 Demo"}, 404); return
        projects = ws / "projects"
        pid, n = f"demo-{flow_id}", 1
        while (projects / pid).exists():
            n += 1
            pid = f"demo-{flow_id}-{n}"
        shutil.copytree(src, projects / pid)
        cfg = projects / pid / "项目配置.json"
        try:
            data = json.loads(cfg.read_text(encoding="utf-8"))
            data["项目"] = pid
            cfg.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        except Exception:
            pass
        ok, log = self._regen_pages(flow_id, pid)
        if not ok:
            self._json({"ok": False, "error": "页面生成失败：" + log}, 500); return
        self._json({"ok": True, "project": pid, "flow": flow_id})

    def do_GET(self):
        if self.gate_code and not self._authorized():
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            code = (q.get("code") or [""])[0]
            if code == self.gate_code:
                self.send_response(302)
                self.send_header("Set-Cookie", f"kit_gate={self.gate_hash}; Path=/; HttpOnly")
                self.send_header("Location", "/")
                self.end_headers()
                return
            self._gate_page()
            return
        # Markdown 渲染视图：浏览器访问 .md 时服务端转 HTML（?raw=1 或非浏览器 UA 仍回原文）
        import os as _os
        _parsed = urllib.parse.urlparse(self.path)
        _fp = self.translate_path(_parsed.path)
        # 冷启动自动配置：打开项目的 workflow.html 时，缺目录/缺页/页面陈旧 → 自动补齐再服务
        _m = re.fullmatch(rf"/projects/({PROJ_ID_RE})/{PAGE_NAME}",
                          urllib.parse.unquote(_parsed.path))
        if _m:
            _q = urllib.parse.parse_qs(_parsed.query)
            info = self._cold_start(_m.group(1), force=bool(_q.get("regen")))
            if not _os.path.isfile(_fp):
                self._cold_start_page(info)
                return
        if (_os.path.isfile(_fp) and _fp.endswith(".md")
                and "text/html" in (self.headers.get("Accept") or "")
                and not urllib.parse.parse_qs(_parsed.query).get("raw")):
            try:
                import markdown as _markdown
                _src = Path(_fp).read_text(encoding="utf-8")
                _body = _markdown.markdown(_src, extensions=["tables", "fenced_code", "nl2br"])
            except Exception:
                _body = None
            if _body is not None:
                _page = f"""<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{Path(_fp).stem}</title><style>
body{{font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:#2a2723;
background:#f7f4ee;margin:0;line-height:1.75}}
main{{max-width:880px;margin:0 auto;padding:40px 28px 80px;background:#fffdf9;min-height:100vh;
box-shadow:0 0 24px rgba(40,32,16,.06)}}
h1{{font-size:26px;border-bottom:2px solid #d9d2c5;padding-bottom:10px}}
h2{{font-size:20px;border-bottom:1px solid #e4ddd0;padding-bottom:6px;margin-top:36px}}
h3{{font-size:17px}}
table{{border-collapse:collapse;width:100%;margin:14px 0;font-size:14px}}
th,td{{border:1px solid #d9d2c5;padding:7px 10px;text-align:left;vertical-align:top}}
th{{background:#f0ebe0}}
blockquote{{border-left:4px solid #c9c1b2;margin:14px 0;padding:4px 16px;color:#6b6455;background:#f7f4ee}}
code{{background:#efe9dc;border-radius:4px;padding:1px 6px;font-size:13px}}
pre code{{display:block;padding:12px;overflow-x:auto}}
hr{{border:0;border-top:1px solid #d9d2c5;margin:28px 0}}
.topbar{{max-width:880px;margin:0 auto;padding:10px 28px 0;font-size:12px;color:#8a8375}}
.topbar a{{color:#a5433a;text-decoration:none}}
</style></head><body>
<div class="topbar">{Path(_fp).name} ｜ <a href="?raw=1">查看原文</a></div>
<main>{_body}</main></body></html>"""
                self._send_bytes(_page.encode("utf-8"), "text/html; charset=utf-8")
                return
        # 文本类文件按需 gzip（外发隧道带宽窄，625KB 工作台页压缩后约 1/4 体积）
        if "gzip" in (self.headers.get("Accept-Encoding") or ""):
            import gzip as _gzip
            import os as _os
            fp = self.translate_path(self.path)
            if (_os.path.isfile(fp) and fp.endswith((".html", ".md", ".json", ".css", ".js", ".svg", ".txt"))):
                try:
                    raw = open(fp, "rb").read()
                except OSError:
                    raw = None
                if raw is not None:
                    body = _gzip.compress(raw, 6)
                    ctype = self.guess_type(fp) or "application/octet-stream"
                    if ctype == ".md" or fp.endswith(".md"):
                        ctype = "text/markdown"
                    if ctype.startswith("text/") or ctype in ("application/javascript", "application/json"):
                        ctype += "; charset=utf-8"
                    self.send_response(200)
                    self.send_header("Content-Type", ctype)
                    self.send_header("Content-Encoding", "gzip")
                    self.send_header("Content-Length", str(len(body)))
                    self.send_header("Cache-Control", "no-store, must-revalidate")
                    self.send_header("Expires", "0")
                    self.end_headers()
                    self.wfile.write(body)
                    return
        if self.path.startswith("/_kit/history"):
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            name = (q.get("name") or [""])[0]
            if not name:
                self.send_error(400); return
            hd = self._history_dir(name)
            if (q.get("view") or [""])[0]:
                fp = hd / ((q["view"][0] + ".md"))
                if not fp.exists():
                    self.send_error(404); return
                body = fp.read_text(encoding="utf-8").encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "text/plain; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers(); self.wfile.write(body)
                return
            entries = self._hist_entries(hd)
            self._json({"ok": True, "name": name, "entries": entries})
            return
        if self.path == "/_kit/tunnel.json":
            body = json.dumps(self.tunnel, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def _authorized(self):
        return f"kit_gate={self.gate_hash}" in self.headers.get("Cookie", "")

    def _gate_page(self, wrong=False):
        self.send_response(401)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        warn = '<p style="color:#a5433a">邀请码不正确，请重试。</p>' if wrong else ""
        html = f"""<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>需要邀请码</title>
<style>body{{font-family:system-ui,sans-serif;background:#f4f1ea;color:#262420;display:flex;
min-height:100vh;align-items:center;justify-content:center;margin:0}}
form{{background:#fffdf9;border:1px solid #d9d2c5;border-radius:10px;padding:32px 36px;
box-shadow:0 8px 28px rgba(40,32,16,.15);text-align:center}}
h1{{font-size:18px;margin:0 0 4px}}p{{font-size:13px;color:#8a8375;margin:0 0 16px}}
input{{font-size:16px;padding:8px 12px;border:1px solid #c9c1b2;border-radius:7px;width:200px;text-align:center}}
button{{font-size:14px;padding:8px 20px;margin-left:8px;border:0;border-radius:7px;
background:#a5433a;color:#fff;cursor:pointer}}</style></head><body>
<form method="get"><h1>🔒 邀请码访问</h1><p>本项目内容仅限受邀人员查看</p>{warn}
<input name="code" placeholder="输入邀请码" autofocus><button>进入</button></form></body></html>"""
        self.wfile.write(html.encode("utf-8"))

    def log_message(self, fmt, *args):
        sys.stderr.write("[serve] " + (fmt % args) + "\n")

def start_tunnel(port, state):
    """cloudflared quick tunnel：把本机端口映射到临时公网地址（无需账号）。"""
    try:
        proc = subprocess.Popen(
            ["cloudflared", "tunnel", "--url", f"http://127.0.0.1:{port}", "--no-autoupdate"],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    except FileNotFoundError:
        state["error"] = "cloudflared 未安装（Cloudflare Zero Trust → Downloads）"
        return
    def reader():
        for line in proc.stdout:
            m = re.search(r"https://[a-z0-9-]+\.trycloudflare\.com", line)
            if m:
                state["active"] = True
                state["url"] = m.group(0)
                break
    threading.Thread(target=reader, daemon=True).start()

def main():
    args = sys.argv[1:]
    port = PORT_DEFAULT
    root = str(Path(__file__).resolve().parent.parent)   # 工具位置反推工作区根（vendor 后为项目根）
    code = None
    use_tunnel = False
    i = 0
    while i < len(args):
        a = args[i]
        if a == "--code" and i + 1 < len(args):
            code = args[i + 1]; i += 1
        elif a == "--tunnel":
            use_tunnel = True
        elif a == "--root" and i + 1 < len(args):
            root = args[i + 1]; i += 1
        elif not a.startswith("--"):
            port = int(a)
        i += 1

    NoCacheHandler.gate_code = code
    NoCacheHandler.gate_hash = hashlib.sha1(code.encode("utf-8")).hexdigest()[:16] if code else None
    NoCacheHandler.tunnel = {"active": False, "url": "", "error": ""}
    NoCacheHandler.workspace = str(Path(root).resolve())
    NoCacheHandler.directory_path = Path(root).resolve()
    handler = functools.partial(NoCacheHandler, directory=root)
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    if use_tunnel:
        threading.Thread(target=start_tunnel, args=(port, NoCacheHandler.tunnel), daemon=True).start()
    gate_note = " ｜ 邀请码门已启用" if code else ""
    tunnel_note = " ｜ cloudflared 外发尝试中…" if use_tunnel else ""
    print(f"serving {root} at http://127.0.0.1:{port} (no-store){gate_note}{tunnel_note}")
    threading.Thread(target=cold_start_sweep, args=(Path(root).resolve(),), daemon=True).start()
    httpd.serve_forever()

if __name__ == "__main__":
    main()
