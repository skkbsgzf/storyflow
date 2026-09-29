// 无头 Edge CDP 截图驱动：打开页面 → 执行动作脚本 → 存 PNG（本机 GUI 会话不可用时的实拍替代）
// 用法：node shot.mjs <wsUrl> <outPng> <动作JS（可选，页面求值后等待毫秒）> <等待ms>
const [wsUrl, out, action = '', waitMs = '2500'] = process.argv.slice(2)
const fs = require('node:fs')

const ws = new WebSocket(wsUrl)
let id = 0
const send = (method, params = {}) => new Promise((res, rej) => {
  const mid = ++id
  const h = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id === mid) { ws.removeEventListener('message', h); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result) }
  }
  ws.addEventListener('message', h)
  ws.send(JSON.stringify({ id: mid, method, params }))
})

ws.addEventListener('open', async () => {
  await send('Page.enable')
  if (action) {
    await send('Runtime.evaluate', { expression: action, awaitPromise: true })
    await new Promise(r => setTimeout(r, Number(waitMs)))
  }
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(out, Buffer.from(data, 'base64'))
  console.log('written', out)
  ws.send(JSON.stringify({ id: ++id, method: 'Browser.close' }))
  setTimeout(() => process.exit(0), 500)
})
ws.addEventListener('error', e => { console.error('ws error', e.message ?? e); process.exit(1) })
