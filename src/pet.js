/**
 * Pet director: turns agent tool calls into timed, serialised actions.
 *
 * Priority, highest first:
 *   1. a transient action started by `pet_act`
 *   2. the pose derived from `session/event` (existing tracker)
 *   3. idle
 *
 * The director only owns level 1. It never writes the tracker's pose, so when an
 * action ends the pet simply falls back to whatever the session is doing — a
 * running task keeps showing WORKING instead of being reset to IDLE.
 */
import { ACTION_DURATION, Action, Kind, message } from './protocol.js'

const MAX_QUEUE = 4
const MAX_DURATION = 10_000
const MIN_DURATION = 200

export class PetDirector {
  /**
   * @param {object} options
   * @param {(payload: object) => void} options.emit protocol sink
   * @param {() => number} [options.now] injectable clock (tests)
   * @param {(fn: () => void, ms: number) => unknown} [options.setTimer]
   * @param {(handle: unknown) => void} [options.clearTimer]
   */
  constructor(options) {
    this.emit = options.emit
    this.now = typeof options.now === 'function' ? options.now : Date.now
    this.setTimer = typeof options.setTimer === 'function' ? options.setTimer : setTimeout
    this.clearTimer = typeof options.clearTimer === 'function' ? options.clearTimer : clearTimeout
    this.active = null
    this.queue = []
    this.timer = null
  }

  /** Message describing the current action, for late subscribers. */
  snapshot() {
    return this.#payload(this.active)
  }

  /**
   * Queue one action.
   * @param {{action: string, text?: string, durationMs?: number}} input
   * @returns {{ok: boolean, action: string, until: number|null, queued: boolean, reason?: string}}
   */
  act(input) {
    const action = String(input?.action || '').trim()
    if (!Object.values(Action).includes(action)) {
      return { ok: false, action, until: null, queued: false, reason: `未知动作 ${action}` }
    }
    const text = typeof input?.text === 'string' ? input.text.trim().slice(0, 120) : ''
    const requested = Number(input?.durationMs)
    const fallback = ACTION_DURATION[action] ?? 1200
    const durationMs = fallback === 0
      ? 0
      : Math.min(MAX_DURATION, Math.max(MIN_DURATION, Number.isFinite(requested) ? requested : fallback))
    const entry = { action, text, durationMs, until: null }

    // A persistent action (sleep/think) is a state, not a clip: replace it
    // instead of queueing behind something that never ends.
    if (this.active && this.active.durationMs === 0) {
      this.#start(entry)
      return { ok: true, action, until: this.active.until, queued: false }
    }

    if (!this.active) {
      this.#start(entry)
      return { ok: true, action, until: this.active.until, queued: false }
    }

    if (this.queue.length >= MAX_QUEUE) {
      return { ok: false, action, until: null, queued: false, reason: '动作队列已满，等它跳完再说' }
    }
    this.queue.push(entry)
    return { ok: true, action, until: null, queued: true }
  }

  /** Drop the current action and the queue, telling clients to fall back. */
  clear() {
    this.#stopTimer()
    const had = Boolean(this.active) || this.queue.length > 0
    this.active = null
    this.queue = []
    if (had) this.emit(this.#payload(null))
  }

  dispose() {
    this.clear()
    this.emit = () => {}
  }

  #start(entry) {
    this.#stopTimer()
    const until = entry.durationMs > 0 ? this.now() + entry.durationMs : null
    this.active = { ...entry, until, startedAt: this.now() }
    this.emit(this.#payload(this.active))
    if (entry.durationMs > 0) {
      this.timer = this.setTimer(() => {
        this.timer = null
        this.active = null
        this.emit(this.#payload(null))
        this.#drain()
      }, entry.durationMs)
      this.timer?.unref?.()
    }
  }

  #drain() {
    const next = this.queue.shift()
    if (next) this.#start(next)
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
    if (!entry) return message(Kind.ACTION, { action: null, text: '', until: null, queued: this.queue.length })
    return message(Kind.ACTION, {
      action: entry.action,
      text: entry.text || '',
      durationMs: entry.durationMs,
      startedAt: entry.startedAt,
      until: entry.until,
      queued: this.queue.length,
    })
  }
}
