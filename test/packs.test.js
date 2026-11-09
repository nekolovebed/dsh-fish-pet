/**
 * Pack discovery, manifest validation and the asset path guard.
 *
 * These are the parts that read attacker-controlled bytes off disk, so the
 * negative cases matter more than the happy path.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PackRegistry, isSafeRelPath, validateAccessory, validateSkin } from '../src/packs.js'
import { repoOnlyPacks, cleanup } from '../testkit/packs.js'


function tempRoot() {
  return mkdtempSync(join(tmpdir(), 'fish-packs-'))
}

function writePack(root, name, manifest, files = {}) {
  const dir = join(root, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'manifest.json'), typeof manifest === 'string' ? manifest : JSON.stringify(manifest))
  for (const [rel, body] of Object.entries(files)) {
    const target = join(dir, rel)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, body)
  }
}

function skinManifest(overrides = {}) {
  return {
    schema: 1,
    kind: 'skin',
    id: 'demo',
    name: 'Demo',
    license: 'MIT',
    canvas: { width: 100, height: 100 },
    anchors: { head: [0.5, 0.2] },
    layers: [{ id: 'body', src: 'layers/body.svg', z: 10 }],
    ...overrides,
  }
}

function accessoryManifest(overrides = {}) {
  return {
    schema: 1,
    kind: 'accessory',
    id: 'demo-gear',
    name: 'Demo Gear',
    license: 'MIT',
    slot: 'head',
    anchor: 'head',
    scale: 0.4,
    src: 'art.svg',
    ...overrides,
  }
}

test('the bundled packs load and hydrate their asset URLs', () => {
  const root = repoOnlyPacks()
  const registry = new PackRegistry({ root })
  const result = registry.reload()

  assert.equal(result.skins, 1)
  assert.equal(result.accessories, 4)
  assert.deepEqual(result.errors, [])

  const skin = registry.skin('paopao')
  assert.equal(skin.name, '泡泡')
  assert.equal(typeof skin.builtin, 'boolean')
  assert.ok(skin.layers.length >= 6)
  for (const layer of skin.layers) {
    if (layer.variants) {
      for (const url of Object.values(layer.variants)) {
        assert.match(url, /^\/plugins\/dsh-neko-pet\/asset\?pack=paopao&path=/)
      }
    } else {
      assert.match(layer.src, /^\/plugins\/dsh-neko-pet\/asset\?pack=paopao&path=/)
    }
  }

  const catEars = registry.accessory('cat-ears')
  assert.equal(catEars.slot, 'head')
  assert.match(catEars.src, /pack=cat-ears/)
  cleanup(root)
})

test('a broken pack is reported and skipped without taking the rest down', () => {
  const root = tempRoot()
  try {
    writePack(root, 'good', skinManifest({ id: 'good' }))
    writePack(root, 'nomanifest', null)
    rmSync(join(root, 'nomanifest', 'manifest.json'))
    writePack(root, 'badjson', '{ oops')
    writePack(root, 'mismatch', skinManifest({ id: 'other' }))
    writePack(root, 'nokind', { id: 'nokind', name: 'x' })
    writePack(root, 'traversal', skinManifest({ id: 'traversal', layers: [{ id: 'body', src: '../good/manifest.json' }] }))

    const registry = new PackRegistry({ root })
    const result = registry.reload()

    assert.equal(result.skins, 1, 'only the good pack should load')
    const reasons = result.errors.map((entry) => `${entry.pack}:${entry.reason}`).join('\n')
    assert.match(reasons, /nomanifest/)
    assert.match(reasons, /badjson/)
    assert.match(reasons, /mismatch/)
    assert.match(reasons, /nokind/)
    assert.match(reasons, /traversal/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('isSafeRelPath rejects everything that could escape a pack', () => {
  for (const bad of ['', '../a.svg', 'a/../../b.svg', '/etc/passwd', 'C:/x.svg', 'a\\b.svg', 'a b.svg', './a.svg']) {
    assert.equal(isSafeRelPath(bad), false, `should reject ${JSON.stringify(bad)}`)
  }
  for (const good of ['art.svg', 'layers/body.svg', 'a-b_c.1.webp']) {
    assert.equal(isSafeRelPath(good), true, `should accept ${good}`)
  }
})

test('the asset resolver only serves known image files inside the pack', () => {
  const root = repoOnlyPacks()
  const registry = new PackRegistry({ root })
  registry.reload()

  assert.ok(registry.resolveAsset('paopao', 'layers/body.svg'))
  assert.equal(registry.resolveAsset('paopao', '../package.json'), null)
  assert.equal(registry.resolveAsset('paopao', 'C:/Windows/win.ini'), null)
  assert.equal(registry.resolveAsset('paopao', 'manifest.json'), null, 'json is not an image')
  assert.equal(registry.resolveAsset('../../etc', 'passwd'), null)
  assert.equal(registry.resolveAsset('[bad]', 'layers/body.svg'), null)
  cleanup(root)
})

test('manifest validation states its refusals plainly', () => {
  const noLayers = validateSkin(skinManifest({ layers: [] }), 'demo')
  assert.equal(noLayers.ok, false)
  assert.match(noLayers.reason, /layers/)

  const badCanvas = validateSkin(skinManifest({ canvas: { width: 2, height: 2 } }), 'demo')
  assert.equal(badCanvas.ok, false)

  const ok = validateSkin(skinManifest(), 'demo')
  assert.equal(ok.ok, true)
  assert.deepEqual(ok.value.canvas, { width: 100, height: 100 })

  const badSlot = validateAccessory(accessoryManifest({ slot: 'tail' }), 'demo-gear')
  assert.equal(badSlot.ok, false)
  assert.match(badSlot.reason, /slot/)

  const clamped = validateAccessory(accessoryManifest({ scale: 99 }), 'demo-gear')
  assert.equal(clamped.ok, true)
  assert.equal(clamped.value.scale, 3)

  const animated = validateSkin(skinManifest({
    propsEnabled: false,
    actionVariants: { wave: 'wave', 'bad key': 'nope' },
  }), 'demo')
  assert.equal(animated.ok, true)
  assert.equal(animated.value.propsEnabled, false)
  assert.deepEqual(animated.value.actionVariants, { wave: 'wave' })
  assert.equal(validateSkin(skinManifest({}), 'demo').value.propsEnabled, true)
})

test('clip variants are whitelisted and the clip layer defaults safely', () => {
  const value = validateSkin(skinManifest({
    clipVariants: ['wave', 'bad key', 'wave', 42, 'still'],
  }), 'demo').value
  assert.deepEqual(value.clipVariants, ['wave', 'still'])
  assert.equal(value.clipLayer, 'body')

  const explicit = validateSkin(skinManifest({ clipLayer: 'body', clipVariants: ['wave'] }), 'demo').value
  assert.equal(explicit.clipLayer, 'body')

  const bogus = validateSkin(skinManifest({ clipLayer: 'ghost' }), 'demo').value
  assert.equal(bogus.clipLayer, 'body', 'an unknown clip layer falls back to the first layer')
  assert.deepEqual(bogus.clipVariants, [])
})
