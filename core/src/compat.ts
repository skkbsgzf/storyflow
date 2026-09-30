/**
 * 兼容面（legacy page endpoints）—— 让现有 `tools/workflow-page-template.html` 在**内核 HTTP 面**上原样可跑。
 *
 * 背景
 * ----
 * 页面上的 fetch 全打在 `tools/serve.py` 上（`/api/save`、`/_kit/save`、`/_kit/history`、
 * `/api/import-flow`、`/api/archive-project`、`/api/regen`、`/api/import-demo`、`/_kit/tunnel.json`），
 * **一个都没打到内核 API** ⇒ 页面状态是构建时注入的静态快照、写操作绕开内核直接改文件。
 * 「前后端稳定」的根治要等前端 live 化；但在那之前，**先把两台 server 合成一台**——
 * 本模块把 serve.py 的语义在内核侧复刻一份，于是同一份页面在 `miniflow up` 下就能跑。
 *
 * 与 serve.py 的三点差别（都是修，不是抄）
 * ---------------------------------------
 * ① **不再无声吞错**：serve.py 的 `except Exception` 直接回 400/静默，本模块所有失败都写 diagnostics；
 * ② **写路径收得更紧**：serve.py 只查"后缀 + 落在工作区内"，本模块额外拒点开头段与 node_modules；
 * ③ **页面生成显式失败**：`project-pages.py` 需要 python，装不上时返回 `ok:false` + 原因 +
 *    `MINIFLOW_PYTHON` 提示，绝不假装生成成功（"以为有，其实没有"是本仓第一大忌）。
 */
import { nodeFs, nodePath, nodeProc } from "./abstraction/defaults.js";
import type { IFileSystem, IFsPath } from "./abstraction/fs.js";
import type { IProcessLauncher } from "./abstraction/proc.js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Kernel } from "./kernel.js";
import { recordDiag } from "./diag.js";
import { isDeniedRelativePath } from "./static.js";

const WRITE_SUFFIX = new Set([".md", ".json"]);
const MAX_HISTORY = 50;

type Body = Record<string, unknown>;

function send(reply: FastifyReply, code: number, obj: unknown): unknown {
  reply.code(code);
  return obj;
}

/** 写路径守卫：限根内 + .md/.json + 敏感路径判定（与静态托管**共用** isDeniedRelativePath）。 */
function safeWritePath(root: string, rel: string, path: IFsPath = nodePath): string | null {
  if (!rel) return null;
  const rootAbs = path.resolve(root);
  const abs = path.resolve(rootAbs, rel);
  if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) return null;
  if (!WRITE_SUFFIX.has(path.extname(abs).toLowerCase())) return null;
  const relNorm = path.relative(rootAbs, abs).split(path.sep).join("/");
  if (isDeniedRelativePath(relNorm)) return null;
  return abs;
}

function historyDir(root: string, name: string, path: IFsPath = nodePath): string {
  return path.join(root, ".history", name.replace(/[^A-Za-z0-9._-]/g, "_"));
}

function readHistEntries(hd: string, fs: IFileSystem = nodeFs, path: IFsPath = nodePath): unknown[] {
  try {
    const j = JSON.parse(fs.readText(path.join(hd, "index.json"))) as { entries?: unknown[] };
    return j.entries ?? [];
  } catch {
    return [];
  }
}

interface HistEntry { id: string; ts: string; label: string; file: string; chars: number }

function appendHist(root: string, name: string, content: string, label: string, fs: IFileSystem = nodeFs, path: IFsPath = nodePath): HistEntry[] {
  const hd = historyDir(root, name, path);
  fs.mkdir(hd, { recursive: true });
  const entries = readHistEntries(hd, fs, path) as HistEntry[];
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const hash = Buffer.from(content, "utf-8").toString("base64").replace(/[^A-Za-z0-9]/g, "").slice(0, 6);
  const id = `${stamp}-${hash}`;
  fs.writeText(path.join(hd, `${id}.md`), content);
  entries.push({ id, ts: new Date().toISOString().slice(0, 19).replace("T", " "), label, file: `${id}.md`, chars: content.length });
  const kept = entries.slice(-MAX_HISTORY);
  fs.writeText(
    path.join(hd, "index.json"),
    JSON.stringify({ name, entries: kept }, null, 1) + "\n",
  );
  return kept;
}

/** 重生成项目工作台页（沿用 tools/project-pages.py，参数序：<flow> <project>）。 */
function regenPages(
  root: string,
  flow: string,
  project: string,
  fs: IFileSystem = nodeFs,
  path: IFsPath = nodePath,
  proc: IProcessLauncher = nodeProc,
): { ok: boolean; log: string } {
  const script = path.join(root, "tools", "project-pages.py");
  if (!fs.exists(script)) return { ok: false, log: "缺 tools/project-pages.py（页面生成器不在仓库内）" };
  // 解释器选择留在 env 面：FS1 v1 只抽象磁盘与进程，环境变量不在接口内（规范 §3.1 普查无此项）。
  const py = process.env.MINIFLOW_PYTHON ?? (process.platform === "win32" ? "python" : "python3");
  const r = proc.run(py, [script, flow, project], { cwd: root });
  if (r.error) {
    return { ok: false, log: `${py} 不可用（${r.error}）；可用环境变量 MINIFLOW_PYTHON 指定解释器` };
  }
  return { ok: r.status === 0, log: `${r.stdout}${r.stderr}`.trim().slice(-500) };
}

/** `projects/<id>` → `projects/_archived/<id>-<时间戳>`；跨盘时退化为复制+删除。 */
function archiveProject(root: string, pid: string, fs: IFileSystem = nodeFs, path: IFsPath = nodePath): { ok: true; to: string } | { ok: false; error: string; code: number } {
  if (!pid || pid.startsWith("_") || /[\\/:*?"<>|]/.test(pid)) {
    return { ok: false, error: `项目 id 非法: ${JSON.stringify(pid)}`, code: 400 };
  }
  const src = path.join(root, "projects", pid);
  const st = fs.stat(src);
  if (!st || !st.isDirectory) {
    return { ok: false, error: `项目不存在: ${pid}`, code: 404 };
  }
  const archRoot = path.join(root, "projects", "_archived");
  fs.mkdir(archRoot, { recursive: true });
  // slice(0,14)=YYYYMMDDHHMMSS——此前 slice(0,15) 会把 toISOString 的毫秒小数点留在尾部，
  // 生成「xxx-20260922174101.」这种 Windows 保留名目录（资源管理器/cmd 无法直接删除）。
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const dst = path.join(archRoot, `${pid}-${stamp}`);
  try {
    fs.rename(src, dst);
  } catch {
    fs.copy(src, dst, { recursive: true });
    fs.remove(src, { recursive: true, force: true });
  }
  return { ok: true, to: path.relative(path.resolve(root), dst).split(path.sep).join("/") };
}

export function registerCompat(app: FastifyInstance, kernel: Kernel): void {
  const root = () => kernel.path.resolve(kernel.root);

  /** /_kit/save 与 /api/save 同语义：页面批注/意见/编辑内容的直写盘端点。 */
  const save = async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req.body ?? {}) as Body;
    const rel = String(body.name ?? body.path ?? "").trim();
    const content = body.content;
    if (!rel || content === undefined) return send(reply, 400, { ok: false, error: "name/content 必填" });
    const abs = safeWritePath(root(), rel, kernel.path);
    if (!abs) return send(reply, 400, { ok: false, error: "path 不合法（限工作区内 .md/.json）" });
    try {
      kernel.fs.writeTextAtomic(abs, String(content));
    } catch (e) {
      recordDiag(kernel, root(), "io", "compat:save", e);
      return send(reply, 500, { ok: false, error: String(e) });
    }
    return { ok: true, path: rel };
  };

  app.post("/_kit/save", save);
  app.post("/api/save", save);

  app.post("/_kit/history", async (req, reply) => {
    const body = (req.body ?? {}) as Body;
    const name = String(body.name ?? "");
    const content = String(body.content ?? "");
    if (!name || !content) return send(reply, 400, { ok: false, error: "name/content 必填" });
    try {
      const entries = appendHist(root(), name, content, String(body.label ?? "自动保存"), kernel.fs, kernel.path);
      return { ok: true, count: entries.length };
    } catch (e) {
      recordDiag(kernel, root(), "io", "compat:history-write", e);
      return send(reply, 500, { ok: false, error: String(e) });
    }
  });

  app.get("/_kit/history", async (req, reply) => {
    const q = (req.query ?? {}) as { name?: string; view?: string };
    const name = q.name ?? "";
    if (!name) return send(reply, 400, { ok: false, error: "name 必填" });
    const hd = historyDir(root(), name, kernel.path);
    if (q.view) {
      const fp = kernel.path.join(hd, `${q.view.replace(/[^A-Za-z0-9._-]/g, "_")}.md`);
      if (!kernel.fs.exists(fp)) return send(reply, 404, { ok: false, error: "no such revision" });
      reply.type("text/plain; charset=utf-8");
      return kernel.fs.readText(fp);
    }
    return { ok: true, name, entries: readHistEntries(hd, kernel.fs, kernel.path) };
  });

  app.post("/api/archive-project", async (req, reply) => {
    const pid = String(((req.body ?? {}) as Body).project ?? "").trim();
    const r = archiveProject(root(), pid, kernel.fs, kernel.path);
    if (!r.ok) return send(reply, r.code, { ok: false, error: r.error });
    return { ok: true, archived: pid, to: r.to };
  });

  app.post("/api/import-flow", async (req, reply) => {
    const body = (req.body ?? {}) as Body;
    const project = String(body.project ?? "");
    const flowId = String(body.flowId ?? "");
    const fj = kernel.path.join(root(), "flows", flowId, "flow.json");
    if (!flowId || !kernel.fs.exists(fj)) return send(reply, 404, { ok: false, error: `flow 不存在：${flowId}` });
    let version = "";
    try {
      version = String((JSON.parse(kernel.fs.readText(fj)) as { version?: string }).version ?? "");
    } catch (e) {
      recordDiag(kernel, kernel.projectDir(project), "io", `compat:import-flow:${flowId}`, e);
    }
    let rebound: string | null = null;
    for (const name of ["state.json", "run-state.json"]) {
      const sfp = kernel.path.join(root(), "projects", project, name);
      if (!kernel.fs.exists(sfp)) continue;
      try {
        const sd = JSON.parse(kernel.fs.readText(sfp)) as Record<string, unknown>;
        sd.flowId = flowId;
        sd.flowVersion = version;
        kernel.fs.writeText(sfp, JSON.stringify(sd, null, 2) + "\n");
        rebound = name;
        break;
      } catch (e) {
        recordDiag(kernel, kernel.projectDir(project), "io", `compat:import-flow:state:${name}`, e);
      }
    }
    if (!rebound) return send(reply, 404, { ok: false, error: `项目无运行状态文件：${project}` });
    const page = regenPages(root(), flowId, project, kernel.fs, kernel.path, kernel.proc);
    if (!page.ok) recordDiag(kernel, kernel.projectDir(project), "io", "compat:regen-pages", page.log);
    return { ok: page.ok, project, flow: flowId, version, rebound, log: page.log };
  });

  app.post("/api/regen", async (req, reply) => {
    const body = (req.body ?? {}) as Body;
    const project = String(body.project ?? "");
    const flowId = String(body.flowId ?? "");
    if (!project || !flowId) return send(reply, 400, { ok: false, error: "project/flowId 必填" });
    const page = regenPages(root(), flowId, project, kernel.fs, kernel.path, kernel.proc);
    if (!page.ok) recordDiag(kernel, kernel.projectDir(project), "io", "compat:regen-pages", page.log);
    return { ok: page.ok, log: page.log };
  });

  app.post("/api/import-demo", async (req, reply) => {
    const flowId = String(((req.body ?? {}) as Body).flowId ?? "");
    const src = kernel.path.join(root(), "demos", flowId);
    if (!flowId || !kernel.fs.exists(kernel.path.join(src, "项目配置.json"))) {
      return send(reply, 404, { ok: false, error: `暂无 ${flowId} 的官方 Demo` });
    }
    let pid = `demo-${flowId}`;
    for (let n = 1; kernel.fs.exists(kernel.path.join(root(), "projects", pid)); n++) pid = `demo-${flowId}-${n + 1}`;
    const dst = kernel.path.join(root(), "projects", pid);
    try {
      kernel.fs.copy(src, dst, { recursive: true });
      const cfg = kernel.path.join(dst, "项目配置.json");
      const data = JSON.parse(kernel.fs.readText(cfg)) as Record<string, unknown>;
      data["项目"] = pid;
      kernel.fs.writeText(cfg, JSON.stringify(data, null, 2) + "\n");
    } catch (e) {
      recordDiag(kernel, kernel.projectDir(pid), "io", "compat:import-demo", e);
      return send(reply, 500, { ok: false, error: String(e) });
    }
    const page = regenPages(root(), flowId, pid, kernel.fs, kernel.path, kernel.proc);
    if (!page.ok) {
      recordDiag(kernel, kernel.projectDir(pid), "io", "compat:regen-pages", page.log);
      return send(reply, 500, { ok: false, error: `页面生成失败：${page.log}` });
    }
    return { ok: true, project: pid, flow: flowId };
  });

  // 隧道状态：原 serve.py 的 `--tunnel` 能力暂未并入内核面。
  // 这里**显式**返回 inactive 而非 404——页面据此隐藏"外发"入口，不假装有隧道。
  app.get("/_kit/tunnel.json", async () => ({
    active: false,
    url: "",
    error: "内核面暂未内置隧道；如需内网穿透请单独运行 tools/serve.py --tunnel",
  }));
}
