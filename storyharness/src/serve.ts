// 协议面守护进程：生产线直驱（/status /start /stop）＋ agent 会话 API（镜像内核 http.ts 形状
// ——工作台对话页签只切 API 基址即换脑，渲染零改动）。
// B1（2026-09-28）：CORS 从全开收紧为「loopback 源 + serve.allowedOrigins 名单」；有口令即全闸鉴权
// （cookie / Bearer 双通道，未过闸：页面导航 302 到 /login，API 401）；绑定地址由 cfg.serve.hostname
// 决定（缺省 127.0.0.1），非本机绑定却没口令 = 拒起服务。
//   GET  /status                                      生产线盘面
//   POST /start {project?}                            启动批循环（后台）
//   POST /stop                                        下一批边界生效
//   POST /api/login {password}                        B1 · 口令换 cookie（连错 5 次锁 30s）
//   POST /api/logout                                  B1 · 清 cookie
//   GET  /login                                       B1 · 登录页（无口令时整条鉴权链不启用）
//   GET  /api/agent/model                             模型配置（掩码）
//   POST /api/agent/model                             改模型配置（写回 .external/storyharness.json）
//   GET  /api/projects/:id/agent/sessions             会话清单（含 executor 轨迹）
//   POST /api/projects/:id/agent/sessions {title}     新建会话
//   GET  /api/projects/:id/agent/sessions/:sid        会话全文
//   GET  /api/projects/:id/agent/sessions/:sid/stats   B9 · 会话指标（context 占用/本轮+累计 cost/压缩压力）
//   POST /api/projects/:id/agent/sessions/:sid/rename 重命名
//   DELETE /api/projects/:id/agent/sessions/:sid      删除
//   POST /api/projects/:id/agent/sessions/:sid/turn   回合（SSE：delta/tool_call/tool_result/round/done/error）
//   GET  /api/panel/files?project=<id>[&file=<rel>]   官方能力·本地文件：两层树 / 单文件读取（.md/.json/.txt ≤200KB）
//   GET  /api/panel/raw?project=<id>&file=<rel>       官方能力·字节流（图/PDF/音频白名单＋25MB 上限＋Range；files&raw=1 同源）
//   GET  /api/panel/preview?project=<id>&file=<rel>   官方能力·预览判定元数据（kind:inline|text|none|missing ＋ url ＋ note）
//                                                     其余面板端点（worldbook/telemetry/changes/canvas）= 410 退役
//   POST /api/kernel-verb[?trim=1]                    内核动词代理（白名单：flow_init/run/next/effect/kb_search/kb_read/worldbook_search；trim 剥提示词大文本）
import * as http from "node:http";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { Agent } from "@earendil-works/pi-agent-core";
import type { HarnessConfig } from "./config.js";
import type { KernelClient } from "./kernel.js";
import { runFlow, type FlowRunResult } from "./scheduler.js";
import { listChats, createChat, chatTranscript, deleteChat, renameChat, setSessionFlags, forkChat, chatTurn, sessionStats, modelMetaOf } from "./chat.js";
import { saveAttachment, listAttachments } from "./attachments.js";
import { loadPacks, packsBootLog, PackRuntime } from "./packs.js";
import { packGateReport, setPackGate, packAllowed, projectFromRequest, cloneTemplateProject } from "./packgate.js";
import { runWithPack, currentPackCtx } from "./packctx.js";
import { safeProject } from "./safe-project.js";
import { panelFiles, panelRaw, panelPreview } from "./panel-files.js";
import {
  COOKIE_NAME, bearerToken, checkLimit, checkToken, clientKey, clearFails, cookieClear, cookieToken,
  isLoopbackHost, loginPageHtml, makeLimiter, makeToken, passwordMatches, readCookie, recordFail,
  resolveCors, safeNext, viaHttps, wantsHtml,
} from "./auth.js";

export interface ServeState {
  running: boolean;
  /** 实际在跑的项目（/start 时钉下）；未跑过 = undefined，/status 回落 cfg.project 显示。 */
  project?: string;
  startedAt?: string;
  last?: FlowRunResult;
  lastError?: string;
  stopRequested?: boolean;
}

const mask = (k?: string) => (k ? `${k.slice(0, 4)}****${k.slice(-4)}` : null);

/** 本地时间「YYYY-MM-DD HH:MM」——toISOString 是 UTC，直接切会差时区（0928 验收：15:55 实为 23:55）。 */
const localStamp = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().replace("T", " ").slice(0, 16);

// B4 · flow_next ?trim=1 剥离器（前端切割后自 panels.ts 迁入）：递归剥提示词大文本。
// 活内核 v5 任务包的大文本字段是 instruction（实测 13.5KB/节点），历史名 spawnPrompt 两个都剥——
// 剥是减字段不是改名。
function stripPromptFields<T>(o: T): T {
  if (Array.isArray(o)) return o.map(stripPromptFields) as unknown as T;
  if (o && typeof o === "object") {
    const r: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) {
      if (k !== "spawnPrompt" && k !== "instruction") r[k] = stripPromptFields(v);
    }
    return r as unknown as T;
  }
  return o;
}

function readModelFile(cfg: HarnessConfig): Record<string, unknown> {
  try { return JSON.parse(fs.readFileSync(path.join(cfg.workspaceRoot, ".external", "storyharness.json"), "utf-8")); }
  catch { try { return JSON.parse(fs.readFileSync(path.join(cfg.workspaceRoot, ".external", "harness-pi.json"), "utf-8")); } catch { return {}; } }
}

function writeModelFile(cfg: HarnessConfig, patch: Record<string, unknown>): void {
  const dir = path.join(cfg.workspaceRoot, ".external");
  fs.mkdirSync(dir, { recursive: true });
  const next = { ...readModelFile(cfg), ...patch };
  fs.writeFileSync(path.join(dir, "storyharness.json"), JSON.stringify(next, null, 1), "utf-8");
}

export function startServe(kernel: KernelClient, cfg: HarnessConfig, port = 8431, opts: { dry?: boolean; maxBatches?: number } = {}): http.Server {
  const state: ServeState = { running: false };
  const chatAgents = new Map<string, Agent>();
  const busyTurns = new Set<string>();

  // B1 · 鉴权状态（工单 WO-B1）：有口令即启用；secret 由口令派生，token 无状态（HMAC(过期戳)）。
  // 无口令 = 不鉴权，但只允许绑 loopback——非本机绑定没口令直接拒起（fail-closed）。
  const pw = cfg.serve?.password;
  const host = cfg.serve?.hostname ?? "127.0.0.1";
  const auth = {
    enabled: !!pw,
    password: pw ?? "",
    secret: crypto.createHash("sha256").update(`storyharness:${pw ?? ""}`).digest("hex"),
    ttlMs: Math.max(1, cfg.serve?.tokenTtlHours ?? 72) * 3600_000,
    limiter: makeLimiter(),
  };
  if (!auth.enabled && !isLoopbackHost(host)) {
    throw new Error(`fail-closed：协议面要绑 ${host}（非本机）却没有任何口令——设 SH_PASSWORD / 配置 serve.password，或改回 127.0.0.1`);
  }

  // B3 · SSE 订阅者：/events 逐事件推送 runFlow 事件（形状与 headless NDJSON 一致）
  const sseClients = new Set<import("node:http").ServerResponse>();
  const ssePush = (e: Record<string, unknown>) => {
    for (const c of sseClients) { try { c.write(`data: ${JSON.stringify(e)}\n\n`); } catch { /* 断连即弃 */ } }
  };

  // S1 · 扩展点挂载表：启动首请求装载一次（挂载是启动期决定，不做热插拔——S4 口径）。
  // 装载失败不拖垮协议面：逐包错误进 report，随启动日志与 /api/hub.packsReport 回显。
  let runtime: PackRuntime = PackRuntime.EMPTY;
  let runtimeLoading: Promise<void> | null = null;
  const ensureRuntime = () => {
    if (runtime === PackRuntime.EMPTY && !runtimeLoading) {
      runtimeLoading = loadPacks(cfg).then((rt) => {
        runtime = rt;
        // S5 · 项目解析单点：kernel 的项目根从此会回落包内模板，写面经 materialize 首写落地。
        kernel.packDirs = { lookup: (p) => rt.templateProjectDir(p), land: (p) => rt.materialize(cfg, p) };
        for (const line of packsBootLog(rt)) console.error(line);
      }).catch((e) => {
        runtime = PackRuntime.failed(String((e as Error).message));
        console.error(`[storyharness] 包装载整体失败：${(e as Error).message}`);
      });
    }
    return runtimeLoading ?? Promise.resolve();
  };

  const server = http.createServer((req, res) => {
    // B1 · CORS 收紧：`*` → loopback 源（8420/8421 作业台页跨源调用是本仓既有形态）+ serve.allowedOrigins 精确名单。
    // 门面壳与 API 同源（都走本端口），公网站点不需要 CORS，因此默认不放行。
    const allow = resolveCors(req.headers.origin, cfg.serve?.allowedOrigins ?? []);
    if (allow) {
      res.setHeader("Access-Control-Allow-Origin", allow);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    }
    if (req.method === "OPTIONS") {
      res.writeHead(allow ? 204 : 403);
      res.end();
      return;
    }
    const url = (req.url ?? "/").split("?")[0];
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      try {
        await ensureRuntime();   // S1 · 首请求装载挂载表（之后为只读常量，开销＝一次判空）
        // ── B1 · 鉴权闸（口令未设时整段跳过，本机形态零改变）───────────
        if (auth.enabled) {
          const q = new URLSearchParams(req.url?.split("?")[1] ?? "");
          if (url === "/api/login" && req.method === "POST") {
            const key = clientKey(req);
            const gate = checkLimit(auth.limiter, key);
            if (!gate.allowed) {
              res.writeHead(429, { "content-type": "application/json", "retry-after": String(Math.ceil(gate.retryAfterMs / 1000)) });
              res.end(JSON.stringify({ error: "TOO_MANY_ATTEMPTS", retryAfterMs: gate.retryAfterMs }));
              return;
            }
            let given = "";
            try { given = String((body ? JSON.parse(body) as { password?: unknown } : {}).password ?? ""); } catch { given = ""; }
            if (given && passwordMatches(auth.password, given)) {
              clearFails(auth.limiter, key);
              const token = makeToken(auth.secret, auth.ttlMs);
              res.writeHead(200, { "content-type": "application/json", "set-cookie": cookieToken(token, auth.ttlMs, viaHttps(req)) });
              res.end(JSON.stringify({ ok: true, ttlHours: Math.round(auth.ttlMs / 3600_000) }));
              return;
            }
            const st = recordFail(auth.limiter, key);
            res.writeHead(401, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: st.locked ? "TOO_MANY_ATTEMPTS" : "BAD_PASSWORD", ...(st.locked ? { retryAfterMs: st.retryAfterMs } : {}) }));
            return;
          }
          if (url === "/api/logout") {
            res.writeHead(200, { "content-type": "application/json", "set-cookie": cookieClear() });
            res.end(JSON.stringify({ ok: true }));
            return;
          }
          if (url === "/login" && req.method === "GET") {
            res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
            res.end(loginPageHtml(safeNext(q.get("next"))));
            return;
          }
          const token = bearerToken(req) ?? readCookie(req, COOKIE_NAME);
          if (!checkToken(auth.secret, token)) {
            // 浏览器导航（门面壳首屏）跳登录页；API / SSE 给 401 JSON，前端自决提示
            if (wantsHtml(req, url)) {
              res.writeHead(302, { location: `/login?next=${encodeURIComponent(url === "/" ? "/" : url)}`, "cache-control": "no-store" });
              res.end();
              return;
            }
            res.writeHead(401, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: "UNAUTHORIZED", note: "带口令：POST /api/login 换 cookie，或 Authorization: Bearer <token>" }));
            return;
          }
        }

        // ── 协议面落地页（前端已切离本仓，2026-10-02）：不再托任何 UI 壳 ──
        if (url === "/" || url === "/index.html") {
          res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
          res.end(`<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>StoryHarness 协议面</title></head>
<body style="font-family:serif;background:#f5f1e8;color:#2c2824;padding:48px;max-width:640px;margin:0 auto">
<h1 style="letter-spacing:2px">StoryHarness 协议面 ·:${port}</h1>
<p>本仓自 2026-10-02 起不含前端：界面由外部宿主经 adapter 协议与下列 API 接入。</p>
<ul><li>生产线：GET /status ｜ POST /start ｜ POST /stop</li>
<li>agent 会话：/api/projects/:id/agent/sessions（+ /turn SSE）</li>
<li>内核动词：POST /api/kernel-verb ｜ 内核 HTTP 面 :8421 与 MCP 同表</li>
<li>协议细节：adapter/README.md 与 docs/integration/</li></ul>
<p style="color:#8a8375">版本 ${cfg.harnessVersion} ｜ 官方面板在 <a href="http://127.0.0.1:30142/" style="color:#a5433a">:30142</a>（本端口只是协议面）</p></body></html>`);
          return;
        }
        // ── 官方 panel 静态托管：优先 kitapp 的静态导出产物（next build，PAGES_BASE_PATH=/panel），
        //    无产物时回落 panel/ 白名单后缀目录（零构建直出）。/panel/client.mjs 固定别名 →
        //    adapter/storyflow-client.mjs（单一事实源，byte-equal 有测试钉住）。
        if (url === "/panel" || url.startsWith("/panel/") || url.startsWith("/panel?")) {
          const HERE = path.dirname(fileURLToPath(import.meta.url));
          const OUT_DIR = path.join(HERE, "..", "..", "panel", "kitapp", "out");
          const PANEL_DIR = fs.existsSync(path.join(OUT_DIR, "index.html"))
            ? OUT_DIR
            : path.join(HERE, "..", "..", "panel");
          const MIME: Record<string, string> = {
            ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript",
            ".json": "application/json", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
            ".woff2": "font/woff2", ".woff": "font/woff", ".txt": "text/plain; charset=utf-8", ".map": "application/json",
          };
          let rel = decodeURIComponent(url.split("?")[0].slice("/panel/".length)) || "index.html";
          let abs: string;
          if (rel === "client.mjs") {
            abs = path.join(PANEL_DIR, "..", "adapter", "storyflow-client.mjs"); // 固定别名，单一事实源
          } else {
            abs = path.resolve(PANEL_DIR, rel);
            if (!abs.startsWith(path.resolve(PANEL_DIR) + path.sep)) {
              res.writeHead(403, { "content-type": "application/json" });
              res.end(JSON.stringify({ error: "FORBIDDEN", note: "路径越出 panel 目录" }));
              return;
            }
          }
          const mime = MIME[path.extname(abs).toLowerCase()];
          if (!mime) {
            res.writeHead(415, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: "UNSUPPORTED_TYPE", note: "panel 静态面只出白名单后缀" }));
            return;
          }
          try {
            const buf = fs.readFileSync(abs);
            res.writeHead(200, { "content-type": mime, "cache-control": "no-store" });
            res.end(buf);
          } catch {
            res.writeHead(404, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: "NOT_FOUND", note: `panel 下没有 ${rel}` }));
          }
          return;
        }
        // D-E · 新建工作区：注册表（.storyharness.workspaces.json）——门面「＋」创建，hub 读它出分组
        const regFile = path.join(cfg.workspaceRoot, ".storyharness.workspaces.json");
        const readReg = (): { name: string; root: string }[] => {
          try { return JSON.parse(fs.readFileSync(regFile, "utf-8")) as { name: string; root: string }[]; } catch { return []; }
        };
        const listProjectsAt = (root: string, projectsDir: string) => {
          try {
            return fs.readdirSync(path.join(root, projectsDir), { withFileTypes: true })
              .filter((e) => e.isDirectory() && !e.name.startsWith("_") && !e.name.startsWith("."))
              .map((e) => {
                let title = e.name, status = "", done = 0, total = 0;
                try {
                  const st = JSON.parse(fs.readFileSync(path.join(root, projectsDir, e.name, "state.json"), "utf-8"));
                  const nodes = st.nodes ?? {};
                  title = st.title || st.inputs?.direction || e.name;
                  status = st.status ?? "";
                  done = Object.values(nodes).filter((n: any) => n.status === "done").length;
                  total = Object.keys(nodes).length;
                } catch { /* 未开跑：目录名即身份 */ }
                return { id: e.name, title, status, done, total };
              });
          } catch { return []; }
        };
        if (url === "/api/hub") {
          // 工作区清单（.storyharness.json manifest 目录枚举）+ 各区项目清单（含 p-sh 链工作区）
          const wsRoot = cfg.workspaceRoot;
          const hub = {
            workspace: path.basename(wsRoot),
            version: cfg.harnessVersion,
            flows: (() => {
              // 流程清单动态枚举：flows/ 下含 flow.json 的目录即有效流程（不硬编码 id，死 id 下拉 → 502）
              const flowsDir = path.join(wsRoot, "flows");
              let ids: string[] = [];
              try {
                ids = fs.readdirSync(flowsDir).filter((e) => {
                  try { return fs.statSync(path.join(flowsDir, e)).isDirectory() && fs.existsSync(path.join(flowsDir, e, "flow.json")); } catch { return false; }
                }).sort();
              } catch { /* flows/ 不存在＝尚无流程 */ }
              return ids.map((id) => {
                try {
                  const f = JSON.parse(fs.readFileSync(path.join(flowsDir, id, "flow.json"), "utf-8"));
                  return { id, title: f.title ?? id, version: f.version ?? "" };
                } catch { return { id, title: id, version: "" }; }
              });
            }),
            groups: [
              { name: path.basename(wsRoot), projects: listProjectsAt(wsRoot, cfg.corpus.projectsDir) },
              ...readReg().map((w) => ({ name: w.name, projects: listProjectsAt(w.root, "projects") })),
              { name: "content-ops", projects: listProjectsAt(path.dirname(wsRoot), "content-ops/manuscripts") },
            ],
            model: cfg.model,
            thinking: cfg.thinking,
            modelInfo: modelMetaOf(cfg),   // B19 · hub 直接带模型元信息（A20 状态行模型/档位 chip 免二次请求）；model 字符串保留不破旧消费
            // S2 · 首页卡片唯一事实源 = 挂载表（包 manifest 声明 card:true 才出卡，无声明不出）
            pages: runtime.cards(),
            packsReport: { loaded: runtime.loaded.map((p) => ({ name: p.name, version: p.version, routes: p.routes, apis: p.apis, configs: p.configs, defaultEnabled: p.defaultEnabled })), errors: runtime.errors, warnings: runtime.warnings, packsOff: cfg.packsOff ?? [] },
          };
          // 包内模板项目（templates/template-<id> 随包走）：单列一组，不混进语料仓 projects/。
          // `template` 字段＝所在包组标签，前端只读它出「模板」徽标与复制入口（单一字段名，不嗅探组名）。
          // 已落工作区的（S5 首写落地后）不再列进模板组：同一 id 出现在两组＝两套真相，工作区那份才是可写的正档。
          for (const dir of runtime.templateProjectDirs()) {
            const prows = listProjectsAt(dir.root, "")
              .filter((p) => !fs.existsSync(path.join(wsRoot, cfg.corpus.projectsDir, p.id)))
              .map((p) => ({ ...p, template: dir.label }));
            if (prows.length) hub.groups.push({ name: dir.label, projects: prows });
          }
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify(hub));
          return;
        }
        if (url === "/api/workspaces" && req.method === "POST") {
          // D-E · 新建工作区：选一个全新文件夹 → 写 manifest → 注册进侧栏（管理多个项目）
          const b = body ? JSON.parse(body) as { name?: string; path?: string } : {};
          const name = String(b.name ?? "").trim();
          const root = path.resolve(String(b.path ?? "").trim());
          if (!name) { res.writeHead(400, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "name 必填" })); return; }
          if (!/^[A-Za-z]:[\\/]/.test(root)) { res.writeHead(400, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "path 须为绝对路径（如 D:/my-workspace）" })); return; }
          fs.mkdirSync(path.join(root, "projects"), { recursive: true });
          const mf = path.join(root, ".storyharness.json");
          if (!fs.existsSync(mf)) {
            fs.writeFileSync(mf, JSON.stringify({
              $comment: `${name} 工作区（StoryHarness 门面「新建工作区」创建）`,
              corpus: { name, projectsDir: "projects", receiptsDir: "内部/收据", quarantineDir: "内部/backup", sessionsDir: "内部/sessions", telemetryDir: "内部/telemetry" },
            }, null, 1), "utf-8");
          }
          const reg = readReg();
          if (!reg.some((w) => w.name === name)) { reg.push({ name, root }); writeReg(); }
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true, name, root }));
          return;
          function writeReg() { fs.writeFileSync(regFile, JSON.stringify(reg, null, 1), "utf-8"); }
        }
        if (url === "/api/kernel-verb" && req.method === "POST") {
          // 门面壳的内核动词代理（立项/开跑/盘面/生效编排——白名单四个，禁止通配；B4 工单 E-B）
          // ?trim=1（flow_next 专用）：剥提示词大文本（spawnPrompt/instruction），面板盘面用
          const b = body ? JSON.parse(body) as { verb?: string; args?: Record<string, unknown>; location?: string } : {};
          // D-E · 新位置项目：location=自定义文件夹 → junction 挂进本仓 projects/（内核零改动，流程照跑）
          if (b.location) {
            const loc = path.resolve(String(b.location));
            const pid = String(b.args?.project ?? "").trim();
            if (!/^[A-Za-z][A-Za-z0-9_-]{1,39}$/.test(pid)) { res.writeHead(400, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "project id 非法" })); return; }
            if (!fs.existsSync(loc)) { res.writeHead(400, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "位置不存在：" + loc })); return; }
            const target = path.join(kernel.projectDir(pid));
            if (fs.existsSync(target)) { res.writeHead(409, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "projects/ 下已存在同名项目" })); return; }
            const mk = spawnSync("cmd", ["/c", "mklink", "/J", target, loc], { shell: true });
            if (!fs.existsSync(target)) { res.writeHead(500, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "junction 创建失败" + (mk.stderr ? "：" + String(mk.stderr).slice(0, 120) : "") })); return; }
          }
          const allow = new Set(["flow_init", "flow_run", "flow_next", "flow_effect", "kb_search", "kb_read", "worldbook_search"]);
          if (!b.verb || !allow.has(b.verb)) { res.writeHead(400, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "verb 不在白名单" })); return; }
          try {
            let r = await kernel.verb(b.verb, b.args ?? {});
            if (b.verb === "flow_next" && new URLSearchParams(req.url?.split("?")[1] ?? "").get("trim") === "1") r = stripPromptFields(r);
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify(r));
          } catch (e) {
            res.writeHead(502, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: String((e as Error).message).slice(0, 300) }));
          }
          return;
        }
        // ── 生产线 ──────────────────────────────────────────────
        if (url === "/events") {
          // B3 · SSE：runFlow 事件流（batch/node_start/node_end/gate_paused/run_end/final）
          res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
          res.write(": connected\n\n");
          sseClients.add(res);
          // 挂 res 而非 req：无 body 的 GET 上 req 会立刻 close（请求流读完即触发），
          // 导致刚注册就被注销、推送永远落空——正是「订阅了却收不到事件」的真因。
          res.on("close", () => sseClients.delete(res));
          return;
        }
        if (url === "/status") {
          const runProject = state.project ?? cfg.project;
          const next = state.running ? { status: "running（守护进程执行中）" } : await kernel.flowNext(runProject).catch((e) => ({ status: `内核不可达: ${e.message}` }));
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ project: runProject, running: state.running, startedAt: state.startedAt ?? null, last: state.last ?? null, lastError: state.lastError ?? null, flowNext: next }));
          return;
        }
        if (url === "/start" && req.method === "POST") {
          if (state.running) {
            res.writeHead(409, { "content-type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: "批循环已在运行" }));
            return;
          }
          const b = body ? (JSON.parse(body) as { project?: string }) : {};
          const runCfg = b.project ? { ...cfg, project: b.project } : cfg;
          state.project = runCfg.project;
          state.running = true;
          state.startedAt = localStamp();
          state.lastError = undefined;
          state.stopRequested = false;
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true, project: runCfg.project, note: "批循环已启动，/status 轮询进度" }));
          void (async () => {
            const push = (e: Record<string, unknown>) => ssePush(e);
            push({ event: "run_start", project: runCfg.project, ...(opts.dry ? { dry: true } : {}) });
            try {
              state.last = await runFlow(kernel, runCfg, { dry: opts.dry, maxBatches: opts.maxBatches, stopCheck: () => !!state.stopRequested, log: (s) => console.error(`[storyharness] ${s}`), onEvent: push });
              push({ event: "run_end", ok: state.last?.ok ?? false, ...(opts.dry ? { dry: true } : {}), summary: typeof state.last?.stopped === "string" ? state.last.stopped : `${state.last?.ran ?? 0} 节点` });
            } catch (e) {
              state.lastError = (e as Error).message;
              push({ event: "final", project: runCfg.project, ok: false, summary: state.lastError });
            } finally {
              state.running = false;
            }
          })();
          return;
        }
        if (url === "/stop" && req.method === "POST") {
          state.stopRequested = true;
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true, note: "下一批边界生效" }));
          return;
        }
        // ── 模型配置 ────────────────────────────────────────────
        if (url === "/api/agent/model" && req.method === "GET") {
          res.writeHead(200, { "content-type": "application/json" });
          // B9 · 带出窗口与价率（modelInfo）：面板要能区分「价率为 0 = 端点不计费」与「还没有数」
          res.end(JSON.stringify({ configured: !!cfg.apiKey, source: ".external/storyharness.json", baseUrl: cfg.baseUrl ?? null, model: cfg.model, provider: cfg.provider, keyMasked: mask(cfg.apiKey), modelInfo: modelMetaOf(cfg), thinking: cfg.thinking }));
          return;
        }
        if (url === "/api/agent/model" && req.method === "POST") {
          const b = body ? JSON.parse(body) as { provider?: string; model?: string; baseUrl?: string; apiKey?: string } : {};
          if (!b.model) { res.writeHead(400, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "model 必填" })); return; }
          const patch: Record<string, unknown> = { model: b.model };
          if (b.provider) patch.provider = b.provider;
          if (b.baseUrl) patch.baseUrl = b.baseUrl;
          if (b.apiKey) patch.apiKey = b.apiKey;
          writeModelFile(cfg, patch);
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true, note: "已写 .external/storyharness.json——重启 storyharness web/serve 后生效" }));
          return;
        }
        // ── agent 会话 API（镜像内核形状）───────────────────────
        const m = url.match(/^\/api\/projects\/([^/]+)\/agent\/sessions(?:\/([^/]+)(\/rename|\/turn|\/stop|\/pin|\/fork|\/archive|\/stats|\/attachments)?)?$/);
        if (m) {
          const project = decodeURIComponent(m[1]);
          // B1 · 路径边界：projectDir 是纯 join 不设防，%2F 编码的 ../ 在这里就拒（与 panels.ts 共用一把判定）
          if (!safeProject(project)) {
            res.writeHead(400, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: `project 非法（只许单段目录名）：${project}` }));
            return;
          }
          const sid = m[2] ? decodeURIComponent(m[2]) : "";
          const sub = m[3] ?? "";
          const projectDir = kernel.projectDir(project);   // 含包模板回落（S5：模板项目在面侧也「有档」）
          if (!sid && req.method === "POST" && !fs.existsSync(projectDir)) {
            res.writeHead(404, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: "NO_PROJECT" }));
            return;
          }
          if (!sid && req.method === "GET") {
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify(listChats(kernel, project)));
            return;
          }
          if (!sid && req.method === "POST") {
            const b = body ? (JSON.parse(body) as { title?: string }) : {};
            const c = createChat(kernel, project, b.title);   // 先算后写（同族防 ERR_HEADERS_SENT）
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify(c));
            return;
          }
          if (sid && !sub && req.method === "GET") {
            try {
              const t = chatTranscript(kernel, project, sid);   // 先算后写（同 fork：抛错不能再补头）
              res.writeHead(200, { "content-type": "application/json" });
              res.end(JSON.stringify(t));
            } catch (e) {
              res.writeHead(404, { "content-type": "application/json" });
              res.end(JSON.stringify({ error: (e as Error).message }));
            }
            return;
          }
          // B9 · 会话指标：只重放该会话 JSONL 的 usage 行（不读 agent 内存态），面板与磁盘同一份账
          if (sid && sub === "/stats" && req.method === "GET") {
            try {
              const s = sessionStats(kernel, cfg, project, sid); // 先算后写（同上）
              res.writeHead(200, { "content-type": "application/json" });
              res.end(JSON.stringify(s));
            } catch (e) {
              res.writeHead(404, { "content-type": "application/json" });
              res.end(JSON.stringify({ error: (e as Error).message }));
            }
            return;
          }
          if (sid && sub === "/rename" && req.method === "POST") {
            const b = body ? (JSON.parse(body) as { title?: string }) : {};
            try {
              renameChat(kernel, project, sid, b.title || "");
              res.writeHead(200, { "content-type": "application/json" });
              res.end(JSON.stringify({ ok: true }));
            } catch (e) {
              res.writeHead(404, { "content-type": "application/json" });
              res.end(JSON.stringify({ error: (e as Error).message }));
            }
            return;
          }
          if (sid && !sub && req.method === "DELETE") {
            deleteChat(kernel, project, sid);
            chatAgents.delete(`${project}:${sid}`);
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
            return;
          }
          if (sid && sub === "/turn" && req.method === "POST") {
            const turnKey = `${project}:${sid}`;
            if (busyTurns.has(turnKey)) {
              res.writeHead(409, { "content-type": "application/json" });
              res.end(JSON.stringify({ error: "上一回合仍在进行" }));
              return;
            }
            const b = body ? (JSON.parse(body) as { text?: string; mode?: string }) : {};
            const mode = (["plan", "confirm", "auto", "full"].includes(b.mode ?? "") ? b.mode : "full") as "plan" | "confirm" | "auto" | "full";
            const raw = new URLSearchParams(req.url?.split("?")[1] ?? "").get("raw") === "1";
            busyTurns.add(turnKey);
            res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache", connection: "keep-alive" });
            res.write(`data: ${JSON.stringify({ type: "open", sid })}\n\n`);
            try {
              for await (const ev of chatTurn(kernel, cfg, project, sid, b.text || "", chatAgents, mode, { raw })) {
                res.write(`data: ${JSON.stringify(ev)}\n\n`);
              }
            } catch (e) {
              res.write(`data: ${JSON.stringify({ type: "error", message: (e as Error).message })}\n\n`);
            } finally {
              busyTurns.delete(turnKey);
            }
            res.write("data: [DONE]\n\n");
            res.end();
            return;
          }
          if (sid && sub === "/stop" && req.method === "POST") {
            // D-E · 回合终止：abort 正在进行的 pi agent（chatAgents 以 project:sid 持有实例）
            const a = chatAgents.get(`${project}:${sid}`);
            if (a) { try { a.abort(); } catch { /* 已结束 */ } }
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ ok: true, note: a ? "已请求终止" : "该会话无进行中回合" }));
            return;
          }
          // D-E · 会话管理三件套：置顶/归档（位开关）+ 分叉（全文复制新会话）
          if (sid && (sub === "/pin" || sub === "/archive") && req.method === "POST") {
            try {
              const bb = body ? (JSON.parse(body) as { value?: boolean }) : {};
              const patch = sub === "/pin" ? { pinned: bb.value ?? true } : { archived: bb.value ?? true };
              setSessionFlags(kernel, project, sid, patch);
              res.writeHead(200, { "content-type": "application/json" });
              res.end(JSON.stringify({ ok: true, ...patch }));
            } catch (e) {
              res.writeHead(404, { "content-type": "application/json" });
              res.end(JSON.stringify({ error: (e as Error).message }));
            }
            return;
          }
          if (sid && sub === "/fork" && req.method === "POST") {
            try {
              // C6 · body.at = 气泡下标（含）——缺省全文分叉。先算后写：forkChat 的参数错（越界/负数）
              // 要走 4xx，不能在 200 头已发出之后再补头（那会 ERR_HEADERS_SENT 连爆两层杀死进程，0929 实测）。
              const fb = body ? (JSON.parse(body) as { at?: number }) : {};
              const r = forkChat(kernel, project, sid, { at: fb.at });
              res.writeHead(200, { "content-type": "application/json" });
              res.end(JSON.stringify(r));
            } catch (e) {
              const msg = (e as Error).message;
              res.writeHead(/越界|非负整数/.test(msg) ? 400 : 404, { "content-type": "application/json" });
              res.end(JSON.stringify({ error: msg }));
            }
            return;
          }
          // G1 · 会话附件：POST {name, data(base64), mime} → 落 内部/uploads/<sid>/；GET 列在档清单。
          //     base64 走既有 JSON 文本通道（serve 体读只收文本，multipart 解析不在本期）。
          if (sid && sub === "/attachments") {
            try {
              if (req.method === "GET") {
                res.writeHead(200, { "content-type": "application/json" });
                res.end(JSON.stringify({ items: listAttachments(kernel, project, sid) }));
                return;
              }
              if (req.method === "POST") {
                const b = body ? (JSON.parse(body) as { name?: string; data?: string; mime?: string }) : {};
                const meta = saveAttachment(kernel, project, sid, String(b.name || ""), String(b.data || ""), String(b.mime || ""));
                res.writeHead(200, { "content-type": "application/json" });
                res.end(JSON.stringify({ ok: true, ...meta }));
                return;
              }
              res.writeHead(405, { "content-type": "application/json" });
              res.end(JSON.stringify({ error: "附件端点只认 GET（列清单）/ POST（上传）" }));
            } catch (e) {
              res.writeHead(400, { "content-type": "application/json" });
              res.end(JSON.stringify({ error: (e as Error).message }));
            }
            return;
          }
        }
        // ── 官方面板数据接口（工单-20261002 批A）：本地文件能力（files/raw/preview）──
        //    worldbook/telemetry/changes/canvas 维持退役 410（世界书走内核动词 worldbook_search）。
        if (url.startsWith("/api/panel/")) {
          const q = new URLSearchParams(req.url?.split("?")[1] ?? "");
          const project = q.get("project") ?? "";
          const name = url.slice("/api/panel/".length);
          // B13 · raw 二进制预览：白名单内才给字节流，其余状态一律 JSON 说明（前端不许靠空 body 猜）
          //     两种拼法走同一个 panelRaw：/api/panel/raw?file=… 与 /api/panel/files?file=…&raw=1
          //     （一份实现、两个入口，判定不许有两套）
          if (name === "raw" || (name === "files" && q.get("raw") === "1")) {
            const r = panelRaw(kernel, project, q.get("file") ?? "", req.headers.range);
            if (r.stream) {
              res.writeHead(r.status, r.headers);
              r.stream.on("error", () => res.destroy());
              r.stream.pipe(res);
            } else {
              res.writeHead(r.status, { "content-type": "application/json", ...r.headers });
              res.end(JSON.stringify(r.payload));
            }
            return;
          }
          if (name === "preview") {
            const reply = panelPreview(kernel, project, q.get("file") ?? "");
            res.writeHead(reply.status, { "content-type": "application/json" });
            res.end(JSON.stringify(reply.payload));
            return;
          }
          if (name === "files") {
            const reply = panelFiles(kernel, project, q.get("file") ?? "");
            res.writeHead(reply.status, { "content-type": "application/json" });
            res.end(JSON.stringify(reply.payload));
            return;
          }
          // 官方面板桥（工单-20261002 批4）：journal 台账尾部——大事记时间轴数据源。
          // project=_scan_：扫全工作区列出有台账的项目（台账只由 flow_run 产生，
          // 立项未跑的项目永远空态——不扫就永远盯错项目，时间轴看起来像没实现）。
          if (name === "journal") {
            if (project === "_scan_" || project === "") {
              const projectsRoot = path.dirname(kernel.projectDir("_scan_probe"));
              const rows: { id: string; total: number; last: string | null; flowId?: string; flowStatus?: string }[] = [];
              try {
                for (const e of fs.readdirSync(projectsRoot, { withFileTypes: true })) {
                  if (!e.isDirectory()) continue;
                  const jPath = path.join(projectsRoot, e.name, "journal.jsonl");
                  if (!fs.existsSync(jPath)) continue;
                  let total = 0;
                  let last: string | null = null;
                  try {
                    const lines = fs.readFileSync(jPath, "utf-8").split("\n").filter((l) => l.trim());
                    total = lines.length;
                    for (let i = lines.length - 1; i >= 0 && !last; i--) {
                      try { last = (JSON.parse(lines[i]) as { ts?: string }).ts ?? null; } catch { /* 半行跳过 */ }
                    }
                  } catch { /* 读不了 = 0 条 */ }
                  let flowId: string | undefined;
                  let flowStatus: string | undefined;
                  try {
                    const st = JSON.parse(fs.readFileSync(path.join(projectsRoot, e.name, "state.json"), "utf-8")) as { flowId?: string; status?: string };
                    flowId = st.flowId;
                    flowStatus = st.status;
                  } catch { /* 无 state = 已归档或半立项 */ }
                  rows.push({ id: e.name, total, last, flowId, flowStatus });
                }
              } catch (e) {
                res.writeHead(500, { "content-type": "application/json", "cache-control": "no-store" });
                res.end(JSON.stringify({ error: `SCAN_FAILED: ${(e as Error).message}` }));
                return;
              }
              res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
              res.end(JSON.stringify({ projects: rows }));
              return;
            }
            if (!safeProject(project)) {
              res.writeHead(400, { "content-type": "application/json" });
              res.end(JSON.stringify({ error: `project 非法：${project}` }));
              return;
            }
            const limit = Math.min(Math.max(Number(q.get("limit") ?? 200), 1), 1000);
            try {
              const raw = fs.readFileSync(path.join(kernel.projectDir(project), "journal.jsonl"), "utf-8");
              const lines = raw.split("\n").filter((l) => l.trim());
              const tail = lines.slice(-limit).map((l) => {
                try { return JSON.parse(l) as Record<string, unknown>; } catch { return { event: "parse-error", detail: l.slice(0, 120) }; }
              });
              res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
              res.end(JSON.stringify({ project, total: lines.length, entries: tail }));
            } catch {
              res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
              res.end(JSON.stringify({ project, total: 0, entries: [], note: "该项目还没有 journal 台账——启动生产线（flow_run）后生成" }));
            }
            return;
          }
          // 官方面板桥（工单-20261002 深度适配）：工具环注册表——kit/skills.tools.json（40 技能卡）
          // + 内核动词白名单，供面板「工具/技能」页签替换罐头目录。
          if (name === "tools") {
            try {
              const regPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "kit", "skills.tools.json");
              const reg = JSON.parse(fs.readFileSync(regPath, "utf-8")) as {
                count?: number;
                tools?: { tool: string; version: number; title: string; summary: string }[];
              };
              res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
              res.end(JSON.stringify({
                skills: (reg.tools ?? []).map((t) => ({ tool: t.tool, version: t.version, title: t.title, summary: t.summary })),
                verbs: ["flow_init", "flow_run", "flow_next", "flow_effect", "kb_search", "kb_read", "worldbook_search"],
              }));
            } catch (e) {
              res.writeHead(404, { "content-type": "application/json" });
              res.end(JSON.stringify({ error: "NO_REGISTRY", note: `kit/skills.tools.json 不可读：${(e as Error).message}` }));
            }
            return;
          }
          // 世界书 pedia 页（v4 力导向图谱前端复活）：模板 + graph.json 注入，整页 text/html。
          // 用法：/api/panel/worldbook-page?project=<id>（新标签页直接打开，或面板 iframe 内嵌）。
          if (name === "worldbook-page") {
            try {
              const tplPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "tools", "worldbook-template.html");
              const tpl = fs.readFileSync(tplPath, "utf-8");
              const wbDir = path.join(kernel.projectDir(project ?? ""), "世界书");
              const graph = JSON.parse(fs.readFileSync(path.join(wbDir, "graph.json"), "utf-8"));
              const html = tpl
                .split("__TITLE__").join(project ?? "未命名")
                .replace("__WBDATA__", JSON.stringify(graph));
              res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
              res.end(html);
            } catch (e) {
              const msg = String((e as Error).message);
              res.writeHead(msg.includes("ENOENT") ? 404 : 500, { "content-type": "application/json" });
              res.end(JSON.stringify({
                error: msg.includes("ENOENT") ? "NO_WORLDBOOK" : "RENDER_FAILED",
                note: msg.includes("ENOENT")
                  ? "该项目无 世界书/graph.json——python tools/worldbook_index.py --root projects/<id> 重建"
                  : msg,
              }));
            }
            return;
          }
          // 官方面板桥（工单-20261004 工程map）：工作流图示化数据源——
          // 已开跑 = state.json（plan.order + 逐节点状态 + gate）⊕ registry/effective.json（内核编排读模型，页面纯消费）
          //          ⊕ journal（submit 时间戳=走过路径）；未开跑 = flows/<flow>/flow.json 描述符骨架（模块级泳道）。
          // effective.json 缺席时先经内核 flow_effect 物化（读模型落盘是内核单点派生的既定出口），失败则降级 no-meta。
          if (name === "plan") {
            if (!safeProject(project)) {
              res.writeHead(400, { "content-type": "application/json" });
              res.end(JSON.stringify({ error: `project 非法：${project}` }));
              return;
            }
            const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
            const pDir = kernel.projectDir(project);
            let stJson: Record<string, unknown> | null = null;
            try { stJson = JSON.parse(fs.readFileSync(path.join(pDir, "state.json"), "utf-8")) as Record<string, unknown>; } catch { /* 未开跑 */ }
            const flowId = String((stJson?.flowId as string) ?? q.get("flow") ?? "novel");
            // 描述符（仓库根声明面）：模块实例→能力域映射 + 题名/描述（骨架模式的主力，run 模式只取题名）
            let fd: { id?: string; title?: string; desc?: string; version?: string; modules?: { id?: string; module?: string; caps?: string[] }[] } = {};
            try { fd = JSON.parse(fs.readFileSync(path.join(repoRoot, "flows", flowId, "flow.json"), "utf-8")); } catch { /* 描述符缺席不致命 */ }
            const modName = (ref: string): string => {
              try {
                const mj = JSON.parse(fs.readFileSync(path.join(repoRoot, "modules", ref, "module.json"), "utf-8")) as { name?: string; desc?: string };
                return mj.name || ref;
              } catch { return ref; }
            };
            // 能力域 → 泳道题名（如 m1+topic →「选题」）
            const modRefOf = new Map<string, string>((fd.modules ?? []).map((mm) => [String(mm.id ?? ""), String(mm.module ?? "")]));
            // op 题名表：modules/<ref>/module.json 的 ops[k].title/desc（连接门 .link 不在表内，走 humanize）
            const opMeta = (ref: string): Record<string, { title?: string; desc?: string }> => {
              try {
                const mj = JSON.parse(fs.readFileSync(path.join(repoRoot, "modules", ref, "module.json"), "utf-8")) as { ops?: Record<string, { title?: string; desc?: string }> };
                return mj.ops ?? {};
              } catch { return {}; }
            };
            const humanize = (s: string) => (s === "link" ? "连接门" : s.replace(/-/g, " "));
            // journal 走过路径：submit 首次时间 + 次数；verdict 计门裁决
            const walked: Record<string, { at?: string; submits: number; verdicts: number }> = {};
            try {
              for (const l of fs.readFileSync(path.join(pDir, "journal.jsonl"), "utf-8").split("\n")) {
                if (!l.trim()) continue;
                try {
                  const e = JSON.parse(l) as { event?: string; nodeId?: string; ts?: string };
                  if (!e.nodeId) continue;
                  const w = (walked[e.nodeId] ??= { submits: 0, verdicts: 0 });
                  if (e.event === "submit") { w.submits++; w.at ??= e.ts; }
                  if (e.event === "verdict") w.verdicts++;
                } catch { /* 半行跳过 */ }
              }
            } catch { /* 无 journal = 未走到任何节点 */ }
            // effective.json（内核读模型）：有 state 但缺席时经 flow_effect 物化一次
            let eff: { nodes?: Record<string, Record<string, unknown>>; edges?: unknown[]; links?: unknown[]; nodeConfig?: Record<string, Record<string, unknown>> } | null = null;
            const effPath = path.join(pDir, "registry", "effective.json");
            try { eff = JSON.parse(fs.readFileSync(effPath, "utf-8")); } catch {
              if (stJson) {
                try { await kernel.verb("flow_effect", { project }); eff = JSON.parse(fs.readFileSync(effPath, "utf-8")); } catch { /* 内核不可达 → 降级 */ }
              }
            }
            const gate = (stJson?.gate ?? {}) as { verdict?: string; node?: string; at?: string };
            const st = String(stJson?.status ?? "");
            const mine = state.project === project;
            const base = {
              project,
              flow: { id: flowId, title: fd.title ?? flowId, version: fd.version ?? "", desc: fd.desc ?? "" },
              running: Boolean(st === "running" && state.running && mine),
              flowStatus: st,
              startedAt: mine ? state.startedAt ?? null : null,
              lastError: mine ? state.lastError ?? null : null,
              gate: { verdict: gate.verdict ?? "none", node: gate.node ?? null, at: gate.at ?? null },
            };
            if (!stJson) {
              // 骨架模式：模块级泳道（描述符声明面），全 pending——开跑后展开为逐节点地图
              const mods = (fd.modules ?? []).map((mm, i) => ({
                id: String(mm.id ?? `m${i + 1}`), ref: String(mm.module ?? ""),
                name: modName(String(mm.module ?? "")), caps: mm.caps ?? [],
              }));
              res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
              res.end(JSON.stringify({
                ...base, mode: "skeleton", degraded: false,
                modules: mods.map((m) => ({ id: m.id, ref: m.ref, name: m.name })),
                nodes: mods.map((m) => ({
                  id: m.id, module: m.id, op: "", title: m.name,
                  desc: m.caps.length ? m.caps.join(" · ") : "", kind: "module", gateRole: "",
                  status: "none", at: null,
                })),
                edges: mods.slice(1).map((m, i) => ({ from: mods[i].id, to: m.id, kind: "chain" })),
                stats: { total: mods.length, done: 0, awaiting: 0 },
              }));
              return;
            }
            // run 模式：plan.order 是执行序真链；effective 补 kind/gateRole/output 元数据
            const order = ((stJson?.plan as { order?: string[] } | undefined)?.order ?? []) as string[];
            const nodesState = (stJson?.nodes ?? {}) as Record<string, { status?: string; round?: number; failCount?: number }>;
            const effNodes = eff?.nodes ?? {};
            const effCfg = eff?.nodeConfig ?? {};
            const seenModule = new Set<string>();
            const modules: { id: string; ref: string; name: string }[] = [];
            const nodes = order.map((id) => {
              const dot = id.indexOf(".");
              const mi = dot > 0 ? id.slice(0, dot) : id;
              const op = dot > 0 ? id.slice(dot + 1) : "";
              const ref = modRefOf.get(mi) ?? "";
              if (!seenModule.has(mi)) { seenModule.add(mi); modules.push({ id: mi, ref, name: ref ? modName(ref) : mi }); }
              const en = effNodes[id] ?? {};
              const ec = effCfg[id] ?? {};
              const meta = ref ? opMeta(ref)[op] : undefined;
              const ns = nodesState[id] ?? {};
              const w = walked[id] ?? { submits: 0, verdicts: 0 };
              return {
                id, module: mi, op,
                title: (meta?.title && meta.title !== op ? meta.title : "") || humanize(op),
                desc: meta?.desc ? meta.desc.slice(0, 90) : "",
                kind: String(en.kind ?? "agent"),
                gateRole: String(ec.gateRole ?? en.gate_role ?? ""),
                output: String(ec.output ?? ""),
                status: String(ns.status ?? "none"),
                round: Number(ns.round ?? 0), failCount: Number((ns as { failCount?: number }).failCount ?? 0),
                at: w.at ?? null, submits: w.submits, verdicts: w.verdicts,
              };
            });
            // 边：effective 原生边优先（带 link 语义），plan 链补缺（kind=chain）
            const edgeKey = (a: string, b: string) => `${a}\u0000${b}`;
            const edges: { from: string; to: string; kind: string }[] = [];
            const push = (from: string, to: string, kind: string) => {
              if (from && to && !edges.some((e) => edgeKey(e.from, e.to) === edgeKey(from, to))) edges.push({ from, to, kind });
            };
            const rawEdges = (eff?.links ?? eff?.edges ?? []) as unknown[];
            for (const re of rawEdges) {
              if (Array.isArray(re) && re.length >= 2) push(String(re[0]), String(re[1]), "auto");
              else if (re && typeof re === "object") {
                const o = re as Record<string, unknown>;
                push(String(o.from ?? o.source ?? ""), String(o.to ?? o.target ?? ""), String(o.link ?? o.kind ?? "auto"));
              }
            }
            for (let i = 1; i < order.length; i++) push(order[i - 1], order[i], "chain");
            res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
            res.end(JSON.stringify({
              ...base, mode: "run", degraded: !eff,
              modules, nodes, edges,
              stats: {
                total: nodes.length,
                done: nodes.filter((n) => n.status === "done").length,
                awaiting: nodes.filter((n) => n.status === "awaiting").length,
              },
            }));
            return;
          }
          // 官方面板桥（工单-20261005 卡片商店）：知识库全量目录——
          // 声明面静态读取（repoRoot/knowledge/**/*.md frontmatter），与 flow.json 同性质的展示数据；
          // 摘要 = 正文首个有效段（剥标题/引用/表格线），≤90 字。卡片商店与侧栏域列表共用。
          if (name === "kb-catalog") {
            const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
            const kbDir = path.join(repoRoot, "knowledge");
            const KB_DOMAINS: Record<string, { name: string; desc: string }> = {
              aesthetic: { name: "审美标尺", desc: "什么叫好：维度、条款、阈值" },
              structure: { name: "叙事结构", desc: "结构选型目录与骨架" },
              craft: { name: "成文工艺", desc: "六维约束路由：写前看什么、盖章查什么" },
              market: { name: "市场盘面", desc: "市场快照与网感公式" },
              formats: { name: "形态标准", desc: "载体形态约束（长篇网文等）" },
              method: { name: "方法论", desc: "长篇工程方法" },
              trope: { name: "梗族", desc: "梗机制 + 饱和度 + 演化链" },
              benchmark: { name: "对标件", desc: "强度标尺（AI 评分 + 热度）" },
              rules: { name: "规则语料", desc: "agent 可激活条款集（是语料不是闸）" },
              continuity: { name: "连续性", desc: "长程连续性与状态台账" },
              deconstruct: { name: "拆解协议", desc: "参考作品怎么拆成可入库素材" },
              "semif-calibration": { name: "semif 校准", desc: "机器类验收校准包" },
            };
            const KB_TYPES: Record<string, string> = {
              "aesthetic-standard": "审美判定标准",
              "style-route": "风格路线档位",
              "rule-corpus": "规则语料卡",
              "market-snapshot": "市场快照",
              "market-standard": "网感公式标准",
              "deconstruct-protocol": "拆解协议",
              "continuity-standard": "连续性标准",
              "format-standard": "形态标准",
              "structure-catalog": "结构选型目录",
              "meme-standard": "梗密度约束",
              "trope": "梗条目",
              "benchmark": "对标件",
              "craft-standard": "成文工艺标准",
            };
            const cards: Record<string, unknown>[] = [];
            const counts: Record<string, number> = {};
            try {
              for (const domain of fs.readdirSync(kbDir).sort()) {
                const dDir = path.join(kbDir, domain);
                if (!fs.statSync(dDir).isDirectory()) continue;
                for (const f of fs.readdirSync(dDir).sort()) {
                  if (!f.endsWith(".md") || f.startsWith("README")) continue;
                  let raw = "";
                  try { raw = fs.readFileSync(path.join(dDir, f), "utf-8"); } catch { continue; }
                  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
                  let fm: Record<string, unknown> = {};
                  if (m) { try { fm = JSON.parse(m[1]) as Record<string, unknown>; } catch { /* frontmatter 非法 → 空对象，落文件名兜底 */ } }
                  // 摘要：正文剥 frontmatter 后，跳过标题/引用/表格/横线，取首个有效段
                  const bodyLines = (m ? raw.slice(m[0].length + "---".length) : raw).split(/\r?\n/);
                  let summary = "";
                  for (const l of bodyLines) {
                    const t = l.trim();
                    if (!t || t.startsWith("#") || t.startsWith(">") || t.startsWith("|") || t.startsWith("---") || t.startsWith("![") || t === "***") continue;
                    summary = t.replace(/\*\*/g, "").replace(/`/g, "");
                    break;
                  }
                  const key = String(fm.id ?? `kb/${domain}/${f.replace(/\.md$/, "")}`);
                  counts[domain] = (counts[domain] ?? 0) + 1;
                  cards.push({
                    id: key,
                    domain,
                    file: `${domain}/${f}`,
                    title: String(fm.title ?? f.replace(/\.md$/, "")),
                    type: String(fm.type ?? ""),
                    typeName: KB_TYPES[String(fm.type ?? "")] ?? String(fm.type ?? ""),
                    status: String(fm.status ?? ""),
                    version: String(fm.version ?? ""),
                    updated: String(fm.updated ?? ""),
                    summary: summary.slice(0, 90),
                  });
                }
              }
            } catch (e) {
              res.writeHead(500, { "content-type": "application/json" });
              res.end(JSON.stringify({ error: `KB_CATALOG_FAILED: ${(e as Error).message}` }));
              return;
            }
            const domains = Object.keys(KB_DOMAINS).filter((k) => counts[k]).map((k) => ({ key: k, ...KB_DOMAINS[k], count: counts[k] }));
            // 盘上存在但映射表没收录的域也带上（不静默吞）
            for (const k of Object.keys(counts)) if (!KB_DOMAINS[k]) domains.push({ key: k, name: k, desc: "（未收录域名映射）", count: counts[k] });
            res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
            res.end(JSON.stringify({ domains, cards, total: cards.length }));
            return;
          }
          res.writeHead(410, { "content-type": "application/json", "cache-control": "no-store" });
          res.end(JSON.stringify({
            error: "GONE",
            code: "RETIRED_FACE",
            retired: name,
            note: "该面板端点已退役（worldbook/telemetry/changes/canvas）；文件能力走 files/raw/preview，世界书/RAG 走 /api/kernel-verb 的 worldbook_search、kb_search、kb_read",
          }));
          return;
        }
        // ── S4 · 扩展包启停面（GET=逐包三态门禁报告，POST=写项目表态进 项目配置.json）────
        if (url === "/api/packs" || url.startsWith("/api/packs?")) {
          const qq = new URLSearchParams(req.url?.split("?")[1] ?? "");
          try {
            if (req.method === "GET") {
              const p = qq.get("project") ?? "";
              if (!p) { res.writeHead(400, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "project 必填（?project=<id>）" })); return; }
              const reply = packGateReport(cfg, runtime, p);
              res.writeHead(200, { "content-type": "application/json" });
              res.end(JSON.stringify({ ...reply, harnessVersion: cfg.harnessVersion, packsOff: cfg.packsOff ?? [] }));
              return;
            }
            if (req.method === "POST") {
              const b = body ? JSON.parse(body) as { project?: string; pack?: string; enabled?: unknown } : {};
              const p = String(b.project ?? qq.get("project") ?? "");
              if (!p) { res.writeHead(400, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "project 必填" })); return; }
              if (!b.pack) { res.writeHead(400, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "pack 必填" })); return; }
              const item = setPackGate(cfg, runtime, p, String(b.pack), b.enabled !== false);
              res.writeHead(200, { "content-type": "application/json" });
              res.end(JSON.stringify({ ok: true, item, report: packGateReport(cfg, runtime, p) }));
              return;
            }
            res.writeHead(405, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: "扩展包面只认 GET（门禁报告）/ POST（写表态）" }));
          } catch (e) {
            res.writeHead(400, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: (e as Error).message }));
          }
          return;
        }
        // S5 · 模板落地：把包内模板项目复制成工作区项目（可换名）。已存在则拒，绝不覆盖用户数据。
        if (url === "/api/packs/clone" && req.method === "POST") {
          try {
            const b = body ? JSON.parse(body) as { project?: string; to?: string } : {};
            // 先算后写（同会话面口径）：复制失败要在 400 里给文案，头先发出去就只剩「200 空响应」（0929 冒烟实测）
            const reply = cloneTemplateProject(cfg, runtime, String(b.project ?? ""), b.to ? String(b.to) : undefined);
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify(reply));
          } catch (e) {
            res.writeHead(400, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: (e as Error).message }));
          }
          return;
        }
        // ── S1 · 扩展点挂载表（语料包 pages/apis；deduce 包已整体挪出至 D:\storyflow-deduce，挂载机制保留）────────
        // 鉴权闸在上方已跑过——包路由与核心面同闸，包不许绕闸。
        // runWithPack 绑定注入面（cfg/runtime/packCfg），包代码经 currentPackCtx() 取用。
        {
          const fullUrl = req.url ?? "/";
          const page = runtime.matchPage(url);
          if (page) {
            const html = await runWithPack(
              { pack: page.pack, cfg, runtime, packCfg: (cfg.extensions?.[page.pack] as Record<string, unknown>) ?? {}, stripPrefix: () => "" },
              async () => page.render(currentPackCtx(), req),
            );
            res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
            res.end(html);
            return;
          }
          const hit = runtime.matchApi(url);
          if (hit) {
            // S4 · 项目级门禁：包照常挂载，数据面按项目放行/拒绝（改开关即生效，不重启）。
            // 判不出项目时底座不代答——交回包自己的参数校验（deduce 会报「project 必填」），
            // 免得同一件事两套话术；未来带 project-less 端点的包也不被底座拦死。
            const gp = projectFromRequest(fullUrl, req.method ?? "GET", body);
            if (gp && !packAllowed(cfg, runtime, gp, hit.mount.pack).enabled) {
              res.writeHead(403, { "content-type": "application/json" });
              res.end(JSON.stringify({
                error: "PACK_DISABLED", pack: hit.mount.pack, project: gp,
                note: `包「${hit.mount.pack}」在项目「${gp}」未启用：设置 · 扩展包 里打开（或改语料 manifest runtime.packsOff 做工作区级停用，那要重启 serve）`,
              }));
              return;
            }
            await runWithPack(
              { pack: hit.mount.pack, cfg, runtime, packCfg: (cfg.extensions?.[hit.mount.pack] as Record<string, unknown>) ?? {}, stripPrefix: (u: string) => u.slice(hit.prefixLen) },
              async () => hit.mount.handle(currentPackCtx(), res, fullUrl, req.method ?? "GET", body, hit.prefixLen),
            );
            return;
          }
        }
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "NOT_FOUND" }));
      } catch (e) {
        // 双保险：任何分支在头已发出后再抛（先写 200 后算账的旧写法/流中途错），收口连接即可——
        // 再 writeHead 会 ERR_HEADERS_SENT 直接杀死进程（0929 fork?at 越界实测）。
        if (res.headersSent) {
          console.error(`[storyharness] ${req.method} ${url} 处理出错（头已发出，连接收口）:`, (e as Error).message);
          try { res.end(); } catch { /* 连接已断 */ }
          return;
        }
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: (e as Error).message }));
      }
    });
  });
  ensureRuntime().then(() => {
    console.error(`[storyharness] 扩展包：${runtime.loaded.map((p) => `${p.name}${p.version ? "@" + p.version : ""}`).join(", ") || "无（底座裸面）"}${runtime.errors.length ? ` · 拒挂 ${runtime.errors.length} 个（见 /api/hub.packsReport）` : ""}`);
  });
  server.listen(port, host, () => {
    const face = auth.enabled
      ? `鉴权已启用（口令来源 ${cfg.serve?.passwordSource ?? "?"}${cfg.serve?.passwordSource === "generated" ? `，已写 ${cfg.serve.credentialsFile}` : ""}）`
      : "鉴权未启用（仅本机可访问；对外绑定请设 SH_PASSWORD）";
    console.error(`[storyharness] 协议面 http://${host}:${port}（/status /start /stop + /api/projects/*/agent/*）· ${face}`);
  });
  return server;
}
