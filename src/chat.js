/**
 * Chat bridge.
 *
 * The pet's chat box is a thin front-end for a *real* DSH session, not a second
 * LLM client. That is deliberate: routing through an agent means the fish can
 * read files, run commands and use every tool the user has enabled, which is
 * what makes "chat here, work there" possible. A private provider call would
 * have been simpler and strictly less capable.
 *
 * The contract used here is the same one the web UI itself uses to submit a
 * message (`agent.followup(createUserMessage(...))`), so it stays on the
 * supported path instead of reaching into private internals.
 *
 * Everything is lazily resolved and guarded: if a future harness release
 * renames `ctx.agents` or changes `followup`, the bubble shows a readable
 * error and the rest of the plugin keeps working.
 */
import { randomUUID } from 'node:crypto'

const MAX_PROMPT = 4000

export function newSessionId() {
  return `fish-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`
}

/**
 * Build a user message value that satisfies the documented `Message` shape
 * (`{ id, role, content, source }`) without importing `@deepseek-ai/dsh-llm`,
 * which is not resolvable from a profile's `node_modules`.
 */
export function userMessage(text, rpcId = randomUUID()) {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'user', rpcId },
  }
}

export class ChatBridge {
  /**
   * @param {object} options
   * @param {import('@deepseek-ai/cordis').Context} options.ctx host context
   * @param {() => object} options.config live config getter
   * @param {(payload: object) => void} options.emit protocol sink
   * @param {(message: string, error?: unknown) => void} [options.warn] logger
   */
  constructor(options) {
    this.ctx = options.ctx
    this.config = options.config
    this.emit = options.emit
    this.warn = options.warn ?? (() => {})
    this.sessionId = newSessionId()
    this.handle = null
    this.pending = false
    /** Text accumulated for the turn currently streaming. */
    this.buffer = ''
    /** Most recent failure text, cleared when the next turn starts producing. */
    this.lastError = null
  }

  get ready() {
    return Boolean(this.handle?.agent)
  }

  /** Resolve the agent registry, or explain why chat is unavailable. */
  #registry() {
    const registry = this.ctx.get?.('agents')
    if (registry && typeof registry.create === 'function') return registry
    return null
  }

  /**
   * Create (or adopt) the pet's private session.
   * @returns {Promise<{ok: true, agent: object} | {ok: false, reason: string}>}
   */
  async ensure() {
    if (this.handle?.agent) return { ok: true, agent: this.handle.agent }
    const config = this.config()
    if (config.chatMode === 'off' || config.chatEnabled === false) {
      return { ok: false, reason: '桌宠对话已在设置中关闭' }
    }
    const registry = this.#registry()
    if (!registry) {
      return { ok: false, reason: '当前 DSH 没有提供 agents 服务，桌宠对话不可用（状态显示不受影响）' }
    }

    // Adopt an agent that already exists under our id (hot reload, HMR).
    // `registry.get()` returns a bare Agent while `create()` returns a handle,
    // so accept both shapes.
    try {
      const existing = registry.get?.(this.sessionId)
      const agent = existing?.agent ?? (typeof existing?.followup === 'function' ? existing : null)
      if (agent) {
        this.handle = { agent, dispose: async () => {} }
        return { ok: true, agent }
      }
    } catch {}

    const cwd = String(config.chatCwd || '').trim() || process.cwd()
    try {
      const handle = await registry.create({
        sessionId: this.sessionId,
        meta: { cwd },
      })
      if (!handle?.agent) {
        return { ok: false, reason: 'DSH 未能创建桌宠会话（返回为空）' }
      }
      this.handle = handle
      return { ok: true, agent: handle.agent }
    } catch (error) {
      return {
        ok: false,
        reason: `创建桌宠会话失败：${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }

  /** True when the given session id belongs to this bridge. */
  owns(sessionId) {
    return String(sessionId ?? '') === this.sessionId
  }

  /**
   * Send one user line into the pet's session.
   * @param {string} text
   */
  async send(text) {
    const content = String(text ?? '').trim().slice(0, MAX_PROMPT)
    if (!content) return { ok: false, reason: '内容为空' }
    if (this.pending) return { ok: false, reason: '上一句还没回完，稍等一下' }

    const resolved = await this.ensure()
    if (!resolved.ok) return resolved

    this.emit({ kind: 'chat', role: 'user', text: content, at: Date.now() })
    this.buffer = ''
    this.pending = true
    try {
      resolved.agent.followup(userMessage(content))
      return { ok: true }
    } catch (error) {
      this.pending = false
      const reason = `发送失败：${error instanceof Error ? error.message : String(error)}`
      this.emit({ kind: 'chat', role: 'system', text: reason, error: true, at: Date.now() })
      return { ok: false, reason }
    }
  }

  /**
   * Fold a session event belonging to the pet's session into the bubble.
   * Called from the shared `session/event` listener.
   * @returns {object[]} protocol messages
   */
  observe(session, event) {
    if (!this.owns(session?.id)) return []
    const out = []
    const type = event?.type
    if (type === 'assistant/message') {
      this.lastError = null
      const text = extractText(event.data?.message?.content)
      if (text) {
        this.buffer = this.buffer ? `${this.buffer}\n${text}` : text
        out.push({ kind: 'chat', role: 'assistant', text: this.buffer, streaming: true, at: Date.now() })
      }
      return out
    }
    if (type === 'assistant/attempt' || type === 'request/error' || type === 'error') {
      // Remember the real cause so a failed turn can explain itself instead of
      // showing a generic apology.
      this.lastError = summarize(errorDetailOf(event))
      return out
    }
    if (type === 'turn/end') {
      const kind = String(event.data?.reason?.kind ?? 'completed')
      if (kind !== 'completed' && !this.buffer.trim()) {
        const reason = this.lastError
          ?? summarize(errorDetailOf(event))
          ?? (kind === 'aborted' ? '这一轮被中断了' : '这一轮没能答上来')
        out.push({ kind: 'chat', role: 'system', text: reason, error: true, at: Date.now() })
      } else if (this.buffer.trim()) {
        out.push({ kind: 'chat', role: 'assistant', text: this.buffer, streaming: false, done: true, at: Date.now() })
      }
      this.pending = false
      this.buffer = ''
      this.lastError = null
    }
    return out
  }

  async dispose() {
    this.pending = false
    this.buffer = ''
    const handle = this.handle
    this.handle = null
    try {
      await handle?.dispose?.()
    } catch (error) {
      this.warn('failed to dispose pet session', error)
    }
  }
}

function extractText(content) {
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (block && block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join('\n').trim()
}

/**
 * Dig a human-readable cause out of an event whose shape varies across harness
 * releases. Returns `undefined` when nothing legible is present.
 */
export function errorDetailOf(event) {
  const data = event?.data
  if (!data || typeof data !== 'object') return undefined
  const candidates = [
    data.error?.message,
    data.error?.detail,
    typeof data.error === 'string' ? data.error : undefined,
    data.reason?.message,
    data.reason?.detail,
    typeof data.reason === 'string' ? data.reason : undefined,
    data.message,
    data.detail,
    data.description,
  ]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  }
  return undefined
}

function summarize(text, limit = 180) {
  if (!text) return undefined
  const flat = String(text).replace(/\s+/g, ' ').trim()
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1)}…`
}
