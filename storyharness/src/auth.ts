// 工单 WO-B1（2026-09-28 B组波3）· 鉴权与路径边界的纯函数层。
// 设计口径：
//   · 无状态 token（HMAC(expiry)）——服务重启不掉登录态，手机经隧道用不必每次重输口令；不落会话表。
//   · fail-closed：绑定非 loopback 却没口令 → config 层自动生成强口令写 credentials 文件，绝不「无口令对外敞开了跑」。
//   · 本机缺省形态零改变：不设 SH_PASSWORD = 不鉴权，但仍只绑 127.0.0.1（现状即如此）。
//   · 本文件只做判定，不起服务、不读盘（写 credentials 归 config.ts）——serve.ts 接线，单测直接打这里。
import crypto from "node:crypto";
import type * as http from "node:http";

export const COOKIE_NAME = "sh_token";

/** loopback 主机名集合：绑这些地址 = 纯本机形态。0.0.0.0 / 局域网 IP = 对外。 */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
/** 127 段只认标准点分四段——`127.0.0.1.evil.com` 那种后缀伪装必须拒（CORS 放行的真实攻击面） */
const LOOPBACK_V4 = /^127(\.\d{1,3}){3}$/;

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host) || LOOPBACK_V4.test(host);
}

/** 强口令：去掉易混字符（l/i/o/0/1），手机好读好输。 */
export function generatePassword(len = 16): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[crypto.randomInt(alphabet.length)];
  return out;
}

const sig = (secret: string, payload: string) => crypto.createHmac("sha256", secret).update(`sh-token:${payload}`).digest("hex");

/** token = <过期毫秒(36进制)>.<HMAC>；无状态，校验不查表。 */
export function makeToken(secret: string, ttlMs: number, now = Date.now()): string {
  const payload = (now + ttlMs).toString(36);
  return `${payload}.${sig(secret, payload)}`;
}

export function checkToken(secret: string, token: string | undefined | null, now = Date.now()): boolean {
  if (!token) return false;
  const i = token.lastIndexOf(".");
  if (i <= 0) return false;
  const payload = token.slice(0, i);
  const given = token.slice(i + 1);
  const exp = parseInt(payload, 36);
  if (!Number.isFinite(exp) || exp <= now) return false;
  const want = Buffer.from(sig(secret, payload), "utf8");
  const got = Buffer.from(given, "utf8");
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

/** 口令比对也走定长时间：不给「逐字猜口令」留计时侧信道。 */
export function passwordMatches(want: string, given: string): boolean {
  const a = Buffer.from(want, "utf8");
  const b = Buffer.from(given, "utf8");
  // 长度不等时 timingSafeEqual 会抛——先比长度再等长比对，长度差异本身不泄露内容
  if (a.length !== b.length) {
    const pad = Buffer.alloc(a.length);
    crypto.timingSafeEqual(a, pad);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

// ── 登录限流：连错 maxFails 次锁 lockMs（工单验收线：5 次 / 30s）────────────
export interface LoginLimiter {
  maxFails: number;
  lockMs: number;
  attempts: Map<string, { fails: number; lockedUntil: number }>;
}

export function makeLimiter(opts: { maxFails?: number; lockMs?: number } = {}): LoginLimiter {
  return { maxFails: opts.maxFails ?? 5, lockMs: opts.lockMs ?? 30_000, attempts: new Map() };
}

export interface LimitGate { allowed: boolean; retryAfterMs: number }

export function checkLimit(l: LoginLimiter, key: string, now = Date.now()): LimitGate {
  const a = l.attempts.get(key);
  if (a && a.lockedUntil > now) return { allowed: false, retryAfterMs: a.lockedUntil - now };
  if (a && a.lockedUntil && a.lockedUntil <= now) l.attempts.delete(key);   // 锁到期即清零，不累计成永久锁
  return { allowed: true, retryAfterMs: 0 };
}

/** 记一次失败：达到阈值即上锁。返回是否已锁与剩余锁定毫秒。 */
export function recordFail(l: LoginLimiter, key: string, now = Date.now()): { locked: boolean; fails: number; retryAfterMs: number } {
  const a = l.attempts.get(key) ?? { fails: 0, lockedUntil: 0 };
  a.fails += 1;
  if (a.fails >= l.maxFails) a.lockedUntil = now + l.lockMs;
  l.attempts.set(key, a);
  return { locked: a.lockedUntil > now, fails: a.fails, retryAfterMs: Math.max(0, a.lockedUntil - now) };
}

export function clearFails(l: LoginLimiter, key: string): void {
  l.attempts.delete(key);
}

/** 限流键：隧道场景 socket 恒为 127.0.0.1，必须取 Cloudflare 回传的真实客户端 IP，否则一人输错全员锁。 */
export function clientKey(req: http.IncomingMessage): string {
  const h = req.headers;
  const cf = h["cf-connecting-ip"];
  if (typeof cf === "string" && cf.trim()) return cf.trim();
  const xff = h["x-forwarded-for"];
  if (typeof xff === "string" && xff.trim()) return xff.split(",")[0]!.trim();
  return req.socket?.remoteAddress ?? "unknown";
}

// ── token 取用与 Cookie ────────────────────────────────────────────────
export function bearerToken(req: http.IncomingMessage): string | null {
  const h = req.headers.authorization;
  return typeof h === "string" && /^Bearer\s+\S/i.test(h) ? h.replace(/^Bearer\s+/i, "").trim() : null;
}

export function readCookie(req: http.IncomingMessage, name: string): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

/** 经隧道来的请求 socket 是 http，但客户端实际走 https——X-Forwarded-Proto 决定 Secure 位。 */
export function viaHttps(req: http.IncomingMessage): boolean {
  const p = req.headers["x-forwarded-proto"];
  return typeof p === "string" && p.split(",")[0]!.trim() === "https";
}

export function cookieToken(token: string, maxAgeMs: number, secure: boolean): string {
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}${secure ? "; Secure" : ""}`;
}

export function cookieClear(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

// ── CORS 收紧：`*` → 本机 loopback 源 + 显式白名单 ──────────────────────
/** 8420/8421 作业台页跨源调 8431 是本仓现有形态，白名单必须放它们进来；
 *  公网任意站点默认拒绝（同源门面不需要 CORS）。 */
export function resolveCors(origin: string | undefined | null, extraAllowed: string[] = []): string | null {
  if (!origin || origin === "null") return null;
  if (extraAllowed.includes(origin)) return origin;
  try {
    const u = new URL(origin);
    if (u.protocol === "http:" && isLoopbackHost(u.hostname)) return origin;
  } catch { /* 非法 Origin 一律不放行 */ }
  return null;
}

// ── 门面壳跳转判定：浏览器导航给 302 到登录页，API/SSE 给 401 JSON ──────
export function wantsHtml(req: http.IncomingMessage, url: string): boolean {
  if (req.method !== "GET") return false;
  const accept = String(req.headers.accept ?? "");
  if (!accept.includes("text/html")) return false;
  return url === "/" || url === "/index.html" || url.endsWith(".html") || url === "";
}

/** next 参数只许站内路径：`//evil` 与绝对 URL 一律回落首页（防开放重定向）。 */
export function safeNext(raw: string | null | undefined): string {
  const v = (raw ?? "").trim();
  if (!v.startsWith("/") || v.startsWith("//")) return "/";
  return v;
}

export function loginPageHtml(next: string): string {
  return `<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>StoryHarness · 登录</title>
<style>
:root{--ink:#1a1714;--paper:#f6f1e6;--line:#d8cfbc;--muted:#8a8172;--accent:#8b1c1c}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--paper);color:var(--ink);
font:15px/1.6 "Songti SC","Noto Serif CJK SC",serif}
.card{width:min(360px,92vw);background:#fffdf7;border:1px solid var(--line);border-radius:14px;padding:26px 22px;box-shadow:0 8px 30px rgba(26,23,20,.08)}
h1{margin:0 0 4px;font-size:20px;letter-spacing:.04em}
p.sub{margin:0 0 20px;color:var(--muted);font-size:13px}
label{display:block;font-size:13px;color:var(--muted);margin-bottom:6px}
input{width:100%;padding:12px 13px;font-size:16px;border:1px solid var(--line);border-radius:9px;background:#fffef9;color:var(--ink)}
button{margin-top:16px;width:100%;padding:12px;font-size:15px;border:0;border-radius:9px;background:var(--accent);color:#fdf6e6;cursor:pointer}
button:disabled{opacity:.55;cursor:progress}
.msg{margin-top:12px;font-size:13px;color:var(--accent);min-height:18px}
</style></head>
<body><form class="card" id="f">
<h1>StoryHarness</h1>
<p class="sub">生产线与对话面 · 需要口令</p>
<label for="p">访问口令</label>
<input id="p" name="password" type="password" autocomplete="current-password" inputmode="text" autofocus>
<button id="b" type="submit">进入</button>
<div class="msg" id="m"></div>
</form>
<script>
const NEXT = ${JSON.stringify(next)};
const f = document.getElementById('f'), p = document.getElementById('p'), b = document.getElementById('b'), m = document.getElementById('m');
f.addEventListener('submit', async (e) => {
  e.preventDefault(); b.disabled = true; m.textContent = '';
  try {
    const r = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: p.value }) });
    const j = await r.json().catch(() => ({}));
    if (r.ok) { location.href = NEXT; return; }
    if (r.status === 429) { m.textContent = '连错太多次，' + Math.ceil((j.retryAfterMs || 30000) / 1000) + ' 秒后再试'; }
    else m.textContent = '口令不对';
  } catch (err) { m.textContent = '服务没应答：' + err.message; }
  b.disabled = false; p.select();
});
</script></body></html>`;
}
