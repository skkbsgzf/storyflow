// 连拍 v2：首页 → 工作区对话 → .md 文件渲染 → 工作流面板（link 门标题修复复检）
const [wsUrl, dir] = process.argv.slice(2)
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
const ev = (expression, waitMs = 0) => send('Runtime.evaluate', { expression, awaitPromise: true }).then(async r => {
  await new Promise(x => setTimeout(x, waitMs)); return r
})
const shot = (name) => send('Page.captureScreenshot', { format: 'png' }).then(({ data }) => {
  fs.writeFileSync(dir + '/' + name, Buffer.from(data, 'base64')); console.log(name)
})

ws.addEventListener('open', async () => {
  await send('Page.enable')
  await shot('1-home.png')
  await ev(`(()=>{const r=[...document.querySelectorAll('.prow')].find(x=>x.textContent.includes('20/20'));r&&r.click();return 1})()`, 3500)
  await shot('2-workspace-chat.png')
  await ev(`(()=>{const r=[...document.querySelectorAll('.prow')].find(x=>x.textContent.includes('20/20'));r&&r.click();return 1})()`, 500)
  await ev(`(()=>{document.querySelectorAll('.rtabs .tab')[1].click();return 1})()`, 1500)
  await ev(`(()=>{const f=[...document.querySelectorAll('.frow')].find(x=>x.textContent.includes('剧本')||x.textContent.includes('.md'));f&&f.click();return f?f.textContent:'none'})()`, 2500)
  await shot('3-md-render.png')
  await ev(`(()=>{document.querySelectorAll('.rtabs .tab')[2].click();return 1})()`, 1500)
  await shot('4-workflow.png')
  await send('Browser.close')
  setTimeout(() => process.exit(0), 400)
})
ws.addEventListener('error', e => { console.error('ws error', e.message ?? e); process.exit(1) })
