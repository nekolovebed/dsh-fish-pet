import test from 'node:test'
import assert from 'node:assert/strict'

import { CompanionTracker, activityOf, estimateCost, textOf } from '../src/state.js'
import { Kind, Pose, TaskState } from '../src/protocol.js'

const session = { id: 'sess-1' }
let clock = 1_700_000_000_000
const now = () => clock++
const make = () => new CompanionTracker({ now, maxTasks: 3 })

test('idle tracker reports IDLE and an empty ledger', () => {
  const tracker = make()
  const state = tracker.stateMessage()
  assert.equal(state.kind, Kind.STATE)
  assert.equal(state.pose, Pose.IDLE)
  assert.deepEqual(tracker.tasksMessage().items, [])
})

test('a full turn walks THINKING -> WORKING -> SUCCESS', () => {
  const tracker = make()
  tracker.handle(session, {
    type: 'user/message', seq: 1,
    data: { message: { content: [{ type: 'text', text: '帮我把报告整理成表格' }] } },
  })

  const started = tracker.handle(session, { type: 'turn/start', seq: 2, data: { turn: 1 } })
  const startState = started.find((m) => m.kind === Kind.STATE)
  assert.equal(startState.pose, Pose.THINKING)

  const tasks = started.find((m) => m.kind === Kind.TASKS)
  assert.equal(tasks.items.length, 1)
  assert.equal(tasks.items[0].title, '帮我把报告整理成表格')
  assert.equal(tasks.items[0].state, TaskState.RUNNING)

  const called = tracker.handle(session, { type: 'tool/call', seq: 3, data: { name: 'write_file' } })
  const workState = called.find((m) => m.kind === Kind.STATE)
  assert.equal(workState.pose, Pose.WORKING)
  assert.equal(workState.activity, 'files')

  const ended = tracker.handle(session, { type: 'turn/end', seq: 4, data: { turn: 1, reason: { kind: 'completed' } } })
  const doneState = ended.find((m) => m.kind === Kind.STATE)
  assert.equal(doneState.pose, Pose.SUCCESS)
  const doneTasks = ended.find((m) => m.kind === Kind.TASKS)
  assert.equal(doneTasks.items[0].state, TaskState.DONE)
  assert.equal(doneTasks.items[0].tools, 1)
  assert.equal(tracker.usage.turns, 1)
})

test('an approval request parks the fish in WAITING', () => {
  const tracker = make()
  tracker.handle(session, { type: 'turn/start', seq: 1, data: { turn: 1 } })
  const out = tracker.handle(session, {
    type: 'approval/asked', seq: 2, data: { id: 'a1', toolName: 'bash' },
  })
  assert.equal(out.find((m) => m.kind === Kind.STATE).pose, Pose.WAITING)
})

test('failed turns surface ERROR and mark the task', () => {
  const tracker = make()
  tracker.handle(session, { type: 'turn/start', seq: 1, data: { turn: 1 } })
  const out = tracker.handle(session, { type: 'turn/end', seq: 2, data: { reason: { kind: 'error' } } })
  assert.equal(out.find((m) => m.kind === Kind.STATE).pose, Pose.ERROR)
  assert.equal(out.find((m) => m.kind === Kind.TASKS).items[0].state, TaskState.ERROR)
})

test('blocked turns keep the task running and wait for the user', () => {
  const tracker = make()
  tracker.handle(session, { type: 'turn/start', seq: 1, data: { turn: 1 } })
  const out = tracker.handle(session, { type: 'turn/end', seq: 2, data: { reason: { kind: 'blocked' } } })
  assert.equal(out.find((m) => m.kind === Kind.STATE).pose, Pose.WAITING)
  assert.equal(out.find((m) => m.kind === Kind.TASKS).items[0].state, TaskState.RUNNING)
})

test('usage accumulates and rolls over on a new local day', () => {
  const tracker = make()
  tracker.handle(session, {
    type: 'assistant/message', seq: 1,
    data: { usage: { inputTokens: 1200, outputTokens: 300, cacheReadTokens: 100 } },
  })
  const usage = tracker.usageMessage({})
  assert.equal(usage.input, 1200)
  assert.equal(usage.output, 300)
  assert.equal(usage.cacheRead, 100)
  assert.equal(usage.dayInput, 1200)
  assert.equal(usage.priced, false)
  assert.equal(usage.cost, null)
})

test('the ledger is capped but never drops a running task', () => {
  const tracker = make()
  for (let turn = 1; turn <= 5; turn += 1) {
    tracker.handle(session, { type: 'turn/start', seq: turn * 2, data: { turn } })
    tracker.handle(session, { type: 'turn/end', seq: turn * 2 + 1, data: { reason: { kind: 'completed' } } })
  }
  // A sixth turn stays open.
  tracker.handle(session, { type: 'turn/start', seq: 99, data: { turn: 6 } })
  const items = tracker.tasksMessage().items
  const running = items.filter((task) => task.state === TaskState.RUNNING)
  assert.equal(running.length, 1)
  assert.ok(items.length <= 3)
})

test('malformed events are ignored instead of throwing', () => {
  const tracker = make()
  assert.deepEqual(tracker.handle(session, null), [])
  assert.deepEqual(tracker.handle(session, {}), [])
  assert.deepEqual(tracker.handle(session, { type: 'unknown/thing', data: null }), [])
  assert.deepEqual(tracker.handle({}, { type: 'step/start' }), [])
})

test('activityOf buckets tool names', () => {
  assert.equal(activityOf('read_file'), 'files')
  assert.equal(activityOf('web_search'), 'search')
  assert.equal(activityOf('bash'), 'shell')
  assert.equal(activityOf('todo_write'), 'plan')
  assert.equal(activityOf('mystery_tool'), 'tool')
  assert.equal(activityOf(undefined), 'tool')
})

test('textOf joins text blocks and ignores the rest', () => {
  assert.equal(textOf([{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' }]), 'a\nb')
  assert.equal(textOf('plain'), 'plain')
  assert.equal(textOf(null), '')
})

test('estimateCost stays null until a price is configured', () => {
  assert.equal(estimateCost({ input: 1000, output: 1000 }, {}), null)
  assert.equal(estimateCost({ input: 1000, output: 1000 }, { priceInputPerMillion: 0, priceOutputPerMillion: 0 }), null)
  const cost = estimateCost(
    { input: 1_000_000, output: 500_000 },
    { priceInputPerMillion: 2, priceOutputPerMillion: 8 },
  )
  assert.equal(cost, 6)
})
