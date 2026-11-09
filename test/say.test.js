/** The speech bubble board: one line at a time, with a hard TTL. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { SayBoard } from '../src/say.js'

function makeBoard() {
  const frames = []
  const scheduled = []
  const say = new SayBoard({
    emit: (payload) => frames.push(payload),
    now: () => 10_000,
    setTimer: (fn, ms) => {
      const timer = { fn, ms, cleared: false, unref() {} }
      scheduled.push(timer)
      return timer
    },
    clearTimer: (timer) => { timer.cleared = true },
  })
  return { say, frames, scheduled }
}

test('SayBoard keeps one line, replaces it and expires it', () => {
  const { say, frames, scheduled } = makeBoard()

  const result = say.say({ text: '第一句  ', durationMs: 100_000 })
  assert.equal(result.ok, true)
  assert.equal(result.text, '第一句', 'trailing whitespace is trimmed')
  assert.equal(result.until, 70_000, 'duration is clamped to 60s')
  assert.equal(frames.at(-1).kind, 'say')
  assert.equal(frames.at(-1).text, '第一句')
  assert.equal(scheduled.length, 1)

  say.say({ text: '第二句', durationMs: 3000 })
  assert.equal(scheduled[0].cleared, true, 'the previous TTL timer must be cancelled')
  assert.equal(say.snapshot().text, '第二句')
  assert.equal(frames.at(-1).text, '第二句')

  scheduled[1].fn()
  assert.equal(say.snapshot().text, '')
  assert.equal(frames.at(-1).text, '', 'expiry clears the bubble on the wire')
})

test('empty text and dispose clear the bubble', () => {
  const { say, frames, scheduled } = makeBoard()
  say.say({ text: '在吗' })
  const cleared = say.say({ text: '   ' })
  assert.deepEqual(cleared, { ok: true, text: '', until: null })
  assert.equal(frames.at(-1).text, '')
  assert.equal(scheduled[0].cleared, true)

  say.say({ text: '最后一句' })
  assert.doesNotThrow(() => say.dispose())
  assert.equal(say.snapshot().text, '')
})

test('a line longer than the cap is truncated', () => {
  const { say } = makeBoard()
  const result = say.say({ text: '鱼'.repeat(300) })
  assert.equal(result.text.length, 160)
})
