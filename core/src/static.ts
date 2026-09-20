/**
 * 静态托管（受白名单约束）—— 把「前端页」并进内核 HTTP 面，实现**单进程单端口**。
 *
 * 为什么不用 @fastify/static
 * ------------------------
 * 两个理由：① 不想为它加依赖；② 更重要的——**默认的静态托管会把仓库根裸暴露**。
 * 现状 `tools/serve.py` 继承 `SimpleHTTPRequestHandler`，任何 `/xxx` 都照发，
 * 于是 `/.zhuque-key`、`/.git/config`、`/src/kakazxing-Json/*`（29M 含真实隐私）全部可下载。
 * 开源部署下这是 P0 级问题，不能带出去。
 *
 * 本模块的模型 = **后缀白名单 ∩ 路径包含关系 ∩ 敏感段拒绝**：
 *   ① 只发 .html/.md/.json/.js/.css/.svg/图片/字体 —— 页面只需要这些；
 *   ② 解析后的绝对路径必须落在 root 之内（防 `..` 穿越）；
 *   ③ 任一路径段命中 `.git`/`.workbuddy`/`node_modules`/`.history`/点开头段 → 拒；
 *   ④ 文件名命中 `.zhuque-key`/锁文件 → 拒。
 * 拒绝一律返回 404（而不是 403）：不泄露"这里存在一个敏感文件"。
 */
import fs from "node:fs";
import path from "node:path";

const ALLOW_SUFFIX = new Set([
  ".html", ".htm", ".md", ".json", ".js", ".mjs", ".css",
  ".svg", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".ico",
  ".woff2", ".woff", ".ttf", ".txt", ".map",
]);

/** 敏感目录段：整段匹配即拒。 */
const DENY_SEGMENTS = new Set([".git", ".workbuddy", ".history", "node_modules", ".vscode", "__pycache__"]);

/**
 * 敏感路径前缀（相对根，'/' 分隔）：整棵子树拒发。
 * 为什么需要它：`src/kakaxing-Json/` 是 29M 第三方数据，含**真实姓名/电话/UCloud 密钥**——
 * 它的后缀是 `.json`（在白名单里）、顶层段 `src` 又不便一刀切（正常项目也有 src/）。
 * 开源部署下这是必须堵死的一条；额外私有目录可用环境变量 `MINIFLOW_STATIC_DENY_PREFIX`
 * （逗号分隔）自行追加。
 */
const DENY_PREFIXES_DEFAULT = ["src/kakaxing-Json/", "tmp-fixture-page/", "trace/"];

function denyPrefixes(): string[] {
  const extra = (process.env.MINIFLOW_STATIC_DENY_PREFIX ?? "")
    .split(",")
    .map((s) => s.trim().replace(/^\/+/, ""))
    .filter(Boolean);
  return [...DENY_PREFIXES_DEFAULT, ...extra];
}

/** 敏感文件（即便后缀在白名单里也拒）。 */
const DENY_FILES = new Set([".zhuque-key", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"]);

/**
 * 相对根路径是否为"禁止外发/禁止写入"的敏感路径——**单点实现**，
 * 静态托管（读）与 legacy 写端点（写）共用同一份判定，避免两边各写一套而漂移。
 * 判定：空段/`.`/`..`、点开头段（.git/.env/.zhuque-key/.workbuddy 一网打尽）、
 * 敏感目录段、敏感文件名、敏感前缀子树。
 */
export function isDeniedRelativePath(rel: string): boolean {
  const segments = rel.split("/").filter((s) => s.length > 0);
  if (!segments.length) return true;
  for (const seg of segments) {
    if (seg === "." || seg === "..") return true;
    if (seg.startsWith(".")) return true;
    if (DENY_SEGMENTS.has(seg)) return true;
  }
  if (DENY_FILES.has(segments[segments.length - 1])) return true;
  return denyPrefixes().some((p) => rel.startsWith(p));
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
};

export function contentTypeOf(absPath: string): string {
  return CONTENT_TYPES[path.extname(absPath).toLowerCase()] ?? "application/octet-stream";
}

/**
 * 把 URL 路径解析成可安全发送的绝对路径；不允许则返回 null。
 * 纯函数（只读文件系统判存在），便于单测直接覆盖穿越/敏感文件两类攻击。
 */
export function resolveStaticPath(root: string, urlPath: string): string | null {
  let rel: string;
  try {
    rel = decodeURIComponent(urlPath.split("?")[0].split("#")[0]);
  } catch {
    return null;
  }
  if (!rel.startsWith("/")) return null;
  rel = rel.replace(/^\/+/, "");
  if (rel === "" || rel.endsWith("/")) rel += "index.html";

  if (!ALLOW_SUFFIX.has(path.extname(rel).toLowerCase())) return null;
  if (isDeniedRelativePath(rel)) return null;

  const abs = path.resolve(root, rel);
  const rootAbs = path.resolve(root);
  // 包含关系用 sep 收口，避免 /repo-evil 命中 /repo
  if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) return null;

  try {
    if (!fs.statSync(abs).isFile()) return null;
  } catch {
    return null;
  }
  return abs;
}
