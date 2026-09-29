// B13 验收件生成：造一份结构正确的最小 PDF（xref 偏移按字节实算），并把仓库里一张真实截图
// 复制进验收项目目录——raw 路由的「真实项目里一张图＋一份 PDF」这两件由此落地。
import fs from 'node:fs'
import path from 'node:path'

const dir = 'D:/storymasterv4/projects/p-sh-demo2/内部/预览验收'
fs.mkdirSync(dir, { recursive: true })

const text = 'BT /F1 20 Tf 60 780 Td (StoryHarness B13 raw PDF) Tj 0 -34 Td /F1 12 Tf (png + pdf via /api/panel/raw) Tj ET'
const objs = [
  '<</Type/Catalog/Pages 2 0 R>>',
  '<</Type/Pages/Kids[3 0 R]/Count 1>>',
  '<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>',
  `<</Length ${Buffer.byteLength(text)}>>\nstream\n${text}\nendstream`,
  '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
]

let out = '%PDF-1.4\n'
const offsets = []
objs.forEach((body, i) => {
  offsets.push(Buffer.byteLength(out))
  out += `${i + 1} 0 obj\n${body}\nendobj\n`
})
const xrefStart = Buffer.byteLength(out)
out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`
out += `trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xrefStart}\n%%EOF\n`

fs.writeFileSync(path.join(dir, 'B13验收.pdf'), Buffer.from(out, 'latin1'))
fs.copyFileSync('D:/storymasterv4/docs/shots/b9-1-legacy-desktop.png', path.join(dir, 'B13验收图.png'))
// 白名单外对照件：不复制真实项目的 docx（跨项目词汇不许串门），用一份自造 stub 走 415 分支
fs.writeFileSync(path.join(dir, 'B13对照.docx'), Buffer.from('B13 对照件：白名单外后缀，验收 415 显式降级用（非真 docx）', 'utf-8'))
const st = fs.statSync(dir)
console.log(JSON.stringify({
  dir,
  files: fs.readdirSync(dir).map((f) => ({ f, bytes: fs.statSync(path.join(dir, f)).size })),
  mtime: st.mtime.toISOString(),
  pdfHeader: fs.readFileSync(path.join(dir, 'B13验收.pdf'), 'latin1').slice(0, 8),
}))
