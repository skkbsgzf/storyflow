// B13 验收矩阵：对 8443（真工作区·新代码）逐条打 raw/preview，把每步的实际响应头与
// 磁盘字节 sha256 一并落盘（os.tmpdir()/b13-matrix.json）——报数必附证据；
// 归档件在 docs/收据-B13-响应矩阵-20260928.json。
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const BASE = 'http://127.0.0.1:8443'
const P = 'p-sh-demo2'
const F = (rel) => encodeURIComponent(rel)
const disk = (rel) => `D:/storymasterv4/projects/${P}/${rel}`
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex').slice(0, 12)

const out = []
async function hit(name, url, opts = {}, expect = {}) {
  const r = await fetch(url, opts)
  const ct = r.headers.get('content-type')
  let rec
  if (ct && ct.includes('json')) rec = await r.json()
  else {
    const buf = Buffer.from(await r.arrayBuffer())
    rec = { bytes: buf.length, sha: sha(buf), head: buf.subarray(0, 8).toString('latin1') }
  }
  out.push({ name, status: r.status, headers: Object.fromEntries(r.headers), expect, reply: rec })
  return { status: r.status, headers: Object.fromEntries(r.headers), reply: rec }
}

const pngRel = '内部/预览验收/B13验收图.png'
const pdfRel = '内部/预览验收/B13验收.pdf'
const docxRel = '内部/预览验收/B13对照.docx'

const png = await hit('raw png', `${BASE}/api/panel/raw?project=${P}&file=${F(pngRel)}`)
const pdf = await hit('raw pdf', `${BASE}/api/panel/raw?project=${P}&file=${F(pdfRel)}`)
const rng = await hit('raw png Range 0-99', `${BASE}/api/panel/raw?project=${P}&file=${F(pngRel)}`, { headers: { range: 'bytes=0-99' } })
const bad = await hit('raw png Range 越界', `${BASE}/api/panel/raw?project=${P}&file=${F(pngRel)}`, { headers: { range: 'bytes=99999999-100000000' } })
const docx = await hit('raw docx（白名单外）', `${BASE}/api/panel/raw?project=${P}&file=${F(docxRel)}`)
const trav = await hit('raw 越界', `${BASE}/api/panel/raw?project=${P}&file=${F('../../AGENTS.md')}`)
const travImg = await hit('raw 越界（png 后缀）', `${BASE}/api/panel/raw?project=${P}&file=${F('../../docs/shots/b9-1-legacy-desktop.png')}`)
const badProject = await hit('raw project 非法', `${BASE}/api/panel/raw?project=p%2F..%2Fx&file=${F(pngRel)}`)
const miss = await hit('raw 查无', `${BASE}/api/panel/raw?project=${P}&file=${F('内部/预览验收/没有这张.png')}`)

for (const [label, rel] of [['preview png', pngRel], ['preview pdf', pdfRel], ['preview docx', docxRel], ['preview md', '01-选题/选题报告.md'],['preview html', 'workflow.html'], ['preview 查无', '内部/预览验收/没了.pdf']]) {
  await hit(label, `${BASE}/api/panel/preview?project=${P}&file=${F(rel)}`)
}

// 磁盘对照：sha 必须与供出字节一致
const diskPng = sha(fs.readFileSync(disk(pngRel)))
const diskPdf = sha(fs.readFileSync(disk(pdfRel)))
out.push({ name: '磁盘对照', diskPng, diskPdf, rawPngSha: png.reply.sha, rawPdfSha: pdf.reply.sha, pngEqual: diskPng === png.reply.sha, pdfEqual: diskPdf === pdf.reply.sha })

fs.writeFileSync(path.join(os.tmpdir(), 'b13-matrix.json'), JSON.stringify(out, null, 2), 'utf-8')
console.log(JSON.stringify(out.filter((r) => r.headers).map((r) => ({
  name: r.name, status: r.status, ct: r.headers['content-type'], cl: r.headers['content-length'],
  cr: r.headers['content-range'], sha: r.reply?.sha, bytes: r.reply?.bytes, kind: r.reply?.kind, code: r.reply?.code, url: r.reply?.url,
})), null, 1))
console.log('DISK_MATCH', JSON.stringify(out[out.length - 1]))
