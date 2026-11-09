/**
 * Wardrobe rules, as pure functions.
 *
 * The wear list is stored in settings and can arrive from three places: the
 * settings page, the HTTP config patch and an agent tool call. Keeping the rules
 * pure means all three go through exactly one implementation, and the tests do
 * not need a running host.
 */
import { SLOTS } from './protocol.js'

export const MAX_WORN = 8

function accessoryIndex(catalog) {
  const index = new Map()
  const list = Array.isArray(catalog?.accessories) ? catalog.accessories : []
  for (const item of list) {
    if (item && typeof item.id === 'string') index.set(item.id, item)
  }
  return index
}

/**
 * Expand stored ids into renderable items.
 * Unknown ids are reported, not thrown: a pack may have been deleted while its
 * id was still in the settings file.
 * @param {string[]} ids
 * @param {{accessories?: object[]}} catalog
 * @returns {{items: object[], rejected: {item: string, reason: string}[], worn: string[]}}
 */
export function resolveWorn(ids, catalog) {
  const index = accessoryIndex(catalog)
  const items = []
  const worn = []
  const rejected = []
  for (const id of Array.isArray(ids) ? ids : []) {
    const item = index.get(id)
    if (!item) {
      rejected.push({ item: id, reason: '素材包里没有这个挂件' })
      continue
    }
    if (worn.includes(id)) continue
    items.push(item)
    worn.push(id)
  }
  return { items, worn, rejected }
}

/**
 * Apply one wardrobe operation.
 * @param {object} input
 * @param {string[]} input.worn current ids
 * @param {{accessories?: object[]}} input.catalog
 * @param {'wear'|'remove'|'clear'} input.op
 * @param {string} [input.item] accessory id
 * @param {string} [input.slot] optional slot guard for `wear`
 */
export function applyWear({ worn, catalog, op, item, slot }) {
  const current = Array.isArray(worn) ? [...worn] : []
  const index = accessoryIndex(catalog)
  const rejected = []

  if (op === 'clear') return { ok: true, worn: [], items: [], rejected }

  if (op === 'remove') {
    const id = String(item || '').trim()
    if (!id) return { ok: false, worn: current, items: [], rejected, reason: '需要 item' }
    if (!current.includes(id)) {
      return { ok: true, worn: current, items: [], rejected, reason: '这件本来就没戴' }
    }
    const next = current.filter((entry) => entry !== id)
    return { ok: true, worn: next, items: [], rejected }
  }

  if (op !== 'wear') {
    return { ok: false, worn: current, items: [], rejected, reason: `未知操作 ${op}` }
  }

  const id = String(item || '').trim()
  if (!id) return { ok: false, worn: current, items: [], rejected, reason: '需要 item' }
  const target = index.get(id)
  if (!target) {
    return { ok: false, worn: current, items: [], rejected: [{ item: id, reason: '素材包里没有这个挂件' }], reason: '没有这个挂件' }
  }
  if (slot && slot !== target.slot) {
    return {
      ok: false,
      worn: current,
      items: [],
      rejected: [{ item: id, reason: `${id} 属于 ${target.slot} 槽，不是 ${slot}` }],
      reason: '槽位不匹配',
    }
  }

  // Same-slot conflict: replace unless both sides opted into stacking.
  let next = [...current]
  for (const otherId of current) {
    const other = index.get(otherId)
    if (!other || other.slot !== target.slot || otherId === id) continue
    if (other.stackable && target.stackable) continue
    next = next.filter((entry) => entry !== otherId)
    rejected.push({ item: otherId, reason: `与 ${id} 同槽，已被替换` })
  }

  if (!next.includes(id)) next.push(id)
  if (next.length > MAX_WORN) {
    return {
      ok: false,
      worn: current,
      items: [],
      rejected: [...rejected, { item: id, reason: `最多同时佩戴 ${MAX_WORN} 件` }],
      reason: `最多同时佩戴 ${MAX_WORN} 件`,
    }
  }

  const { items } = resolveWorn(next, catalog)
  return { ok: true, worn: next, items, rejected }
}

/** Group worn items by slot, ordered by the fixed z-index. Pure helper for UI. */
export function bySlot(items) {
  const groups = new Map(SLOTS.map((slot) => [slot, []]))
  for (const item of Array.isArray(items) ? items : []) {
    if (!groups.has(item.slot)) groups.set(item.slot, [])
    groups.get(item.slot).push(item)
  }
  return groups
}

/**
 * Coerce an arbitrary wear list into the rules the rest of the plugin assumes.
 *
 * Every write path (settings page, `PATCH /config`, an agent tool) funnels
 * through this, so a hand-written config file cannot leave two hats on one head.
 * Later entries win for a contested slot.
 */
export function normalizeWorn(ids, catalog) {
  const index = accessoryIndex(catalog)
  const kept = []
  for (const raw of Array.isArray(ids) ? ids : []) {
    const id = typeof raw === 'string' ? raw.trim() : ''
    const item = index.get(id)
    if (!item) continue
    if (!item.stackable) {
      for (let position = kept.length - 1; position >= 0; position -= 1) {
        const other = index.get(kept[position])
        if (other && other.slot === item.slot && !other.stackable) kept.splice(position, 1)
      }
    }
    if (!kept.includes(id)) kept.push(id)
    if (kept.length >= MAX_WORN) break
  }
  return kept
}

