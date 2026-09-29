// B13 实拍用静态页＋同源反代：5196 静态托管 preview-demo.html，/api/* 转 8443（真工作区·新代码）。
// 同源是为了让页面里的相对 URL（preview 返回的 /api/panel/raw?...）与真实面板一致。
import http from 'node:http'
import fs from 'node:fs'

const UP = { host: '127.0.0.1', port: Number(process.env.B13_UP_PORT ?? 8443) }
const PORT = Number(process.env.B13_PORT ?? 5196)
const PAGE = fs.readFileSync(new URL('./preview-demo.html', import.meta.url), 'utf-8')

http.createServer((req, res) => {
  if (!req.url.startsWith('/api/')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    res.end(PAGE)
    return
  }
  const up = http.request(
    { ...UP, path: req.url, method: req.method, headers: { ...req.headers, host: `${UP.host}:${UP.port}` } },
    (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers)
      r.pipe(res)
    },
  )
  up.on('error', (e) => {
    res.writeHead(502, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: String(e.message) }))
  })
  req.pipe(up)
}).listen(PORT, '127.0.0.1', () => console.log(`proxy ${PORT} -> ${UP.port} up`))
