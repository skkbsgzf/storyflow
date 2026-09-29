// StoryHarness 桌面壳：拉起/附着 8431 协议面，并从该面加载 ui/dist 构建产物。
// 页面必须走 http://127.0.0.1:<port>，不能用 loadFile 直载 dist：
// `ui/src/lib/api.ts` 全走相对 `/api/*`（dev 期由 vite proxy 兜），file:// 没有 origin 可解析，
// 实测 fetch('/api/hub') 直接 Failed to fetch、项目行 0、窗口空白（2026-09-28 无头复现，见 CHANGELOG 0.7.1 未决⑨）。
// 静态面本身是 serve 每次请求读盘，所以壳不需要自带离线路径；8431 已由 `storyharness web` 起着时直接附着。
const { app, BrowserWindow, shell } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const PORT = Number(process.env.STORYHARNESS_PORT || 8431);
const BASE = `http://127.0.0.1:${PORT}`;
// desktop/ 与 storyharness/ 同级发布时：release 里 desktop 的上一级即 storyharness 包根
const PKG_ROOT = path.resolve(__dirname, '..');
const SERVE_ARGS = ['src/cli.ts', 'serve', '--no-open', '--port', String(PORT)];

let serverProc = null;
const LOG = path.join(__dirname, 'desktop.log');
const log = (s) => fs.appendFileSync(LOG, `[${new Date().toISOString()}] ${s}\n`);
fs.writeFileSync(LOG, '');

const healthy = () =>
  fetch(BASE + '/api/hub', { signal: AbortSignal.timeout(1500) }).then(r => r.ok).catch(() => false);

async function ensureServer() {
  if (await healthy()) return;
  const tsx = path.join(PKG_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  if (!fs.existsSync(tsx)) throw new Error(`找不到 tsx（${tsx}）且 ${BASE} 未就绪——先手动跑 storyharness web`);
  serverProc = spawn('node', [tsx, ...SERVE_ARGS],
    { cwd: PKG_ROOT, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  if (serverProc.stderr) serverProc.stderr.on('data', d => console.error('[serve]', String(d).slice(0, 300)));
  for (let i = 0; i < 60; i++) {
    if (await healthy()) return;
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('storyharness serve 启动超时（60×0.5s）');
}

async function createWindow() {
  await ensureServer();
  const win = new BrowserWindow({
    width: 1360, height: 860, minWidth: 980, minHeight: 620,
    backgroundColor: '#efece3',
    title: 'StoryHarness',
    autoHideMenuBar: true,
  });
  // 一律从 serve 面加载：dist 在盘上就发新构建，没 dist 时 serve 回落旧门面（同一条退路逻辑）
  await win.loadURL(BASE + '/');
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' } });
  // SH_SHOT=<png 路径>：加载后截图退出（CI/冒烟用，无头环境不给 :start 传此变量即正常桌面模式）
  if (process.env.SH_SHOT) {
    const shot = path.resolve(process.env.SH_SHOT);
    setTimeout(async () => {
      const img = await win.webContents.capturePage();
      fs.writeFileSync(shot, img.toPNG());
      app.quit();
    }, 3500);
  }
}

app.whenReady().then(() => {
  log(`ready; SH_SHOT=${process.env.SH_SHOT ?? '-'}`);
  createWindow().catch(e => {
    log('createWindow fail: ' + (e.message || e));
    const msg = String(e.message || e);
    const win = new BrowserWindow({ width: 640, height: 320, autoHideMenuBar: true });
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
      `<body style="font:14px/1.8 sans-serif;padding:24px"><h2>StoryHarness 启动失败</h2><pre>${msg}</pre><p>可在终端跑 <code>storyharness web</code> 后重开本壳。</p></body>`));
  });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow().catch(() => {}); });
});
app.on('window-all-closed', () => app.quit());
app.on('quit', () => { try { serverProc?.kill(); } catch { /* 已退 */ } });
