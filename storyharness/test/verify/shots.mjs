// B13 实拍：headless Edge（本机 GUI 进程起不来，只能 headless）+ CDP 驱动。
// 1) 起 Edge（新 profile，端口 9334）→ 2) 打开 5196 演示页 → 3) 等数据面渲染完
// → 4) 读回「图片真解码尺寸 / PDF iframe 请求状态」→ 5) 桌面整页＋手机宽度两张 PNG。
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PROFILE = path.join(os.tmpdir(), 'sh-b13-edge')
const PORT = Number(process.env.B13_CDP_PORT ?? 9334)
const URL = process.env.B13_PAGE_URL ?? 'http://127.0.0.1:5196/'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

fs.mkdirSync(PROFILE, { recursive: true })
const child = spawn(EDGE, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--allow-file-access-from-files', 'about:blank',
], { detached: true, stdio: 'ignore' })
child.unref()

async function json(pathName) {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}${pathName}`)
      if (r.ok) return await r.json()
    } catch {}
    await sleep(500)
  }
  throw new Error('CDP 未就绪（Edge 没起来？）')
}

const { webSocketDebuggerUrl: browserWs } = await json('/json/version')
const conn = new WebSocket(browserWs)
await new Promise((res, rej) => { conn.onopen = res; conn.onerror = rej })
let idn = 0
const pend = new Map()
conn.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) }
}
const send = (method, params = {}, sessionId) =>
  new Promise((res) => {
    const id = ++idn
    pend.set(id, (m) => res(m.error ? { error: m.error } : m.result))
    conn.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
  })

const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
await send('Page.enable', {}, sessionId)
await send('Network.enable', {}, sessionId)
const netLog = []
const onMsg = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.method === 'Network.responseReceived' && m.sessionId === sessionId) {
    const r = m.params.response
    netLog.push({ url: r.url, status: r.status, mime: r.mimeType, headers: r.headers })
  }
}
conn.addEventListener('message', onMsg)

await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId)
await send('Page.navigate', { url: URL }, sessionId)
for (let i = 0; i < 40; i++) {
  const r = await send('Runtime.evaluate', { expression: '!!window.__done', returnByValue: true }, sessionId)
  if (r?.result?.value === true) break
  await sleep(300)
}
await sleep(1200)

const probe = await send('Runtime.evaluate', {
  expression: `(() => {
    const imgs = [...document.images].map(i => ({ src: i.src.split('file=')[1] || i.src, complete: i.complete, nw: i.naturalWidth, nh: i.naturalHeight }));
    const frames = [...document.querySelectorAll('iframe')].map(f => f.src.split('file=')[1] || f.src);
    const badges = [...document.querySelectorAll('.badge')].map(b => b.textContent.trim());
    const notes = [...document.querySelectorAll('.note')].map(n => n.textContent.trim().slice(0, 90));
    return JSON.stringify({ imgs, frames, badges, notes, h: document.body.scrollHeight });
  })()`, returnByValue: true,
}, sessionId)
const info = JSON.parse(probe.result.value)

const metrics = await send('Page.getLayoutMetrics', {}, sessionId)
const h = Math.min(Math.ceil(metrics.cssContentSize.height || info.h), 4000)
const shot = await send('Page.captureScreenshot', {
  format: 'png',
  clip: { x: 0, y: 0, width: 1440, height: h, scale: 1 },
  captureBeyondViewport: true,
}, sessionId)
fs.writeFileSync(path.join(os.tmpdir(), 'b13-1-preview-desktop.png'), Buffer.from(shot.data, 'base64'))

await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, sessionId)
await sleep(600)
const shotM = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 390, height: Math.min(h, 3000), scale: 1 }, captureBeyondViewport: true }, sessionId)
fs.writeFileSync(path.join(os.tmpdir(), 'b13-2-preview-mobile.png'), Buffer.from(shotM.data, 'base64'))

fs.writeFileSync(path.join(os.tmpdir(), 'b13-render-evidence.json'), JSON.stringify({ info, netLog }, null, 2), 'utf-8')
console.log(JSON.stringify({ info, pdfNet: netLog.filter((n) => n.url.includes('.pdf') || n.mime === 'application/pdf'), pngNet: netLog.filter((n) => n.mime === 'image/png') }, null, 1))

await send('Target.closeTarget', { targetId })
conn.close()
process.exit(0)
