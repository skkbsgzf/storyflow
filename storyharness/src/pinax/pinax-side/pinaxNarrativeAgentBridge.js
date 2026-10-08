import { sha256Hex } from './canonicalJson.js'
const createBrowserStorageRepository = () => ({ getText: key => globalThis.localStorage?.getItem(key), setText: (key, value) => globalThis.localStorage?.setItem(key, value) })
// === bridge-sync：此行之下两副本必须逐字节一致（scripts/check-bridge-sync.mjs）===

const DOMAINS = {
  world: 'world_lookup',
  geo: 'geo_lookup',
  history: 'history_lookup',
  memory: 'memory_lookup',
  politics: 'politics_lookup',
  manuscript: 'manuscript', notes: 'notes', outline: 'outline',
}

function text(value, limit = 520) {
  const s = String(value ?? '').trim()
  return s.length > limit ? `${s.slice(0, limit - 1)}…` : s
}

// 浏览器侧 stores 的数据 Node 看不见——随请求带资源快照上行（解决落盘时机不一致）
export function buildResourceSnapshot(index, { maxItemsPerDomain = 120 } = {}) {
  const domains = {}
  const coverage = {}
  maxItemsPerDomain = Number.isFinite(maxItemsPerDomain) ? Math.max(1, Math.min(120, Math.floor(maxItemsPerDomain))) : 120
  for (const [domain, toolName] of Object.entries(DOMAINS)) {
    const resources = index?.byDomain?.get?.(domain) || index?.byDomain?.[domain] || []
    if (!Array.isArray(resources) || resources.length === 0) continue
    const itemLimit = ['manuscript', 'notes', 'outline'].includes(domain) ? Math.min(60, maxItemsPerDomain) : maxItemsPerDomain
    coverage[toolName] = { included: Math.min(resources.length, itemLimit), available: resources.length, maxTextCharacters: domain === 'manuscript' ? 8000 : 2400 }
    domains[toolName] = resources.slice(0, itemLimit).map((r) => ({
      id: text(r.id, 120),
      title: text(r.title || r.name || '', 120),
      type: text(r.type || '', 60),
      summary: text(r.summary || r.content || r.description || r.text || '', 520),
      text: text(r.text || r.content || r.summary || '', domain === 'manuscript' ? 8000 : 2400),
      aliases: (Array.isArray(r.aliases) ? r.aliases : []).map((a) => text(a, 60)).filter(Boolean),
      tags: (Array.isArray(r.tags) ? r.tags : []).map((t) => text(t, 40)).filter(Boolean),
      relations: (Array.isArray(r.relations) ? r.relations : []).slice(0, 12).map((rel) => ({ type: text(rel.type || 'related', 40), targetId: text(rel.targetId || rel.id || '', 120) })),
      trust: text(r.trust || '', 40),
      sourceRefs: (Array.isArray(r.sourceRefs) ? r.sourceRefs : []).slice(0, 6).map((s) => text(s, 120)),
      ...(r.position ? { position: r.position } : {}),
      ...(Array.isArray(r.connectedPlaces) ? { connectedPlaces: r.connectedPlaces.slice(0, 20) } : {}),
      ...(r.faction ? { faction: text(r.faction, 80) } : {}),
      ...(Array.isArray(r.controls) ? { controls: r.controls.slice(0, 20) } : {}),
      ...(r.time ? { time: text(r.time, 60) } : {}),
      ...(r.cause ? { cause: text(r.cause, 120) } : {}),
    }))
  }
  return { revision: text(index?.revision || '', 80), currentPlaceId: text(index?.currentPlaceId || '', 120), domains, coverage }
}

// kernel.blocks 复用 Pinax 已预算化的串行化产物；缺省时从 kernel 现拼一份有界块表
export function buildKernelPayload(kernel) {
  if (Array.isArray(kernel?.serialization?.blocks)) {
    return { revision: text(kernel.revision || '', 80), blocks: kernel.serialization.blocks }
  }
  const pick = (kind, value, limit) => (value ? { kind, title: kind, text: text(value, limit) } : null)
  const blocks = [
    pick('scene', kernel?.scene?.title || kernel?.scene?.summary, 800),
    pick('character', kernel?.character?.name ? `${kernel.character.name}${kernel.character.profile ? `：${kernel.character.profile}` : ''}` : kernel?.character?.summary, 1200),
    pick('time', kernel?.time?.label || kernel?.time, 200),
    pick('location', kernel?.location?.name || kernel?.location, 400),
    pick('activities', Array.isArray(kernel?.activities) ? kernel.activities.map((a) => a?.title || a).join('；') : kernel?.activities, 600),
    pick('goals', Array.isArray(kernel?.goals) ? kernel.goals.join('；') : kernel?.goals, 600),
    pick('continuity', kernel?.continuity?.summary || kernel?.thread?.summary, 1200),
    pick('voice', kernel?.voice?.policy || kernel?.voice?.anchor, 800),
    pick('recent', Array.isArray(kernel?.recentMessages) ? kernel.recentMessages.slice(-6).map((m) => `${m.role}:${text(m.content, 200)}`).join('\n') : kernel?.recentText, 2400),
  ].filter(Boolean)
  return { revision: text(kernel?.revision || '', 80), blocks }
}

function parseSseFrame(raw) {
  const lines = String(raw || '').split(/\r?\n/)
  const eventName = lines.find((l) => l.startsWith('event:'))?.slice(6).trim() || 'message'
  const data = lines.filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n')
  if (!data) return null
  let parsed = null
  try { parsed = JSON.parse(data) } catch { return null }
  return { eventName, data: parsed }
}

const STREAM_EVENT_TYPES = new Set(['step.start', 'tool.input.delta', 'tool.call', 'text.delta', 'step.finish', 'usage', 'error'])
const TASK_EVENT_TYPES = new Set(['task.started', 'task.completed', 'task.failed'])
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled'])

function abortError(signal) {
  if (signal?.reason?.name === 'AbortError') return signal.reason
  return new DOMException(String(signal?.reason?.message || '请求已中止'), 'AbortError')
}

async function requestError(response) {
  const payload = await response.json().catch(() => null)
  const friendly = ({ 403: '当前浏览器无法续接这项任务，请重新开始任务。', 404: '原任务已不可用，请重新开始任务；现有对话仍保留。', 409: '任务仍在运行，请先停止后再继续。', 422: '这项任务没有可续接的记录，请重新开始任务。', 429: '写作工具正在忙，请稍后重试。', 503: '写作工具暂不可用，请稍后重试。' })[response.status]
  const error = new Error(friendly || '写作任务请求失败，请稍后重试。')
  error.name = 'PinaxAdapterRequestError'
  error.status = response.status
  error.code = payload?.error || 'request-failed'
  return error
}

export function createPiNarrativeAgentBridge({ endpoint = '/api/storyagent', fetchImpl = fetch, parseEvent = null } = {}) {
  const base = String(endpoint).replace(/\/$/, '')
  const repo = createBrowserStorageRepository()
  let session = ''
  try { session = repo.getText('pinax_agent_client_capability') || '' } catch { /* transient capability */ }
  if (!/^[a-f0-9]{64}$/.test(session)) {
    session = [...crypto.getRandomValues(new Uint8Array(32))].map(v => v.toString(16).padStart(2, '0')).join('')
    try { repo.setText('pinax_agent_client_capability', session) } catch { /* page-local capability */ }
  }
  const headers = { 'content-type': 'application/json', 'x-pinax-agent-session': session }
  const scope = sha256Hex(session).slice(0, 24)
  const freshId = () => `${Date.now().toString(36)}_${[...crypto.getRandomValues(new Uint8Array(8))].map(v => v.toString(16).padStart(2, '0')).join('')}`
  const scopedId = (id) => { const prefix = `pa_${scope}_`; return String(id || '').startsWith(prefix) ? id : `${prefix}${String(id || freshId()).slice(0, 52)}` }

  async function streamTask(path, body, { signal, callbacks = {}, onStatus, state }) {
    const response = await fetchImpl(`${base}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    })
    if (!response.ok) throw await requestError(response)
    if (!response.body) throw new Error('pinax-adapter 未返回事件流')
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let finalText = ''
    const events = []
    let ended = false
    let readerCancelled = false
    const cancelReader = () => {
      if (readerCancelled) return
      readerCancelled = true
      // 清理失败不能替换原来的中止/传输异常。
      reader.cancel(signal?.reason).catch(() => {})
    }
    const emitStatus = (status) => {
      onStatus?.(status)
      if (callbacks.onStatus !== onStatus) callbacks.onStatus?.(status)
    }
    const consumeFrame = (raw) => {
      if (!raw.trim()) return
      const named = parseSseFrame(raw)
      if (state.terminal && (TASK_EVENT_TYPES.has(named?.eventName) || STREAM_EVENT_TYPES.has(named?.eventName))) throw new Error('pinax-adapter 终态之后仍有任务输出')
      // 生命周期不属于 narrative parser 的事件集，两种接入方式都必须处理。
      if (TASK_EVENT_TYPES.has(named?.eventName)) {
        if (!named.data || typeof named.data !== 'object' || Array.isArray(named.data)) throw new Error('pinax-adapter 任务事件格式错误')
        if (named.data.taskId && body.taskId && named.data.taskId !== body.taskId) throw new Error('pinax-adapter 任务标识不一致')
        const fallbackStatus = named.eventName === 'task.started' ? 'running' : named.eventName === 'task.completed' ? 'completed' : 'failed'
        state.taskEvent = { ...state.taskEvent, ...named.data, status: named.data.status || fallbackStatus }
        const validStatus = named.eventName === 'task.started' ? state.taskEvent.status === 'running'
          : named.eventName === 'task.completed' ? state.taskEvent.status === 'completed'
            : ['failed', 'cancelled'].includes(state.taskEvent.status)
        if (!validStatus || state.terminal) throw new Error('pinax-adapter 任务生命周期不一致')
        if (named.eventName !== 'task.started') {
          state.terminal = true
          if (state.taskEvent.status !== 'completed') {
            state.error = state.taskEvent.error || state.error || { code: 'PINAX_ADAPTER_TASK_FAILED', message: `任务状态：${state.taskEvent.status}`, retryable: false }
          }
        }
        if (named.eventName === 'task.completed') {
          if (typeof named.data.finalText === 'string') finalText = named.data.finalText
          state.beatPlan = named.data.beatPlan || state.beatPlan || null
        }
        callbacks.onTask?.(state.taskEvent, named.eventName)
        return
      }
      if (named?.eventName === 'reasoning.delta') { const content = String(named.data?.delta || ''); state.reasoningChars = (state.reasoningChars || 0) + content.length; callbacks.onReasoning?.({ content }); return }
      if (named?.eventName === 'beat.plan') { state.beatPlan = named.data?.plan || null; callbacks.onBeatPlan?.(state.beatPlan); return }
      if (named?.eventName === 'tool.result') {
        if (named.data && typeof named.data.toolName === 'string') {
          (state.toolResults ||= []).push(named.data); callbacks.onToolResult?.(named.data)
        }
        return
      }
      // 默认 parser 读取标准 schema；显式 parser 可增加 Pinax 的契约核对。
      const frame = parseEvent ? parseEvent(raw) : named?.data
      if (!frame || frame.schemaVersion !== 1 || !STREAM_EVENT_TYPES.has(frame.type)) {
        if (STREAM_EVENT_TYPES.has(named?.eventName)) throw new Error('pinax-adapter 叙事事件不符合流契约')
        return
      }
      const type = frame.type
      events.push({ type, data: frame, at: Date.now() })
      if (type === 'text.delta') {
        const content = String(frame.content ?? '')
        finalText += content
        callbacks.onChunk?.({ content })
      } else if (type === 'tool.call') {
        emitStatus({ phase: 'tool', tool: frame.toolName, action: frame.action })
      } else if (type === 'step.start') {
        emitStatus({ phase: 'step', stepIndex: frame.stepIndex, toolChoice: frame.toolChoice })
      } else if (type === 'usage') {
        state.usage = frame.usage || state.usage
      } else if (type === 'error') {
        state.error = { code: frame.code, message: frame.message, retryable: frame.retryable }
      }
    }
    signal?.addEventListener('abort', cancelReader, { once: true })
    try {
      while (true) {
        if (signal?.aborted) throw abortError(signal)
        const { done, value } = await reader.read()
        if (signal?.aborted) throw abortError(signal)
        if (done) { ended = true; break }
        buffer += decoder.decode(value, { stream: true })
        let separator
        while ((separator = /\r?\n\r?\n/.exec(buffer))) {
          const raw = buffer.slice(0, separator.index)
          buffer = buffer.slice(separator.index + separator[0].length)
          consumeFrame(raw)
        }
      }
      buffer += decoder.decode()
      if (buffer.trim()) consumeFrame(buffer)
      if (!state.terminal) throw new Error(`pinax-adapter 事件流未确认任务终态${state.error?.message ? `：${state.error.message}` : ''}`)
      return { finalText, events }
    } catch (error) {
      if (signal?.aborted) {
        // A lost reader is not confirmation that the remote model stopped.
        const taskId = state.taskEvent?.taskId || body.taskId
        if (taskId) {
          try { await fetchImpl(`${base}/v1/pinax/tasks/${encodeURIComponent(taskId)}/cancel`, { method: 'POST', headers, signal: AbortSignal.timeout(5000) }) } catch { /* original abort remains authoritative locally */ }
        }
        throw abortError(signal)
      }
      throw error
    } finally {
      signal?.removeEventListener('abort', cancelReader)
      if (!ended) cancelReader()
      reader.releaseLock()
    }
  }

  function resultOf(state, finalText, events, taskId, resumed = false) {
    const toolCalls = events.filter((e) => e.type === 'tool.call')
    const steps = events.filter((e) => e.type === 'step.start')
    const status = state.taskEvent?.status === 'completed' && state.error ? 'failed' : state.taskEvent?.status
    const ok = status === 'completed' && !state.error
    return {
      ok,
      finalContent: finalText,
      provider: 'pi-agent',
      model: state.taskEvent?.model || 'pi-agent',
      usage: state.usage || state.taskEvent?.usage || { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      toolRounds: Math.max(0, steps.length - 1),
      totalCalls: toolCalls.length,
      ...(state.error ? { error: state.error } : {}),
      trace: {
        engine: 'pi-agent-adapter',
        steps: Number(state.taskEvent?.steps) || steps.length,
        reasoningChars: state.reasoningChars || 0,
        terminalMode: toolCalls.length ? 'tool-assisted' : 'direct-text',
        calls: toolCalls.map((e) => ({ name: e.data.toolName, action: e.data.action })),
        groundingPolicy: { level: (state.toolResults || []).some(result => !result.isError && /lookup|manuscript|notes/.test(result.toolName)) ? 'evidenced' : 'none' },
        taskId: state.taskEvent?.taskId || taskId || null,
        ...(state.taskEvent?.bookId ? { bookId: state.taskEvent.bookId } : {}),
        status,
        ...(resumed ? { resumed: true } : {}),
      },
      beatPlan: state.beatPlan || null,
      finalToolResults: state.toolResults || [],
    }
  }

  return {
    async healthz({ signal = null, timeoutMs = 2500 } = {}) {
      const controller = new AbortController()
      const abort = () => controller.abort(signal.reason)
      if (signal?.aborted) abort()
      else signal?.addEventListener('abort', abort, { once: true })
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const response = await fetchImpl(`${base}/healthz`, { signal: controller.signal })
        return response.ok ? await response.json() : null
      } catch { if (signal?.aborted) throw abortError(signal); return null }
      finally { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
    },

    async run({ kernel, index, registry, mode = 'continue', intent = null, formatInstructions = '', requestId = '', signal = null, callbacks = {}, onStatus = null, budget = null, taskId = null, bookId = null, taskKind = 'narrative' }) {
      taskId = base === '/api/storyagent' ? scopedId(taskId) : taskId || freshId()
      if (signal?.aborted) throw abortError(signal)
      const state = { usage: null, error: null, taskEvent: null, terminal: false }
      const body = {
        requestId: requestId || `pi_${Date.now().toString(36)}`,
        mode, taskKind,
        intent,
        formatInstructions,
        // 作品归属（PR #4 审阅②）：任务开始时固定；适配器全程携带并落账
        ...(bookId ? { bookId } : {}),
        kernel: buildKernelPayload(kernel),
        resources: buildResourceSnapshot(index, { maxItemsPerDomain: budget?.maxItemsPerDomain }),
        ...(budget ? { budget: { agentTimeoutMs: budget.agentTimeoutMs, maxModelSteps: budget.maxModelSteps, maxCallsPerTurn: budget.maxCallsPerTurn } } : {}),
        ...(taskId ? { taskId } : {}),
      }
      if (registry?.revision) body.resources.revision = body.resources.revision || String(registry.revision)
      const { finalText, events } = await streamTask('/v1/pinax/tasks', body, { signal, callbacks, onStatus, state })
      const result = resultOf(state, finalText, events, taskId)
      if (result.ok) callbacks.onComplete?.({ content: finalText })
      return result
    },

    async tasks(bookId = '') {
      const response = await fetchImpl(`${base}/v1/pinax/tasks/list?bookId=${encodeURIComponent(bookId)}`, { headers })
      return response.ok ? response.json() : { tasks: [] }
    },

    async status(taskId) {
      const r = await fetchImpl(`${base}/v1/pinax/tasks/${encodeURIComponent(taskId)}`, { headers })
      return r.ok ? r.json() : null
    },

    async cancel(taskId, { signal = null } = {}) {
      const r = await fetchImpl(`${base}/v1/pinax/tasks/${encodeURIComponent(taskId)}/cancel`, { method: 'POST', signal, headers })
      if (!r.ok) throw await requestError(r)
      const result = await r.json()
      if (result?.ok !== true || result.stopped !== true || result.taskId !== taskId || !TERMINAL_STATUSES.has(result.status)) {
        throw new Error('pinax-adapter 未确认取消请求后的任务终态')
      }
      return { ...result, cancelled: result.status === 'cancelled' }
    },

    async resume({ taskId, kernel, index, intent = null, callbacks = {}, onStatus = null, signal = null, requestId = '', bookId = null, taskKind = 'assistant', formatInstructions = '' }) {
      const state = { usage: null, error: null, taskEvent: null, terminal: false }
      const body = {
        requestId: requestId || `pi_resume_${Date.now().toString(36)}`,
        mode: 'continue', taskId, taskKind, formatInstructions,
        intent,
        // 归属不变式：续跑重发同值；客户端漏发时适配器以快照为准（旧任务永远归旧作品）
        ...(bookId ? { bookId } : {}),
        kernel: buildKernelPayload(kernel),
        resources: buildResourceSnapshot(index),
      }
      const { finalText, events } = await streamTask(`/v1/pinax/tasks/${encodeURIComponent(taskId)}/resume`, body, { signal, callbacks, onStatus, state })
      const result = resultOf(state, finalText, events, taskId, true)
      if (result.ok) callbacks.onComplete?.({ content: finalText })
      return result
    },
  }
}
