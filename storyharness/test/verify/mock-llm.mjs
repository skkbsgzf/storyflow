// 验收用 mock LLM（OpenAI 兼容 /chat/completions）：固定回报 usage，让「新格式会话」的指标链
// 不花真配额也能复跑。数是我造的，链是真的——用它只为验链路，别把里面的数字当业务事实。
// 两种响应都要会：① stream:true → SSE 分片（pi 的会话面/回合走这条，2026-09-29 之前只回 JSON，
//   结果 assistant 正文空、usage 全 0——「回合跑完但气泡没字」就是这么来的）；② 非流式 JSON（执行器/直读）。
// 用法：node storyharness/test/verify/mock-llm.mjs [端口=8450]
//      STORYHARNESS_WORKSPACE=<工作区> PI_BASE_URL=http://127.0.0.1:8450/v1 PI_PROVIDER=mock PI_MODEL=mock-b9 PI_API_KEY=mock \
//        npx tsx storyharness/src/cli.ts serve --port 8441
// 然后 node storyharness/test/verify/b9-turn.mjs http://127.0.0.1:8441 <项目id> "只回一句话"
import http from 'node:http'

const PORT = Number(process.argv[2] ?? 8450)
const TEXT = '指标面 mock 回复：一句话。'
const USAGE = { prompt_tokens: 1234, completion_tokens: 210, total_tokens: 1444, prompt_tokens_details: { cached_tokens: 200 } }
const chunk = (model, delta, finish) => ({
  id: 'chatcmpl-mock-b9',
  object: 'chat.completion.chunk',
  created: Math.floor(Date.now() / 1000),
  model,
  choices: [{ index: 0, delta, ...(finish ? { finish_reason: finish } : {}) }],
})

http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    if (!req.url.endsWith('/chat/completions')) {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end('{}')
      return
    }
    let reqJson = {}
    try { reqJson = JSON.parse(body || '{}') } catch { /* 坏 body：按非流式回 */ }
    // 每请求留一行：验「模型到底被调了没」——回合 2ms 就结束、正文空，就是这里没声音
    console.log(`[mock] ${req.method} ${req.url} stream=${reqJson.stream === true} model=${reqJson.model ?? '-'} msgs=${Array.isArray(reqJson.messages) ? reqJson.messages.length : 0} bytes=${body.length} roles=${(Array.isArray(reqJson.messages) ? reqJson.messages : []).map((m) => m?.role).join('/')}`)
    const model = String(reqJson.model || 'mock-b9')
    // 故障注入（缺省不触发）：末条 user 消息带 [[mock-error]] → 回 5xx。
    // 用途：验「模型侧失败不再静默出空气泡」——chat.ts 见 stopReason=error 会推 error 事件。
    // pi 发的 content 可能是字符串，也可能是内容块数组（{type:'text',text}），两种都要能读——
    // 只 String(content) 会把数组变成 [object Object]，触发词永远匹配不上（第一版探针就是这么空的）
    const flat = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((b) => (typeof b === 'string' ? b : b?.text ?? '')).join('') : '')
    const lastUser = [...(Array.isArray(reqJson.messages) ? reqJson.messages : [])].reverse().find((m) => m?.role === 'user')
    if (flat(lastUser?.content).includes('[[mock-error]]')) {
      console.log('[mock] 故障注入 → 500')
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'mock 故障注入：这条不该有正文', type: 'server_error' } }))
      return
    }
    if (!reqJson.stream) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        id: 'chatcmpl-mock-b9', object: 'chat.completion', created: Math.floor(Date.now() / 1000), model,
        choices: [{ index: 0, message: { role: 'assistant', content: TEXT }, finish_reason: 'stop' }],
        usage: USAGE,
      }))
      return
    }
    // SSE：role 头帧 → 逐字分片 → stop 尾帧 → usage 帧 → [DONE]（分片故意切三段，验前端的 delta 拼接）
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' })
    const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`)
    send(chunk(model, { role: 'assistant', content: '' }))
    for (const piece of [TEXT.slice(0, 6), TEXT.slice(6, 14), TEXT.slice(14)]) send(chunk(model, { content: piece }))
    send(chunk(model, {}, 'stop'))
    send({ id: 'chatcmpl-mock-b9', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model, choices: [], usage: USAGE })
    res.write('data: [DONE]\n\n')
    res.end()
  })
}).listen(PORT, '127.0.0.1', () => console.log(`mock llm on ${PORT}`))
