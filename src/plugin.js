/**
 * Host half: wiring, HTTP routes and the session observer.
 *
 * Security posture
 * - Every route is loopback-only and rejects a cross-origin `Origin`.
 * - Nothing here writes outside the process except the balance HTTP call the
 *   user explicitly configures.
 * - No route is reachable from another machine on the LAN.
 *
 * Failure posture
 * - `apply()` never throws. DSH treats a rejected activation as fatal for the
 *   whole boot, so a broken pet must cost the user its pet, never its harness.
 */
import { appendFileSync, createReadStream, readFileSync } from 'node:fs'
import { Kind, message as envelope } from './protocol.js'
import { CompanionTracker } from './state.js'
import { ChatBridge } from './chat.js'
import { loadBalance, unavailable } from './balance.js'
import { Config, NAMESPACE, defaults, normalizeConfig, writableKeys } from './config.js'
import { DEFAULT_PACKS_ROOT, PackRegistry } from './packs.js'
import { resolveWorn, normalizeWorn } from './wardrobe.js'
import { PetDirector } from './pet.js'
import { MotionDirector } from './motion.js'
import { SayBoard } from './say.js'
import { DesktopPetWindow } from './desktop.js'
import { registerPetTools } from './tools.js'

export { Config, NAMESPACE }

/**
 * Opt-in file trace: `DSH_FISH_PET_TRACE=/path/to/trace.log`.
 *
 * Console output from inside a plugin is not reliably visible during DSH boot
 * (the console exporter attaches late), so loading problems are much faster to
 * diagnose by appending to a file the operator names explicitly. Off by
 * default; costs one env lookup when unset.
 */
const TRACE_PATH = process.env.DSH_FISH_PET_TRACE || ''
function trace(note) {
  if (!TRACE_PATH) return
  try {
    appendFileSync(TRACE_PATH, `[dsh-fish-pet] ${new Date().toISOString()} ${note}\n`)
  } catch {}
}

const STREAM_ENDPOINT = '/plugins/dsh-fish-pet/stream'
const CONFIG_ENDPOINT = '/plugins/dsh-fish-pet/config'
const CHAT_ENDPOINT = '/plugins/dsh-fish-pet/chat'
const STATUS_ENDPOINT = '/plugins/dsh-fish-pet/status'
const BALANCE_REFRESH_ENDPOINT = '/plugins/dsh-fish-pet/balance'
const PACKS_ENDPOINT = '/plugins/dsh-fish-pet/packs'
const ASSET_ENDPOINT = '/plugins/dsh-fish-pet/asset'
const DESKTOP_ENDPOINT = '/plugins/dsh-fish-pet/desktop'
const DESKTOP_SCRIPT = '/plugins/dsh-fish-pet/desktop.js'
const SAY_ENDPOINT = '/plugins/dsh-fish-pet/say'

export const endpoints = {
  stream: STREAM_ENDPOINT,
  config: CONFIG_ENDPOINT,
  chat: CHAT_ENDPOINT,
  status: STATUS_ENDPOINT,
  balance: BALANCE_REFRESH_ENDPOINT,
  packs: PACKS_ENDPOINT,
  asset: ASSET_ENDPOINT,
  desktop: DESKTOP_ENDPOINT,
  say: SAY_ENDPOINT,
}

/** DSH's web UI puts a session token in its URL; carry it into the overlay. */
function sanitizeToken(value) {
  const text = String(value ?? '')
  return /^[A-Za-z0-9._~-]{1,256}$/.test(text) ? text : ''
}

function tokenQuery(token) {
  return token ? `?token=${encodeURIComponent(token)}` : ''
}

function tokenFromUrl(rawUrl) {
  try {
    return sanitizeToken(new URL(rawUrl || '/', 'http://127.0.0.1').searchParams.get('token'))
  } catch {
    return ''
  }
}

/** Fan-out channel for server-sent events, with late-subscriber replay. */
export function createStream() {
  const clients = new Set()
  const snapshot = new Map()
  return {
    get size() {
      return clients.size
    },
    broadcast(payload) {
      const kind = payload?.kind
      if (kind && kind !== Kind.CHAT) snapshot.set(kind, payload)
      const frame = `data: ${JSON.stringify(payload)}\n\n`
      for (const res of clients) {
        try {
          res.write(frame)
        } catch {
          clients.delete(res)
        }
      }
    },
    add(res, seed = []) {
      clients.add(res)
      for (const payload of [...seed, ...snapshot.values()]) {
        try {
          res.write(`data: ${JSON.stringify(payload)}\n\n`)
        } catch {
          break
        }
      }
      return () => clients.delete(res)
    },
  }
}

function json(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

export function isLocalRequest(req) {
  const address = req?.socket?.remoteAddress
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false
  const origin = req.headers?.origin
  if (!origin) return true
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

async function readJsonBody(req, limit = 16384) {
  const chunks = []
  let bytes = 0
  for await (const chunk of req) {
    bytes += chunk.length
    if (bytes > limit) throw new Error('请求体过大')
    chunks.push(chunk)
  }
  if (bytes === 0) return {}
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('请求体必须是对象')
  }
  return value
}

/** A settings scope that only lives in memory — used when `settings` is absent. */
function memoryScope(initial) {
  let value = initial
  const watchers = new Set()
  return {
    get: () => value,
    watch(fn) {
      watchers.add(fn)
      return () => watchers.delete(fn)
    },
    async update(patch) {
      value = normalizeConfig({ ...value, ...patch })
      for (const fn of watchers) {
        try {
          fn(value)
        } catch {}
      }
      return value
    },
  }
}

export function apply(ctx, config = {}) {
  try {
    trace(`apply called; inject=${typeof ctx.inject} get=${typeof ctx.get}`)
    mount(ctx, config)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    trace(`mount threw: ${detail}`)
    try {
      (ctx.logger ?? console).error(`[dsh-fish-pet] 激活失败，本次启动停用桌宠（不影响 DSH）: ${detail}`)
    } catch {}
  }
}

function mount(ctx, config) {
  const logger = ctx.logger ?? console
  const base = normalizeConfig(config)
  trace(`mount start; hasSettings=${typeof ctx.settings?.register}`)

  // `settings.register` throws when the namespace is already taken, which is
  // exactly what a hot reload or a second mount of the same plugin produces.
  // Falling back to an in-memory scope keeps the pet working for that process
  // instead of losing the whole overlay over a cosmetic duplicate.
  let settings
  try {
    settings = ctx.settings?.register?.(NAMESPACE, Config, { base, applies: 'live' }) ?? memoryScope(base)
  } catch (error) {
    trace(`settings.register failed: ${error instanceof Error ? error.message : String(error)}`)
    logger.warn?.(`[dsh-fish-pet] 设置命名空间注册失败，改用内存配置: ${error instanceof Error ? error.message : String(error)}`)
    settings = memoryScope(base)
  }
  trace(`settings ready; scope=${typeof settings.get}`)
  const stream = createStream()

  let tracker = new CompanionTracker({ maxTasks: settings.get().maxTasks })
  let balance = unavailable('尚未查询')
  let balanceTimer = null
  const chat = new ChatBridge({
    ctx,
    config: () => settings.get(),
    emit: (payload) => stream.broadcast(payload),
    warn: (note, error) => logger.warn?.(`[dsh-fish-pet] ${note}`, error),
  })

  // Asset packs are read from disk once at mount, then re-scanned on demand.
  // A pack that fails validation is skipped with a reason; the pet keeps its
  // built-in look rather than disappearing.
  const packsRoot = (config) => String(config.packsDir || '').trim() || DEFAULT_PACKS_ROOT
  const packs = new PackRegistry({ root: packsRoot(settings.get()), log: trace })
  trace(`packs root = ${packs.root}`)
  packs.reload()
  const director = new PetDirector({ emit: (payload) => stream.broadcast(payload) })
  const motion = new MotionDirector({ emit: (payload) => stream.broadcast(payload) })
  const say = new SayBoard({ emit: (payload) => stream.broadcast(payload) })
  const desktop = new DesktopPetWindow({ width: 300, height: 460, log: trace })

  // Every state frame carries the enabled flag, so the overlay can disappear
  // and come back without waiting for a reconnect (a stale `hello` snapshot
  // would otherwise pin it to whatever the config was at connect time).
  const decorate = (payload) => (
    payload?.kind === Kind.STATE && settings.get().enabled === false
      ? { ...payload, off: true }
      : payload
  )
  const send = (payload) => stream.broadcast(decorate(payload))
  const balancePayload = () => envelope(Kind.BALANCE, { ...balance })
  const catalogPayload = () => envelope(Kind.CATALOG, { catalog: packs.catalog() })
  const wardrobePayload = () => {
    const config = settings.get()
    const resolved = resolveWorn(config.worn, packs.catalog())
    return envelope(Kind.WARDROBE, {
      skinId: config.skinId,
      worn: resolved.worn,
      wearing: resolved.items,
      rejected: resolved.rejected,
      assetsEnabled: config.assetsEnabled !== false,
    })
  }
  const pushAll = () => {
    send(tracker.stateMessage())
    send(tracker.tasksMessage())
    send(tracker.usageMessage(settings.get()))
    send(balancePayload())
    send(wardrobePayload())
    send(catalogPayload())
    send(director.snapshot())
    send(say.snapshot())
  }

  // Only push the catalog when it actually changed; `pet_status` rescans on
  // every call and the client should not re-render for an identical catalog.
  let catalogSignature = ''
  const signatureOf = (catalog) => [
    catalog.skins.map((entry) => entry.id).join(','),
    catalog.accessories.map((entry) => entry.id).join(','),
    catalog.errors.length,
  ].join('|')
  const syncCatalog = (force = false) => {
    const signature = signatureOf(packs.catalog())
    if (!force && signature === catalogSignature) return false
    catalogSignature = signature
    send(catalogPayload())
    send(wardrobePayload())
    return true
  }
  const reloadPacks = (options = {}) => {
    const result = packs.reload()
    if (!options.quiet) syncCatalog(true)
    else syncCatalog(false)
    return result
  }
  syncCatalog(true)

  const patchConfig = async (patch) => {
    const merged = normalizeConfig({ ...settings.get(), ...patch })
    // Slot exclusivity is enforced here so the settings page, the HTTP patch and
    // the agent all end up with the same wardrobe.
    if (Object.prototype.hasOwnProperty.call(patch, 'worn')) {
      merged.worn = normalizeWorn(merged.worn, packs.catalog())
    }
    if (typeof settings.update === 'function') await settings.update(merged)
    return settings.get()
  }

  const refreshBalance = async () => {
    const current = settings.get()
    if (!current.showBalance) {
      balance = unavailable('余额显示已关闭')
      send(balancePayload())
      return balance
    }
    balance = await loadBalance(current)
    send(balancePayload())
    return balance
  }

  const scheduleBalance = () => {
    if (balanceTimer) clearInterval(balanceTimer)
    balanceTimer = setInterval(() => {
      void refreshBalance()
    }, 60_000)
    balanceTimer.unref?.()
  }

  // --- session observation -------------------------------------------------
  const onEvent = ctx.on('session/event', (session, event) => {
    try {
      for (const payload of tracker.handle(session, event)) send(payload)
      for (const payload of chat.observe(session, event)) send(payload)
    } catch (error) {
      // A throw here would stop every other subscriber on the shared bus.
      logger.error?.('[dsh-fish-pet] 处理会话事件失败', error)
    }
  }, { global: true })

  const onDisposed = ctx.on('session/disposed', (session) => {
    try {
      for (const payload of tracker.disposeSession(session)) send(payload)
    } catch (error) {
      logger.error?.('[dsh-fish-pet] 清理会话失败', error)
    }
  }, { global: true })

  // --- config -------------------------------------------------------------
  let lastConfig = settings.get()
  const unwatch = settings.watch((next) => {
    try {
      const previous = lastConfig
      lastConfig = next

      // A different packs root invalidates every loaded manifest.
      if (packsRoot(previous) !== packsRoot(next)) {
        packs.setRoot(packsRoot(next))
        trace(`packs root changed -> ${packs.root}`)
        reloadPacks()
      }

      if (next.enabled === false) {
        send(envelope(Kind.STATE, { pose: 'IDLE', stage: '已关闭', detail: '在设置里重新开启', off: true }))
        return
      }
      send(envelope(Kind.STATE, { ...tracker.stateMessage(), scale: next.scale }))
      send(tracker.usageMessage(next))
      send(wardrobePayload())
    } catch (error) {
      logger.error?.('[dsh-fish-pet] 应用设置失败', error)
    }
  })

  // --- HTTP routes --------------------------------------------------------
  const registerRoutes = (httpCtx) => {
    trace(`registerRoutes fired; webServer=${typeof httpCtx?.webServer} register=${typeof httpCtx?.webServer?.register}`)
    const server = httpCtx.webServer
    if (!server?.register) return
    const route = (path, handler, label) => {
      try {
        httpCtx.effect(() => server.register({ kind: 'exact', path, handler }), label)
      } catch (error) {
        logger.warn?.(`[dsh-fish-pet] 注册 ${path} 失败: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    route(STREAM_ENDPOINT, (req, res) => {
      if (!isLocalRequest(req)) return json(res, 403, { error: 'local access only' })
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      })
      res.write('retry: 2000\n\n')
      const config = settings.get()
      const seed = [
        envelope(Kind.HELLO, { plugin: 'dsh-fish-pet', config, catalog: packs.catalog() }),
        ...tracker.snapshot(config).map(decorate),
        balancePayload(),
        wardrobePayload(),
        director.snapshot(),
        motion.snapshot(),
        say.snapshot(),
      ]
      const remove = stream.add(res, seed)
      req.on('close', remove)
    }, 'dsh-fish-pet: event stream')

    route(CONFIG_ENDPOINT, async (req, res) => {
      if (!isLocalRequest(req)) return json(res, 403, { error: 'local access only' })
      if (req.method === 'GET') return json(res, 200, settings.get())
      if (req.method !== 'PATCH') return json(res, 405, { error: 'method not allowed' })
      try {
        const patch = await readJsonBody(req)
        const unknown = Object.keys(patch).filter((key) => !writableKeys.has(key))
        if (unknown.length > 0) return json(res, 400, { error: `未知设置项: ${unknown.join(', ')}` })
        const next = await patchConfig(patch)
        logger.info?.(`[dsh-fish-pet] 设置已更新 (${Object.keys(patch).join(', ')})`)
        if (Object.prototype.hasOwnProperty.call(patch, 'showBalance')
          || Object.prototype.hasOwnProperty.call(patch, 'balanceProvider')
          || Object.prototype.hasOwnProperty.call(patch, 'balanceApiKey')
          || Object.prototype.hasOwnProperty.call(patch, 'balanceUrl')) {
          void refreshBalance()
        }
        return json(res, 200, next)
      } catch (error) {
        return json(res, 400, { error: error instanceof Error ? error.message : String(error) })
      }
    }, 'dsh-fish-pet: settings endpoint')

    route(STATUS_ENDPOINT, (req, res) => {
      if (!isLocalRequest(req)) return json(res, 403, { error: 'local access only' })
      json(res, 200, {
        state: tracker.stateMessage(),
        tasks: tracker.tasksMessage(),
        usage: tracker.usageMessage(settings.get()),
        balance: balancePayload(),
        wardrobe: wardrobePayload(),
        action: director.snapshot(),
        motion: motion.snapshot(),
        say: say.snapshot(),
        desktop: desktop.status(),
        packs: { root: packs.root, skins: packs.skins.size, accessories: packs.accessories.size, errors: packs.errors },
        chatReady: chat.ready || settings.get().chatEnabled,
      })
    }, 'dsh-fish-pet: status endpoint')

    // Catalog for the browser and for anyone poking the API by hand.
    route(PACKS_ENDPOINT, (req, res) => {
      if (!isLocalRequest(req)) return json(res, 403, { error: 'local access only' })
      if (req.method === 'POST') {
        const result = reloadPacks()
        return json(res, 200, { ok: true, ...result, catalog: packs.catalog() })
      }
      if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' })
      packs.reload()
      return json(res, 200, packs.catalog())
    }, 'dsh-fish-pet: pack catalog')

    /**
     * Asset bytes, by query rather than by path: the host route contract only
     * exposes exact paths here, and a query keeps the traversal guard in one
     * place (`PackRegistry.resolveAsset`).
     */
    route(ASSET_ENDPOINT, (req, res) => {
      if (!isLocalRequest(req)) return json(res, 403, { error: 'local access only' })
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return json(res, 405, { error: 'method not allowed' })
      }
      let params
      try {
        params = new URL(req.url || '/', 'http://127.0.0.1').searchParams
      } catch {
        return json(res, 400, { error: 'bad url' })
      }
      const asset = packs.resolveAsset(params.get('pack'), params.get('path'))
      if (!asset) return json(res, 404, { error: 'asset not found' })

      const etag = `"${Math.round(asset.mtimeMs)}-${asset.size}"`
      if (req.headers['if-none-match'] === etag) {
        res.writeHead(304, { etag })
        return res.end()
      }
      const headers = {
        'content-type': asset.type,
        'content-length': asset.size,
        etag,
        'cache-control': 'public, max-age=300',
        'x-content-type-options': 'nosniff',
      }
      // Belt and braces: even though these images are referenced through <img>,
      // an SVG opened directly in a tab must not be able to run script.
      if (asset.type === 'image/svg+xml') headers['content-security-policy'] = "default-src 'none'; style-src 'unsafe-inline'"
      res.writeHead(200, headers)
      if (req.method === 'HEAD') return res.end()
      const stream_ = createReadStream(asset.file)
      stream_.on('error', () => {
        try {
          res.destroy()
        } catch {}
      })
      stream_.pipe(res)
    }, 'dsh-fish-pet: pack asset')

    route(BALANCE_REFRESH_ENDPOINT, async (req, res) => {
      if (!isLocalRequest(req)) return json(res, 403, { error: 'local access only' })
      if (req.method !== 'POST' && req.method !== 'GET') return json(res, 405, { error: 'method not allowed' })
      json(res, 200, await refreshBalance())
    }, 'dsh-fish-pet: balance refresh')

    route(DESKTOP_SCRIPT, (req, res) => {
      if (!isLocalRequest(req)) return json(res, 403, { error: 'local access only' })
      try {
        const body = readFileSync(new URL('../lib/desktop.js', import.meta.url))
        res.writeHead(200, {
          'content-type': 'text/javascript; charset=utf-8',
          'cache-control': 'no-store',
          'content-length': body.length,
        })
        return res.end(body)
      } catch {
        return json(res, 500, { error: 'desktop script missing' })
      }
    }, 'dsh-fish-pet: desktop script')

    // The overlay window loads this exact URL; POST controls its lifecycle.
    // The page URL keeps DSH's session token, which is also injected into the
    // script tag and picked up by the renderer for SSE and asset requests.
    route(DESKTOP_ENDPOINT, async (req, res) => {
      if (!isLocalRequest(req)) return json(res, 403, { error: 'local access only' })

      if (req.method === 'GET') {
        try {
          const query = tokenQuery(tokenFromUrl(req.url))
          const html = readFileSync(new URL('../lib/desktop.html', import.meta.url), 'utf8')
            .replaceAll('__DSH_TOKEN_QUERY__', query)
          res.writeHead(200, {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-store',
            'content-length': Buffer.byteLength(html),
          })
          return res.end(html)
        } catch {
          return json(res, 500, { error: 'desktop page missing' })
        }
      }

      if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
      let action = 'status'
      let token = ''
      try {
        const payload = await readJsonBody(req, 2048)
        action = String(payload.action || 'status')
        token = sanitizeToken(payload.token)
      } catch {
        return json(res, 400, { error: 'bad body' })
      }

      if (action === 'open') {
        const host = String(req.headers.host || '')
        if (!host) return json(res, 400, { error: 'missing host header' })
        const query = tokenQuery(token || tokenFromUrl(req.headers.referer))
        const url = `http://${host}${DESKTOP_ENDPOINT}${query}`
        const result = desktop.open(url)
        return json(res, result.ok ? 200 : 501, { ...result, ...desktop.status() })
      }
      if (action === 'close') {
        desktop.close()
        return json(res, 200, desktop.status())
      }
      return json(res, 200, desktop.status())
    }, 'dsh-fish-pet: desktop window')

    /**
     * A plain HTTP door into the speech bubble, for agents or scripts that do
     * not go through the tool registry. `pet_say` calls the same SayBoard.
     */
    route(SAY_ENDPOINT, async (req, res) => {
      if (!isLocalRequest(req)) return json(res, 403, { error: 'local access only' })
      if (req.method === 'GET') return json(res, 200, say.snapshot())
      if (req.method === 'DELETE') {
        say.clear()
        return json(res, 200, say.snapshot())
      }
      if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
      try {
        const payload = await readJsonBody(req, 4096)
        return json(res, 200, say.say({ text: payload?.text, durationMs: payload?.durationMs }))
      } catch (error) {
        return json(res, 400, { error: error instanceof Error ? error.message : String(error) })
      }
    }, 'dsh-fish-pet: speech bubble')

    route(CHAT_ENDPOINT, async (req, res) => {
      if (!isLocalRequest(req)) return json(res, 403, { error: 'local access only' })
      if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
      try {
        const body = await readJsonBody(req, 8192)
        const result = await chat.send(body?.text)
        if (!result.ok) return json(res, 409, { error: result.reason })
        return json(res, 202, { ok: true })
      } catch (error) {
        return json(res, 400, { error: error instanceof Error ? error.message : String(error) })
      }
    }, 'dsh-fish-pet: chat endpoint')
  }

  try {
    if (typeof ctx.inject === 'function') {
      trace('calling ctx.inject([webServer])')
      ctx.inject(['webServer'], registerRoutes)
      trace('ctx.inject returned')
    } else {
      registerRoutes(ctx)
    }
  } catch (error) {
    trace(`inject failed: ${error instanceof Error ? error.message : String(error)}`)
    logger.warn?.(`[dsh-fish-pet] 无法注册 HTTP 路由: ${error instanceof Error ? error.message : String(error)}`)
  }

  // --- agent surface -------------------------------------------------------
  // `tools` is requested through `ctx.inject` rather than the static `inject`
  // list: on a harness without the service the plugin must still load, and a
  // missing static dependency would keep `apply` from ever running.
  let disposeTools = null
  try {
    const registerTools = (toolCtx) => {
      try {
        disposeTools = registerPetTools(toolCtx, {
          packs,
          director,
          motion,
          getConfig: () => settings.get(),
          patchConfig,
          tracker: () => tracker,
          say,
          reloadPacks,
        }, {
          warn: (note) => logger.warn?.(`[dsh-fish-pet] ${note}`),
        })
        trace('pet tools registered')
      } catch (error) {
        trace(`tools registration threw: ${error instanceof Error ? error.message : String(error)}`)
        logger.warn?.('[dsh-fish-pet] Agent 工具注册失败', error)
      }
    }
    if (typeof ctx.inject === 'function') ctx.inject(['tools'], registerTools)
    else registerTools(ctx)
  } catch (error) {
    trace(`tools inject failed: ${error instanceof Error ? error.message : String(error)}`)
    logger.warn?.('[dsh-fish-pet] 无法接入 Agent 工具（桌宠显示不受影响）')
  }

  // --- skill: teach the agent when to use the pet --------------------------
  // Registered at runtime (no files on disk), and guarded the same way as the
  // tools: a harness without `skills` loses only the guidance, never the pet.
  try {
    const registerSkill = (skillsCtx) => {
      try {
        const disposer = skillsCtx.skills?.register?.({
          name: 'desk-pet',
          description: '控制页面右下角的桌宠：做动作、说话、走路、转移视线、换装和换皮肤。',
          whenToUse: '想让桌宠对任务结果做可视反馈（开始、完成、出错、等待确认），或用户直接让你逗它、让它动、让它说话的时候。',
          content: [
            '# 桌宠控制',
            '',
            '页面右下角有一只桌宠，你是它的操控者。可用工具：',
            '',
            '- `pet_act`：原地动作（挥手/跳/转圈/跳舞/打盹/欢呼/害羞/发呆），可带一句气泡台词',
            '- `pet_say`：只说一句话（汇报进度、吐槽、提醒）',
            '- `pet_move`：走路（walk to=left/right/center）、转移视线（look at=cursor/left/…）、恢复（reset）',
            '- `pet_wear` / `pet_skin`：换挂件和皮肤；`pet_status` 查看目录与当前状态',
            '',
            '## 什么时候该动',
            '',
            '- 接到一个大任务时：`pet_act` 打个招呼或 `pet_move` 走到屏幕中间',
            '- 任务完成：欢呼 + 一句台词；出错：打盹/害羞 + 简短道歉',
            '- 需要用户批准时：走到用户附近并看向屏幕（at=cursor）',
            '',
            '## 克制原则（重要）',
            '',
            '- 用户在专注工作时**不要乱动**，任务事件已经会自动驱动它的姿态',
            '- 一次 `pet_act`/`pet_move` 就够，不要连续调用多个动作',
            '- 眨眼、呼吸等微动作是自动的，**不要**也不要试图控制它们',
            '- 拿不准现在什么状态就先 `pet_status`',
          ].join('\n'),
        })
        if (typeof disposer === 'function') {
          ctx.effect(() => disposer)
        }
        trace('desk-pet skill registered')
      } catch (error) {
        trace(`skill registration threw: ${error instanceof Error ? error.message : String(error)}`)
        logger.warn?.('[dsh-fish-pet] skill 注册失败（Agent 指引不可用，工具不受影响）', error)
      }
    }
    if (typeof ctx.inject === 'function') ctx.inject(['skills'], registerSkill)
    else registerSkill(ctx)
  } catch (error) {
    trace(`skills inject failed: ${error instanceof Error ? error.message : String(error)}`)
  }

  // Prime the panel so the first client paint is never empty.
  pushAll()
  void refreshBalance()
  scheduleBalance()

  ctx.effect(() => () => {
    try {
      if (balanceTimer) clearInterval(balanceTimer)
      balanceTimer = null
      unwatch?.()
      onEvent?.()
      onDisposed?.()
      disposeTools?.()
      director.dispose()
      motion.dispose()
      say.dispose()
      desktop.close()
    } catch (error) {
      logger.error?.('[dsh-fish-pet] 清理失败', error)
    }
    void chat.dispose()
  })

  logger.info?.('[dsh-fish-pet] 桌宠已就绪')
}

export { defaults, normalizeConfig }
