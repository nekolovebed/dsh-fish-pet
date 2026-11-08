import test from 'node:test'
import assert from 'node:assert/strict'

import { loadBalance, normalizeCustom, normalizeDeepSeek, pickPath, resolveProvider } from '../src/balance.js'

function fakeFetch(handler) {
  return async (url, init) => handler(url, init)
}

test('pickPath walks objects and arrays without throwing', () => {
  const value = { data: { items: [{ balance: 12 }] } }
  assert.equal(pickPath(value, 'data.items.0.balance'), 12)
  assert.equal(pickPath(value, 'data.missing.deep'), undefined)
  assert.equal(pickPath(null, 'a'), undefined)
  assert.equal(pickPath(value, ''), undefined)
})

test('normalizeDeepSeek reads the documented balance_infos shape', () => {
  const out = normalizeDeepSeek({
    is_available: true,
    balance_infos: [{ currency: 'CNY', total_balance: '110.50', granted_balance: '10.00', topped_up_balance: '100.50' }],
  })
  assert.equal(out.total, 110.5)
  assert.equal(out.currency, 'CNY')
  assert.equal(out.granted, 10)
  assert.equal(out.toppedUp, 100.5)
  assert.equal(out.available, true)
})

test('normalizeDeepSeek rejects unusable payloads', () => {
  assert.equal(normalizeDeepSeek(null), null)
  assert.equal(normalizeDeepSeek({}), null)
  assert.equal(normalizeDeepSeek({ balance_infos: [] }), null)
  assert.equal(normalizeDeepSeek({ balance_infos: [{ currency: 'CNY' }] }), null)
})

test('normalizeCustom honours an explicit path and falls back to guesses', () => {
  assert.equal(normalizeCustom({ result: { credit: '8.5' } }, 'result.credit').total, 8.5)
  assert.equal(normalizeCustom({ balance: 3 }).total, 3)
  assert.equal(normalizeCustom({ data: { total_balance: '7' } }).total, 7)
  assert.equal(normalizeCustom({ nothing: 1 }), null)
})

test('resolveProvider maps config and env to a provider', () => {
  assert.equal(resolveProvider({ balanceProvider: 'off' }), 'off')
  assert.equal(resolveProvider({ balanceProvider: 'deepseek' }), 'deepseek')
  assert.equal(resolveProvider({ balanceProvider: 'custom', balanceUrl: '' }), 'off')
  assert.equal(resolveProvider({ balanceProvider: 'auto' }, { DEEPSEEK_API_KEY: 'sk-1' }), 'deepseek')
  assert.equal(resolveProvider({ balanceProvider: 'auto' }, {}), 'off')
})

test('loadBalance returns ok for a healthy DeepSeek response', async () => {
  let seen
  const snapshot = await loadBalance(
    { balanceProvider: 'deepseek', balanceApiKey: 'sk-test', balanceBaseUrl: '' },
    {
      env: {},
      fetchImpl: fakeFetch(async (url, init) => {
        seen = { url, auth: init.headers.authorization }
        return { ok: true, json: async () => ({ balance_infos: [{ currency: 'CNY', total_balance: '42.00' }] }) }
      }),
    },
  )
  assert.equal(seen.url, 'https://api.deepseek.com/user/balance')
  assert.equal(seen.auth, 'Bearer sk-test')
  assert.equal(snapshot.status, 'ok')
  assert.equal(snapshot.total, 42)
})

test('loadBalance degrades to unavailable instead of throwing', async () => {
  const httpError = await loadBalance(
    { balanceProvider: 'deepseek', balanceApiKey: 'sk' },
    { env: {}, fetchImpl: fakeFetch(async () => ({ ok: false, status: 401 })) },
  )
  assert.equal(httpError.status, 'unavailable')
  assert.match(httpError.reason, /401/)

  const thrown = await loadBalance(
    { balanceProvider: 'deepseek', balanceApiKey: 'sk' },
    { env: {}, fetchImpl: fakeFetch(async () => { throw new Error('boom') }) },
  )
  assert.equal(thrown.status, 'unavailable')
  assert.match(thrown.reason, /boom/)

  const off = await loadBalance({ balanceProvider: 'off' }, { env: {} })
  assert.equal(off.status, 'unavailable')
})

test('a custom endpoint is queried with the configured path', async () => {
  const snapshot = await loadBalance(
    {
      balanceProvider: 'custom',
      balanceUrl: 'http://127.0.0.1:9/billing',
      balanceJsonPath: 'data.credit',
      balanceApiKey: 'Token abc',
    },
    {
      env: {},
      fetchImpl: fakeFetch(async (url, init) => {
        assert.equal(url, 'http://127.0.0.1:9/billing')
        assert.equal(init.headers.authorization, 'Token abc')
        return { ok: true, json: async () => ({ data: { credit: 9.99 } }) }
      }),
    },
  )
  assert.equal(snapshot.status, 'ok')
  assert.equal(snapshot.total, 9.99)
  assert.equal(snapshot.source, 'custom')
})
