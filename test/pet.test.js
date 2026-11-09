/**
 * PetDirector: queueing, TTL and the persistent-action rule.
 *
 * Timers are injected, so the suite advances a virtual clock instead of waiting.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { PetDirector } from '../src/pet.js'

function harness() {
  let now = 0
  let nextId = 0
  const timers = new Map()
  const events = []
  const director = new PetDirector({
    emit: (payload) => events.push(payload),
    now: () => now,
    setTimer: (fn, ms) => {
      const id = ++nextId
      timers.set(id, { fn, at: now + ms })
      return id
    },
    clearTimer: (id) => timers.delete(id),
  })
  const advance = (ms) => {
    now += ms
    for (const [id, timer] of [...timers]) {
      if (timer.at <= now) {
        timers.delete(id)
        timer.fn()
      }
    }
  }
  return { director, events, advance, remaining: () => timers.size }
}

test('an action plays immediately and clears when its TTL ends', () => {
  const { director, events, advance } = harness()
  const started = director.act({ action: 'wave', text: '你好' })

  assert.equal(started.ok, true)
  assert.equal(started.queued, false)
  assert.equal(director.active.action, 'wave')
  assert.equal(director.active.text, '你好')
  assert.equal(events.at(-1).kind, 'action')
  assert.equal(events.at(-1).action, 'wave')

  advance(1600)
  assert.equal(director.active, null)
  assert.equal(events.at(-1).action, null)
})

test('a second action queues instead of cutting the first one short', () => {
  const { director, events, advance } = harness()
  director.act({ action: 'jump' })
  const queued = director.act({ action: 'spin' })

  assert.equal(queued.queued, true)
  assert.equal(director.active.action, 'jump')

  advance(1200)
  assert.equal(director.active.action, 'spin', 'queued action starts after the first')
  assert.ok(events.some((event) => event.action === 'spin'))
})

test('the queue is bounded so a chatty model cannot pile up motions', () => {
  const { director } = harness()
  director.act({ action: 'jump' })
  for (let index = 0; index < 4; index += 1) director.act({ action: 'wave' })

  const overflow = director.act({ action: 'dance' })
  assert.equal(overflow.ok, false)
  assert.match(overflow.reason, /队列已满/)
})

test('persistent actions are replaced, not queued behind forever', () => {
  const { director, remaining } = harness()
  director.act({ action: 'sleep' })
  assert.equal(director.active.action, 'sleep')
  assert.equal(director.active.until, null)
  assert.equal(remaining(), 0, 'a persistent action sets no timer')

  const replaced = director.act({ action: 'jump' })
  assert.equal(replaced.queued, false)
  assert.equal(director.active.action, 'jump')
})

test('an unknown action is refused without touching the current one', () => {
  const { director } = harness()
  director.act({ action: 'wave' })
  const bad = director.act({ action: 'backflip' })
  assert.equal(bad.ok, false)
  assert.match(bad.reason, /未知动作/)
  assert.equal(director.active.action, 'wave')
})

test('durations are clamped, and clear() resets state', () => {
  const { director, events } = harness()
  director.act({ action: 'wave', durationMs: 999_999 })
  assert.equal(director.active.durationMs, 10_000)

  director.clear()
  assert.equal(director.active, null)
  assert.equal(events.at(-1).action, null)
})
