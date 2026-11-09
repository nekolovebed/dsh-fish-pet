/**
 * Asset pack discovery and validation.
 *
 * A pack is one directory with a `manifest.json`:
 *
 *   packs/paopao/manifest.json   { "kind": "skin", ... }
 *   packs/cat-ears/manifest.json { "kind": "accessory", ... }
 *
 * Design posture
 * - Discovery never throws: one broken pack is skipped and reported, the rest
 *   keep working. A malformed manifest must never take the pet down.
 * - Paths are data from disk, so every asset request is resolved and then
 *   checked to still live inside its pack directory. `..`, absolute paths and
 *   unknown extensions are rejected before a file handle is opened.
 * - Only image extensions are servable. Manifests reach the browser through the
 *   catalog JSON, not through the asset route, so the route has one job.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { extname, isAbsolute, join, normalize, resolve, sep } from 'node:path'
import { MOTIONS, SLOTS, SLOT_Z } from './protocol.js'

/** `packs/` next to the package root — the built-in, MIT-licensed artwork. */
export const DEFAULT_PACKS_ROOT = fileURLToPath(new URL('../packs/', import.meta.url))

export const ASSET_ROUTE = '/plugins/dsh-neko-pet/asset'

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/
const REL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$/
const MANIFEST_LIMIT = 64 * 1024
const MAX_LAYERS = 40
const MAX_ANCHORS = 12

const CONTENT_TYPES = new Map([
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
  ['.svg', 'image/svg+xml'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
])

/** Build the loopback URL the browser uses for one asset file. */
export function assetUrl(packId, relPath) {
  const query = `pack=${encodeURIComponent(packId)}&path=${encodeURIComponent(relPath)}`
  return `${ASSET_ROUTE}?${query}`
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function asUnitPair(value) {
  if (!Array.isArray(value) || value.length !== 2) return null
  const [x, y] = value
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return null
  return [x, y]
}

/** Relative asset path that cannot escape its own pack directory. */
export function isSafeRelPath(value) {
  if (typeof value !== 'string' || value.length === 0) return false
  if (value.includes('\0') || value.includes('\\')) return false
  if (isAbsolute(value)) return false
  if (!REL_PATTERN.test(value)) return false
  const segments = value.split('/')
  if (segments.some((part) => part === '' || part === '.' || part === '..')) return false
  const normalized = normalize(value).split(sep).join('/')
  return normalized === value
}

/** Keep only the fields the renderer understands, so a pack cannot smuggle extras. */
function cleanLayer(raw, index, errors, tag) {
  if (!raw || typeof raw !== 'object') {
    errors.push(`${tag}: 第 ${index + 1} 层不是对象`)
    return null
  }
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : ''
  if (!ID_PATTERN.test(id)) {
    errors.push(`${tag}: 第 ${index + 1} 层缺少合法 id`)
    return null
  }
  const layer = { id }
  layer.z = isFiniteNumber(raw.z) ? raw.z : 10 + index

  if (raw.variants && typeof raw.variants === 'object' && !Array.isArray(raw.variants)) {
    const variants = {}
    for (const [key, src] of Object.entries(raw.variants)) {
      if (!ID_PATTERN.test(key) || !isSafeRelPath(src)) {
        errors.push(`${tag}: 层 ${id} 的变体 ${key} 路径非法`)
        continue
      }
      variants[key] = src
    }
    if (Object.keys(variants).length === 0) {
      errors.push(`${tag}: 层 ${id} 没有任何可用变体`)
      return null
    }
    layer.variants = variants
  } else if (isSafeRelPath(raw.src)) {
    layer.src = raw.src
  } else {
    errors.push(`${tag}: 层 ${id} 缺少合法 src 或 variants`)
    return null
  }

  if (typeof raw.motion === 'string') {
    if (MOTIONS.includes(raw.motion)) layer.motion = raw.motion
    else errors.push(`${tag}: 层 ${id} 的运动 ${raw.motion} 不在词汇表内`)
  }
  const pivot = asUnitPair(raw.pivot)
  if (pivot) layer.pivot = pivot
  // Gaze parallax factor: how strongly this layer follows the gaze variables
  // (eyes 1, head ~0.5). Anything outside the band is dropped, not clamped, so
  // a typo in a manifest cannot silently fling a layer across the canvas.
  if (isFiniteNumber(raw.gaze) && raw.gaze > 0 && raw.gaze <= 1.5) layer.gaze = raw.gaze
  if (typeof raw.optional === 'boolean') layer.optional = raw.optional
  return layer
}

function cleanAnchors(raw, errors, tag) {
  const anchors = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return anchors
  for (const [name, pair] of Object.entries(raw).slice(0, MAX_ANCHORS)) {
    if (!ID_PATTERN.test(name)) {
      errors.push(`${tag}: 锚点名 ${name} 非法`)
      continue
    }
    const value = asUnitPair(pair)
    if (!value) {
      errors.push(`${tag}: 锚点 ${name} 必须是 [x, y]`)
      continue
    }
    anchors[name] = [
      Math.min(1, Math.max(0, value[0])),
      Math.min(1, Math.max(0, value[1])),
    ]
  }
  return anchors
}

function cleanExpressions(raw, layerIds) {
  const out = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [pose, spec] of Object.entries(raw)) {
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) continue
    const entry = {}
    for (const [layerId, variant] of Object.entries(spec)) {
      if (!layerIds.has(layerId)) continue
      if (typeof variant !== 'string' || !ID_PATTERN.test(variant)) continue
      entry[layerId] = variant
    }
    if (Object.keys(entry).length > 0) out[pose] = entry
  }
  return out
}

/**
 * Per-skin tuning for a shared accessory.
 *
 * Gear scale is relative to the canvas width, so a 512px photo-like skin and a
 * 200px line-art skin need different numbers for the same cat ears. Letting the
 * skin override them keeps one accessory pack usable on both.
 */
function cleanOverrides(raw) {
  const out = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [id, spec] of Object.entries(raw).slice(0, 40)) {
    if (!ID_PATTERN.test(id) || !spec || typeof spec !== 'object' || Array.isArray(spec)) continue
    const entry = {}
    const scale = Number(spec.scale)
    if (isFiniteNumber(scale)) entry.scale = Math.min(3, Math.max(0.05, scale))
    const offset = asUnitPair(spec.offset)
    if (offset) entry.offset = offset
    const pivot = asUnitPair(spec.pivot)
    if (pivot) entry.pivot = pivot
    if (typeof spec.anchor === 'string' && ID_PATTERN.test(spec.anchor)) entry.anchor = spec.anchor
    if (isFiniteNumber(Number(spec.z))) entry.z = Number(spec.z)
    if (Object.keys(entry).length > 0) out[id] = entry
  }
  return out
}

/**
 * Action → variant key, for skins that ship real motion clips (`wave` playing a
 * hand-authored bow, say). Keys are lowercase because variant ids follow the
 * pack id grammar.
 */
function cleanActionVariants(raw) {
  const out = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [action, key] of Object.entries(raw).slice(0, 16)) {
    if (!ID_PATTERN.test(action) || typeof key !== 'string' || !ID_PATTERN.test(key)) continue
    out[action] = key
  }
  return out
}

/**
 * Validate one skin manifest.
 * @returns {{ok: true, value: object} | {ok: false, reason: string}}
 */
export function validateSkin(raw, dirName) {
  const errors = []
  const tag = `skin:${dirName}`

  const id = typeof raw?.id === 'string' && raw.id.trim() ? raw.id.trim() : dirName
  if (!ID_PATTERN.test(id)) return { ok: false, reason: 'id 不合法' }
  if (id !== dirName) return { ok: false, reason: `id(${id}) 与目录名(${dirName}) 不一致` }

  const name = typeof raw?.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 40) : ''
  if (!name) return { ok: false, reason: '缺少 name' }

  const canvasRaw = raw?.canvas
  const width = Math.round(Number(canvasRaw?.width))
  const height = Math.round(Number(canvasRaw?.height))
  if (!isFiniteNumber(width) || !isFiniteNumber(height) || width < 16 || height < 16
    || width > 4096 || height > 4096) {
    return { ok: false, reason: 'canvas 必须是 16..4096 的 { width, height }' }
  }

  const layerList = Array.isArray(raw?.layers) ? raw.layers.slice(0, MAX_LAYERS) : []
  if (layerList.length === 0) return { ok: false, reason: 'layers 为空' }
  const layers = []
  const layerIds = new Set()
  layerList.forEach((item, index) => {
    const layer = cleanLayer(item, index, errors, tag)
    if (!layer) return
    if (layerIds.has(layer.id)) {
      errors.push(`${tag}: 层 id ${layer.id} 重复`)
      return
    }
    layerIds.add(layer.id)
    layers.push(layer)
  })
  if (layers.length === 0) return { ok: false, reason: '没有合法的 layer' }

  // A pack can mark some variants as motion clips. While a clip plays the
  // renderer shows only that one layer: static overlay layers and wardrobe
  // props would slide over a moving character, and CSS pose animations would
  // fight the frames. `clipLayer` names the layer that carries the clip.
  const clipVariants = Array.isArray(raw?.clipVariants)
    ? [...new Set(raw.clipVariants.filter((key) => typeof key === 'string' && ID_PATTERN.test(key)))].slice(0, 24)
    : []
  const clipLayer = typeof raw?.clipLayer === 'string' && layerIds.has(raw.clipLayer)
    ? raw.clipLayer
    : layers[0].id

  return {
    ok: true,
    value: {
      schema: 1,
      kind: 'skin',
      id,
      name,
      author: typeof raw?.author === 'string' ? raw.author.slice(0, 60) : '',
      license: typeof raw?.license === 'string' ? raw.license.slice(0, 60) : '',
      description: typeof raw?.description === 'string' ? raw.description.slice(0, 200) : '',
      canvas: { width, height },
      anchors: cleanAnchors(raw?.anchors, errors, tag),
      layers: layers.sort((a, b) => a.z - b.z),
      expressions: cleanExpressions(raw?.expressions, layerIds),
      accessoryOverrides: cleanOverrides(raw?.accessoryOverrides),
      actionVariants: cleanActionVariants(raw?.actionVariants),
      clipVariants,
      clipLayer,
      propsEnabled: raw?.propsEnabled !== false,
      warnings: errors,
    },
  }
}

/**
 * Validate one accessory manifest.
 * @returns {{ok: true, value: object} | {ok: false, reason: string}}
 */
export function validateAccessory(raw, dirName) {
  const id = typeof raw?.id === 'string' && raw.id.trim() ? raw.id.trim() : dirName
  if (!ID_PATTERN.test(id)) return { ok: false, reason: 'id 不合法' }
  if (id !== dirName) return { ok: false, reason: `id(${id}) 与目录名(${dirName}) 不一致` }

  const name = typeof raw?.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 40) : ''
  if (!name) return { ok: false, reason: '缺少 name' }

  const slot = typeof raw?.slot === 'string' ? raw.slot : ''
  if (!SLOTS.includes(slot)) return { ok: false, reason: `slot 必须是 ${SLOTS.join('/')}` }

  const src = raw?.src
  if (!isSafeRelPath(src)) return { ok: false, reason: '缺少合法 src' }

  const anchor = typeof raw?.anchor === 'string' && ID_PATTERN.test(raw.anchor) ? raw.anchor : 'head'
  const offset = asUnitPair(raw?.offset) ?? [0, 0]
  const pivot = asUnitPair(raw?.pivot) ?? [0.5, 0.5]
  const scaleRaw = Number(raw?.scale)
  const scale = isFiniteNumber(scaleRaw) ? Math.min(3, Math.max(0.05, scaleRaw)) : 0.4
  const zRaw = Number(raw?.z)
  const z = isFiniteNumber(zRaw) ? zRaw : (SLOT_Z[slot] ?? 40)
  const motion = MOTIONS.includes(raw?.motion) ? raw.motion : 'sway'
  const tags = Array.isArray(raw?.tags)
    ? raw.tags.filter((tag) => typeof tag === 'string').slice(0, 8).map((tag) => tag.slice(0, 24))
    : []
  const poses = Array.isArray(raw?.poses)
    ? raw.poses.filter((pose) => typeof pose === 'string').slice(0, 12)
    : []

  return {
    ok: true,
    value: {
      schema: 1,
      kind: 'accessory',
      id,
      name,
      author: typeof raw?.author === 'string' ? raw.author.slice(0, 60) : '',
      license: typeof raw?.license === 'string' ? raw.license.slice(0, 60) : '',
      description: typeof raw?.description === 'string' ? raw.description.slice(0, 200) : '',
      slot,
      anchor,
      offset,
      pivot,
      scale,
      z,
      motion,
      tags,
      poses,
      stackable: raw?.stackable === true,
      layerOffset: isFiniteNumber(Number(raw?.layerOffset)) ? Number(raw.layerOffset) : 0,
      src,
    },
  }
}

/**
 * A read-only view over one packs directory.
 *
 * `reload()` is synchronous on purpose: the first paint needs the catalog, and
 * a directory with a handful of small manifests is cheaper to read than to
 * orchestrate around. It is called at mount, on an explicit reload and when a
 * tool asks for the catalog.
 */
export class PackRegistry {
  constructor(options = {}) {
    this.cache = new Map()
    this.setRoot(options.root || DEFAULT_PACKS_ROOT)
    this.log = typeof options.log === 'function' ? options.log : () => {}
    this.skins = new Map()
    this.accessories = new Map()
    this.dirs = new Map()
    this.errors = []
    this.updatedAt = 0
  }

  setRoot(root) {
    this.root = root || DEFAULT_PACKS_ROOT
    this.cache.clear()
  }

  /** All packs currently loaded, hydrated with absolute asset URLs. */
  catalog() {
    return {
      root: this.root,
      updatedAt: this.updatedAt,
      skins: [...this.skins.values()],
      accessories: [...this.accessories.values()],
      errors: this.errors,
    }
  }

  skin(id) {
    return this.skins.get(String(id || '')) ?? null
  }

  accessory(id) {
    return this.accessories.get(String(id || '')) ?? null
  }

  /**
   * Re-scan the packs directory.
   * @returns {{skins: number, accessories: number, errors: object[]}}
   */
  reload() {
    const skins = new Map()
    const accessories = new Map()
    this.dirs = new Map()
    const errors = []
    let entries = []
    try {
      entries = readdirSync(this.root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && ID_PATTERN.test(entry.name))
        .map((entry) => entry.name)
        .sort()
    } catch (error) {
      errors.push({ pack: '', reason: `素材目录不可读：${error?.code || error?.message || 'unknown'}` })
    }

    // A directory without a manifest is treated as a container, so users can
    // keep private packs together under `packs/local/<id>`.
    const packs = []
    for (const dirName of entries) {
      const dir = join(this.root, dirName)
      if (this.#hasManifest(dir)) {
        packs.push({ dir, name: dirName })
        continue
      }
      let nested = []
      try {
        nested = readdirSync(dir, { withFileTypes: true })
          .filter((entry) => entry.isDirectory() && ID_PATTERN.test(entry.name))
          .map((entry) => entry.name)
          .sort()
      } catch {}
      const children = nested.filter((name) => this.#hasManifest(join(dir, name)))
      if (children.length === 0) {
        errors.push({ pack: dirName, reason: '缺少 manifest.json' })
        continue
      }
      for (const name of children) packs.push({ dir: join(dir, name), name })
    }

    for (const { dir, name: dirName } of packs) {
      const loaded = this.#loadPack(dir, dirName)
      if (!loaded.ok) {
        errors.push({ pack: dirName, reason: loaded.reason })
        continue
      }
      const manifest = loaded.value
      this.dirs.set(manifest.id, dir)
      if (manifest.kind === 'skin') {
        if (skins.has(manifest.id)) {
          errors.push({ pack: dirName, reason: `皮肤 id ${manifest.id} 重复` })
          continue
        }
        skins.set(manifest.id, this.#hydrate(manifest))
      } else {
        if (accessories.has(manifest.id)) {
          errors.push({ pack: dirName, reason: `挂件 id ${manifest.id} 重复` })
          continue
        }
        accessories.set(manifest.id, this.#hydrate(manifest))
      }
      if (manifest.warnings?.length) {
        for (const warning of manifest.warnings) errors.push({ pack: dirName, reason: warning })
      }
    }

    this.skins = skins
    this.accessories = accessories
    this.errors = errors
    this.updatedAt = Date.now()
    this.log(`packs loaded; skins=${skins.size} accessories=${accessories.size} errors=${errors.length}`)
    return { skins: skins.size, accessories: accessories.size, errors: [...errors] }
  }

  /**
   * Map a request to a file on disk, or `null` when it is not servable.
   * @param {string} packId directory name (also the manifest id)
   * @param {string} relPath manifest-relative asset path
   * @returns {{file: string, type: string, size: number, mtimeMs: number} | null}
   */
  resolveAsset(packId, relPath) {
    if (!ID_PATTERN.test(String(packId || ''))) return null
    if (!isSafeRelPath(relPath)) return null
    const dir = this.dirs.get(String(packId)) || join(this.root, String(packId))
    const file = resolve(dir, relPath)
    if (file !== dir && !file.startsWith(dir + sep)) return null
    const type = CONTENT_TYPES.get(extname(file).toLowerCase())
    if (!type) return null
    try {
      const stat = statSync(file)
      if (!stat.isFile()) return null
      return { file, type, size: stat.size, mtimeMs: stat.mtimeMs }
    } catch {
      return null
    }
  }

  #hasManifest(dir) {
    try {
      return statSync(join(dir, 'manifest.json')).isFile()
    } catch {
      return false
    }
  }

  #loadPack(dir, dirName) {
    const manifestPath = join(dir, 'manifest.json')
    let stat
    try {
      stat = statSync(manifestPath)
    } catch {
      return { ok: false, reason: '缺少 manifest.json' }
    }
    if (!stat.isFile() || stat.size === 0) return { ok: false, reason: 'manifest.json 为空' }
    if (stat.size > MANIFEST_LIMIT) return { ok: false, reason: 'manifest.json 超过 64 KB' }

    const cached = this.cache.get(dir)
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.result

    let raw
    try {
      const text = readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, '')
      raw = JSON.parse(text)
    } catch (error) {
      const result = { ok: false, reason: `manifest.json 解析失败：${error?.message || 'unknown'}` }
      this.cache.set(dir, { mtimeMs: stat.mtimeMs, size: stat.size, result })
      return result
    }

    const kind = raw?.kind
    const result = kind === 'skin'
      ? validateSkin(raw, dirName)
      : kind === 'accessory'
        ? validateAccessory(raw, dirName)
        : { ok: false, reason: 'kind 必须是 skin 或 accessory' }
    this.cache.set(dir, { mtimeMs: stat.mtimeMs, size: stat.size, result })
    return result
  }

  /** Replace every relative path with the URL the browser should load. */
  #hydrate(manifest) {
    if (manifest.kind === 'accessory') {
      return { ...manifest, src: assetUrl(manifest.id, manifest.src), builtin: this.#isBuiltin() }
    }
    const layers = manifest.layers.map((layer) => {
      if (!layer.variants) return { ...layer, src: assetUrl(manifest.id, layer.src) }
      const variants = {}
      for (const [key, value] of Object.entries(layer.variants)) variants[key] = assetUrl(manifest.id, value)
      return { ...layer, variants }
    })
    return { ...manifest, layers, builtin: this.#isBuiltin() }
  }

  #isBuiltin() {
    return resolve(this.root) === resolve(DEFAULT_PACKS_ROOT)
  }
}
