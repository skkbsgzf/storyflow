// 工单 WO-B1 · 鉴权与路径边界纯函数单测（token / 限流 / CORS / Cookie / 越界判定）。
// 集成面（起服务真打 401/302/429/403）在 test/serve-auth.test.ts，本文件只钉判定语义。
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bearerToken, checkLimit, checkToken, clearFails, clientKey, cookieClear, cookieToken, generatePassword,
  isLoopbackHost, loginPageHtml, makeLimiter, makeToken, passwordMatches, readCookie, recordFail,
  resolveCors, safeNext, viaHttps, wantsHtml, COOKIE_NAME,
} from "../src/auth.js";
import { safeProject } from "../src/safe-project.js";

const SECRET = "unit-test-secret";

test("token 往返：未过期通过，过期即拒，改一字节即拒", () => {
  const t = makeToken(SECRET, 60_000, 1_000_000);
  assert.ok(checkToken(SECRET, t, 1_000_000));
  assert.ok(checkToken(SECRET, t, 1_059_999));
  assert.ok(!checkToken(SECRET, t, 1_060_001), "过期后必须拒");
  assert.ok(!checkToken(SECRET, t.slice(0, -1) + (t.endsWith("a") ? "b" : "a"), 1_000_000), "签名篡改必须拒");
  assert.ok(!checkToken("other-secret", t, 1_000_000), "换口令后旧 token 全失效");
  for (const bad of [undefined, null, "", ".", "abc", "zz.aabb"]) assert.ok(!checkToken(SECRET, bad, 1_000_000), `畸形 token 须拒：${bad}`);
});

test("限流：连错 5 次上锁 30s，锁期内对错都拒，锁到期计数清零", () => {
  const l = makeLimiter();
  const k = "1.2.3.4";
  const t0 = 1_700_000_000_000;
  for (let i = 1; i <= 4; i++) {
    assert.ok(checkLimit(l, k, t0).allowed);
    const st = recordFail(l, k, t0);
    assert.equal(st.fails, i);
    assert.equal(st.locked, false, `第 ${i} 次未达阈值不该锁`);
  }
  const fifth = recordFail(l, k, t0);
  assert.equal(fifth.locked, true, "第 5 次必须上锁");
  assert.equal(fifth.retryAfterMs, 30_000);
  const gate = checkLimit(l, k, t0 + 1_000);
  assert.deepEqual(gate, { allowed: false, retryAfterMs: 29_000 });
  // 锁到期：计数清零，重新给 5 次机会（不做永久锁）
  const after = checkLimit(l, k, t0 + 30_001);
  assert.equal(after.allowed, true);
  assert.equal(recordFail(l, k, t0 + 30_001).fails, 1);
});

test("clearFails：登录成功即清计数，不给「错 4 次 + 对 1 次 + 再错 1 次」凑成锁", () => {
  const l = makeLimiter();
  for (let i = 0; i < 4; i++) recordFail(l, "k", 1000);
  clearFails(l, "k");
  assert.equal(checkLimit(l, "k", 1000).allowed, true);
  assert.equal(recordFail(l, "k", 1000).fails, 1);
  assert.equal(recordFail(l, "k", 1000).locked, false);
});

test("口令比对：正确通过 / 错误拒绝 / 长度不等不抛", () => {
  assert.ok(passwordMatches("abcdefgh", "abcdefgh"));
  assert.ok(!passwordMatches("abcdefgh", "abcdefgg"));
  assert.ok(!passwordMatches("abcdefgh", ""));
  assert.ok(!passwordMatches("abcdefgh", "abcdefghabcdefgh"));
});

test("生成的口令够用且不含易混字符", () => {
  for (let i = 0; i < 20; i++) {
    const p = generatePassword();
    assert.equal(p.length, 16);
    assert.ok(!/[lio01]/.test(p), `含易混字符：${p}`);
  }
  assert.notEqual(generatePassword(), generatePassword(), "两次生成须不同");
});

test("CORS：loopback 源放行（8420/8421 作业台形态不断），公网站点拒，白名单精确放行", () => {
  assert.equal(resolveCors("http://127.0.0.1:8421"), "http://127.0.0.1:8421");
  assert.equal(resolveCors("http://localhost:8420"), "http://localhost:8420");
  assert.equal(resolveCors("http://[::1]:8431"), "http://[::1]:8431");
  assert.equal(resolveCors("https://evil.example.com"), null);
  assert.equal(resolveCors("http://192.168.1.7:8420"), null);
  assert.equal(resolveCors("http://127.0.0.1.evil.com"), null);
  assert.equal(resolveCors(undefined), null);
  assert.equal(resolveCors("null"), null);
  assert.equal(resolveCors("https://tunnel.example", ["https://tunnel.example"]), "https://tunnel.example");
  assert.equal(resolveCors("https://tunnel.example:8431", ["https://tunnel.example"]), null, "白名单精确匹配，不做前缀放行");
});

test("绑定地址：loopback 判定覆盖缺省形态，0.0.0.0 算对外，后缀伪装不算本机", () => {
  for (const h of ["127.0.0.1", "localhost", "::1", "[::1]", "127.5.5.5"]) assert.ok(isLoopbackHost(h), h);
  for (const h of ["0.0.0.0", "192.168.1.7", "10.0.0.2", "127.0.0.1.evil.com"]) assert.ok(!isLoopbackHost(h), h);
});

test("取真实客户端：CF-Connecting-IP 优先（隧道下 socket 恒为 127.0.0.1，否则一人输错全员锁）", () => {
  const r = (headers: Record<string, string>, remote = "127.0.0.1") =>
    ({ headers, socket: { remoteAddress: remote } }) as never;
  assert.equal(clientKey(r({ "cf-connecting-ip": "9.9.9.9" })), "9.9.9.9");
  assert.equal(clientKey(r({ "x-forwarded-for": "8.8.8.8, 127.0.0.1" })), "8.8.8.8");
  assert.equal(clientKey(r({})), "127.0.0.1");
});

test("token 取用：Bearer 头与 cookie 双通道", () => {
  assert.equal(bearerToken({ headers: { authorization: "Bearer abc.def" } } as never), "abc.def");
  assert.equal(bearerToken({ headers: { authorization: "Basic xyz" } } as never), null);
  assert.equal(readCookie({ headers: { cookie: `other=1; ${COOKIE_NAME}=tok%2Fen; x=2` } } as never, COOKIE_NAME), "tok/en");
  assert.equal(readCookie({ headers: {} } as never, COOKIE_NAME), null);
});

test("cookie 序列化：HttpOnly + SameSite=Lax，经 https 隧道才加 Secure", () => {
  const c = cookieToken("t", 72 * 3600_000, viaHttps({ headers: { "x-forwarded-proto": "https" } } as never));
  assert.ok(c.startsWith("sh_token=t; Path=/; HttpOnly; SameSite=Lax; Max-Age=259200; Secure"), c);
  const plain = cookieToken("t", 60_000, viaHttps({ headers: {} } as never));
  assert.ok(!plain.includes("Secure") && plain.includes("Max-Age=60"), plain);
  assert.ok(cookieClear().includes("Max-Age=0"));
});

test("未过闸的分诊：HTML 导航跳登录页，API/SSE 给 401（由 serve 侧判定，这里钉 wantsHtml 语义）", () => {
  assert.ok(wantsHtml({ method: "GET", headers: { accept: "text/html,application/xhtml+xml" } } as never, "/"));
  assert.ok(wantsHtml({ method: "GET", headers: { accept: "text/html" } } as never, "/index.html"));
  assert.ok(!wantsHtml({ method: "GET", headers: { accept: "text/html" } } as never, "/api/hub"), "API 不给 302");
  assert.ok(!wantsHtml({ method: "GET", headers: { accept: "text/event-stream" } } as never, "/events"));
  assert.ok(!wantsHtml({ method: "POST", headers: { accept: "text/html" } } as never, "/start"));
});

test("next 参数防开放重定向：只许站内路径", () => {
  assert.equal(safeNext("/projects.html"), "/projects.html");
  assert.equal(safeNext("//evil.com"), "/");
  assert.equal(safeNext("https://evil.com"), "/");
  assert.equal(safeNext(null), "/");
});

test("登录页可渲染且把口令交给 /api/login，next 注入前已转义", () => {
  const html = loginPageHtml("/");
  for (const must of ["/api/login", 'name="password"', "StoryHarness"]) assert.ok(html.includes(must), html.slice(0, 80));
  assert.ok(loginPageHtml('/"><svg>').includes('\\"'), "next 走 JSON.stringify 转义，不裸插");
});

test("越界判定共用一把钥匙：project 只许单段目录名", () => {
  assert.equal(safeProject("p-sh-001"), "p-sh-001");
  for (const bad of ["", "..", "../x", "a/b", "a\\b", "..\\..\\windows"]) assert.equal(safeProject(bad), null, bad);
});
