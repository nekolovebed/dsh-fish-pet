import test from 'node:test'
import assert from 'node:assert/strict'

import { ChatBridge, errorDetailOf, newSessionId, userMessage } from '../src/chat.js'

function makeBridge(overrides = {}) {
  const emitted = []
  const bridge = new ChatBridge({
    ctx: { get: () => undefined },
    config: () => ({ chatEnabled: true, chatMode: 'session', chatCwd: '' }),
    emit: (payload) => emitted.push(payload),
    warn: () => {},
    ...overrides,
  })
  return { bridge, emitted }
}

test('newSessionId is prefixed and unique', () => {
  const a = newSessionId()
  const b = newSessionId()
  assert.match(a, /^fish-/)
  assert.notEqual(a, b)
})

test('userMessage satisfies the documented Message shape', () => {
  const message = userMessage('你好')
  assert.equal(message.role, 'user')
  assert.ok(message.id)
  assert.deepEqual(message.content, [{ type: 'text', text: '你好' }])
  assert.equal(message.source.kind, 'user')
  // The bus keys replies by rpcId, so it must be present and unique.
  assert.ok(message.source.rpcId)
  assert.notEqual(message.source.rpcId, userMessage('你好').source.rpcId)
})

test('sending without an agents service explains itself instead of throwing', async () => {
  const { bridge, emitted } = makeBridge()
  const result = await bridge.send('在吗')
  assert.equal(result.ok, false)
  assert.match(result.reason, /agents/)
  assert.equal(emitted.length, 0)
})

test('disabling chat short-circuits the send', async () => {
  const { bridge } = makeBridge({ config: () => ({ chatEnabled: false, chatMode: 'session' }) })
  const result = await bridge.send('在吗')
  assert.equal(result.ok, false)
  assert.match(result.reason, /关闭/)
})

test('empty input is rejected without touching the agent', async () => {
  const { bridge } = makeBridge()
  assert.equal((await bridge.send('   ')).ok, false)
})

test('observe ignores events from other sessions', () => {
  const { bridge, emitted } = makeBridge()
  const out = bridge.observe({ id: 'someone-else' }, {
    type: 'assistant/message',
    data: { message: { content: [{ type: 'text', text: 'hi' }] } },
  })
  assert.deepEqual(out, [])
  assert.equal(emitted.length, 0)
})

test('assistant text streams then settles on turn end', () => {
  const { bridge } = makeBridge()
  const session = { id: bridge.sessionId }

  const partial = bridge.observe(session, {
    type: 'assistant/message',
    data: { message: { content: [{ type: 'text', text: '第一段' }] } },
  })
  assert.equal(partial[0].streaming, true)
  assert.equal(partial[0].text, '第一段')

  const second = bridge.observe(session, {
    type: 'assistant/message',
    data: { message: { content: [{ type: 'text', text: '第二段' }] } },
  })
  assert.equal(second[0].text, '第一段\n第二段')

  const done = bridge.observe(session, { type: 'turn/end', data: { reason: { kind: 'completed' } } })
  assert.equal(done[0].done, true)
  assert.equal(done[0].streaming, false)
  assert.equal(bridge.pending, false)
})

test('a failed turn reports the remembered cause', () => {
  const { bridge } = makeBridge()
  const session = { id: bridge.sessionId }

  const attempt = bridge.observe(session, {
    type: 'assistant/attempt',
    data: { error: { message: '缺少模型凭据' } },
  })
  assert.deepEqual(attempt, [])
  assert.equal(bridge.lastError, '缺少模型凭据')

  const ended = bridge.observe(session, { type: 'turn/end', data: { reason: { kind: 'error' } } })
  assert.equal(ended[0].error, true)
  assert.equal(ended[0].text, '缺少模型凭据')
  assert.equal(bridge.lastError, null)
})

test('a failed turn without detail still says something useful', () => {
  const { bridge } = makeBridge()
  const out = bridge.observe({ id: bridge.sessionId }, { type: 'turn/end', data: { reason: { kind: 'aborted' } } })
  assert.equal(out[0].error, true)
  assert.match(out[0].text, /中断/)
})

test('errorDetailOf digs through the shapes it knows', () => {
  assert.equal(errorDetailOf({ data: { error: { message: 'a' } } }), 'a')
  assert.equal(errorDetailOf({ data: { reason: { detail: 'b' } } }), 'b')
  assert.equal(errorDetailOf({ data: { message: 'c' } }), 'c')
  assert.equal(errorDetailOf({ data: { error: 'd' } }), 'd')
  assert.equal(errorDetailOf({ data: {} }), undefined)
  assert.equal(errorDetailOf(null), undefined)
})
