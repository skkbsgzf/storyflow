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
import json
import http.server
import re
import subprocess
import sys
import threading
import urllib.parse
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
            if self.path == "/_kit/save":
                self._kit_save(body)
            elif self.path == "/api/save":
                self._api_save(body)
            elif self.path == "/api/import-flow":
                self._api_import_flow(body)
            elif self.path == "/api/regen":
                self._api_regen(body)
            else:
                self._json({"ok": False, "error": "unknown endpoint"}, 404)
        except Exception as e:
            self._json({"ok": False, "error": f"{type(e).__name__}: {e}"}, 400)

    def _kit_save(self, body):
        """页面批注/意见/编辑内容落盘：工作区内 .md/.json，原子写。"""
        name = str(body.get("name", "")).replace("\\", "/").lstrip("/")
        content = str(body.get("content", ""))
        if not name or ".." in name:
            raise ValueError("非法路径")
        if not name.endswith((".md", ".json")):
            raise ValueError("仅支持 .md/.json 写入")
        ws = Path(self.workspace).resolve()
        target = (ws / name).resolve()
        if ws != target and ws not in target.parents:
            raise ValueError("路径越界")
        target.parent.mkdir(parents=True, exist_ok=True)
        tmp = target.with_suffix(target.suffix + ".tmp")
        tmp.write_text(content, encoding="utf-8")
        tmp.replace(target)
        self._json({"ok": True, "path": name})

    def _json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _safe_target(self, rel):
        rel = rel.replace("\\", "/").lstrip("/")
        if not re.match(r"^(skills/[^/]+\.md|projects/[^/]+/(项目配置\.json|kit/[^/]+|[^/]+\.md)|flows/[^/]+/flow\.json)$", rel):
            raise ValueError(f"路径不在可写白名单: {rel}")
        ws = Path(self.workspace).resolve()
        target = (ws / rel).resolve()
        if ws != target and ws not in target.parents:
            raise ValueError("路径越界")
        return target, rel

    def _api_save(self, body):
        content = body.get("content", "")
        target, rel = self._safe_target(body.get("path", ""))
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        self._json({"ok": True, "saved": rel, "sha1": hashlib.sha1(content.encode("utf-8")).hexdigest()[:12]})

    def _regen_pages(self, project, flow_id):
        tools = Path(self.workspace) / "tools" / "project-pages.py"
        out = subprocess.run(
            [sys.executable, str(tools), flow_id, project],
            capture_output=True, text=True, cwd=str(self.workspace), timeout=120)
        if out.returncode != 0:
            raise ValueError("页面生成失败: " + (out.stderr or out.stdout)[-400:])
        return out.stdout.strip()[-120:]

    def _api_import_flow(self, body):
        project, flow_id = body["project"], body["flowId"]
        state_p = Path(self.workspace) / "projects" / project / "state.json"
        if not state_p.exists():
            raise ValueError(f"项目无 state.json: {project}")
        lint = subprocess.run(
            [sys.executable, str(Path(self.workspace) / "tools" / "flow-lint.py"), flow_id],
            capture_output=True, text=True, cwd=str(self.workspace), timeout=60)
        if lint.returncode != 0:
            raise ValueError("flow-lint 未通过（导入被拒）: " + (lint.stdout or "")[-300:])
        s = json.loads(state_p.read_text(encoding="utf-8"))
        old = s.get("flowId")
        s["flowId"] = flow_id
        s["plan"] = None
        state_p.write_text(json.dumps(s, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        pages = self._regen_pages(project, flow_id)
        self._json({"ok": True, "from": old, "to": flow_id, "pages": pages})

    def _api_regen(self, body):
        project = body["project"]
        state_p = Path(self.workspace) / "projects" / project / "state.json"
        fid = json.loads(state_p.read_text(encoding="utf-8")).get("flowId")
        pages = self._regen_pages(project, fid)
        self._json({"ok": True, "pages": pages})


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
