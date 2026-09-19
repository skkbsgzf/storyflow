"""本地应用服务器（替代 python -m http.server）：
- 响应带 no-store 缓存头（防画布页吃旧缓存）
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

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    directory_path = None     # 服务根（Path）
    gate_code = None          # 邀请码（None = 不启用访问门）
    gate_hash = None          # 邀请码 sha1 前 16 位（Cookie 值）
    tunnel = {"active": False, "url": "", "error": ""}

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

    def _ws(self):
        return Path(self.workspace).resolve()

    def _regen_pages(self, flow, project):
        """重生成项目工作台页（project-pages.py）。"""
        proc = subprocess.run(
            [sys.executable, str(self._ws() / "tools" / "project-pages.py"), flow, project],
            capture_output=True, text=True, cwd=str(self._ws()))
        return proc.returncode == 0, (proc.stdout + proc.stderr).strip()[-500:]

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
    httpd.serve_forever()

if __name__ == "__main__":
    main()
