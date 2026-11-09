/**
 * Continuous-motion director: gaze and locomotion.
 *
 * This is the first slice of the parameter bus described in
 * `docs/AGENT-DRIVEN-ACTIONS.md`. It sits *beside* {@link PetDirector}, not
 * above it: an action clip (wave, dance…) is a discrete performance, while
 * gaze and walking are continuous states that must compose with everything
 * else — the pet can walk while a clip plays, and a task pose survives both.
 *
 * Guards, in order of importance:
 *  1. closed vocabulary — `at` / `to` must be from the protocol enums
 *  2. hard clamping — numeric input is pulled into range and reported
 *  3. bounded lifetimes — gaze and walk expire, so a stuck client self-heals
 *  4. monotonic `seq` — a replayed snapshot never replays a walk
 */
import { GAZE_TARGETS, Kind, MOTION_LIMITS, WALK_TARGETS, message } from './protocol.js'

const WALK_MIN = MOTION_LIMITS.walkDuration[0]
const WALK_MAX = MOTION_LIMITS.walkDuration[1]
const GAZE_MIN = MOTION_LIMITS.gazeDuration[0]
const GAZE_MAX = MOTION_LIMITS.gazeDuration[1]
const WALK_DEFAULT_MS = 1200
/** Walk distance/speed ratio: crossing the full viewport takes this long. */
const WALK_FULL_MS = 1400
const GAZE_POINT_DEFAULT_MS = 8000

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

export class MotionDirector {
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
    this.gazeState = null
    this.walkState = null
    this.seq = 0
    this.gazeTimer = null
    this.walkTimer = null
  }

  /** Current motion as one protocol message. */
  snapshot() {
    return this.#payload()
  }

  /**
   * Point the gaze somewhere.
   * @param {{at?: string, x?: number, y?: number, durationMs?: number}} input
   * @returns {{ok: boolean, gaze?: object, reason?: string, clamped?: string[]}}
   */
  look(input) {
    const clamped = []
    const at = typeof input?.at === 'string' ? input.at.trim() : ''
    const hasPoint = input?.x !== undefined || input?.y !== undefined

    if (!at && !hasPoint) {
      return { ok: false, reason: 'look 需要 at（front/cursor/left/right/up/down）或 x/y' }
    }
    if (at && !GAZE_TARGETS.includes(at)) {
      return { ok: false, reason: `未知视线目标 ${at}，可用：${GAZE_TARGETS.join('/')}` }
    }

    let gaze
    if (at === 'cursor') {
      gaze = { mode: 'cursor' }
    } else if (at && at !== 'cursor') {
      gaze = { mode: 'point', ...pointForTarget(at) }
    } else {
      const x = clampFinite(input.x, MOTION_LIMITS.gazePoint, clamped, 'x')
      const y = clampFinite(input.y, MOTION_LIMITS.gazePoint, clamped, 'y')
      if (x === null && y === null) {
        return { ok: false, reason: 'look 需要 at 或有效的 x/y' }
      }
      gaze = { mode: 'point', x: x ?? 0, y: y ?? 0 }
    }

    const requested = Number(input?.durationMs)
    const durationMs = Number.isFinite(requested) && requested > 0
      ? clamp(requested, GAZE_MIN, GAZE_MAX)
      : GAZE_POINT_DEFAULT_MS
    gaze.durationMs = durationMs
    gaze.until = this.now() + durationMs

    this.#setGaze(gaze)
    return { ok: true, gaze: { ...gaze }, clamped: clamped.length ? clamped : undefined }
  }

  /**
   * Walk across the viewport.
   * @param {{to?: string, durationMs?: number}} input
   * @returns {{ok: boolean, walk?: object, reason?: string, clamped?: string[]}}
   */
  walk(input) {
    const clamped = []
    const raw = input?.to
    const text = typeof raw === 'string' ? raw.trim() : String(raw ?? '').trim()
    if (!text) return { ok: false, reason: 'walk 需要 to（left/right/center 或 0..1）' }

    let target
    if (WALK_TARGETS.includes(text)) {
      target = text
    } else {
      const numeric = Number(text)
      if (!Number.isFinite(numeric)) {
        return { ok: false, reason: `未知目的地 ${text}，可用：${WALK_TARGETS.join('/')} 或 0..1` }
      }
      if (numeric < 0 || numeric > 1) clamped.push(`to: ${numeric} -> ${clamp(numeric, 0, 1)}`)
      target = clamp(numeric, 0, 1)
    }

    const requested = Number(input?.durationMs)
    let durationMs = WALK_DEFAULT_MS
    if (Number.isFinite(requested) && requested > 0) {
      durationMs = clamp(requested, WALK_MIN, WALK_MAX)
    } else if (typeof target === 'number') {
      // Distance-based timing, so a short hop is not a full glide.
      durationMs = Math.round(WALK_FULL_MS * Math.max(0.15, Math.abs(target - 0.5) * 2))
    }
    if (Number.isFinite(requested) && requested > 0 && (requested < WALK_MIN || requested > WALK_MAX)) {
      clamped.push(`durationMs: ${requested} -> ${durationMs}`)
    }

    const walk = {
      to: target,
      durationMs,
      until: this.now() + durationMs,
      seq: this.seq + 1,
    }
    this.#setWalk(walk)
    return { ok: true, walk: { ...walk }, clamped: clamped.length ? clamped : undefined }
  }

  /**
   * Clear motion. `scope` is `all` (default), `gaze` or `walk`.
   * @param {{scope?: string}} [input]
   */
  reset(input) {
    const scope = input?.scope === 'gaze' || input?.scope === 'walk' ? input.scope : 'all'
    const changed = this.gazeState !== null || this.walkState !== null
    if (scope !== 'walk') this.#setGaze(null)
    if (scope !== 'gaze') this.#setWalk(null)
    if (!changed) {
      // Still emit once so a late subscriber learns the cleared state.
      this.#bump()
      this.emit(this.#payload())
    }
    return { ok: true, scope }
  }

  dispose() {
    this.#stopTimers()
    this.gazeState = null
    this.walkState = null
    this.emit = () => {}
  }

  #setGaze(gaze) {
    this.gazeState = gaze
    this.#bump()
    this.#stopGazeTimer()
    if (gaze?.until) {
      this.gazeTimer = this.setTimer(() => {
        this.gazeTimer = null
        this.gazeState = null
        this.#bump()
        this.emit(this.#payload())
      }, Math.max(50, gaze.until - this.now()))
      this.gazeTimer?.unref?.()
    }
    this.emit(this.#payload())
  }

  #setWalk(walk) {
    this.walkState = walk
    this.#bump()
    this.#stopWalkTimer()
    if (walk?.until) {
      this.walkTimer = this.setTimer(() => {
        this.walkTimer = null
        this.walkState = null
        this.#bump()
        this.emit(this.#payload())
      }, Math.max(50, walk.until - this.now()))
      this.walkTimer?.unref?.()
    }
    this.emit(this.#payload())
  }

  #bump() {
    this.seq += 1
  }

  #stopGazeTimer() {
    if (this.gazeTimer !== null) {
      try {
        this.clearTimer(this.gazeTimer)
      } catch {}
      this.gazeTimer = null
    }
  }

  #stopWalkTimer() {
    if (this.walkTimer !== null) {
      try {
        this.clearTimer(this.walkTimer)
      } catch {}
      this.walkTimer = null
    }
  }

  #stopTimers() {
    this.#stopGazeTimer()
    this.#stopWalkTimer()
  }

  #payload() {
    return message(Kind.MOTION, {
      seq: this.seq,
      gaze: this.gazeState ? { ...this.gazeState } : null,
      walk: this.walkState ? { ...this.walkState } : null,
    })
  }
}

/** Fixed offsets for the named gaze targets, in normalised units. */
function pointForTarget(at) {
  switch (at) {
    case 'left': return { x: -1, y: 0 }
    case 'right': return { x: 1, y: 0 }
    case 'up': return { x: 0, y: -1 }
    case 'down': return { x: 0, y: 0.6 }
    default: return { x: 0, y: 0 }
  }
}

function clampFinite(value, range, clamped, label) {
  if (value === undefined || value === null || value === '') return null
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    clamped.push(`${label}: ${value} -> 忽略（非数字）`)
    return null
  }
  const [min, max] = range
  if (numeric < min || numeric > max) clamped.push(`${label}: ${numeric} -> ${clamp(numeric, min, max)}`)
  return clamp(numeric, min, max)
}
