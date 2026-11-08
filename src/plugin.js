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
import { appendFileSync } from 'node:fs'
import { Kind, message as envelope } from './protocol.js'
import { CompanionTracker } from './state.js'
import { ChatBridge } from './chat.js'
import { loadBalance, unavailable } from './balance.js'
import { Config, NAMESPACE, defaults, normalizeConfig, writableKeys } from './config.js'

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

export const endpoints = {
  stream: STREAM_ENDPOINT,
  config: CONFIG_ENDPOINT,
  chat: CHAT_ENDPOINT,
  status: STATUS_ENDPOINT,
  balance: BALANCE_REFRESH_ENDPOINT,
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

  // Every state frame carries the enabled flag, so the overlay can disappear
  // and come back without waiting for a reconnect (a stale `hello` snapshot
  // would otherwise pin it to whatever the config was at connect time).
  const decorate = (payload) => (
    payload?.kind === Kind.STATE && settings.get().enabled === false
      ? { ...payload, off: true }
      : payload
  )
  const send = (payload) => stream.broadcast(decorate(payload))
  const pushAll = () => {
    send(tracker.stateMessage())
    send(tracker.tasksMessage())
    send(tracker.usageMessage(settings.get()))
    send(balancePayload())
  }

  const balancePayload = () => envelope(Kind.BALANCE, { ...balance })

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
  const unwatch = settings.watch((next) => {
    try {
      if (next.enabled === false) {
        send(envelope(Kind.STATE, { pose: 'IDLE', stage: '已关闭', detail: '在设置里重新开启', off: true }))
        return
      }
      send(envelope(Kind.STATE, { ...tracker.stateMessage(), scale: next.scale }))
      send(tracker.usageMessage(next))
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
        envelope(Kind.HELLO, { plugin: 'dsh-fish-pet', config }),
        ...tracker.snapshot(config).map(decorate),
        balancePayload(),
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
        const merged = normalizeConfig({ ...settings.get(), ...patch })
        if (typeof settings.update === 'function') await settings.update(merged)
        const next = settings.get()
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
        chatReady: chat.ready || settings.get().chatEnabled,
      })
    }, 'dsh-fish-pet: status endpoint')

    route(BALANCE_REFRESH_ENDPOINT, async (req, res) => {
      if (!isLocalRequest(req)) return json(res, 403, { error: 'local access only' })
      if (req.method !== 'POST' && req.method !== 'GET') return json(res, 405, { error: 'method not allowed' })
      json(res, 200, await refreshBalance())
    }, 'dsh-fish-pet: balance refresh')

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
    } catch (error) {
      logger.error?.('[dsh-fish-pet] 清理失败', error)
    }
    void chat.dispose()
  })

  logger.info?.('[dsh-fish-pet] 桌宠已就绪')
}

export { defaults, normalizeConfig }
