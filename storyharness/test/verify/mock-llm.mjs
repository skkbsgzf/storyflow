// B9 验收用 mock LLM（OpenAI 兼容 /chat/completions）：固定回报 usage，让「新格式会话」的指标链
// 不花真配额也能复跑。数是我造的，链是真的——用它只为验链路，别把里面的数字当业务事实。
// 用法：node storyharness/test/verify/mock-llm.mjs [端口=8450]
//      STORYHARNESS_WORKSPACE=<工作区> PI_BASE_URL=http://127.0.0.1:8450/v1 PI_PROVIDER=mock PI_MODEL=mock-b9 PI_API_KEY=mock \
//        npx tsx storyharness/src/cli.ts serve --port 8441
// 然后 node storyharness/test/verify/b9-turn.mjs http://127.0.0.1:8441 <项目id> "只回一句话"
import http from 'node:http'

const PORT = Number(process.argv[2] ?? 8450)

http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    if (!req.url.endsWith('/chat/completions')) {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end('{}')
      return
    }
    const payload = {
      id: 'chatcmpl-mock-b9',
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: 'mock-b9',
      choices: [{ index: 0, message: { role: 'assistant', content: '指标面 mock 回复：一句话。' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1234, completion_tokens: 210, total_tokens: 1444, prompt_tokens_details: { cached_tokens: 200 } },
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(payload))
  })
}).listen(PORT, '127.0.0.1', () => console.log(`mock llm on ${PORT}`))
