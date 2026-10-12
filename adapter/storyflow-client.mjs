// StoryFlow 适配层参考客户端（零依赖，浏览器 / Electron / Node 通用）
// 契约：一个 base URL + 一个口令（可选）+ 七个端点（见 adapter/README.md）。
// 事件 schema 以 runtime 实发为准；本客户端只做传输与订阅，不做业务解释。

export class StoryFlowClient {
  /**
   * @param base    runtime 地址，如 http://127.0.0.1:8431
   * @param options { password?: string }  设 SH_PASSWORD 后必填
   */
  constructor(base, options = {}) {
    this.base = base.replace(/\/+$/, '')
    this.password = options.password || ''
    this.token = ''   // 登录后由 runtime 下发（cookie 或显式带上）
  }

  async #req(path, init = {}) {
    const headers = { ...(init.headers || {}) }
    if (this.token) headers['authorization'] = `Bearer ${this.token}`
    const r = await fetch(this.base + path, { ...init, headers })
    if (r.status === 401) throw new Error('未授权：需要口令（先调 login）')
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}: ${await r.text().catch(() => '')}`)
    return r.json()
  }

  #post(path, body) {
    return this.#req(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) })
  }

  /** 口令登录（runtime 设了 SH_PASSWORD 才需要）
   *  服务端把 token 只放在 HttpOnly cookie 里（响应体是 {ok,ttlHours}），所以：
   *  · 浏览器——cookie 自动随请求走，this.token 留空也没事（跨源宿主需自行带 credentials:'include'）；
   *  · Node/Electron 主进程——fetch 没有 cookie 罐，这里从 Set-Cookie 里把 token 抠出来改走 Bearer。
   *  没有这一步，非浏览器宿主登录后依旧 401（W4.2 fileWrite 实测撞出来的既存缺口）。 */
  async login(password) {
    const headers = { 'content-type': 'application/json' }
    const r = await fetch(this.base + '/api/login', { method: 'POST', headers, body: JSON.stringify({ password }) })
    if (r.status === 401) throw new Error('未授权：需要口令（先调 login）')
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}: ${await r.text().catch(() => '')}`)
    const j = await r.json().catch(() => ({}))
    const fromCookie = (typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : [])
      .map((c) => /(?:^|;\s*)sh_token=([^;]+)/.exec(c)).filter(Boolean).map((m) => m[1])[0]
    this.token = j.token || fromCookie || this.token
    return { ...j, tokenVia: j.token ? 'body' : fromCookie ? 'set-cookie' : 'none（浏览器靠 cookie 自动随请求）' }
  }

  /** 工作区/项目/流程清单 */
  hub() { return this.#req('/api/hub') }
  /** 生产线运行状态 */
  status() { return this.#req('/status') }
  /** 启动一条生产线（project 为项目 id） */
  start(project) { return this.#post('/start', { project }) }
  /** 下一批边界停止 */
  stop() { return this.#post('/stop') }

  /** 会话清单 / 回放 / 会话级指标 */
  sessions(project) { return this.#req(`/api/projects/${encodeURIComponent(project)}/agent/sessions`) }
  /** 新建会话（title 可空） */
  createSession(project, title = '') { return this.#post(`/api/projects/${encodeURIComponent(project)}/agent/sessions`, { title }) }
  transcript(project, sid) { return this.#req(`/api/projects/${encodeURIComponent(project)}/agent/sessions/${encodeURIComponent(sid)}`) }
  stats(project, sid) { return this.#req(`/api/projects/${encodeURIComponent(project)}/agent/sessions/${encodeURIComponent(sid)}/stats`) }

  /** 发一个对话回合；onEvent 逐个收到 SSE 事件（delta/tool_call/tool_result/done/error） */
  async turn(project, sid, text, mode = 'full', onEvent = () => {}) {
    const r = await fetch(this.base + `/api/projects/${encodeURIComponent(project)}/agent/sessions/${encodeURIComponent(sid)}/turn`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, mode }),
    })
    if (!r.ok || !r.body) throw new Error(`turn ${r.status}`)
    const reader = r.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let i
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, i); buf = buf.slice(i + 2)
        const line = frame.split('\n').find(l => l.startsWith('data: '))
        if (!line) continue
        const payload = line.slice(6)
        if (payload === '[DONE]') return
        try { onEvent(JSON.parse(payload)) } catch { /* 非JSON帧忽略 */ }
      }
    }
  }

  /** 生产线实时事件流（run_start / 批事件 / run_end / final）——永远订阅 */
  events() {
    const base = this.base, headers = this.token ? { authorization: `Bearer ${this.token}` } : {}
    return (async function* () {
      const r = await fetch(base + '/events', { headers })
      if (!r.ok || !r.body) throw new Error(`events ${r.status}`)
      const reader = r.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        let i
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, i); buf = buf.slice(i + 2)
          const line = frame.split('\n').find(l => l.startsWith('data: '))
          if (!line) continue
          try { yield JSON.parse(line.slice(6)) } catch { /* 忽略非JSON帧 */ }
        }
      }
    })()
  }

  /** 官方面板数据（工单-20261002 批A）：仅 files|raw|preview 三端点存活；
   *  worldbook/telemetry/changes/canvas 已退役（410 GONE）。 */
  panel(project, kind) { return this.#req(`/api/panel/${kind}?project=${encodeURIComponent(project)}`) }

  // ── 官方能力面（四能力，详见 adapter/README.md 能力声明总表）─────────

  /** 本地文件·两层文件树 [{path,sizeKB,mtime}] */
  fileList(project) { return this.#req(`/api/panel/files?project=${encodeURIComponent(project)}`) }
  /** 本地文件·读文本（.md/.json/.txt，≤200KB 截断） */
  fileRead(project, file) { return this.#req(`/api/panel/files?project=${encodeURIComponent(project)}&file=${encodeURIComponent(file)}`) }
  /** 本地文件·字节流 URL（图/PDF/音频白名单，供 <img>/<iframe>/fetch 自取） */
  fileRawUrl(project, file) { return `${this.base}/api/panel/raw?project=${encodeURIComponent(project)}&file=${encodeURIComponent(file)}` }
  /** 本地文件·预览判定元数据（kind: inline|text|none|missing ＋ url ＋ note） */
  filePreview(project, file) { return this.#req(`/api/panel/preview?project=${encodeURIComponent(project)}&file=${encodeURIComponent(file)}`) }
  /** 本地文件·写文本（W4.2 通道 B）：只收 .md/.txt（.json 是派生件，工具独占写），服务端走临时件 → 回读校验 → 原子替换，绝不半截写。
   *  expectHash 用 fileRead() 回的 hash：目标已存在而不带 → 409 EXPECT_HASH_REQUIRED；带了但对不上 → 409 CONFLICT（零写入，payload.hash 是盘上当前指纹）。
   *  与其他方法不同：4xx **不抛**，原样交回 {status, ...payload}——冲突是预期状态，调用方要拿指纹重读合流；5xx 才抛。 */
  async fileWrite(project, file, content, expectHash) {
    const headers = { 'content-type': 'application/json' }
    if (this.token) headers['authorization'] = `Bearer ${this.token}`
    const r = await fetch(`${this.base}/api/panel/files?project=${encodeURIComponent(project)}&file=${encodeURIComponent(file)}`, {
      method: 'PUT', headers, body: JSON.stringify(expectHash ? { content, expectHash } : { content }),
    })
    const j = await r.json().catch(() => ({}))
    if (r.status >= 500) throw new Error(`${r.status} ${r.statusText}: ${j.error || ''}`)
    return { status: r.status, ...j }
  }

  /** 世界书检索（GraphHyperRAG：标题/tag/摘要打分 + 一跳关系扩展） */
  worldbookSearch(project, q, k) { return this.kernelVerb('worldbook_search', { project, q, ...(k ? { k } : {}) }) }

  /** RAG 检索（95 张方法论/标尺卡） */
  kbSearch(q, k) { return this.kernelVerb('kb_search', { q, ...(k ? { k } : {}) }) }
  /** RAG 读卡正文（ref = 卡 id 如 kb/aesthetic/character） */
  kbRead(ref, maxChars) { return this.kernelVerb('kb_read', { ref, ...(maxChars ? { max_chars: maxChars } : {}) }) }

  /** 内核动词白名单代理（flow_init/run/next/effect · kb_search/kb_read · worldbook_search） */
  kernelVerb(verb, args = {}) { return this.#post('/api/kernel-verb', { verb, args }) }
}
