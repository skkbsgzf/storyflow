// B组 · 面板数据接口（工单 E-B 2026-09-27）：8431 同源只读代理——世界书/文件/遥测三面板的数据后端。
// 数据源 = 项目目录盘上文件 + 内核 8421；编排事实单源在内核（R5），本文件只做只读代理与白名单，不做新逻辑。
// 契约为跨组钉死件（E-A 门面按此形状开发）：字段不得增删改名，改形状先改工单。
// B13（波9 追加 · 2026-09-28）：新增 raw / preview 两个只读端点。B1/B2/B3 既有形状一字未改（additive），
// 跨组形状见 docs/交接回执-B组波12(B13二进制预览)-20260928.md。
// B12（波9 追加 · 2026-09-28）：新增 changes 端点（右栏「变更」页签）——快照轮次索引 + 产物 unified diff，
// diff 算法 = src/udiff.ts（tools/snapshot.py 的 difflib 口径逐字节复刻），形状见
// docs/交接回执-B组波13(B12变更diff)-20260928.md。
import * as fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { diffText } from "./udiff.js";
import type { KernelClient } from "./kernel.js";

// 与 src/tools.ts buildTools 的 fs_tree 同语义（IGNORE + 两层深度）；withinProject 因 tools.ts
// 未导出该内部函数，按同款越界拒绝语义等价实现（工单授权：「抽出复用或等价实现」）。
const IGNORE = new Set(["node_modules", ".git", "snapshots"]);
const READ_SUFFIX = new Set([".md", ".json", ".txt"]);
const READ_CAP = 200_000; // B2 单文件读取上限（字符），超出截断并附全长标注

// B13 · 可内嵌预览的后缀→MIME 白名单。只收浏览器能直接渲染的图/PDF/音频；
// svg 单列（同源内联有脚本执行面，raw 路由对它附 CSP 沙箱头）。
const RAW_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.ico': 'image/vnd.microsoft.icon',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
};
const RAW_CAP = 25_000_000; // B13 单文件上限（字节）：超限 413 显式报数，不静默截断、不给空 body
const TELEMETRY_CAP = 50; // B3 遥测清单上限（mtime 倒序取前 50）

export interface PanelReply {
  status: number;
  payload: unknown;
}

/** project id 只许单段目录名——kernel.projectDir 是纯 join 不设防，../ 形态在这里堵下。
 *  B1 起 serve.ts 的会话 API 也共用本判定（同一把钥匙，禁止两处各写一份越界规则）。 */
export function safeProject(project: string): string | null {
  return project && !/[/\\]/.test(project) && !project.includes("..") ? project : null;
}

/** 项目内相对路径解析，越界拒绝（与 tools.ts withinProject 同款语义）。 */
function withinProject(kernel: KernelClient, project: string, rel: string): string {
  const root = path.resolve(kernel.projectDir(project));
  const abs = path.resolve(root, rel);
  if (!abs.startsWith(root + path.sep) && abs !== root) throw new Error(`路径越出项目：${rel}`);
  return abs;
}

/** B1 · 世界书：读 <projectDir>/世界书/graph.json（内核 worldbook_index 落盘件，只读不重建），
 *  graph 原样透传 + {project} 包裹；无 graph.json（含项目不存在）→ 空态，不 500。 */
export function panelWorldbook(kernel: KernelClient, project: string): PanelReply {
  const id = safeProject(project);
  if (!id) return { status: 400, payload: { error: `project 非法：${project}` } };
  let graph: Record<string, unknown> | null = null;
  try {
    graph = JSON.parse(fs.readFileSync(path.join(kernel.projectDir(id), "世界书", "graph.json"), "utf-8")) as Record<string, unknown>;
  } catch { /* 无落盘件：空态（归纳归内核 worldbook_index） */ }
  const body = graph ?? { entries: [], relations: [], stats: {} };
  return { status: 200, payload: { project: id, ...body } };
}

/** B2 · 文件：无 file → 两层文件树（fs_tree 语义）每项 {path,sizeKB,mtime}；
 *  有 file → 读单文件（≤200KB，.md/.json/.txt 白名单，越界 403）。 */
export function panelFiles(kernel: KernelClient, project: string, file: string): PanelReply {
  const id = safeProject(project);
  if (!id) return { status: 400, payload: { error: `project 非法：${project}` } };
  const dir = kernel.projectDir(id);
  if (file) {
    if (!READ_SUFFIX.has(path.extname(file).toLowerCase())) {
      return { status: 400, payload: { error: `后缀不在白名单（.md/.json/.txt）：${file}` } };
    }
    let abs: string;
    try {
      abs = withinProject(kernel, id, file);
    } catch (e) {
      return { status: 403, payload: { error: (e as Error).message } };
    }
    let content: string;
    try {
      content = fs.readFileSync(abs, "utf-8");
    } catch {
      return { status: 404, payload: { error: `文件不存在：${file}` } };
    }
    if (content.length > READ_CAP) content = content.slice(0, READ_CAP) + `\n…(截断，全长 ${content.length} 字符)`;
    return { status: 200, payload: { path: file, content } };
  }
  const files: { path: string; sizeKB: number; mtime: string }[] = [];
  if (fs.existsSync(dir)) {
    const walk = (d: string, depth: number) => {
      if (depth > 2) return;
      let items: fs.Dirent[];
      try {
        items = fs.readdirSync(d, { withFileTypes: true });
      } catch { return; }
      for (const it of items.sort((a, b) => a.name.localeCompare(b.name))) {
        if (IGNORE.has(it.name) || it.name.startsWith(".")) continue;
        const abs = path.join(d, it.name);
        if (it.isDirectory()) walk(abs, depth + 1);
        else if (it.isFile()) {
          const st = fs.statSync(abs);
          files.push({
            path: path.relative(dir, abs).split(path.sep).join("/"),
            sizeKB: Math.round(st.size / 1024),
            mtime: st.mtime.toISOString(),
          });
        }
      }
    };
    walk(dir, 0);
  }
  return { status: 200, payload: { files } };
}

/** B3 · 遥测：列 <projectDir>/<corpus.telemetryDir>/run-*.json（mtime 倒序，≤50）。
 *  summary 取自 sh-run-telemetry@1 顶层字段；ran = totals.nodes（遥测文件无独立 ran 字段，
 *  逐节点明细走 latest.nodes 原样）。无 telemetry → {runs:[],latest:null}。 */
export function panelTelemetry(kernel: KernelClient, project: string): PanelReply {
  const id = safeProject(project);
  if (!id) return { status: 400, payload: { error: `project 非法：${project}` } };
  const tdir = path.join(kernel.projectDir(id), kernel.corpus.telemetryDir);
  let names: string[] = [];
  try {
    names = fs.readdirSync(tdir).filter((f) => /^run-.*\.json$/.test(f));
  } catch { /* 无 telemetry 目录：空态 */ }
  const newest = names
    .map((f) => ({ f, m: fs.statSync(path.join(tdir, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m)
    .slice(0, TELEMETRY_CAP);
  const runs = newest.map(({ f }) => {
    let t: Record<string, any> = {};
    try {
      t = JSON.parse(fs.readFileSync(path.join(tdir, f), "utf-8")) as Record<string, any>;
    } catch { /* 坏文件按空算，不 500 */ }
    return {
      file: f,
      summary: {
        wallMs: t.wallMs ?? null,
        ok: t.ok ?? null,
        batches: t.batches ?? null,
        ran: t.totals?.nodes ?? (Array.isArray(t.nodes) ? t.nodes.length : null),
        totals: t.totals ?? null,
      },
    };
  });
  let latest: unknown = null;
  if (newest.length) {
    try {
      latest = JSON.parse(fs.readFileSync(path.join(tdir, newest[0].f), "utf-8"));
    } catch { latest = null; }
  }
  return { status: 200, payload: { runs, latest } };
}

/** B5 · 画布同源代理：把 <projectDir>/workflow.html 以 text/html 同源供出。跨源 iframe 里
 *  第三方存储被拒会让作业台初始化崩成白屏（实测 8421 页面跨源嵌入白屏、单开正常）；同源化后
 *  localStorage 落在门面自身 origin。作业台页的 API 基址是页面内烘焙的绝对 URL（DATA.agentApi），
 *  且 8421/8431 CORS 全开，代理不改变其行为。 */
export function panelCanvas(kernel: KernelClient, project: string): { status: number; html: string; error?: string } {
  const id = safeProject(project);
  if (!id) return { status: 400, html: "", error: `project 非法：${project}` };
  let html: string;
  try {
    html = fs.readFileSync(path.join(kernel.projectDir(id), "workflow.html"), "utf-8");
  } catch {
    return { status: 404, html: "", error: "该项目没有 workflow.html（静态画布快照由内核生成）" };
  }
  return { status: 200, html };
}

/** B4 · flow_next ?trim=1 剥离器：递归剥提示词大文本。工单写 spawnPrompt（kernel.ts 类型声明的
 *  历史名）；活内核 v5 任务包的大文本字段是 instruction（实测 13.5KB/节点），两个都剥——
 *  盘面视图不带巨串，剥是减字段不是改名。 */
export function stripPromptFields<T>(o: T): T {
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

// ── B13 · 二进制预览：raw 字节流 + preview 元数据 ──────────────────

export interface RawReply {
  status: number;
  headers: Record<string, string>;
  stream?: fs.ReadStream;
  payload?: unknown;
}

const json400 = (msg: string): RawReply => ({ status: 400, headers: {}, payload: { error: msg } });

function rawUrl(project: string, file: string): string {
  return `/api/panel/raw?project=${encodeURIComponent(project)}&file=${encodeURIComponent(file)}`;
}

/** B13 · raw：项目内二进制只读供出（<img>/<iframe>/<audio> 直接吃这个 URL）。
 *  判定顺序：project 非法 400 → file 缺失 400 → 路径越界 403 → 后缀不在白名单 415 →
 *  文件不存在/非普通文件 404 → 超上限 413 → Range 非法 416 → 200/206 带流。
 *  越界判定在白名单之前：项目外的路径不配告诉调用者「它的后缀行不行」（信息泄漏面收窄）。
 *  每一步都回 JSON 说明（code 字段可枚举），前端不许靠空 body 猜。 */
export function panelRaw(kernel: KernelClient, project: string, file: string, rangeHeader?: string): RawReply {
  const id = safeProject(project);
  if (!id) return json400(`project 非法：${project}`);
  if (!file) return json400('file 必填');
  let abs: string;
  try {
    abs = withinProject(kernel, id, file);
  } catch (e) {
    return { status: 403, headers: {}, payload: { error: (e as Error).message, code: 'OUT_OF_PROJECT' } };
  }
  const ext = path.extname(file).toLowerCase();
  const mime = RAW_MIME[ext];
  if (!mime) {
    return {
      status: 415,
      headers: {},
      payload: {
        error: `后缀不在预览白名单：${ext || file}`,
        code: 'UNSUPPORTED_TYPE',
        allowed: Object.keys(RAW_MIME),
        note: '白名单外的文件类型本底座不供字节流；.docx/.xlsx 请看它的 md 导出（tools/export-doc.py）',
      },
    };
  }
  let st: fs.Stats;
  try {
    st = fs.statSync(abs);
  } catch {
    return { status: 404, headers: {}, payload: { error: `文件不存在：${file}`, code: 'NOT_FOUND' } };
  }
  if (!st.isFile()) {
    return { status: 404, headers: {}, payload: { error: `不是普通文件：${file}`, code: 'NOT_A_FILE' } };
  }
  if (st.size > RAW_CAP) {
    return {
      status: 413,
      headers: {},
      payload: { error: `文件超出预览上限：${st.size} > ${RAW_CAP} 字节`, code: 'TOO_LARGE', size: st.size, limit: RAW_CAP },
    };
  }
  const headers: Record<string, string> = {
    'content-type': mime,
    'content-length': String(st.size),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(path.basename(abs))}`,
    'accept-ranges': 'bytes',
  };
  // svg 同源内联 = 该源上的脚本面：给它 CSP 沙箱（不拦合法图片显示，只掐联网与顶层导航）
  if (mime === 'image/svg+xml') headers['content-security-policy'] = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
  const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader ?? '');
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : 0;
    let end = m[1] && m[2] ? Math.min(Number(m[2]), st.size - 1) : st.size - 1;
    if (!m[1] && m[2]) { // bytes=-N：取尾 N 字节
      start = Math.max(0, st.size - Number(m[2]));
      end = st.size - 1;
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= st.size) {
      return {
        status: 416,
        headers: { 'content-range': `bytes */${st.size}` },
        payload: { error: `Range 不可满足：${rangeHeader}`, code: 'BAD_RANGE', size: st.size },
      };
    }
    return {
      status: 206,
      headers: { ...headers, 'content-length': String(end - start + 1), 'content-range': `bytes ${start}-${end}/${st.size}` },
      stream: fs.createReadStream(abs, { start, end }),
    };
  }
  return { status: 200, headers, stream: fs.createReadStream(abs) };
}

/** B13 · preview：给 A8 渲染层的判定元数据（一条请求说清「能不能内嵌、URL 是啥、不能的话为什么」）。
 *  一律 200（除 project/file 非法与越界 403），kind 上带显式档位，UI 按 kind 分支不靠 catch 空白。 */
export function panelPreview(kernel: KernelClient, project: string, file: string): PanelReply {
  const id = safeProject(project);
  if (!id) return { status: 400, payload: { error: `project 非法：${project}` } };
  if (!file) return { status: 400, payload: { error: 'file 必填' } };
  const meta = { path: file, name: path.basename(file), ext: path.extname(file).toLowerCase() };
  let abs: string;
  try {
    abs = withinProject(kernel, id, file);
  } catch (e) {
    return { status: 403, payload: { ...meta, error: (e as Error).message, code: 'OUT_OF_PROJECT' } };
  }
  let st: fs.Stats | null = null;
  try {
    st = fs.statSync(abs);
  } catch {
    return { status: 200, payload: { ...meta, kind: 'missing', size: 0, sizeKB: 0, mtime: null, mime: null, url: null, note: '文件不存在（可能已被改名或删掉，刷新文件树看看）' } };
  }
  const size = st!.isFile() ? st!.size : 0;
  const base = { ...meta, size, sizeKB: Math.round(size / 1024), mtime: st!.isFile() ? st!.mtime.toISOString() : null };
  if (!st!.isFile()) return { status: 200, payload: { ...base, kind: 'none', mime: null, url: null, note: '这不是普通文件（目录或链接），本底座不供预览' } };
  const ext = base.ext;
  const mime = RAW_MIME[ext];
  if (mime) {
    if (size > RAW_CAP) {
      return { status: 200, payload: { ...base, kind: 'none', mime, url: null, note: `超出预览上限（${size} > ${RAW_CAP} 字节），本底座不内嵌这种大块头` } };
    }
    return { status: 200, payload: { ...base, kind: 'inline', mime, url: rawUrl(id, file), note: '' } };
  }
  if (READ_SUFFIX.has(ext)) {
    return { status: 200, payload: { ...base, kind: 'text', mime: 'text/plain', url: `/api/panel/files?project=${encodeURIComponent(id)}&file=${encodeURIComponent(file)}`, note: '文本走 B2 读取（≤200KB 截断）' } };
  }
  return { status: 200, payload: { ...base, kind: 'none', mime: null, url: null, note: `${ext ? '.' + ext.slice(1) : '（无后缀）'} 这类文件不能直接看；docx 请看 tools/export-doc.py 的 md/docx 导出件` } };
}

// ── B12 · 变更页签：快照轮次索引 + 产物 unified diff ──────────────────
//
// 数据事实源 = 项目目录 snapshots/index.json（tools/snapshot.py capture 落的账）＋ 快照正文
// snapshots/<node>/r<N>/<保存名>。本端点只读不改这份账，也不新建第二种变更账：
// 「哪些文件在哪个轮次长什么样」问 index.json，「这两版差在哪行」问 udiff.ts（= difflib 口径复刻），
// 于是面板看到的 diff 与 `python tools/snapshot.py diff <project> <node> --a N --b M` 同一份字节
// （逐文件正文；唯一有意差异是头两行的标签——见 panelChangesDiff 注释与验收收据）。

/** 单侧文本超过它就明说「这块头不硬算」：SequenceMatcher 是平方级，服务端不能被一次请求钉死。 */
const DIFF_CAP = 400_000;

interface SnapFileMeta { hash?: string | null; path?: string | null; binary?: boolean }
interface SnapRoundEntry { round: number; ts?: string; note?: string; files?: Record<string, SnapFileMeta> }

/** snapshots/index.json → {node: 轮次条目[]}；文件缺失/坏 JSON/结构不符都回 null（调用方出显式空态）。 */
function loadSnapshotIndex(dir: string): Record<string, SnapRoundEntry[]> | null {
  let raw: string;
  try {
    raw = fs.readFileSync(path.join(dir, "snapshots", "index.json"), "utf-8");
  } catch {
    return null;
  }
  try {
    const idx = JSON.parse(raw) as { snapshots?: Record<string, SnapRoundEntry[]> };
    if (!idx || typeof idx !== "object" || !idx.snapshots || typeof idx.snapshots !== "object") return null;
    const out: Record<string, SnapRoundEntry[]> = {};
    for (const [node, rounds] of Object.entries(idx.snapshots)) {
      if (Array.isArray(rounds)) out[node] = rounds.filter((r) => r && typeof r.round === "number");
    }
    return out;
  } catch {
    return null;
  }
}

/** 与 snapshot.py sha1(text)/sha1_bytes 同口径：文本按原字节哈希（capture 用 decode 不改字节），取 12 位。 */
function sha1_12(abs: string): string | null {
  try {
    return createHash("sha1").update(fs.readFileSync(abs)).digest("hex").slice(0, 12);
  } catch {
    return null;
  }
}

/** 按轮次号取条目（snapshot.py 用 `[s for s in ... if s["round"]==N][0]`，取不到就是没有这一轮）。 */
function roundEntry(rounds: SnapRoundEntry[], round: number): SnapRoundEntry | null {
  return rounds.find((r) => r.round === round) ?? null;
}

const sidePath = (dir: string, node: string, round: number, name: string): string =>
  path.join(dir, "snapshots", node, `r${round}`, name);

/** 手改过的 index.json 能把名字写成 ../：两侧路径都先确认还在项目里（与 withinProject 同一把尺）。 */
function inProject(dir: string, abs: string): boolean {
  const root = path.resolve(dir);
  const r = path.resolve(abs);
  return r === root || r.startsWith(root + path.sep);
}

/** snapshot.py 读侧口径：read_text(encoding="utf-8") 走 universal newlines（\r\n 与裸 \r → \n）；
 *  不存在/读不动 → ""（与 `ta = ... if pa.exists() else ""` 同）。binary 侧不许当文本喂 diff。 */
function readSideText(abs: string): { text: string; exists: boolean; size: number } {
  let buf: Buffer;
  try {
    buf = fs.readFileSync(abs);
  } catch {
    return { text: "", exists: false, size: 0 };
  }
  const text = buf.toString("utf-8").replace(/\r\n?/g, "\n");
  return { text, exists: true, size: buf.length };
}

/** 只问「在不在、多大」不问内容（二进制侧的降级条目用）。 */
function fileSize(abs: string): { exists: boolean; size: number } {
  try {
    const st = fs.statSync(abs);
    return st.isFile() ? { exists: true, size: st.size } : { exists: false, size: 0 };
  } catch {
    return { exists: false, size: 0 };
  }
}

/** B12 · changes：一个端点两种视图，由 node/a 参数区分，响应里带 mode 明写，前端不许猜。
 *  - `?project=<id>` → mode:"index"：节点 × 轮次账 + 最新轮各文件的盘上现状（sameAsSnapshot=有没有没拍快照的改动）
 *  - `?project=<id>&node=<n>&a=<轮>[&b=<轮|working>]` → mode:"diff"：逐文件 unified diff
 *  b 缺省 = 该项目该节点的最新一轮；b=working = 拿盘上的现在当 b 侧。 */
export function panelChanges(
  kernel: KernelClient,
  project: string,
  node: string,
  aRaw: string,
  bRaw: string,
  file: string,
): PanelReply {
  const id = safeProject(project);
  if (!id) return { status: 400, payload: { error: `project 非法：${project}` } };
  const dir = kernel.projectDir(id);
  const idx = loadSnapshotIndex(dir);

  // ── 视图一：索引（没给 node 就走这里）──
  if (!node) {
    if (!idx) {
      return {
        status: 200,
        payload: {
          mode: "index",
          project: id,
          available: false,
          source: "snapshots/index.json",
          nodes: [],
          note: "该项目没有快照索引 snapshots/index.json——变更页签要有账可看，先按铁律 7 用 tools/snapshot.py capture 拍产物快照",
        },
      };
    }
    const nodes = Object.keys(idx)
      .sort()
      .map((n) => {
        const rounds = [...idx[n]].sort((x, y) => x.round - y.round);
        const latest = rounds[rounds.length - 1] ?? null;
        return {
          node: n,
          rounds: rounds.map((r) => ({
            round: r.round,
            ts: r.ts ?? null,
            note: r.note ?? "",
            files: Object.entries(r.files ?? {}).map(([name, m]) => ({
              name,
              hash: m?.hash ?? null,
              binary: m?.binary === true,
            })),
          })),
          latest: latest ? latest.round : null,
          // 最新一轮登记的文件 vs 盘上现在：hash 对不上 = 改了没拍快照
          disk: Object.keys(latest?.files ?? {}).map((name) => {
            const abs = path.resolve(dir, name);
            let st: fs.Stats | null = null;
            try {
              st = fs.statSync(abs);
            } catch { /* 盘上没有 */ }
            const snapHash = latest?.files?.[name]?.hash ?? null;
            if (!st || !st.isFile()) return { name, exists: false, sizeKB: 0, mtime: null, hash: null, sameAsSnapshot: false };
            const h = sha1_12(abs);
            return {
              name,
              exists: true,
              sizeKB: Math.round(st.size / 1024),
              mtime: st.mtime.toISOString(),
              hash: h,
              sameAsSnapshot: h !== null && snapHash !== null && h === snapHash,
            };
          }),
        };
      });
    return { status: 200, payload: { mode: "index", project: id, available: true, source: "snapshots/index.json", nodes } };
  }

  // ── 视图二：diff ──
  if (!aRaw) return { status: 400, payload: { error: "a（起始轮次）必填", node, hint: "先取 mode:index 看有哪些轮次" } };
  const a = Number(aRaw);
  if (!Number.isInteger(a)) return { status: 400, payload: { error: `a 必须是整数轮次：${aRaw}` } };
  const working = bRaw === "working";
  const b = bRaw && !working ? Number(bRaw) : null;
  if (bRaw && !working && !Number.isInteger(b)) return { status: 400, payload: { error: `b 必须是整数轮次或 working：${bRaw}` } };

  const rounds = idx?.[node];
  if (!idx || !rounds || !rounds.length) {
    return {
      status: 404,
      payload: { error: `节点没有快照账：${node}`, code: "NODE_NOT_FOUND", available: idx ? Object.keys(idx).sort() : [], hasIndex: !!idx },
    };
  }
  const sorted = [...rounds].sort((x, y) => x.round - y.round);
  const bRound = working ? sorted[sorted.length - 1].round : (b ?? sorted[sorted.length - 1].round);
  const ea = roundEntry(sorted, a);
  const eb = roundEntry(sorted, bRound);
  if (!ea) return { status: 404, payload: { error: `节点 ${node} 没有第 ${a} 轮`, code: "ROUND_NOT_FOUND", node, available: sorted.map((r) => r.round) } };
  if (!eb) return { status: 404, payload: { error: `节点 ${node} 没有第 ${bRound} 轮`, code: "ROUND_NOT_FOUND", node, available: sorted.map((r) => r.round) } };

  // 文件名单：两侧登记名的并集（b=working 时 b 侧就是 a 侧的名字——盘上新建、从没入过快照的文件
  // 不属于「产物变更」，它们在 B2 文件页签里，这里显式说明而不是哑掉）。
  const names = [...new Set([...Object.keys(ea.files ?? {}), ...Object.keys(eb.files ?? {})])].sort();
  const scope = file ? names.filter((n) => n === file) : names;
  if (file && !scope.length) {
    return {
      status: 404,
      payload: { error: `这两轮都没登记这个文件：${file}`, code: "FILE_NOT_IN_ROUNDS", node, a, b: working ? "working" : bRound, available: names },
    };
  }

  const files = scope.map((name) => {
    const metaA = ea.files?.[name];
    const metaB = eb.files?.[name];
    const aAbs = sidePath(dir, node, a, name);
    const bAbs = working ? path.resolve(dir, name) : sidePath(dir, node, bRound, name);
    const entry = {
      name,
      // inA/inB = 这一侧到底读不读得到内容（快照登记过但文件被删，也算读不到）
      inA: false,
      inB: false,
      binary: metaA?.binary === true || metaB?.binary === true,
      snapshotHashA: metaA?.hash ?? null,
      snapshotHashB: metaB?.hash ?? null,
      sizeA: 0,
      sizeB: 0,
      adds: 0,
      dels: 0,
      hunks: 0,
      unchanged: false,
      diff: "",
      note: "",
      code: null as string | null,
    };
    if (!inProject(dir, aAbs) || !inProject(dir, bAbs)) {
      entry.code = "OUT_OF_PROJECT";
      entry.note = "快照索引里的这个文件名越出了项目目录，本端点不读（路径边界与 B1/B13 同一把判定）";
      return entry;
    }
    if (entry.binary) {
      // 二进制产物（docx/图片等）：snapshot.py 在这里按 utf-8 读文本会直接抛 UnicodeDecodeError，
      // 本端点显式降级不崩，也不假装能算。
      const ba = fileSize(aAbs);
      const bb = fileSize(bAbs);
      entry.sizeA = ba.size;
      entry.sizeB = bb.size;
      entry.inA = ba.exists;
      entry.inB = bb.exists;
      entry.note = "二进制产物没有行级 diff：请看它的 md 导出件，或把两版分别下载对比。tools/snapshot.py 遇到同样的文件会抛异常，本端点按显式降级处理。";
      entry.code = "BINARY";
      return entry;
    }
    const sa = readSideText(aAbs);
    const sb = readSideText(bAbs);
    entry.sizeA = sa.size;
    entry.sizeB = sb.size;
    entry.inA = sa.exists;
    entry.inB = sb.exists;
    if (!sa.exists && !sb.exists) {
      entry.unchanged = true;
      entry.note = "两侧文件都不在盘上（快照被删过？），这里的「无变更」只说 diff 为空，不代表内容没改过";
      entry.code = "BOTH_MISSING";
      return entry;
    }
    if (sa.text.length > DIFF_CAP || sb.text.length > DIFF_CAP) {
      entry.note = `单侧 ${Math.max(sa.text.length, sb.text.length)} 字符，超出本端点逐行对比上限 ${DIFF_CAP}，不硬算（平方级算法会钉死请求）——请把 a/b 拆到更细的产物粒度。`;
      entry.code = "TOO_LARGE";
      return entry;
    }
    // 标签口径：snapshot.py 的 diff_text 传通用名 "previous"/"current"（文件名打在正文外的
    // `===== 名字 =====` 行里）。本端点把文件名直接做到 +++/--- 上，A8 的 parseUnifiedDiff 才能按文件
    // 分组、手机上一屏看得出改的是哪个产物；@@ 行与 ± 正文逐字节同 snapshot.py
    //（对账：test/verify/snapshot-diff-parity.mjs）。
    const r = diffText(sa.text, sb.text, `a/${name}`, `b/${name}`);
    entry.adds = r.adds;
    entry.dels = r.dels;
    entry.hunks = r.hunks;
    entry.unchanged = r.hunks === 0;
    entry.diff = r.text;
    entry.note = r.hunks === 0 ? "这两版内容逐字节相同" : "";
    return entry;
  });

  return {
    status: 200,
    payload: {
      mode: "diff",
      project: id,
      node,
      a,
      b: working ? "working" : bRound,
      bNote: working ? "b 侧 = 项目目录里的当前文件（快照之外的手改会在这里现形）" : `b 侧 = snapshots/${node}/r${bRound}/`,
      source: "snapshots/index.json",
      files,
      summary: {
        files: files.length,
        changed: files.filter((f) => !f.unchanged && f.code !== "BINARY" && f.code !== "TOO_LARGE" && f.code !== "BOTH_MISSING").length,
        adds: files.reduce((n, f) => n + f.adds, 0),
        dels: files.reduce((n, f) => n + f.dels, 0),
      },
    },
  };
}
