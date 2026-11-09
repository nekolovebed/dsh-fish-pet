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

// ---------------------------------------------------------------------------
// Pack renderer. `__internals` exists so a skin can be rendered without an
// EventSource; it is not part of the loader contract.
// ---------------------------------------------------------------------------

const SKIN = {
  canvas: { width: 140, height: 130 },
  anchors: { head: [0.5, 0.3] },
  layers: [
    { id: 'body', src: '/body.svg', z: 10 },
    { id: 'eyes', z: 20, variants: { open: '/eyes-open.svg', happy: '/eyes-happy.svg' }, motion: 'blink', pivot: [0.49, 0.55] },
  ],
  expressions: { IDLE: { eyes: 'open' }, SUCCESS: { eyes: 'happy' }, SLEEP: { eyes: 'open' } },
}

const CAT_EARS = {
  id: 'cat-ears',
  name: '猫耳',
  src: '/ears.svg',
  slot: 'head',
  anchor: 'head',
  offset: [0, 0.02],
  pivot: [0.5, 0.9],
  scale: 0.46,
  z: 40,
  motion: 'sway',
}

test('the pack renderer stacks layers, switches expressions and anchors props', () => {
  const { mod } = loadClient()
  const { RigStage } = mod.__internals

  const html = renderToStaticMarkup(React.createElement(RigStage, {
    skin: SKIN, worn: [CAT_EARS], pose: 'IDLE', action: null,
  }))

  assert.match(html, /fp-pose-IDLE/)
  assert.match(html, /fp-layer/)
  assert.match(html, /fp-motion-blink/)
  assert.match(html, /\/eyes-open\.svg/, 'IDLE must use the open eyes variant')
  assert.match(html, /\/body\.svg/)
  assert.match(html, /fp-prop/)
  assert.match(html, /\/ears\.svg/)
  assert.match(html, /fp-motion-sway/)

  const success = renderToStaticMarkup(React.createElement(RigStage, {
    skin: SKIN, worn: [], pose: 'SUCCESS', action: null,
  }))
  assert.match(success, /\/eyes-happy\.svg/, 'SUCCESS must switch the variant')
})

test('an action borrows a pose for its expression and adds its own class', () => {
  const { mod } = loadClient()
  const { RigStage } = mod.__internals

  const html = renderToStaticMarkup(React.createElement(RigStage, {
    skin: SKIN, worn: [CAT_EARS], pose: 'WORKING', action: 'sleep',
  }))
  assert.match(html, /fp-act-sleep/)
  assert.match(html, /fp-pose-WORKING/)
  assert.match(html, /\/eyes-open\.svg/, 'SLEEP expression is borrowed from the skin table')
})

test('a prop restricted to some poses stays off in the others', () => {
  const { mod } = loadClient()
  const { RigStage } = mod.__internals
  const restricted = { ...CAT_EARS, poses: ['SUCCESS'] }

  const idle = renderToStaticMarkup(React.createElement(RigStage, {
    skin: SKIN, worn: [restricted], pose: 'IDLE', action: null,
  }))
  assert.doesNotMatch(idle, /\/ears\.svg/)

  const success = renderToStaticMarkup(React.createElement(RigStage, {
    skin: SKIN, worn: [restricted], pose: 'SUCCESS', action: null,
  }))
  assert.match(success, /\/ears\.svg/)
})

test('props and layers share one z stack, so a back item renders behind the body', () => {
  const { mod } = loadClient()
  const { RigStage } = mod.__internals
  const cape = {
    id: 'cape', name: '披风', src: '/cape.svg', slot: 'back', anchor: 'head',
    offset: [0, 0], pivot: [0.5, 0.1], scale: 0.8, z: 6,
  }
  const html = renderToStaticMarkup(React.createElement(RigStage, {
    skin: SKIN, worn: [cape, CAT_EARS], pose: 'IDLE', action: null,
  }))

  assert.ok(html.indexOf('/cape.svg') < html.indexOf('/body.svg'), 'cape must sit behind the body')
  assert.ok(html.indexOf('/body.svg') < html.indexOf('/ears.svg'), 'cat ears must sit in front of the body')
})

test('an animated skin can opt out of props and map actions to variants', () => {
  const { mod } = loadClient()
  const { RigStage } = mod.__internals
  const skin = {
    canvas: { width: 220, height: 300 },
    propsEnabled: false,
    actionVariants: { wave: 'wave' },
    layers: [{ id: 'base', z: 10, variants: { idle: '/idle.webp', wave: '/wave.webp' } }],
    expressions: { IDLE: { base: 'idle' } },
  }

  const idle = renderToStaticMarkup(React.createElement(RigStage, {
    skin, worn: [CAT_EARS], pose: 'IDLE', action: null,
  }))
  assert.match(idle, /\/idle\.webp/)
  assert.doesNotMatch(idle, /ears\.svg/, 'propsEnabled:false must skip the wardrobe')

  const waving = renderToStaticMarkup(React.createElement(RigStage, {
    skin, worn: [], pose: 'IDLE', action: 'wave',
  }))
  assert.match(waving, /\/wave\.webp/, 'actionVariants must win over the pose variant')
})

test('a motion clip hides overlays, props and CSS motion while it plays', () => {
  const { mod } = loadClient()
  const { RigStage } = mod.__internals
  const skin = {
    canvas: { width: 220, height: 300 },
    layers: [
      { id: 'base', z: 10, variants: { still: '/base.webp', wave: '/wave.webp' } },
      { id: 'fx', z: 60, variants: { none: '/none.svg', thinking: '/dots.svg' } },
    ],
    expressions: {
      IDLE: { base: 'still', fx: 'none' },
      THINKING: { base: 'still', fx: 'thinking' },
    },
    actionVariants: { wave: 'wave' },
    clipVariants: ['wave'],
    clipLayer: 'base',
    propsEnabled: true,
  }

  const idle = renderToStaticMarkup(React.createElement(RigStage, {
    skin, worn: [CAT_EARS], pose: 'IDLE', action: null,
  }))
  assert.match(idle, /\/base\.webp/)
  assert.match(idle, /\/none\.svg/, 'the fx layer is part of the still rig')
  assert.match(idle, /ears\.svg/, 'wardrobe props are visible on the still rig')
  assert.doesNotMatch(idle, /fp-clip/)

  const waving = renderToStaticMarkup(React.createElement(RigStage, {
    skin, worn: [CAT_EARS], pose: 'IDLE', action: 'wave',
  }))
  assert.match(waving, /\/wave\.webp/)
  assert.doesNotMatch(waving, /\/none\.svg/, 'overlay layers would slide over a moving clip')
  assert.doesNotMatch(waving, /ears\.svg/, 'static props would slide over a moving clip')
  assert.match(waving, /fp-clip/, 'CSS motion must be suppressed while the clip plays')
  assert.doesNotMatch(waving, /fp-fx/, "built-in pose marks must not double up with a pack's fx layer")
})

test('the active skin follows the wardrobe message, then the config', () => {
  const { mod } = loadClient()
  const { activeSkin, wornItems } = mod.__internals
  const catalog = { skins: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], accessories: [CAT_EARS] }

  assert.equal(activeSkin({ catalog, wardrobe: { skinId: 'b' } }).id, 'b')
  assert.equal(activeSkin({ catalog, hello: { config: { skinId: 'a' } } }).id, 'a')
  assert.equal(activeSkin({ catalog, wardrobe: { skinId: 'gone' } }).id, 'a', 'unknown id falls back to the first pack')
  assert.equal(activeSkin({}), null)

  assert.deepEqual(wornItems({ wardrobe: { wearing: [CAT_EARS] } }), [CAT_EARS])
  assert.deepEqual(wornItems({ wardrobe: { worn: ['cat-ears'] }, catalog }), [CAT_EARS])
  assert.deepEqual(wornItems({ wardrobe: { worn: ['ghost'] }, catalog }), [])
})

test('layers flagged with a gaze factor ride in a parallax wrapper', () => {
  const { mod } = loadClient()
  const { RigStage } = mod.__internals

  const gazedSkin = {
    ...SKIN,
    layers: [
      { id: 'body', src: '/body.svg', z: 10 },
      { id: 'head', src: '/head.svg', z: 14, gaze: 0.5 },
      { id: 'eyes', z: 20, gaze: 1, variants: { open: '/eyes-open.svg' } },
    ],
  }
  const html = renderToStaticMarkup(React.createElement(RigStage, {
    skin: gazedSkin, worn: [], pose: 'IDLE', action: null,
  }))

  assert.match(html, /fp-gaze/, 'gaze layers must be wrapped')
  assert.match(html, /\/head\.svg/, 'the wrapped layer still renders')
  assert.match(html, /\/eyes-open\.svg/)
})

test('layers without a gaze factor render bare, with no wrapper', () => {
  const { mod } = loadClient()
  const { RigStage } = mod.__internals

  const html = renderToStaticMarkup(React.createElement(RigStage, {
    skin: SKIN, worn: [], pose: 'IDLE', action: null,
  }))
  assert.doesNotMatch(html, /fp-gaze/, 'no gaze variables declared, no wrapper')

  const walking = renderToStaticMarkup(React.createElement(RigStage, {
    skin: SKIN, worn: [], pose: 'IDLE', action: null, walking: true,
  }))
  assert.match(walking, /fp-walking/, 'a walk must put the rig into its walking animation')
})
