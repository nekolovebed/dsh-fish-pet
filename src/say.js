/**
 * Speech bubble board.
 *
 * One line at a time, with a TTL. A newer line replaces the current one instead
 * of queueing: an agent that talks faster than the TTL should not build a
 * backlog of stale sentences.
 */
import { Kind, message } from './protocol.js'

const MIN_MS = 1200
const MAX_MS = 60_000
const DEFAULT_MS = 6000
const MAX_CHARS = 160

export class SayBoard {
  constructor(options = {}) {
    this.emit = options.emit
    this.now = typeof options.now === 'function' ? options.now : Date.now
    this.setTimer = typeof options.setTimer === 'function' ? options.setTimer : setTimeout
    this.clearTimer = typeof options.clearTimer === 'function' ? options.clearTimer : clearTimeout
    this.current = null
    this.timer = null
  }

  snapshot() {
    return this.#payload(this.current)
  }

  /**
   * @param {{text?: string, durationMs?: number}} input
   * @returns {{ok: boolean, text: string, until: number|null, reason?: string}}
   */
  say(input) {
    const text = String(input?.text ?? '').replace(/\s+$/, '').slice(0, MAX_CHARS)
    if (!text.trim()) {
      this.clear()
      return { ok: true, text: '', until: null }
    }
    const requested = Number(input?.durationMs)
    const durationMs = Number.isFinite(requested)
      ? Math.min(MAX_MS, Math.max(MIN_MS, requested))
      : DEFAULT_MS

    this.#stopTimer()
    const until = this.now() + durationMs
    this.current = { text, until, startedAt: this.now() }
    this.emit(this.#payload(this.current))
    this.timer = this.setTimer(() => {
      this.timer = null
      this.current = null
      this.emit(this.#payload(null))
    }, durationMs)
    this.timer?.unref?.()
    return { ok: true, text, until }
  }

  clear() {
    this.#stopTimer()
    const had = Boolean(this.current)
    this.current = null
    if (had) this.emit(this.#payload(null))
  }

  dispose() {
    this.clear()
    this.emit = () => {}
  }

  #stopTimer() {
    if (this.timer !== null) {
      try {
        this.clearTimer(this.timer)
      } catch {}
      this.timer = null
    }
  }

  #payload(entry) {
    return message(Kind.SAY, {
      text: entry?.text ?? '',
      until: entry?.until ?? null,
      startedAt: entry?.startedAt ?? null,
    })
  }
}
