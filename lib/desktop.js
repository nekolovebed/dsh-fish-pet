/* Desktop overlay renderer.
 *
 * Runs in the plugin's own always-on-top window. Plain DOM, no React: the page
 * only needs the layered pet rig, one head bubble and the SSE stream. It shares
 * the same manifest vocabulary as `lib/client.js` (layers, expressions,
 * actionVariants, clipVariants, props, accessoryOverrides).
 */
;(function boot() {
  const TOKEN = new URLSearchParams(location.search).get('token') || ''
  const stackEl = document.getElementById('pet-stack')
  const wrap = document.getElementById('pet-wrap')
  const bubble = document.getElementById('bubble')

  const POSE_VARIANT = {
    IDLE: 'idle', THINKING: 'thinking', WORKING: 'working', WAITING: 'thinking',
    SUCCESS: 'success', ERROR: 'error', SLEEP: 'sleep', SHY: 'idle',
  }
  const ACTION_POSE = { sleep: 'SLEEP', cheer: 'SUCCESS', think: 'THINKING', shy: 'SHY' }

  const snapshot = { hello: null, state: null, wardrobe: null, catalog: null, say: null, action: null }
  const nodes = new Map()
  const timers = { say: null, action: null }
  let lastPetSignature = ''
  let bubbleTimer = null

  /** DSH's web UI carries a session token in its URL; keep it on every request. */
  function withToken(url) {
    if (!TOKEN || !url || typeof url !== 'string') return url || ''
    if (!url.startsWith('/') && !url.startsWith('http')) return url
    try {
      const parsed = new URL(url, location.href)
      parsed.searchParams.set('token', TOKEN)
      return parsed.pathname + parsed.search + parsed.hash
    } catch {
      return url
    }
  }

  function activeSkin() {
    const catalog = snapshot.catalog
    if (!catalog || !Array.isArray(catalog.skins) || catalog.skins.length === 0) return null
    const wanted = snapshot.wardrobe?.skinId || snapshot.hello?.config?.skinId
    return catalog.skins.find((skin) => skin.id === wanted) || catalog.skins[0]
  }

  function wornItems() {
    const wardrobe = snapshot.wardrobe
    if (Array.isArray(wardrobe?.wearing)) return wardrobe.wearing
    const ids = Array.isArray(wardrobe?.worn) ? wardrobe.worn : []
    const list = Array.isArray(snapshot.catalog?.accessories) ? snapshot.catalog.accessories : []
    return ids.map((id) => list.find((item) => item.id === id)).filter(Boolean)
  }

  function live(kind) {
    const entry = snapshot[kind]
    if (!entry) return null
    const field = kind === 'say' ? 'text' : 'action'
    if (!entry[field]) return null
    if (entry.until && entry.until <= Date.now()) return null
    return entry
  }

  function variantSrc(skin, layer, pose, actionKey) {
    if (!layer.variants) return layer.src || ''
    const expression = skin.expressions?.[pose] || skin.expressions?.IDLE || {}
    const keys = Object.keys(layer.variants)
    const key = actionKey && layer.variants[actionKey]
      ? actionKey
      : (expression[layer.id] || POSE_VARIANT[pose] || keys[0])
    return layer.variants[key] || layer.variants[keys[0]] || ''
  }

  function renderPet() {
    const skin = activeSkin()
    if (!skin) return
    const pose = snapshot.state?.pose || 'IDLE'
    const action = live('action')?.action || null
    const displayPose = action ? (ACTION_POSE[action] || pose) : pose
    const actionKey = action ? skin.actionVariants?.[action] : null
    const clipKey = actionKey && Array.isArray(skin.clipVariants) && skin.clipVariants.includes(actionKey)
      ? actionKey
      : null
    const layers = Array.isArray(skin.layers) ? skin.layers : []
    const clipLayerId = skin.clipLayer || layers[0]?.id
    const entries = []

    for (const layer of layers) {
      if (clipKey && layer.id !== clipLayerId) continue
      const src = variantSrc(skin, layer, displayPose, actionKey)
      if (!src) continue
      entries.push({ key: `layer:${layer.id}`, z: Number(layer.z) || 0, type: 'layer', src })
    }

    if (!clipKey && skin.propsEnabled !== false) {
      const anchors = skin.anchors || {}
      const overrides = skin.accessoryOverrides || {}
      for (const base of wornItems()) {
        const tune = overrides[base.id]
        const item = tune && typeof tune === 'object' ? { ...base, ...tune } : base
        if (item.poses?.length && !item.poses.includes(displayPose)) continue
        const anchor = anchors[item.anchor] || anchors.head || [0.5, 0.5]
        const offset = Array.isArray(item.offset) ? item.offset : [0, 0]
        const pivot = Array.isArray(item.pivot) ? item.pivot : [0.5, 0.5]
        entries.push({
          key: `prop:${item.id}`, z: Number(item.z) || 0, type: 'prop', src: item.src,
          left: (anchor[0] + offset[0]) * 100, top: (anchor[1] + offset[1]) * 100,
          width: (Number(item.scale) || 0.4) * 100, px: pivot[0] * 100, py: pivot[1] * 100,
        })
      }
    }
    entries.sort((a, b) => a.z - b.z)

    const className = [clipKey ? 'clip' : '', action ? `act-${action}` : ''].filter(Boolean).join(' ')
    const signature = [className, skin.id, ...entries.map((entry) => `${entry.key}:${entry.z}:${entry.src}`)].join('|')
    if (signature === lastPetSignature) return
    lastPetSignature = signature

    const wanted = new Set(entries.map((entry) => entry.key))
    for (const [key, node] of nodes) {
      if (!wanted.has(key)) {
        node.remove()
        nodes.delete(key)
      }
    }
    for (const entry of entries) {
      let node = nodes.get(entry.key)
      if (!node) {
        if (entry.type === 'layer') {
          node = document.createElement('img')
          node.className = 'rig-layer'
          node.alt = ''
          node.draggable = false
        } else {
          node = document.createElement('div')
          node.className = 'rig-prop'
          const img = document.createElement('img')
          img.alt = ''
          img.draggable = false
          node.appendChild(img)
        }
        nodes.set(entry.key, node)
      }
      const img = entry.type === 'layer' ? node : node.firstChild
      const src = withToken(entry.src)
      if (img.getAttribute('src') !== src) img.setAttribute('src', src)
      if (entry.type === 'prop') {
        node.style.left = `${entry.left}%`
        node.style.top = `${entry.top}%`
        node.style.width = `${entry.width}%`
        node.style.transform = `translate(${-entry.px}%, ${-entry.py}%)`
      }
      // Re-appending an existing node keeps its loaded image (and animation)
      // while restoring the z order.
      stackEl.appendChild(node)
    }

    if (skin.canvas) {
      wrap.style.width = `${Math.round(210 * (skin.canvas.width / 220))}px`
      stackEl.style.aspectRatio = `${skin.canvas.width} / ${skin.canvas.height}`
    }
    stackEl.className = className
  }

  function showBubble(text, until) {
    if (!text) {
      bubble.classList.remove('show')
      return
    }
    bubble.textContent = String(text).slice(0, 220)
    bubble.classList.add('show')
    if (bubbleTimer) clearTimeout(bubbleTimer)
    if (until && until > Date.now()) {
      bubbleTimer = setTimeout(() => {
        bubbleTimer = null
        renderBubble()
      }, until - Date.now() + 40)
    }
  }

  function renderBubble() {
    const say = live('say')
    if (say) return showBubble(say.text, say.until)
    const action = live('action')
    if (action) return showBubble(action.text || '', action.until)
    bubble.classList.remove('show')
  }

  /** Re-render when a transient frame expires even if the SSE clear is missed. */
  function arm(key, payload) {
    clearTimeout(timers[key])
    timers[key] = null
    if (payload?.until && payload.until > Date.now()) {
      timers[key] = setTimeout(() => {
        timers[key] = null
        renderPet()
        renderBubble()
      }, payload.until - Date.now() + 40)
    }
  }

  function apply(payload) {
    if (!payload || typeof payload !== 'object') return
    switch (payload.kind) {
      case 'hello':
        snapshot.hello = payload
        if (payload.catalog) snapshot.catalog = payload.catalog
        break
      case 'catalog':
        snapshot.catalog = payload.catalog || snapshot.catalog
        break
      case 'state':
        snapshot.state = payload
        break
      case 'wardrobe':
        snapshot.wardrobe = payload
        break
      case 'say':
        snapshot.say = payload.text ? payload : null
        arm('say', snapshot.say)
        break
      case 'action':
        snapshot.action = payload.action ? payload : null
        arm('action', snapshot.action)
        break
      default:
        return
    }
    renderPet()
    renderBubble()
  }

  function connect() {
    try {
      const source = new EventSource(withToken('/plugins/dsh-neko-pet/stream'))
      source.onmessage = (event) => {
        try {
          apply(JSON.parse(event.data))
        } catch {}
      }
    } catch {}
  }

  document.getElementById('close').addEventListener('click', () => {
    void fetch(withToken('/plugins/dsh-neko-pet/desktop'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'close', token: TOKEN }),
    }).catch(() => {})
  })

  connect()
})()
