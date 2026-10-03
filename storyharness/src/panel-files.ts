// 官方面板数据接口 · 本地文件能力（工单-20261002 批A）：files/raw/preview 三端点的实现件。
// 自 2026-10-02 前端切割时的 panels.ts 对齐复刻（B2 文件树/读取 + B13 二进制预览）；
// safeProject 走 safe-project.ts（同一把越界钥匙，禁止两处各写一份）。
// 退役面（worldbook/telemetry/changes/canvas）不在此模块——它们维持 410，世界书走内核动词 worldbook_search。
import * as fs from "node:fs";
import path from "node:path";
import { safeProject } from "./safe-project.js";
import type { KernelClient } from "./kernel.js";

// 与旧 tools.ts buildTools 的 fs_tree 同语义（IGNORE + 两层深度）；越界拒绝语义同 withinProject。
const IGNORE = new Set(["node_modules", ".git", "snapshots"]);
const READ_SUFFIX = new Set([".md", ".json", ".txt"]);
const READ_CAP = 200_000; // 单文件读取上限（字符），超出截断并附全长标注

// 可内嵌预览的后缀→MIME 白名单。只收浏览器能直接渲染的图/PDF/音频；
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
const RAW_CAP = 25_000_000; // 单文件上限（字节）：超限 413 显式报数，不静默截断、不给空 body

export interface PanelReply {
  status: number;
  payload: unknown;
}

/** 项目内相对路径解析，越界拒绝（与 safe-project 同一把尺的路径版）。 */
function withinProject(kernel: KernelClient, project: string, rel: string): string {
  const root = path.resolve(kernel.projectDir(project));
  const abs = path.resolve(root, rel);
  if (!abs.startsWith(root + path.sep) && abs !== root) throw new Error(`路径越出项目：${rel}`);
  return abs;
}

/** files：无 file → 两层文件树（fs_tree 语义）每项 {path,sizeKB,mtime}；
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

// ── raw/preview：二进制预览判定 ──────────────────────────────────

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

/** raw：项目内二进制只读供出（<img>/<iframe>/<audio> 直接吃这个 URL）。
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

/** preview：给渲染层的判定元数据（一条请求说清「能不能内嵌、URL 是啥、不能的话为什么」）。
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
    return { status: 200, payload: { ...base, kind: 'text', mime: 'text/plain', url: `/api/panel/files?project=${encodeURIComponent(id)}&file=${encodeURIComponent(file)}`, note: '文本走 files 读取（≤200KB 截断）' } };
  }
  return { status: 200, payload: { ...base, kind: 'none', mime: null, url: null, note: `${ext ? '.' + ext.slice(1) : '（无后缀）'} 这类文件不能直接看；docx 请看 tools/export-doc.py 的 md/docx 导出件` } };
}
