/**
 * The desktop overlay is optional: on a plain Node build (`dsh web`) there is
 * no Electron, so every call must degrade without touching the in-page pet.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { DesktopPetWindow, electronRuntime } from '../src/desktop.js'

test('the desktop overlay degrades to unsupported on a plain Node host', (t) => {
  if (process.versions.electron) return t.skip('running inside Electron')
  const desktop = new DesktopPetWindow({ width: 300, height: 460 })

  assert.equal(electronRuntime(), null)
  assert.deepEqual(desktop.status(), {
    supported: false,
    open: false,
    size: { width: 300, height: 460 },
  })

  const result = desktop.open('http://127.0.0.1:3099/plugins/dsh-fish-pet/desktop')
  assert.equal(result.ok, false)
  assert.match(result.reason, /桌面版/)
  assert.equal(desktop.isOpen, false)
  assert.equal(desktop.hoverTimer, null, 'no cursor polling without a window')

  assert.equal(desktop.close().ok, true)
  assert.equal(desktop.status().open, false)
})

test('window size is clamped so an overlay cannot become unusable', () => {
  const desktop = new DesktopPetWindow({ width: 10, height: 10 })
  assert.deepEqual(desktop.status().size, { width: 160, height: 200 })
})
