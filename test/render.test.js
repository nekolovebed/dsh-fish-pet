/**
 * Render smoke test for the browser half.
 *
 * `lib/client.js` is a plain script that expects a DSH page: a module loader, a
 * DOM, localStorage and window. This test supplies minimal shims so the React
 * tree can be rendered with `react-dom/server`. It is not a substitute for a
 * browser, but it does catch the two failure modes that syntax checking misses
 * completely: broken element trees and hook misuse.
 *
 * Effects do not run during server rendering, so nothing here performs I/O.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

const here = dirname(fileURLToPath(import.meta.url))
const clientSource = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8')

/** Build the fake page environment the client bundle expects. */
function fakePage() {
  const created = []
  const head = { appendChild: (node) => created.push(node) }
  const body = { style: {} }
  const document = {
    body,
    head,
    getElementById: () => null,
    createElement: (tag) => ({ tag, textContent: '', id: '', setAttribute() {} }),
  }
  const store = new Map()
  const localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
  }
  const window = { document, localStorage, innerWidth: 1440, innerHeight: 900 }
  const globals = {
    document,
    localStorage,
    getComputedStyle: () => ({ backgroundColor: 'rgb(20, 22, 30)' }),
  }
  return { window, globals, created, store }
}

/** One page shared by every test in this file. */
const PAGE = fakePage()
for (const [key, value] of Object.entries(PAGE.globals)) {
  globalThis[key] = value
}
globalThis.window = PAGE.window

/**
 * Evaluate the bundle against a fake loader and return the module it exports.
 * The bundle is a classic script, so `new Function` is the faithful loader.
 *
 * The page shims stay installed for the lifetime of the test process: the
 * overlay touches `document` during render, not only at load time.
 */
function loadClient() {
  let captured = null
  PAGE.window.__ModuleLoader__ = {
    load: (definition) => {
      captured = definition
    },
  }

  // eslint-disable-next-line no-new-func
  new Function('window', clientSource)(PAGE.window)

  assert.ok(captured, 'bundle should call the module loader')
  const mod = captured.factory((name) => {
    if (name === 'react') return React
    throw new Error(`unexpected require: ${name}`)
  })
  return { mod, page: PAGE, created: PAGE.created }
}

/** A context that records slot registrations instead of mounting them. */
function fakeClientContext() {
  const registered = []
  const injected = []
  return {
    registered,
    injected,
    slots: {
      inject(name, callback) {
        injected.push(name)
        callback()
      },
      register(descriptor, component) {
        registered.push({ descriptor, component })
        return () => {}
      },
    },
  }
}

test('the bundle registers an overlay and a settings card', () => {
  const { mod } = loadClient()
  assert.equal(mod.name, 'dsh-fish-pet-client')
  assert.deepEqual(mod.inject, ['slots'])

  const ctx = fakeClientContext()
  mod.apply(ctx)

  const names = ctx.registered.map((entry) => entry.descriptor.name)
  assert.ok(names.includes('shell.overlay'), `expected shell.overlay, got ${names.join(',')}`)
  assert.ok(
    names.includes('settings.plugin.item') || names.includes('settings.section'),
    `expected a settings slot, got ${names.join(',')}`,
  )
  for (const entry of ctx.registered) {
    assert.equal(typeof entry.component, 'function')
  }
})

test('the overlay renders a self-contained drawing and no external asset', () => {
  const { mod } = loadClient()
  const ctx = fakeClientContext()
  mod.apply(ctx)
  const overlay = ctx.registered.find((entry) => entry.descriptor.name === 'shell.overlay')

  const html = renderToStaticMarkup(React.createElement(overlay.component))
  assert.match(html, /^<div/)
  assert.match(html, /<svg/)
  // Original character: gradients are declared inline, so the overlay needs no
  // image request at all.
  assert.match(html, /linearGradient/)
  assert.doesNotMatch(html, /<img/)
  assert.doesNotMatch(html, /data:image/)
  assert.doesNotMatch(html, /https?:\/\//)
})

test('every pose has styling and an adornment wired up', () => {
  const { mod, created } = loadClient()
  const ctx = fakeClientContext()
  mod.apply(ctx)
  const overlay = ctx.registered.find((entry) => entry.descriptor.name === 'shell.overlay')

  // Rendering mounts the overlay, which lazily injects the stylesheet.
  renderToStaticMarkup(React.createElement(overlay.component))
  const css = created.map((node) => node.textContent).join('\n')
  assert.ok(css.length > 0, 'the overlay should inject its stylesheet')
  assert.match(css, /@keyframes fp-bob/)
  assert.match(css, /prefers-reduced-motion/, 'animations must respect reduced motion')

  // Pose-specific rules: IDLE is the unqualified base rule.
  for (const pose of ['THINKING', 'WORKING', 'WAITING', 'SUCCESS', 'ERROR']) {
    assert.ok(css.includes(`fp-pose-${pose}`), `missing CSS for pose ${pose}`)
  }

  // Each pose has a distinct visual accessory; assert the branches exist so a
  // refactor cannot silently collapse them into one look.
  for (const adornment of ['fp-dots', 'fp-spray', 'fp-sparkle', 'fp-drop', 'fp-alert']) {
    assert.ok(clientSource.includes(adornment), `missing adornment ${adornment}`)
  }
})

test('the settings card renders its copy and controls', () => {
  const { mod } = loadClient()
  const ctx = fakeClientContext()
  mod.apply(ctx)
  const card = ctx.registered.find((entry) => entry.descriptor.name === 'settings.plugin.item')
    ?? ctx.registered.find((entry) => entry.descriptor.name === 'settings.section')

  const html = renderToStaticMarkup(React.createElement(card.component))
  assert.match(html, /小鱼桌宠/)
  // Before the fetch resolves the card must show a loading state, never crash.
  assert.match(html, /正在读取设置|设置尚未连接/)
})

test('a broken loader is reported instead of thrown', () => {
  const page = fakePage()
  page.window.__ModuleLoader__ = undefined
  page.window.ModuleLoader = undefined
  const errors = []
  const original = console.error
  console.error = (...args) => errors.push(args.join(' '))
  try {
    // eslint-disable-next-line no-new-func
    assert.doesNotThrow(() => new Function('window', clientSource)(page.window))
  } finally {
    console.error = original
  }
  assert.ok(errors.some((line) => line.includes('dsh-fish-pet')))
})
