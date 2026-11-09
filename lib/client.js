/* dsh-neko-pet — browser half.
 *
 * Runs inside the DSH page as a lazily required CJS module. Hand-written, no
 * build step: `dsh plugin add git+…` installs it exactly as shipped.
 *
 * Everything here is defensive by design. The overlay is registered into
 * `shell.overlay`; if a future harness release changes the slot contract, the
 * failure must stay inside this file and never abort the Web UI load.
 */
;(function bootstrap() {
  const loader = window.__ModuleLoader__ || window.ModuleLoader
  if (!loader || typeof loader.load !== 'function') {
    console.error('[dsh-neko-pet] 找不到 DSH 模块加载器，桌宠无法挂载')
    return
  }
  loader.load({ id: 'dsh-neko-pet', factory: (require) => {
  const React = require('react')
  const { useCallback, useEffect, useMemo, useRef, useState } = React

  const ENDPOINT = {
    stream: '/plugins/dsh-neko-pet/stream',
    config: '/plugins/dsh-neko-pet/config',
    chat: '/plugins/dsh-neko-pet/chat',
    balance: '/plugins/dsh-neko-pet/balance',
    packs: '/plugins/dsh-neko-pet/packs',
    desktop: '/plugins/dsh-neko-pet/desktop',
  }
  const POS_KEY = 'dsh-neko-pet:origin'
  const OPEN_KEY = 'dsh-neko-pet:open'
  const SEEN_KEY = 'dsh-neko-pet:seen'

  const POSE_LABEL = {
    IDLE: '待命',
    THINKING: '思考中',
    WORKING: '干活中',
    WAITING: '等确认',
    SUCCESS: '完成了',
    ERROR: '出问题了',
  }

  const ACTION_LABEL = {
    wave: '挥手',
    jump: '跳一下',
    spin: '转个圈',
    dance: '跳舞',
    sleep: '打盹',
    cheer: '欢呼',
    shy: '害羞',
    think: '发呆',
  }

  /** Which expression table entry an action borrows while it plays. */
  const ACTION_POSE = {
    sleep: 'SLEEP',
    cheer: 'SUCCESS',
    think: 'THINKING',
    shy: 'SHY',
  }

  const SLOT_LABEL = {
    back: '背后',
    body: '身上',
    neck: '颈部',
    head: '头部',
    face: '脸部',
    hand: '手持',
    effect: '光效',
  }
  const SLOT_ORDER = ['back', 'body', 'neck', 'head', 'face', 'hand', 'effect']

  /** `e(type, props, ...children)` — jsx-runtime's third arg is `key`, so build children explicitly. */
  function e(type, props, ...children) {
    const kids = children.flat().filter((child) => child !== null && child !== undefined && child !== false)
    const merged = props ? { ...props } : {}
    if (kids.length > 0) merged.children = kids.length === 1 ? kids[0] : kids
    return React.createElement(type, merged)
  }

  // ---------------------------------------------------------------- theming
  /** Probe the page background once so the overlay matches light and dark shells. */
  function detectTheme() {
    try {
      const raw = getComputedStyle(document.body).backgroundColor
      const parts = String(raw).match(/[\d.]+/g)
      if (!parts || parts.length < 3) return 'dark'
      const [r, g, b] = parts.map(Number)
      const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
      return luminance > 0.5 ? 'light' : 'dark'
    } catch {
      return 'dark'
    }
  }

  function theme() {
    if (theme.cached) return theme.cached
    theme.cached = detectTheme()
    return theme.cached
  }

  function palette() {
    return theme() === 'light'
      ? {
        surface: 'rgba(255,255,255,0.97)',
        raised: 'rgba(246,248,252,1)',
        line: 'rgba(15,23,42,0.10)',
        text: '#1b2130',
        dim: 'rgba(27,33,48,0.62)',
        faint: 'rgba(27,33,48,0.40)',
        good: '#0e9f6e',
        bad: '#d94848',
        warn: '#c2760a',
        accent: '#4c6fe0',
        shadow: '0 10px 30px rgba(15,23,42,0.16)',
      }
      : {
        surface: 'rgba(24,27,36,0.97)',
        raised: 'rgba(34,38,50,1)',
        line: 'rgba(255,255,255,0.12)',
        text: '#eef1f7',
        dim: 'rgba(238,241,247,0.68)',
        faint: 'rgba(238,241,247,0.42)',
        good: '#4ecf9a',
        bad: '#ff8080',
        warn: '#f0b95e',
        accent: '#8aa6ff',
        shadow: '0 12px 34px rgba(0,0,0,0.55)',
      }
  }

  // ------------------------------------------------------------------- art
  /* The built-in character is an original drawing. No third-party sprite,
   * frame pack or character design is bundled or reproduced. */
  function FishArt({ pose }) {
    const spray = pose === 'WORKING'
    const dots = pose === 'THINKING'
    const sparkle = pose === 'SUCCESS'
    const drop = pose === 'ERROR'
    const alert = pose === 'WAITING'
    return e('svg', {
      viewBox: '0 0 140 130',
      width: '100%',
      height: '100%',
      'aria-hidden': true,
      style: { overflow: 'visible', display: 'block' },
    },
    e('defs', null,
      e('linearGradient', { id: 'fpBody', x1: '0', y1: '0', x2: '0', y2: '1' },
        e('stop', { offset: '0%', stopColor: '#8FB4FF' }),
        e('stop', { offset: '100%', stopColor: '#4C6FE0' })),
      e('linearGradient', { id: 'fpBelly', x1: '0', y1: '0', x2: '0', y2: '1' },
        e('stop', { offset: '0%', stopColor: '#FFF7E2' }),
        e('stop', { offset: '100%', stopColor: '#FFE7B8' }))),
    e('ellipse', { cx: 70, cy: 116, rx: 34, ry: 6, fill: 'rgba(0,0,0,0.16)', className: 'fp-shadow' }),
    e('g', { className: `fp-bob fp-pose-${pose}` },
      // tail
      e('g', { className: `fp-tail fp-tail-${pose}` },
        e('path', {
          d: 'M104 76 C116 66 126 62 132 54 C133 68 127 76 117 80 C128 84 134 92 132 104 C126 97 116 92 104 86 Z',
          fill: '#4566D6',
        })),
      // dorsal fin
      e('path', { d: 'M64 46 C68 32 76 26 84 28 C80 35 77 42 76 48 Z', fill: '#3F5FCB' }),
      // body
      e('path', {
        d: 'M28 76 C28 50 46 36 68 36 C92 36 108 52 108 76 C108 98 90 110 68 110 C46 110 28 96 28 76 Z',
        fill: 'url(#fpBody)',
      }),
      // belly
      e('ellipse', { cx: 68, cy: 90, rx: 29, ry: 18, fill: 'url(#fpBelly)', opacity: 0.92 }),
      // pectoral fin
      e('path', { d: 'M46 92 C38 98 35 106 40 110 C49 108 57 101 60 94 Z', fill: '#3F5FCB', opacity: 0.95 }),
      // gill
      e('path', { d: 'M92 62 C88 70 88 82 92 90', stroke: 'rgba(255,255,255,0.45)', strokeWidth: 2.4, fill: 'none', strokeLinecap: 'round' }),
      // face
      e('g', { className: 'fp-face' },
        e('g', { className: 'fp-eyes' },
          e('ellipse', { cx: 56, cy: 72, rx: 8, ry: 9.4, fill: '#FFFFFF' }),
          e('ellipse', { cx: 82, cy: 72, rx: 8, ry: 9.4, fill: '#FFFFFF' }),
          e('circle', { cx: 57, cy: 73.5, r: 4.4, fill: '#202742' }),
          e('circle', { cx: 83, cy: 73.5, r: 4.4, fill: '#202742' }),
          e('circle', { cx: 58.7, cy: 71.2, r: 1.5, fill: '#FFFFFF' }),
          e('circle', { cx: 84.7, cy: 71.2, r: 1.5, fill: '#FFFFFF' })),
        e('path', {
          d: pose === 'ERROR' ? 'M62 92 Q70 86 78 92' : 'M62 90 Q70 96 78 90',
          stroke: '#3A4670', strokeWidth: 2.6, fill: 'none', strokeLinecap: 'round',
        }),
        e('circle', { cx: 43, cy: 84, r: 5.2, fill: '#FF9FB2', opacity: 0.75 }),
        e('circle', { cx: 95, cy: 84, r: 5.2, fill: '#FF9FB2', opacity: 0.75 })),
      dots ? e('g', { className: 'fp-dots' },
        e('circle', { cx: 112, cy: 44, r: 3.2, fill: '#FFFFFF', opacity: 0.9 }),
        e('circle', { cx: 120, cy: 34, r: 4.2, fill: '#FFFFFF', opacity: 0.75 }),
        e('circle', { cx: 128, cy: 24, r: 2.6, fill: '#FFFFFF', opacity: 0.6 })) : null,
      spray ? e('g', { className: 'fp-spray' },
        e('circle', { cx: 70, cy: 26, r: 3, fill: '#BFE3FF' }),
        e('circle', { cx: 62, cy: 18, r: 2.2, fill: '#BFE3FF', opacity: 0.75 }),
        e('circle', { cx: 78, cy: 16, r: 2.6, fill: '#BFE3FF', opacity: 0.85 })) : null,
      sparkle ? e('g', { className: 'fp-sparkle' },
        e('path', { d: 'M112 30 l2.6 6.4 6.4 2.6 -6.4 2.6 -2.6 6.4 -2.6 -6.4 -6.4 -2.6 6.4 -2.6 z', fill: '#FFE28A' }),
        e('path', { d: 'M28 44 l1.8 4.4 4.4 1.8 -4.4 1.8 -1.8 4.4 -1.8 -4.4 -4.4 -1.8 4.4 -1.8 z', fill: '#FFE28A', opacity: 0.8 })) : null,
      drop ? e('path', { className: 'fp-drop', d: 'M104 44 C104 44 110 52 110 56 a6 6 0 0 1 -12 0 C98 52 104 44 104 44 Z', fill: '#9BD7FF' }) : null,
      alert ? e('g', { className: 'fp-alert' },
        e('circle', { cx: 112, cy: 36, r: 10, fill: '#F0B95E' }),
        e('rect', { x: 110.4, y: 30, width: 3.2, height: 8, rx: 1.6, fill: '#3A2B0C' }),
        e('circle', { cx: 112, cy: 41.4, r: 1.7, fill: '#3A2B0C' })) : null,
    ))
  }

  /** Pose marks that do not belong to any pack, so a skin stays just a body. */
  function PoseFx({ pose }) {
    if (pose === 'THINKING') {
      return e('g', { className: 'fp-dots' },
        e('circle', { cx: 30, cy: 34, r: 3.2, fill: '#FFFFFF', opacity: 0.9 }),
        e('circle', { cx: 40, cy: 24, r: 4.2, fill: '#FFFFFF', opacity: 0.75 }),
        e('circle', { cx: 50, cy: 14, r: 2.6, fill: '#FFFFFF', opacity: 0.6 }))
    }
    if (pose === 'WORKING') {
      return e('g', { className: 'fp-spray' },
        e('circle', { cx: 26, cy: 30, r: 3, fill: '#BFE3FF' }),
        e('circle', { cx: 18, cy: 22, r: 2.2, fill: '#BFE3FF', opacity: 0.75 }),
        e('circle', { cx: 34, cy: 20, r: 2.6, fill: '#BFE3FF', opacity: 0.85 }))
    }
    if (pose === 'SUCCESS') {
      return e('g', { className: 'fp-sparkle' },
        e('path', { d: 'M34 12 l2.6 6.4 6.4 2.6 -6.4 2.6 -2.6 6.4 -2.6 -6.4 -6.4 -2.6 6.4 -2.6 z', fill: '#FFE28A' }),
        e('path', { d: 'M14 28 l1.8 4.4 4.4 1.8 -4.4 1.8 -1.8 4.4 -1.8 -4.4 -4.4 -1.8 4.4 -1.8 z', fill: '#FFE28A', opacity: 0.8 }))
    }
    if (pose === 'ERROR') {
      return e('path', { className: 'fp-drop', d: 'M34 18 C34 18 40 26 40 30 a6 6 0 0 1 -12 0 C28 26 34 18 34 18 Z', fill: '#9BD7FF' })
    }
    if (pose === 'WAITING') {
      return e('g', { className: 'fp-alert' },
        e('circle', { cx: 34, cy: 24, r: 10, fill: '#F0B95E' }),
        e('rect', { x: 32.4, y: 18, width: 3.2, height: 8, rx: 1.6, fill: '#3A2B0C' }),
        e('circle', { cx: 34, cy: 29.4, r: 1.7, fill: '#3A2B0C' }))
    }
    return null
  }

  /**
   * Render one skin pack.
   *
   * Layers and props share a single stack ordered by `z`: a `back` prop (a cape,
   * z ≈ 6) has to render *behind* the body, or it would cover the face. Missing
   * variants fall back to the layer's first variant, and a broken image simply
   * renders nothing — the pet stays interactive.
   *
   * Two rendering modes:
   *  - Still rig (the usual case): a static base plus full-canvas overlay layers
   *    (expressions / effects) and wardrobe props, all gently animated by CSS.
   *  - Motion clip: an action mapped to a `clipVariants` entry. The clip already
   *    contains the whole character, so only `clipLayer` is drawn and CSS motion
   *    is suppressed; overlay layers and props would slide over moving frames.
   */
  function RigStage({ skin, worn, pose, action, walking }) {
    const canvas = skin?.canvas || { width: 140, height: 130 }
    const displayPose = action ? (ACTION_POSE[action] || pose) : pose
    const expression = skin?.expressions?.[displayPose] || skin?.expressions?.IDLE || {}
    const anchors = skin?.anchors || {}
    const layers = Array.isArray(skin?.layers) ? skin.layers : []
    const hasFxLayer = layers.some((layer) => layer.id === 'fx')
    const actionKey = action ? skin?.actionVariants?.[action] : null
    const clipKey = actionKey && Array.isArray(skin?.clipVariants) && skin.clipVariants.includes(actionKey)
      ? actionKey
      : null
    const clipLayerId = skin?.clipLayer || layers[0]?.id
    const props = clipKey || skin?.propsEnabled === false
      ? []
      : (Array.isArray(worn) ? worn : [])
        .filter((item) => !item.poses?.length || item.poses.includes(displayPose))

    const stack = []

    for (const layer of layers) {
      if (clipKey && layer.id !== clipLayerId) continue
      const variantKey = actionKey && layer.variants?.[actionKey] ? actionKey : expression[layer.id]
      const src = layer.variants
        ? (layer.variants[variantKey] || layer.variants[Object.keys(layer.variants)[0]])
        : layer.src
      if (!src) continue
      const pivot = Array.isArray(layer.pivot) ? layer.pivot : null
      const img = e('img', {
        key: `layer-${layer.id}`,
        src,
        alt: '',
        draggable: false,
        className: `fp-layer${layer.motion ? ` fp-motion-${layer.motion}` : ''}`,
        style: pivot ? { transformOrigin: `${pivot[0] * 100}% ${pivot[1] * 100}%` } : undefined,
      })
      stack.push({
        z: Number(layer.z) || 0,
        // Layers flagged `gaze` ride in a wrapper so their parallax transform
        // cannot fight the CSS motion animated on the image itself.
        node: layer.gaze ? e('div', { key: `gaze-${layer.id}`, className: 'fp-gaze' }, img) : img,
      })
    }

    const overrides = skin?.accessoryOverrides || {}
    for (const base of props) {
      const tune = overrides[base.id]
      const item = tune && typeof tune === 'object' ? { ...base, ...tune } : base
      const anchor = anchors[item.anchor] || anchors.head || [0.5, 0.5]
      const offset = Array.isArray(item.offset) ? item.offset : [0, 0]
      const pivot = Array.isArray(item.pivot) ? item.pivot : [0.5, 0.5]
      stack.push({
        z: Number(item.z) || 0,
        node: e('div', {
          key: `prop-${item.id}`,
          className: 'fp-prop',
          title: item.name,
          style: {
            left: `${(anchor[0] + offset[0]) * 100}%`,
            top: `${(anchor[1] + offset[1]) * 100}%`,
            width: `${(Number(item.scale) || 0.4) * 100}%`,
            transform: `translate(${-pivot[0] * 100}%, ${-pivot[1] * 100}%)`,
          },
        },
        e('img', {
          src: item.src,
          alt: '',
          draggable: false,
          className: `fp-prop-art${item.motion ? ` fp-motion-${item.motion}` : ''}`,
          style: { transformOrigin: `${pivot[0] * 100}% ${pivot[1] * 100}%` },
        })),
      })
    }

    stack.sort((a, b) => a.z - b.z)

    return e('div', {
      style: { position: 'relative', width: '100%', height: '100%', aspectRatio: `${canvas.width} / ${canvas.height}` },
    },
    e('div', { className: 'fp-stage-shadow' }),
    e('div', {
      className: `fp-rig fp-pose-${pose}${action ? ` fp-act-${action}` : ''}${clipKey ? ' fp-clip' : ''}${walking ? ' fp-walking' : ''}`,
    },
      stack.map((entry) => entry.node),
      // A pack with its own `fx` layer draws its own expression marks; the
      // built-in marks would double up on the same face.
      !clipKey && !hasFxLayer
        ? e('svg', { className: 'fp-fx', viewBox: '0 0 60 60', 'aria-hidden': true },
          e(PoseFx, { pose: displayPose }))
        : null))
  }

  /** Pick the skin the host says is active, falling back to the first pack. */
  function activeSkin(snapshot) {
    const catalog = snapshot?.catalog
    if (!catalog || !Array.isArray(catalog.skins) || catalog.skins.length === 0) return null
    const wanted = snapshot?.wardrobe?.skinId || snapshot?.hello?.config?.skinId
    return catalog.skins.find((skin) => skin.id === wanted) || catalog.skins[0]
  }

  /** Worn props, preferring the hydrated list the host already resolved. */
  function wornItems(snapshot) {
    const wardrobe = snapshot?.wardrobe
    if (Array.isArray(wardrobe?.wearing)) return wardrobe.wearing
    const catalog = snapshot?.catalog
    const ids = Array.isArray(wardrobe?.worn) ? wardrobe.worn : []
    const list = Array.isArray(catalog?.accessories) ? catalog.accessories : []
    return ids.map((id) => list.find((item) => item.id === id)).filter(Boolean)
  }

  const STYLE_ID = 'dsh-neko-pet-style'
  function ensureStyle() {
    if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return
    const node = document.createElement('style')
    node.id = STYLE_ID
    node.textContent = `
@keyframes fp-bob { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-4px) } }
@keyframes fp-bob-fast { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-6px) } }
@keyframes fp-wag { 0%,100% { transform: rotate(0deg) } 50% { transform: rotate(10deg) } }
@keyframes fp-wag-fast { 0%,100% { transform: rotate(-4deg) } 50% { transform: rotate(14deg) } }
@keyframes fp-blink { 0%,94%,100% { transform: scaleY(1) } 97% { transform: scaleY(0.08) } }
@keyframes fp-hop { 0%,100% { transform: translateY(0) } 35% { transform: translateY(-14px) } 60% { transform: translateY(0) } }
@keyframes fp-shake { 0%,100% { transform: rotate(0deg) } 25% { transform: rotate(-4deg) } 75% { transform: rotate(4deg) } }
@keyframes fp-droop { 0%,100% { transform: rotate(8deg) translateY(3px) } 50% { transform: rotate(11deg) translateY(5px) } }
@keyframes fp-float { 0% { opacity: 0; transform: translateY(4px) } 40% { opacity: 1 } 100% { opacity: 0; transform: translateY(-8px) } }
@keyframes fp-twinkle { 0%,100% { opacity: 0.25; transform: scale(0.85) } 50% { opacity: 1; transform: scale(1.08) } }
@keyframes fp-drip { 0%,100% { opacity: 0; transform: translateY(-3px) } 50% { opacity: 1; transform: translateY(3px) } }
@keyframes fp-pulse { 0%,100% { opacity: 0.55 } 50% { opacity: 1 } }
@keyframes fp-sway { 0%,100% { transform: rotate(-3.5deg) } 50% { transform: rotate(3.5deg) } }
@keyframes fp-act-jump { 0%,100% { transform: translateY(0) } 30% { transform: translateY(-16px) } 62% { transform: translateY(0) } }
@keyframes fp-act-spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
@keyframes fp-act-dance { 0%,100% { transform: translateX(-6px) rotate(-6deg) } 50% { transform: translateX(6px) rotate(6deg) } }
@keyframes fp-act-wave { 0%,100% { transform: rotate(0deg) } 25% { transform: rotate(-7deg) } 75% { transform: rotate(7deg) } }
@keyframes fp-act-cheer { 0%,100% { transform: translateY(0) scale(1) } 40% { transform: translateY(-12px) scale(1.05) } }
@keyframes fp-act-shy { 0%,100% { transform: rotate(0deg) } 50% { transform: rotate(-6deg) translateY(2px) } }
.fp-bob { animation: fp-bob 3.4s ease-in-out infinite; }
.fp-bob.fp-pose-THINKING { animation-duration: 2.1s; }
.fp-bob.fp-pose-WORKING { animation: fp-bob-fast 0.95s ease-in-out infinite; }
.fp-bob.fp-pose-SUCCESS { animation: fp-hop 0.9s ease-out 2; }
.fp-bob.fp-pose-WAITING { animation: fp-shake 1.6s ease-in-out infinite; }
.fp-bob.fp-pose-ERROR { animation: fp-droop 2.8s ease-in-out infinite; }
.fp-tail { transform-origin: 106px 80px; animation: fp-wag 2.8s ease-in-out infinite; }
.fp-tail-WORKING { animation: fp-wag-fast 0.8s ease-in-out infinite; }
.fp-tail-SUCCESS { animation: fp-wag-fast 0.5s ease-in-out 4; }
.fp-eyes { transform-origin: 69px 72px; animation: fp-blink 5.6s ease-in-out infinite; }
.fp-dots circle { animation: fp-float 1.8s ease-in-out infinite; }
.fp-dots circle:nth-child(2) { animation-delay: 0.35s; }
.fp-dots circle:nth-child(3) { animation-delay: 0.7s; }
.fp-sparkle path { animation: fp-twinkle 1.1s ease-in-out infinite; transform-origin: center; }
.fp-sparkle path:nth-child(2) { animation-delay: 0.45s; }
.fp-drop { animation: fp-drip 1.6s ease-in-out infinite; }
.fp-alert { animation: fp-pulse 1.2s ease-in-out infinite; }
.fp-shadow { opacity: 0.5; }
/* --- pack renderer (rig) ------------------------------------------------ */
.fp-rig { position: absolute; inset: 0; animation: fp-bob 3.4s ease-in-out infinite; transform-origin: 50% 88%; }
.fp-rig.fp-pose-THINKING { animation-duration: 2.1s; }
.fp-rig.fp-pose-WORKING { animation: fp-bob-fast 0.95s ease-in-out infinite; }
.fp-rig.fp-pose-SUCCESS { animation: fp-hop 0.9s ease-out 2; }
.fp-rig.fp-pose-WAITING { animation: fp-shake 1.6s ease-in-out infinite; }
.fp-rig.fp-pose-ERROR { animation: fp-droop 2.8s ease-in-out infinite; }
.fp-layer { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.fp-prop { position: absolute; pointer-events: none; }
.fp-prop-art { display: block; width: 100%; height: auto; pointer-events: none; }
.fp-motion-wag { animation: fp-wag 2.8s ease-in-out infinite; }
.fp-motion-sway { animation: fp-sway 3.6s ease-in-out infinite; }
.fp-motion-blink { animation: fp-blink 5.6s ease-in-out infinite; }
.fp-motion-bob { animation: fp-bob 3.4s ease-in-out infinite; }
.fp-motion-hop { animation: fp-hop 0.9s ease-out infinite; }
.fp-motion-shake { animation: fp-shake 1.6s ease-in-out infinite; }
.fp-motion-droop { animation: fp-droop 2.8s ease-in-out infinite; }
.fp-motion-spin { animation: fp-act-spin 1.4s linear infinite; }
.fp-motion-none { animation: none; }
/* Actions are declared after poses so they win at equal specificity. */
.fp-rig.fp-act-wave { animation: fp-act-wave 0.8s ease-in-out 2; }
.fp-rig.fp-act-jump { animation: fp-act-jump 1.2s ease-out; }
.fp-rig.fp-act-spin { animation: fp-act-spin 1.4s linear; }
.fp-rig.fp-act-dance { animation: fp-act-dance 0.6s ease-in-out 4; }
.fp-rig.fp-act-cheer { animation: fp-act-cheer 0.5s ease-out 3; }
.fp-rig.fp-act-shy { animation: fp-act-shy 1s ease-in-out 2; }
.fp-rig.fp-act-sleep { animation: fp-droop 3s ease-in-out infinite; }
.fp-rig.fp-act-think { animation: fp-bob 2.4s ease-in-out infinite; }

/* --- continuous motion (agent-driven) -------------------------------------
 * The gaze variables --gaze-x/y are set on the stage container and inherited
 * by every layer marked with a gaze factor in the manifest. The transform
 * lives on a wrapper so it never fights the CSS animation on the image. */
.fp-gaze {
  position: absolute; inset: 0; pointer-events: none;
  transform: translate(var(--gaze-x, 0px), var(--gaze-y, 0px));
  transition: transform 0.18s ease-out;
  will-change: transform;
}
/* The fallback art has no wrappers; its face group takes the same variables. */
.fp-face {
  transform: translate(var(--gaze-x, 0px), var(--gaze-y, 0px));
  transition: transform 0.18s ease-out;
}
/* Walking overrides the pose animation and speeds the tail up. Declared after
 * the pose/action rules so it wins the cascade at equal specificity. */
.fp-walking .fp-rig { animation: fp-bob-fast 0.62s ease-in-out infinite; }
.fp-walking .fp-bob { animation-duration: 0.62s; }
.fp-walking .fp-motion-wag { animation-duration: 0.85s; }
.fp-walking .fp-tail { animation-duration: 0.85s; }
/* A motion clip animates itself: do not stack CSS pose/action motion on it. */
.fp-rig.fp-clip, .fp-rig.fp-clip[class*="fp-pose-"], .fp-rig.fp-clip[class*="fp-act-"] { animation: none !important; }
.fp-stage-shadow {
  position: absolute; left: 20%; right: 20%; bottom: 0; height: 7%;
  background: radial-gradient(ellipse at center, rgba(0,0,0,0.26), rgba(0,0,0,0) 70%);
  pointer-events: none;
}
.fp-fx { position: absolute; right: 0; top: 0; width: 38%; height: 38%; overflow: visible; pointer-events: none; }
/* Head bubble: one plain rounded frame with a tail, like the reference pet. */
@keyframes fp-bubble-in { from { opacity: 0; transform: translateY(5px) } to { opacity: 1; transform: translateY(0) } }
.fp-bubble {
  position: relative; max-width: 220px; box-sizing: border-box;
  background: #fff; color: #1b2130; border: 1px solid rgba(15,23,42,0.12);
  border-radius: 12px; padding: 7px 10px; box-shadow: 0 6px 16px rgba(0,0,0,0.18);
  font-size: 12px; line-height: 1.45; text-align: center; pointer-events: none;
  animation: fp-bubble-in .18s ease-out;
}
.fp-bubble::after {
  content: ""; position: absolute; left: 50%; bottom: -6px; margin-left: -6px;
  width: 11px; height: 11px; background: #fff;
  border-right: 1px solid rgba(15,23,42,0.12); border-bottom: 1px solid rgba(15,23,42,0.12);
  transform: rotate(45deg); border-radius: 0 0 2px 0;
}
.fp-bubble-text {
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical;
  overflow: hidden; white-space: pre-wrap; word-break: break-word;
}
@media (prefers-reduced-motion: reduce) {
  .fp-bob, .fp-tail, .fp-eyes, .fp-dots circle, .fp-sparkle path, .fp-drop, .fp-alert { animation: none !important; }
  .fp-rig, .fp-rig[class*="fp-pose-"], .fp-rig[class*="fp-act-"], .fp-layer, .fp-prop-art { animation: none !important; }
  .fp-bubble { animation: none !important; }
}
`
    document.head.appendChild(node)
  }

  // ------------------------------------------------------------- data layer
  /** Subscribe to the host stream. Returns `{ state, tasks, usage, balance, chat, hello }`. */
  function useCompanion() {
    const [snapshot, setSnapshot] = useState({
      state: null, tasks: [], usage: null, balance: null, hello: null, chat: [],
      action: null, say: null, wardrobe: null, catalog: null, motion: null,
    })
    const sourceRef = useRef(null)

    useEffect(() => {
      let alive = true
      const apply = (payload) => {
        if (!alive || !payload || typeof payload !== 'object') return
        setSnapshot((prev) => {
          switch (payload.kind) {
            case 'hello':
              return { ...prev, hello: payload, catalog: payload.catalog ?? prev.catalog }
            case 'state':
              return { ...prev, state: payload }
            case 'action':
              return { ...prev, action: payload.action ? payload : null }
            case 'motion':
              return { ...prev, motion: payload }
            case 'say':
              return { ...prev, say: payload.text ? payload : null }
            case 'wardrobe':
              return { ...prev, wardrobe: payload }
            case 'catalog':
              return { ...prev, catalog: payload.catalog ?? prev.catalog }
            case 'tasks':
              return { ...prev, tasks: Array.isArray(payload.items) ? payload.items : [] }
            case 'usage':
              return { ...prev, usage: payload }
            case 'balance':
              return { ...prev, balance: payload }
            case 'chat': {
              const next = prev.chat.slice(-40)
              const last = next[next.length - 1]
              // A streaming reply replaces the previous assistant frame instead of
              // appending, so the bubble does not grow one line at a time.
              if (payload.role === 'assistant' && last && last.role === 'assistant' && last.streaming) {
                next[next.length - 1] = payload
              } else {
                next.push(payload)
              }
              return { ...prev, chat: next }
            }
            default:
              return prev
          }
        })
      }

      if (typeof EventSource === 'undefined') return () => { alive = false }
      try {
        const source = new EventSource(ENDPOINT.stream)
        sourceRef.current = source
        source.onmessage = (event) => {
          try {
            apply(JSON.parse(event.data))
          } catch {}
        }
      } catch {}
      return () => {
        alive = false
        try { sourceRef.current?.close() } catch {}
        sourceRef.current = null
      }
    }, [])

    return snapshot
  }

  // -------------------------------------------------------------- ui pieces
  function Dot({ color, pulse }) {
    return e('span', {
      style: {
        width: 7, height: 7, borderRadius: '50%', background: color, flex: '0 0 auto',
        animation: pulse ? 'fp-pulse 1.4s ease-in-out infinite' : undefined,
      },
    })
  }

  function Row({ label, value, hint, tone }) {
    const p = palette()
    const color = tone === 'good' ? p.good : tone === 'bad' ? p.bad : tone === 'warn' ? p.warn : p.text
    return e('div', { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, padding: '5px 0' } },
      e('span', { style: { color: p.dim, fontSize: 12, flex: '0 0 auto' } }, label),
      e('span', { style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', minWidth: 0 } },
        e('span', { style: { color, fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' } }, value),
        hint ? e('span', { style: { color: p.faint, fontSize: 10.5, marginTop: 1 } }, hint) : null))
  }

  function formatTokens(count) {
    const value = Number(count) || 0
    if (value < 1000) return String(value)
    if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}k`
    return `${(value / 1_000_000).toFixed(2)}M`
  }

  function formatDuration(ms) {
    const value = Number(ms) || 0
    if (value < 1000) return '<1s'
    if (value < 60_000) return `${Math.round(value / 1000)}s`
    return `${Math.floor(value / 60_000)}m${Math.round((value % 60_000) / 1000)}s`
  }

  function BalanceBlock({ balance, onRefresh }) {
    const p = palette()
    const [busy, setBusy] = useState(false)
    const ok = balance && balance.status === 'ok'
    const total = ok
      ? `${balance.currency === 'CNY' ? '¥' : ''}${Number(balance.total).toFixed(2)}`
      : '—'
    const hint = ok
      ? [
        balance.source === 'deepseek' ? 'DeepSeek 余额接口' : '自定义接口',
        typeof balance.granted === 'number' && balance.granted > 0 ? `赠金 ¥${balance.granted.toFixed(2)}` : null,
      ].filter(Boolean).join(' · ')
      : (balance?.reason || '正在查询…')
    return e('div', { style: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0 4px' } },
      e('div', { style: { flex: 1, minWidth: 0 } },
        e('div', { style: { color: p.faint, fontSize: 11, marginBottom: 2 } }, '账户余额'),
        e('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8 } },
          e('span', {
            style: {
              fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em',
              color: ok ? p.text : p.faint, fontVariantNumeric: 'tabular-nums',
            },
          }, total),
          ok && balance.available === false
            ? e('span', { style: { color: p.bad, fontSize: 11 } }, '账户不可用')
            : null),
        e('div', { style: { color: p.faint, fontSize: 10.5, marginTop: 2, lineHeight: 1.35 } }, hint)),
      e('button', {
        type: 'button',
        title: '刷新余额',
        disabled: busy,
        onClick: async () => {
          setBusy(true)
          try {
            await onRefresh?.()
          } finally {
            setBusy(false)
          }
        },
        style: {
          border: `1px solid ${p.line}`, background: 'transparent', color: p.dim,
          borderRadius: 8, padding: '5px 9px', fontSize: 11, cursor: busy ? 'default' : 'pointer',
          opacity: busy ? 0.5 : 1,
        },
      }, busy ? '刷新中' : '刷新'))
  }

  function TaskList({ tasks }) {
    const p = palette()
    if (!Array.isArray(tasks) || tasks.length === 0) {
      return e('div', { style: { color: p.faint, fontSize: 11.5, padding: '8px 0' } }, '还没有任务记录')
    }
    return e('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
      tasks.slice(0, 5).map((task) => {
        const tone = task.state === 'running' ? p.accent
          : task.state === 'done' ? p.good
            : task.state === 'error' ? p.bad : p.faint
        const label = task.state === 'running' ? '进行中'
          : task.state === 'done' ? '完成'
            : task.state === 'error' ? '失败' : '已停止'
        return e('div', {
          key: task.id,
          style: {
            display: 'flex', alignItems: 'center', gap: 7, padding: '5px 8px',
            borderRadius: 8, background: p.raised, border: `1px solid ${p.line}`,
          },
        },
        e(Dot, { color: tone, pulse: task.state === 'running' }),
        e('span', {
          style: {
            flex: 1, minWidth: 0, fontSize: 11.5, color: p.text,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          },
          title: task.title,
        }, task.title || '未命名任务'),
        e('span', { style: { color: p.faint, fontSize: 10, flex: '0 0 auto' } },
          task.tools > 0 ? `${task.tools} 步` : label),
        e('span', { style: { color: tone, fontSize: 10, flex: '0 0 auto' } }, label))
      }))
  }

  function ChatLog({ chat, sending }) {
    const p = palette()
    const boxRef = useRef(null)
    useEffect(() => {
      const node = boxRef.current
      if (node) node.scrollTop = node.scrollHeight
    }, [chat.length, chat[chat.length - 1]?.text])
    return e('div', {
      ref: boxRef,
      style: {
        maxHeight: 168, overflowY: 'auto', display: 'flex', flexDirection: 'column',
        gap: 6, paddingRight: 2,
      },
    },
    chat.length === 0
      ? e('div', { style: { color: p.faint, fontSize: 11.5, lineHeight: 1.5 } },
        '问我点什么，我会用 DSH 的会话帮你做事；也可以先让我待着。')
      : chat.map((item, index) => {
        const mine = item.role === 'user'
        const sys = item.role === 'system'
        return e('div', {
          key: `${index}-${item.at}`,
          style: {
            alignSelf: mine ? 'flex-end' : 'flex-start',
            maxWidth: '88%',
            background: sys ? 'transparent' : mine ? p.accent : p.raised,
            color: sys ? p.bad : mine ? '#fff' : p.text,
            border: sys ? `1px dashed ${p.line}` : 'none',
            borderRadius: 10,
            padding: '6px 9px',
            fontSize: 12,
            lineHeight: 1.5,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          },
        }, item.text)
      }),
    sending ? e('div', { style: { color: p.faint, fontSize: 11, display: 'flex', gap: 6, alignItems: 'center' } },
      e(Dot, { color: p.accent, pulse: true }), '正在响应…') : null)
  }

  function Composer({ onSend, disabled }) {
    const p = palette()
    const [text, setText] = useState('')
    const [error, setError] = useState('')
    const [sending, setSending] = useState(false)
    const submit = async () => {
      const value = text.trim()
      if (!value || sending) return
      setSending(true)
      setError('')
      const result = await onSend(value)
      setSending(false)
      if (result.ok) setText('')
      else setError(result.reason || '发送失败')
    }
    return e('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
      e('div', { style: { display: 'flex', gap: 6, alignItems: 'flex-end' } },
        e('textarea', {
          value: text,
          rows: 1,
          disabled: disabled || sending,
          placeholder: disabled ? '对话不可用' : '跟泡泡说点什么…',
          onChange: (event) => setText(event.target.value),
          onKeyDown: (event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void submit()
            }
          },
          style: {
            flex: 1, resize: 'none', minHeight: 32, maxHeight: 92, padding: '7px 9px',
            borderRadius: 9, border: `1px solid ${p.line}`, background: p.raised,
            color: p.text, fontSize: 12, fontFamily: 'inherit', lineHeight: 1.45, outline: 'none',
          },
        }),
        e('button', {
          type: 'button',
          disabled: disabled || sending || !text.trim(),
          onClick: () => void submit(),
          style: {
            border: 'none', borderRadius: 9, padding: '7px 12px', fontSize: 12, fontWeight: 600,
            background: p.accent, color: '#fff', cursor: 'pointer',
            opacity: disabled || sending || !text.trim() ? 0.45 : 1,
          },
        }, '发送')),
      error ? e('div', { style: { color: p.bad, fontSize: 10.5 } }, error) : null)
  }

  function Panel({ snapshot, onClose, onRefreshBalance }) {
    const p = palette()
    const { state, tasks, usage, balance, hello } = snapshot
    const config = hello?.config ?? {}
    const skinName = activeSkin(snapshot)?.name || '泡泡'
    const wornCount = wornItems(snapshot).length
    const cost = usage?.priced ? `¥${Number(usage.cost).toFixed(4)}` : '未配置单价'
    return e('div', {
      style: {
        width: 292, maxHeight: 'min(74vh, 640px)', overflowY: 'auto',
        background: p.surface, color: p.text, border: `1px solid ${p.line}`,
        borderRadius: 16, boxShadow: p.shadow, backdropFilter: 'blur(10px)',
        padding: '12px 13px 13px', display: 'flex', flexDirection: 'column', gap: 10,
        pointerEvents: 'auto',
      },
    },
    e('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
      e('div', { style: { flex: 1, minWidth: 0 } },
        e('div', { style: { fontSize: 13, fontWeight: 700 } }, skinName),
        e('div', { style: { fontSize: 10.5, color: p.faint, marginTop: 1 } },
          `${POSE_LABEL[state?.pose] || '待命'} · ${state?.stage || '…'}${wornCount > 0 ? ` · ${wornCount} 件挂件` : ''}`)),
      e('button', {
        type: 'button', onClick: onClose, title: '收起',
        style: {
          border: `1px solid ${p.line}`, background: 'transparent', color: p.dim,
          borderRadius: 8, width: 24, height: 24, cursor: 'pointer', lineHeight: 1, fontSize: 13,
        },
      }, '×')),

    config?.showBalance !== false
      ? e(BalanceBlock, { balance, onRefresh: onRefreshBalance })
      : null,

    e('div', { style: { borderTop: `1px solid ${p.line}`, paddingTop: 4 } },
      e(Row, {
        label: '今日用量',
        value: `${formatTokens(usage?.dayInput)} in / ${formatTokens(usage?.dayOutput)} out`,
        hint: usage?.day ? `${usage.day} · 共 ${usage.turns || 0} 轮` : undefined,
      }),
      e(Row, {
        label: '本轮累计',
        value: `${formatTokens(usage?.input)} in / ${formatTokens(usage?.output)} out`,
        hint: usage?.cacheRead > 0 ? `缓存读 ${formatTokens(usage.cacheRead)}` : undefined,
      }),
      e(Row, {
        label: '估算费用',
        value: cost,
        hint: usage?.priced ? '按你在设置里填的单价估算' : '在设置里填写单价后显示',
        tone: usage?.priced ? 'warn' : undefined,
      })),

    e('div', null,
      e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 } },
        e('span', { style: { fontSize: 11, color: p.faint } }, '任务'),
        state?.detail ? e('span', {
          style: {
            fontSize: 10.5, color: p.faint, maxWidth: 170, overflow: 'hidden',
            textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          },
          title: state.detail,
        }, state.detail) : null),
      e(TaskList, { tasks })),

    e('div', { style: { fontSize: 9.5, color: p.faint, textAlign: 'center' } },
      `dsh-neko-pet · ${skinName} · 素材来自 packs/，自备素材请遵守其授权`))
  }

  /** One plain frame above the head. It is the pet's only voice. */
  function Bubble({ state, chat, action, say }) {
    const last = chat[chat.length - 1]
    const showChat = last && (last.role === 'user' || last.role === 'assistant' || last.error)
    // Priority: an explicit `pet_say` line, then an action's line, then chat,
    // then the session stage.
    const text = say?.text
      || action?.text
      || (showChat && last.text ? last.text : (state?.stage || '待命中'))
    return e('div', { className: 'fp-bubble' },
      e('div', { className: 'fp-bubble-text' }, String(text).slice(0, 220)))
  }

  // --------------------------------------------------------------- overlay
  function PetOverlay() {
    ensureStyle()
    const snapshot = useCompanion()
    const [open, setOpen] = useState(() => {
      try { return localStorage.getItem(OPEN_KEY) === '1' } catch { return false }
    })
    const [origin, setOrigin] = useState(() => {
      try {
        const raw = localStorage.getItem(POS_KEY)
        if (raw) {
          const parsed = JSON.parse(raw)
          if (Number.isFinite(parsed?.right) && Number.isFinite(parsed?.bottom)) return parsed
        }
      } catch {}
      return { right: 24, bottom: 18 }
    })
    const dragRef = useRef(null)

    const scale = Number(snapshot.hello?.config?.scale) || 1
    const width = Math.round(132 * scale)
    // `off` rides on every state frame, so the pet reacts to the switch
    // immediately instead of trusting the connect-time hello snapshot.
    const disabled = snapshot.state?.off === true
    const pose = snapshot.state?.pose || 'IDLE'
    const bubble = snapshot.hello?.config?.bubble !== false

    const config = snapshot.hello?.config ?? {}
    const assetsEnabled = config.assetsEnabled !== false && snapshot.wardrobe?.assetsEnabled !== false
    const skin = assetsEnabled ? activeSkin(snapshot) : null
    const stageHeight = skin
      ? Math.round(width * ((skin.canvas?.height || 130) / (skin.canvas?.width || 140)))
      : width

    // The host clears an action when its timer ends, but a tab that was hidden
    // can miss that frame; expire locally as well.
    const [clockTick, setClockTick] = useState(0)
    const actionUntil = snapshot.action?.until ?? null
    useEffect(() => {
      if (!actionUntil) return undefined
      const remaining = actionUntil - Date.now()
      if (remaining <= 0) return undefined
      const timer = setTimeout(() => setClockTick((value) => value + 1), remaining + 60)
      return () => clearTimeout(timer)
    }, [actionUntil])
    const liveAction = snapshot.action?.action && (!actionUntil || actionUntil > Date.now())
      ? snapshot.action
      : null
    const sayUntil = snapshot.say?.until ?? null
    const liveSay = snapshot.say?.text && (!sayUntil || sayUntil > Date.now())
      ? snapshot.say
      : null
    useEffect(() => {
      if (!sayUntil) return undefined
      const remaining = sayUntil - Date.now()
      if (remaining <= 0) return undefined
      const timer = setTimeout(() => setClockTick((value) => value + 1), remaining + 60)
      return () => clearTimeout(timer)
    }, [sayUntil])
    void clockTick

    // --- continuous motion (agent-driven gaze + walk) -----------------------
    // The host owns intent and expiry; the client owns pixels. A monotonic
    // `seq` keeps a replayed snapshot from re-walking a walk already done.
    const motion = snapshot.motion
    const motionUntil = Math.max(motion?.walk?.until ?? 0, motion?.gaze?.until ?? 0) || null
    useEffect(() => {
      if (!motionUntil) return undefined
      const remaining = motionUntil - Date.now()
      if (remaining <= 0) return undefined
      const timer = setTimeout(() => setClockTick((value) => value + 1), remaining + 60)
      return () => clearTimeout(timer)
    }, [motionUntil])

    const walk = motion?.walk && motion.walk.until > Date.now() ? motion.walk : null
    const appliedWalkSeq = useRef(0)
    useEffect(() => {
      if (!walk || typeof walk.seq !== 'number') return undefined
      if (walk.seq === appliedWalkSeq.current) return undefined
      appliedWalkSeq.current = walk.seq

      const margin = 12
      const maxRight = Math.max(margin, window.innerWidth - width - margin)
      let target
      if (walk.to === 'left') target = maxRight
      else if (walk.to === 'right') target = margin
      else if (walk.to === 'center') target = Math.round(Math.max(margin, (window.innerWidth - width) / 2))
      else {
        // `to` is the normalised position measured from the LEFT screen edge.
        const numeric = Number(walk.to)
        if (!Number.isFinite(numeric)) return undefined
        target = Math.round(Math.max(margin, Math.min(maxRight, (window.innerWidth - width) * (1 - numeric))))
      }
      setOrigin((prev) => ({ ...prev, right: target }))
      return undefined
    }, [walk, width])

    const gaze = motion?.gaze && (!motion.gaze.until || motion.gaze.until > Date.now())
      ? motion.gaze
      : null
    const stageRef = useRef(null)
    const setGazeVars = useCallback((x, y) => {
      const node = stageRef.current
      if (!node) return
      node.style.setProperty('--gaze-x', `${Number(x).toFixed(2)}px`)
      node.style.setProperty('--gaze-y', `${Number(y).toFixed(2)}px`)
    }, [])

    // Named targets are fixed offsets. They run through an effect so a reset
    // (front) also lands here and zeroes the variables.
    useEffect(() => {
      if (!gaze || gaze.mode === 'cursor') return undefined
      const offsets = { left: [-6, 0], right: [6, 0], up: [0, -5], down: [0, 3.5], front: [0, 0] }
      const [gx, gy] = offsets[gaze.mode] || [0, 0]
      setGazeVars(gx, gy)
      return undefined
    }, [gaze, setGazeVars])

    // Cursor tracking writes CSS variables straight to the node: a state update
    // per mousemove would re-render the whole rig sixty times a second.
    useEffect(() => {
      if (!gaze || gaze.mode !== 'cursor') return undefined
      const onMove = (event) => {
        const node = stageRef.current
        if (!node) return
        const rect = node.getBoundingClientRect()
        const dx = event.clientX - (rect.left + rect.width / 2)
        const dy = event.clientY - (rect.top + rect.height * 0.35)
        const range = 240
        const gx = Math.max(-1, Math.min(1, dx / range)) * 6
        const gy = Math.max(-1, Math.min(1, dy / range)) * 4.5
        node.style.setProperty('--gaze-x', `${gx.toFixed(2)}px`)
        node.style.setProperty('--gaze-y', `${gy.toFixed(2)}px`)
      }
      window.addEventListener('mousemove', onMove, { passive: true })
      return () => {
        window.removeEventListener('mousemove', onMove)
        setGazeVars(0, 0)
      }
    }, [gaze, setGazeVars])

    const walking = Boolean(walk)

    useEffect(() => {
      try { localStorage.setItem(OPEN_KEY, open ? '1' : '0') } catch {}
    }, [open])

    const onPointerDown = useCallback((event) => {
      if (event.button !== 0) return
      event.currentTarget.setPointerCapture?.(event.pointerId)
      dragRef.current = { x: event.clientX, y: event.clientY, ...origin, moved: false }
    }, [origin])

    const onPointerMove = useCallback((event) => {
      const drag = dragRef.current
      if (!drag) return
      const dx = event.clientX - drag.x
      const dy = event.clientY - drag.y
      if (!drag.moved && Math.hypot(dx, dy) < 4) return
      drag.moved = true
      const next = {
        right: Math.max(0, Math.min(window.innerWidth - width, drag.right - dx)),
        bottom: Math.max(0, Math.min(window.innerHeight - stageHeight, drag.bottom - dy)),
      }
      setOrigin(next)
    }, [width, stageHeight])

    const onPointerUp = useCallback(() => {
      const drag = dragRef.current
      dragRef.current = null
      if (!drag) return
      if (!drag.moved) {
        setOpen((prev) => !prev)
        return
      }
      try { localStorage.setItem(POS_KEY, JSON.stringify(origin)) } catch {}
    }, [origin])

    const refreshBalance = useCallback(async () => {
      try {
        await fetch(ENDPOINT.balance, { method: 'POST' })
      } catch {}
    }, [])

    if (disabled) return null

    return e('div', {
      'data-dsh-neko-pet': '',
      style: {
        position: 'fixed', right: origin.right, bottom: origin.bottom, zIndex: 2147482000,
        display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8,
        pointerEvents: 'none', userSelect: 'none',
        // Only while walking: a lingering transition would make dragging laggy.
        transition: walking ? `right ${walk.durationMs}ms ease-in-out` : undefined,
      },
    },
    e('div', {
      style: {
        display: 'flex', alignItems: 'flex-end', gap: 10,
        flexDirection: open ? 'row' : 'column', pointerEvents: 'auto',
      },
    },
    open ? e(Panel, { snapshot, onClose: () => setOpen(false), onRefreshBalance: refreshBalance }) : null,
    e('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 } },
      bubble ? e(Bubble, { state: snapshot.state, chat: snapshot.chat, action: liveAction, say: liveSay }) : null,
      e('div', {
        ref: stageRef,
        role: 'button',
        tabIndex: 0,
        className: walking ? 'fp-walking' : undefined,
        title: `${liveAction ? ACTION_LABEL[liveAction.action] || '' : POSE_LABEL[pose] || ''} · 点击打开面板，拖动可换位置`,
        onPointerDown,
        onPointerMove,
        onPointerUp,
        onKeyDown: (event) => {
          if (event.key === 'Enter' || event.key === ' ') setOpen((prev) => !prev)
        },
        style: {
          width, height: stageHeight, cursor: 'grab', outline: 'none',
          filter: 'drop-shadow(0 6px 12px rgba(0,0,0,0.28))',
          touchAction: 'none',
          // The gaze variables live here so both the pack layers and the
          // fallback art inherit them.
          '--gaze-x': '0px',
          '--gaze-y': '0px',
        },
      }, skin
        ? e(RigStage, { skin, worn: wornItems(snapshot), pose, action: liveAction?.action || null, walking })
        : e(FishArt, { pose })))))
  }

  // -------------------------------------------------------- settings card
  function SettingsCard() {
    const [value, setValue] = useState(null)
    const [status, setStatus] = useState('loading')
    const [busy, setBusy] = useState(false)
    const [catalog, setCatalog] = useState(null)
    const [desktop, setDesktop] = useState(null)

    useEffect(() => {
      let alive = true
      fetch(ENDPOINT.desktop, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'status' }),
      }).then((response) => (response.ok ? response.json() : null))
        .then((next) => { if (alive && next) setDesktop(next) })
        .catch(() => {})
      fetch(ENDPOINT.config, { cache: 'no-store' })
        .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
        .then((next) => {
          if (!alive) return
          setValue(next)
          setStatus('ready')
        })
        .catch(() => { if (alive) setStatus('unavailable') })
      fetch(ENDPOINT.packs, { cache: 'no-store' })
        .then((response) => (response.ok ? response.json() : null))
        .then((next) => { if (alive && next) setCatalog(next) })
        .catch(() => {})
      return () => { alive = false }
    }, [])

    const rescan = async () => {
      setBusy(true)
      try {
        const response = await fetch(ENDPOINT.packs, { method: 'POST' })
        if (response.ok) {
          const body = await response.json()
          if (body?.catalog) setCatalog(body.catalog)
        }
      } catch {
      } finally {
        setBusy(false)
      }
    }

    const callDesktop = async (action) => {
      try {
        // The DSH web UI puts its session token in the URL. Pass it along so
        // the overlay window can load the same authenticated routes.
        const token = new URLSearchParams(location.search).get('token') || ''
        const response = await fetch(ENDPOINT.desktop, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action, token }),
        })
        const body = await response.json().catch(() => null)
        if (body) setDesktop({ ...body, error: response.ok ? undefined : body.reason })
      } catch {
        setDesktop((prev) => ({ ...(prev ?? {}), error: '无法连接到宿主' }))
      }
    }

    const toggleWear = (id) => {
      const worn = Array.isArray(value?.worn) ? value.worn : []
      const next = worn.includes(id) ? worn.filter((entry) => entry !== id) : [...worn, id]
      void write({ worn: next })
    }

    const write = async (patch) => {
      setBusy(true)
      try {
        const response = await fetch(ENDPOINT.config, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(patch),
        })
        if (!response.ok) throw new Error(String(response.status))
        setValue(await response.json())
        setStatus('ready')
      } catch {
        setStatus('unavailable')
      } finally {
        setBusy(false)
      }
    }

    const p = palette()
    const field = (label, hint, control) => e('label', {
      style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '6px 0' },
    },
    e('span', null,
      e('span', { style: { display: 'block', fontSize: 12.5, fontWeight: 600 } }, label),
      e('span', { style: { display: 'block', fontSize: 10.5, color: p.faint, marginTop: 2, maxWidth: 320 } }, hint)),
    control)

    const toggle = (key, hint) => field(key === 'enabled' ? '启用桌宠' : key === 'bubble' ? '状态气泡' : '显示余额', hint,
      e('input', {
        type: 'checkbox', checked: value?.[key] !== false, disabled: busy || status !== 'ready',
        onChange: (event) => void write({ [key]: event.target.checked }),
      }))

    return e('li', {
      style: {
        listStyle: 'none', border: `1px solid ${p.line}`, borderRadius: 12, padding: 16,
        background: 'transparent', display: 'grid', gap: 6,
      },
      'data-testid': 'dsh-neko-pet-settings',
    },
    e('div', null,
      e('strong', { style: { fontSize: 15 } }, '小鱼桌宠'),
      e('p', { style: { margin: '5px 0 0', fontSize: 12, color: p.dim, lineHeight: 1.5 } },
        '页面内的小鱼，跟随 DSH 任务状态做出反应，显示余额与任务清单，也能开一个窗口外的悬浮窗。内置形象为原创绘制；packs/local 里的自备素材请自行确认授权。')),
    status === 'loading' ? e('div', { style: { fontSize: 12, color: p.dim } }, '正在读取设置…') : null,
    status === 'unavailable' ? e('div', { style: { fontSize: 12, color: p.bad } }, '设置尚未连接到 DSH Host，请确认插件已在 profile 中启用并重启 DSH。') : null,
    status !== 'ready' ? null : e(React.Fragment, null,
      toggle('enabled', '关闭后页面内的鱼立即消失。'),
      toggle('bubble', '头顶的简单气泡：当前状态、Agent 让它说的话或最近一句对话。'),
      toggle('showBalance', '在面板顶部显示账户余额。'),
      field('宠物大小', `${Math.round((value.scale ?? 1) * 100)}%`,
        e('input', {
          type: 'range', min: 0.6, max: 1.8, step: 0.05, value: value.scale ?? 1,
          disabled: busy, style: { width: 140 },
          onChange: (event) => void write({ scale: Number(event.target.value) }),
        })),
      field('余额查询', '自动：有密钥时查 DeepSeek 官方余额接口。',
        e('select', {
          value: value.balanceProvider ?? 'auto', disabled: busy,
          onChange: (event) => void write({ balanceProvider: event.target.value }),
          style: { minWidth: 150, padding: '5px 8px', borderRadius: 7 },
        },
        e('option', { value: 'auto' }, '自动'),
        e('option', { value: 'deepseek' }, 'DeepSeek 官方'),
        e('option', { value: 'custom' }, '自定义接口'),
        e('option', { value: 'off' }, '关闭'))),
      field('余额密钥', '留空则读取环境变量 DEEPSEEK_API_KEY。',
        e('input', {
          type: 'password', value: value.balanceApiKey ?? '', disabled: busy,
          placeholder: 'sk-…', autoComplete: 'off',
          onChange: (event) => setValue((prev) => ({ ...prev, balanceApiKey: event.target.value })),
          onBlur: (event) => void write({ balanceApiKey: event.target.value }),
          style: { width: 170, padding: '5px 8px', borderRadius: 7 },
        })),
      field('输入单价', '元 / 百万 token，用于估算费用；0 表示不估算。',
        e('input', {
          type: 'number', min: 0, step: 0.1, value: value.priceInputPerMillion ?? 0, disabled: busy,
          onChange: (event) => void write({ priceInputPerMillion: Number(event.target.value) }),
          style: { width: 96, padding: '5px 8px', borderRadius: 7 },
        })),
      field('输出单价', '元 / 百万 token。',
        e('input', {
          type: 'number', min: 0, step: 0.1, value: value.priceOutputPerMillion ?? 0, disabled: busy,
          onChange: (event) => void write({ priceOutputPerMillion: Number(event.target.value) }),
          style: { width: 96, padding: '5px 8px', borderRadius: 7 },
        })),
      field('桌宠对话', '走真实 DSH 会话，可用工具，因此能替你干活。',
        e('input', {
          type: 'checkbox', checked: value.chatEnabled !== false, disabled: busy,
          onChange: (event) => void write({ chatEnabled: event.target.checked }),
        })),
      field('对话工作目录', '留空使用 DSH 进程当前目录。',
        e('input', {
          type: 'text', value: value.chatCwd ?? '', disabled: busy, placeholder: 'C:\\work\\my-project',
          onChange: (event) => setValue((prev) => ({ ...prev, chatCwd: event.target.value })),
          onBlur: (event) => void write({ chatCwd: event.target.value }),
          style: { width: 200, padding: '5px 8px', borderRadius: 7 },
        })),
      toggle('assetsEnabled', '关闭后回退到内置内联形象（素材包出错时的兜底）。'),
      field('桌面悬浮窗', desktop?.supported === false
        ? '当前环境不支持（纯 Node 版 DSH）；桌面版可以开一个置顶小窗，不占页面。'
        : '把桌宠放到 DSH 窗口之外，透明置顶，可拖动。',
        e('button', {
          type: 'button', disabled: busy || desktop?.supported === false,
          onClick: () => void callDesktop(desktop?.open ? 'close' : 'open'),
          style: {
            border: `1px solid ${p.line}`, background: 'transparent', color: p.dim,
            borderRadius: 8, padding: '5px 10px', fontSize: 11,
            cursor: desktop?.supported === false ? 'default' : 'pointer',
            opacity: desktop?.supported === false ? 0.5 : 1,
          },
        }, desktop?.open ? '关闭悬浮窗' : '打开悬浮窗')),
      desktop?.error ? e('div', { style: { fontSize: 10.5, color: p.bad } }, desktop.error) : null,
      e('div', { style: { borderTop: `1px solid ${p.line}`, paddingTop: 8, display: 'grid', gap: 7 } },
        e('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
          e('div', { style: { minWidth: 0 } },
            e('div', { style: { fontSize: 12.5, fontWeight: 600 } }, '素材与衣柜'),
            e('div', {
              style: {
                fontSize: 10.5, color: p.faint, marginTop: 2, maxWidth: 260,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              },
              title: catalog?.root || '',
            }, catalog
              ? `${catalog.skins?.length || 0} 套皮肤 · ${catalog.accessories?.length || 0} 件挂件`
              : '正在读取素材包…')),
          e('button', {
            type: 'button', disabled: busy, onClick: () => void rescan(),
            style: {
              border: `1px solid ${p.line}`, background: 'transparent', color: p.dim,
              borderRadius: 8, padding: '5px 9px', fontSize: 11, cursor: busy ? 'default' : 'pointer',
              opacity: busy ? 0.5 : 1,
            },
          }, '重新扫描')),
        catalog?.errors?.length
          ? e('div', { style: { fontSize: 10.5, color: p.warn, lineHeight: 1.45, whiteSpace: 'pre-wrap' } },
            catalog.errors.slice(0, 3).map((error) => `${error.pack || '(root)'}: ${error.reason}`).join('\n'))
          : null,
        catalog && catalog.skins?.length > 1
          ? field('皮肤', '来自素材包的整套形象。',
            e('select', {
              value: value.skinId ?? catalog.skins[0].id, disabled: busy,
              onChange: (event) => void write({ skinId: event.target.value }),
              style: { minWidth: 140, padding: '5px 8px', borderRadius: 7 },
            }, catalog.skins.map((skin) => e('option', { key: skin.id, value: skin.id }, skin.name))))
          : null,
        catalog?.accessories?.length
          ? e('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 180, overflowY: 'auto' } },
            catalog.accessories
              .slice()
              .sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot) || a.name.localeCompare(b.name))
              .map((item) => {
                const on = Array.isArray(value.worn) && value.worn.includes(item.id)
                return e('button', {
                  key: item.id,
                  type: 'button',
                  title: item.description || item.name,
                  onClick: () => void toggleWear(item.id),
                  style: {
                    border: `1px solid ${on ? p.accent : p.line}`,
                    background: on ? 'rgba(76,111,224,0.14)' : 'transparent',
                    color: on ? p.accent : p.dim,
                    borderRadius: 999, padding: '4px 10px', fontSize: 10.5,
                    cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1,
                  },
                }, `${SLOT_LABEL[item.slot] || item.slot} · ${item.name}`)
              }))
          : null,
        e('div', { style: { fontSize: 9.5, color: p.faint, lineHeight: 1.4 } },
          '把素材包放进 packs/ 后点「重新扫描」即可生效，不用重启 DSH。')),
      busy ? e('small', { style: { color: p.faint } }, '正在保存…') : null))
  }

  // ---------------------------------------------------------------- export
  function apply(ctx) {
    const guarded = (label, fn) => {
      try {
        fn()
      } catch (error) {
        if (typeof console !== 'undefined') console.error(`[dsh-neko-pet] ${label} 失败:`, error)
      }
    }
    // Guard INSIDE the inject callback: DSH may invoke it asynchronously, so a
    // try around `inject()` itself would not catch a late registration error.
    guarded('注册桌宠', () => {
      ctx.slots.inject('shell.overlay', () => {
        guarded('挂载 shell.overlay', () => {
          ctx.slots.register({ name: 'shell.overlay', id: 'dsh-neko-pet', order: 900 }, PetOverlay)
        })
      })
    })
    guarded('注册设置卡片', () => {
      const register = () => {
        guarded('挂载 settings.plugin.item', () => {
          ctx.slots.register({
            name: 'settings.plugin.item',
            key: 'dsh-neko-pet',
            id: 'dsh-neko-pet',
            order: 40,
            inject: () => ({}),
          }, SettingsCard)
        })
      }
      try {
        ctx.slots.inject('settings.plugin.item', register)
      } catch {
        ctx.slots.inject('settings.section', () => {
          guarded('挂载 settings.section', () => {
            ctx.slots.register({
              name: 'settings.section', id: 'dsh-neko-pet', order: 60,
              label: () => '小鱼桌宠',
            }, SettingsCard)
          })
        })
      }
    })
  }

  const module = { exports: {} }
  // `__internals` is a test seam only: the host loader reads `name`/`inject`/
  // `apply` and ignores it. Keeping the renderer reachable lets the suite render
  // a pack without standing up an EventSource.
  module.exports = {
    name: 'dsh-neko-pet-client',
    inject: ['slots'],
    apply,
    __internals: { RigStage, FishArt, activeSkin, wornItems },
  }
  return module.exports
  } })
})()
