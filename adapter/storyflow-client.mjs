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

  /** 口令登录（runtime 设了 SH_PASSWORD 才需要） */
  async login(password) {
    const r = await this.#req('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) })
    this.token = r.token || this.token
    return r
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

  /** 面板只读数据：kind ∈ worldbook | files | telemetry */
  panel(project, kind) { return this.#req(`/api/panel/${kind}?project=${encodeURIComponent(project)}`) }

  /** 内核动词白名单代理（flow_run / flow_next / flow_effect / flow_init） */
  kernelVerb(verb, args = {}) { return this.#post('/api/kernel-verb', { verb, args }) }
}
