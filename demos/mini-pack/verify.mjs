#!/usr/bin/env node
/* verify:pack · 最小第二包立证（工单 C-B4）
 *
 * STORYHARNESS_WORKSPACE=demos/mini-pack 起 `storyharness web`（临时端口 18992，不碰 8431/真仓）：
 *   ① ui 按 manifest runtime.ui 命令拉起（python -m http.server :18990）可访问
 *   ② 协议面 /status 响应 JSON
 *   ③ 退出后子进程全部清理（端口归还）
 * 退出码 0 = 包契约成立。真仓 manifest 与 8431 全程不被触碰。
 */
import { spawn, execSync } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));           // demos/mini-pack
const PKG = path.resolve(HERE, "..", "..", "storyharness");          // storyharness 包
const WEB_PORT = 18992, UI_PORT = 18990;
const fails = [];
const ok = (name, cond) => { console.log((cond ? "PASS" : "FAIL") + "  " + name); if (!cond) fails.push(name); };
const ping = (url) => new Promise((resolve) => {
  const req = http.get(url, (r) => { r.resume(); resolve(r.statusCode < 500); });
  req.on("error", () => resolve(false));
  req.setTimeout(1500, () => { req.destroy(); resolve(false); });
});

// 前置：临时端口必须空闲（被占用 = 上一次未清理或环境冲突，直接失败不硬闯）
for (const p of [WEB_PORT, UI_PORT]) {
  if (await ping(`http://127.0.0.1:${p}/`)) {
    console.error(`FAIL  端口 ${p} 已被占用（上次未清理？）——终止，不硬闯`);
    process.exit(1);
  }
}

const kid = spawn(process.execPath, [path.join(PKG, "node_modules", "tsx", "dist", "cli.mjs"),
  "src/cli.ts", "web", "--no-open", "--port", String(WEB_PORT)], {
  cwd: PKG,
  env: { ...process.env, STORYHARNESS_WORKSPACE: HERE, HF_HUB_DISABLE_PROGRESS_BARS: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});
let webLog = "";
kid.stdout.on("data", (d) => { webLog += d.toString(); });
kid.stderr.on("data", (d) => { webLog += d.toString(); });

try {
  // ① web 协议面就绪
  let webUp = false;
  for (let i = 0; i < 40 && !webUp; i++) { webUp = await ping(`http://127.0.0.1:${WEB_PORT}/status`); if (!webUp) await new Promise((r) => setTimeout(r, 500)); }
  ok("① 协议面 web :18992 就绪", webUp);
  // ② log 来源区分：ui 面必须标 manifest（mini-pack 只声明了 ui），kernel 面必须标回落
  //    （mini-pack 无 kernel 节——各面按各自声明/回落精确断言，不做全文取反）
  ok("② log 区分：ui=manifest 声明 / kernel=回落 v4 缺省",
    /manifest runtime\.ui/.test(webLog) && /:8421[^]*runtime 未声明/.test(webLog) && !/manifest runtime\.kernel/.test(webLog));
  // ③ ui 按 manifest 命令拉起（python -m http.server :18990 列目录页）——窗口 20s
  let uiUp = false;
  for (let i = 0; i < 40 && !uiUp; i++) { uiUp = await ping(`http://127.0.0.1:${UI_PORT}/`); if (!uiUp) await new Promise((r) => setTimeout(r, 500)); }
  if (!uiUp) {
    try { console.error("[verify] ③ 失败现场 netstat:", execSync(`netstat -ano | findstr :${UI_PORT}`, { shell: true }).toString().slice(0, 300)); }
    catch { console.error("[verify] ③ 失败现场：18990 无任何监听"); }
  }
  ok("③ ui 按 manifest 命令拉起 :18990", uiUp);
  // ④ /status 是本包协议面 JSON（带 project 字段）
  const status = await new Promise((resolve) => {
    http.get(`http://127.0.0.1:${WEB_PORT}/status`, (r) => { let b = ""; r.on("data", (c) => (b += c)); r.on("end", () => resolve(b)); }).on("error", () => resolve(""));
  });
  ok("④ /status 返回协议 JSON", /"project"/.test(status));
} finally {
  // C-B4 · 清理：kill 的是 web（node）→ web 里的 quietSpawn kill 的也只是 shell 中间层，
  // python 孙进程要显式按端口追杀（Windows 无进程组信号；taskkill /T 需句柄树，此处按端口最可靠）
  const killPort = (p) => { try { execSync(`for /f "tokens=5" %i in ('netstat -ano ^| findstr :${p} ^| findstr LISTENING') do taskkill /F /PID %i`, { shell: true }); } catch { /* 无监听即目标达成 */ } };
  try { kid.kill(); } catch { /* 已退出 */ }
  killPort(WEB_PORT);
  await new Promise((r) => setTimeout(r, 600));
  killPort(UI_PORT);
  await new Promise((r) => setTimeout(r, 600));
  const uiGone = !(await ping(`http://127.0.0.1:${UI_PORT}/`));
  const webGone = !(await ping(`http://127.0.0.1:${WEB_PORT}/status`));
  ok("⑤ 退出清理：web+ui 子进程端口归还", uiGone && webGone);
}

console.log("\n===== " + (fails.length ? "VERIFY-PACK FAIL: " + fails.join(" | ") : "VERIFY-PACK PASS") + " =====");
process.exit(fails.length ? 1 : 0);
