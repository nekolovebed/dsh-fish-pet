import test from 'node:test'
import assert from 'node:assert/strict'

import { defaults, normalizeConfig, writableKeys } from '../src/config.js'

test('an empty object normalizes to the documented defaults', () => {
  assert.deepEqual(normalizeConfig({}), { ...defaults })
  assert.deepEqual(normalizeConfig(undefined), { ...defaults })
  assert.deepEqual(normalizeConfig('nope'), { ...defaults })
})

test('unknown keys are dropped', () => {
  const out = normalizeConfig({ enabled: false, evil: 'payload' })
  assert.equal(out.enabled, false)
  assert.equal('evil' in out, false)
})

test('numbers are clamped to their ranges', () => {
  assert.equal(normalizeConfig({ scale: 99 }).scale, 1.8)
  assert.equal(normalizeConfig({ scale: 0 }).scale, 0.6)
  assert.equal(normalizeConfig({ maxTasks: 100 }).maxTasks, 20)
  assert.equal(normalizeConfig({ priceInputPerMillion: -5 }).priceInputPerMillion, 0)
})

test('non-finite numbers fall back to the default', () => {
  assert.equal(normalizeConfig({ scale: Number.NaN }).scale, 1)
  assert.equal(normalizeConfig({ scale: '1.2' }).scale, 1)
})

test('booleans and strings keep their types', () => {
  const out = normalizeConfig({ shown: true, bubble: false, balanceApiKey: 'sk-1' })
  assert.equal(out.bubble, false)
  assert.equal(out.balanceApiKey, 'sk-1')
})

test('invalid enum members fall back to the default', () => {
  assert.equal(normalizeConfig({ balanceProvider: 'nope' }).balanceProvider, 'auto')
  assert.equal(normalizeConfig({ balanceProvider: 'custom' }).balanceProvider, 'custom')
  assert.equal(normalizeConfig({ chatMode: 'nope' }).chatMode, 'session')
})

test('every default key is writable through the settings endpoint', () => {
  assert.deepEqual([...writableKeys].sort(), Object.keys(defaults).sort())
})
