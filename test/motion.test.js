import test from 'node:test'
import assert from 'node:assert/strict'

import { MotionDirector } from '../src/motion.js'
import { Kind } from '../src/protocol.js'

/**
 * Timer-faithful harness: expired timers fire through `advance`, so TTL
 * behaviour is asserted without real time.
 */
function harness() {
  const sent = []
  let clock = 1_730_000_000_000
  const timers = new Map()
  let nextId = 1
  const director = new MotionDirector({
    emit: (payload) => sent.push(payload),
    now: () => clock,
    setTimer: (fn, ms) => {
      const id = nextId++
      timers.set(id, { fn, at: clock + ms })
      return id
    },
    clearTimer: (id) => timers.delete(id),
  })
  return {
    director,
    sent,
    advance(ms) {
      clock += ms
      const due = [...timers.entries()].filter(([, timer]) => timer.at <= clock)
      for (const [id, timer] of due) {
        timers.delete(id)
        timer.fn()
      }
    },
    last() {
      return sent[sent.length - 1]
    },
  }
}

test('look accepts the named targets and reports the state', () => {
  const { director, last } = harness()
  const result = director.look({ at: 'cursor' })
  assert.equal(result.ok, true)
  assert.equal(result.gaze.mode, 'cursor')
  assert.equal(last().kind, Kind.MOTION)
  assert.equal(last().gaze.mode, 'cursor')
  assert.ok(Number.isFinite(last().seq))
})

test('look with a point clamps into range and reports what was trimmed', () => {
  const { director } = harness()
  const result = director.look({ x: -3, y: 0.2 })
  assert.equal(result.ok, true)
  assert.equal(result.gaze.x, -1)
  assert.equal(result.gaze.y, 0.2)
  assert.deepEqual(result.clamped, ['x: -3 -> -1'])
})

test('look without any target explains itself', () => {
  const { director } = harness()
  assert.equal(director.look({}).ok, false)
  assert.match(director.look({}).reason, /look 需要/)
})

test('unknown gaze targets are rejected, not guessed', () => {
  const { director } = harness()
  const result = director.look({ at: 'the-moon' })
  assert.equal(result.ok, false)
  assert.match(result.reason, /未知视线目标/)
})

test('walk resolves named destinations to normalised positions', () => {
  const { director } = harness()
  const left = director.walk({ to: 'left' })
  assert.equal(left.ok, true)
  assert.equal(left.walk.to, 'left')
  assert.ok(left.walk.until > 0)

  const center = director.walk({ to: 'center' })
  assert.equal(center.walk.to, 'center')
})

test('walk clamps numeric destinations and honours distance-based timing', () => {
  const { director } = harness()
  const result = director.walk({ to: '1.8' })
  assert.equal(result.ok, true)
  assert.equal(result.walk.to, 1)
  assert.deepEqual(result.clamped, ['to: 1.8 -> 1'])
  // `to: 1` is the far edge, so the default duration is the full crossing.
  assert.equal(result.walk.durationMs, 1400)

  const short = director.walk({ to: '0.5' })
  assert.equal(short.walk.durationMs, Math.round(1400 * 0.15))
})

test('nonsense destinations are rejected with the vocabulary', () => {
  const { director } = harness()
  const result = director.walk({ to: 'to-the-moon' })
  assert.equal(result.ok, false)
  assert.match(result.reason, /未知目的地/)
})

test('reset clears both channels and keeps the seq monotonic', () => {
  const { director, sent } = harness()
  director.look({ at: 'left' })
  director.walk({ to: 'center' })
  const before = director.seq
  director.reset()
  const state = director.snapshot()
  assert.equal(state.gaze, null)
  assert.equal(state.walk, null)
  assert.ok(director.seq >= before)
  const last = sent[sent.length - 1]
  assert.equal(last.gaze, null)
  assert.equal(last.walk, null)
})

test('reset can target one channel only', () => {
  const { director } = harness()
  director.look({ at: 'left' })
  director.walk({ to: 'center' })
  director.reset({ scope: 'gaze' })
  const state = director.snapshot()
  assert.equal(state.gaze, null)
  assert.ok(state.walk, 'walk must survive a gaze-only reset')
})

test('gaze expires on its own and the expiry is broadcast', () => {
  const { director, sent, advance } = harness()
  director.look({ at: 'cursor', durationMs: 500 })
  assert.ok(director.snapshot().gaze)
  advance(600)
  assert.equal(director.snapshot().gaze, null)
  const last = sent[sent.length - 1]
  assert.equal(last.gaze, null)
})

test('walk expires and stops reporting motion', () => {
  const { director, advance } = harness()
  director.walk({ to: 'center', durationMs: 900 })
  assert.ok(director.snapshot().walk)
  advance(1000)
  assert.equal(director.snapshot().walk, null)
})

test('seq only ever increases, even across channels', () => {
  const { director } = harness()
  const seen = []
  director.look({ at: 'left' })
  director.walk({ to: 'left' })
  director.look({ at: 'right' })
  for (const frame of [director.snapshot(), director.snapshot(), director.snapshot()]) {
    seen.push(frame.seq)
  }
  for (let index = 1; index < seen.length; index += 1) {
    assert.ok(seen[index] >= seen[index - 1], 'seq must never go backwards')
  }
})

test('dispose stops timers and silences the emitter', () => {
  const { director, sent } = harness()
  director.look({ at: 'cursor' })
  const count = sent.length
  director.dispose()
  director.walk({ to: 'left' })
  assert.equal(sent.length, count, 'a disposed director must not emit')
})
