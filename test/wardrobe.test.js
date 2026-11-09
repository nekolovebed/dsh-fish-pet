/**
 * Wardrobe rules. Pure functions, so every case is a table row rather than a
 * fixture.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { applyWear, bySlot, normalizeWorn, resolveWorn } from '../src/wardrobe.js'

const CATALOG = {
  accessories: [
    { id: 'cat-ears', name: '猫耳', slot: 'head', stackable: false },
    { id: 'top-hat', name: '礼帽', slot: 'head', stackable: false },
    { id: 'headphones', name: '耳机', slot: 'head', stackable: true },
    { id: 'ribbon', name: '蝴蝶结', slot: 'neck', stackable: true },
    { id: 'glasses', name: '眼镜', slot: 'face', stackable: false },
  ],
}

test('wearing a second item in the same slot replaces the first', () => {
  const first = applyWear({ worn: [], catalog: CATALOG, op: 'wear', item: 'cat-ears' })
  assert.equal(first.ok, true)
  assert.deepEqual(first.worn, ['cat-ears'])

  const second = applyWear({ worn: first.worn, catalog: CATALOG, op: 'wear', item: 'top-hat' })
  assert.equal(second.ok, true)
  assert.deepEqual(second.worn, ['top-hat'])
  assert.equal(second.rejected[0].item, 'cat-ears')
})

test('two stackable items can share a slot', () => {
  const first = applyWear({ worn: [], catalog: CATALOG, op: 'wear', item: 'headphones' })
  const second = applyWear({ worn: first.worn, catalog: CATALOG, op: 'wear', item: 'headphones' })
  assert.deepEqual(second.worn, ['headphones'], 'same id is not duplicated')

  const mixed = applyWear({ worn: first.worn, catalog: CATALOG, op: 'wear', item: 'cat-ears' })
  assert.deepEqual(mixed.worn, ['cat-ears'], 'non-stackable still wins the slot')
})

test('unknown items fail loudly instead of being stored', () => {
  const outcome = applyWear({ worn: [], catalog: CATALOG, op: 'wear', item: 'ghost' })
  assert.equal(outcome.ok, false)
  assert.match(outcome.reason, /没有这个挂件/)
  assert.deepEqual(outcome.worn, [])
})

test('a slot guard stops an item from being worn on the wrong body part', () => {
  const outcome = applyWear({ worn: [], catalog: CATALOG, op: 'wear', item: 'cat-ears', slot: 'neck' })
  assert.equal(outcome.ok, false)
  assert.match(outcome.reason, /槽位不匹配/)
})

test('remove and clear behave', () => {
  const removed = applyWear({ worn: ['cat-ears', 'ribbon'], catalog: CATALOG, op: 'remove', item: 'cat-ears' })
  assert.deepEqual(removed.worn, ['ribbon'])

  const absent = applyWear({ worn: ['ribbon'], catalog: CATALOG, op: 'remove', item: 'glasses' })
  assert.equal(absent.ok, true)
  assert.match(absent.reason, /本来就没戴/)

  const cleared = applyWear({ worn: ['ribbon'], catalog: CATALOG, op: 'clear' })
  assert.deepEqual(cleared.worn, [])
})

test('normalizeWorn is the single gate every write path goes through', () => {
  assert.deepEqual(
    normalizeWorn(['cat-ears', 'top-hat', 'ribbon'], CATALOG),
    ['top-hat', 'ribbon'],
    'later entry wins the contested slot',
  )
  assert.deepEqual(normalizeWorn(['ghost', 'ribbon'], CATALOG), ['ribbon'], 'unknown ids are dropped')
  assert.deepEqual(normalizeWorn(['ribbon', 'ribbon'], CATALOG), ['ribbon'], 'duplicates collapse')
  assert.deepEqual(normalizeWorn(null, CATALOG), [])
})

test('resolveWorn reports ids whose pack disappeared', () => {
  const resolved = resolveWorn(['cat-ears', 'ghost'], CATALOG)
  assert.deepEqual(resolved.worn, ['cat-ears'])
  assert.equal(resolved.items[0].name, '猫耳')
  assert.equal(resolved.rejected[0].item, 'ghost')
})

test('bySlot groups into the fixed slot order', () => {
  const groups = bySlot([{ id: 'a', slot: 'head' }, { id: 'b', slot: 'neck' }])
  assert.deepEqual([...groups.keys()], ['back', 'body', 'neck', 'head', 'face', 'hand', 'effect'])
  assert.equal(groups.get('head')[0].id, 'a')
})
