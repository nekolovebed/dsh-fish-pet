/**
 * Account-balance adapters.
 *
 * The overlay is allowed to show a number only when a provider actually
 * returned one. Every failure path resolves to a snapshot with
 * `status: 'unavailable'` plus a human-readable reason, because a silently
 * fabricated balance is worse than a visible "—".
 *
 * Never throws: the caller is an HTTP handler and a timer.
 */

const DEFAULT_BASE_URL = 'https://api.deepseek.com'
const TIMEOUT_MS = 8000

/** Candidate field names tried when `balanceJsonPath` is empty. */
const GUESS_KEYS = [
  'total_balance', 'totalBalance', 'balance', 'total', 'remaining',
  'available', 'amount', 'credit', 'credits',
]

/** Read `a.b.c` out of a value without throwing on any hop. */
export function pickPath(value, path) {
  if (!path) return undefined
  let current = value
  for (const segment of String(path).split('.')) {
    if (current === null || current === undefined) return undefined
    if (Array.isArray(current) && /^\d+$/.test(segment)) {
      current = current[Number(segment)]
      continue
    }
    if (typeof current !== 'object') return undefined
    current = current[segment]
  }
  return current
}

function toNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/,/g, '').trim())
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

/**
 * Normalize the documented DeepSeek `/user/balance` response.
 * Shape: `{ is_available, balance_infos: [{ currency, total_balance,
 * granted_balance, topped_up_balance }] }`.
 * @returns {{currency: string, total: number, granted: number|null, toppedUp: number|null}|null}
 */
export function normalizeDeepSeek(payload) {
  if (!payload || typeof payload !== 'object') return null
  const infos = Array.isArray(payload.balance_infos) ? payload.balance_infos : []
  if (infos.length === 0) return null
  const info = infos[0]
  const total = toNumber(info.total_balance)
  if (total === null) return null
  return {
    currency: typeof info.currency === 'string' ? info.currency : 'CNY',
    total,
    granted: toNumber(info.granted_balance),
    toppedUp: toNumber(info.topped_up_balance),
    available: payload.is_available !== false,
  }
}

/**
 * Normalize an arbitrary JSON document through an optional dot-path, falling
 * back to a short list of conventional field names.
 */
export function normalizeCustom(payload, jsonPath = '') {
  if (payload === null || payload === undefined) return null
  if (jsonPath) {
    const raw = pickPath(payload, jsonPath)
    const total = toNumber(raw)
    if (total === null) return null
    return { currency: 'CNY', total, granted: null, toppedUp: null, available: true }
  }
  if (typeof payload === 'number' || typeof payload === 'string') {
    const total = toNumber(payload)
    return total === null ? null : { currency: 'CNY', total, granted: null, toppedUp: null, available: true }
  }
  if (typeof payload !== 'object') return null
  for (const key of GUESS_KEYS) {
    const total = toNumber(payload[key])
    if (total !== null) {
      const currency = typeof payload.currency === 'string' ? payload.currency : 'CNY'
      return { currency, total, granted: null, toppedUp: null, available: true }
    }
  }
  // One common nesting level: { data: { balance } }
  for (const key of ['data', 'result', 'payload']) {
    const nested = payload[key]
    if (nested && typeof nested === 'object') {
      const found = normalizeCustom(nested, '')
      if (found) return found
    }
  }
  return null
}

export function unavailable(reason, extra = {}) {
  return { status: 'unavailable', reason, at: Date.now(), ...extra }
}

/**
 * Resolve which provider a config selects.
 * `auto` means "DeepSeek when we have a key at all".
 */
export function resolveProvider(config, env = {}) {
  const configured = String(config?.balanceProvider || 'auto')
  const hasKey = Boolean(String(config?.balanceApiKey || env.DEEPSEEK_API_KEY || '').trim())
  if (configured === 'off') return 'off'
  if (configured === 'custom') return config?.balanceUrl ? 'custom' : 'off'
  if (configured === 'deepseek') return 'deepseek'
  if (hasKey) return 'deepseek'
  return config?.balanceUrl ? 'custom' : 'off'
}

/**
 * Query the account balance once.
 * @param {object} config normalized plugin config
 * @param {object} [options] `{ fetchImpl, env, timeoutMs }`
 * @returns {Promise<object>} a protocol-ready balance snapshot
 */
export async function loadBalance(config, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const env = options.env ?? process.env ?? {}
  const provider = resolveProvider(config, env)

  if (provider === 'off') {
    return unavailable(
      provider === 'off' && config?.balanceProvider === 'off'
        ? '余额查询已关闭'
        : '未配置余额查询：填写密钥或自定义接口后可用',
    )
  }
  if (typeof fetchImpl !== 'function') {
    return unavailable('当前运行环境没有 fetch，无法查询余额')
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? TIMEOUT_MS)
  timer.unref?.()

  try {
    if (provider === 'deepseek') {
      const apiKey = String(config?.balanceApiKey || env.DEEPSEEK_API_KEY || '').trim()
      const base = String(config?.balanceBaseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '')
      const response = await fetchImpl(`${base}/user/balance`, {
        method: 'GET',
        headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' },
        signal: controller.signal,
      })
      if (!response.ok) {
        return unavailable(`余额接口返回 HTTP ${response.status}`)
      }
      const normalized = normalizeDeepSeek(await response.json())
      if (!normalized) return unavailable('余额接口返回了无法识别的结构')
      return { status: 'ok', source: 'deepseek', at: Date.now(), ...normalized }
    }

    // custom
    const headers = { accept: 'application/json' }
    const apiKey = String(config?.balanceApiKey || '').trim()
    if (apiKey) {
      headers.authorization = apiKey.includes(' ') ? apiKey : `Bearer ${apiKey}`
    }
    const response = await fetchImpl(String(config.balanceUrl), {
      method: 'GET',
      headers,
      signal: controller.signal,
    })
    if (!response.ok) return unavailable(`自定义余额接口返回 HTTP ${response.status}`)
    const normalized = normalizeCustom(await response.json(), config?.balanceJsonPath || '')
    if (!normalized) {
      return unavailable('自定义接口里没有找到余额字段，请填写 JSON 路径')
    }
    return { status: 'ok', source: 'custom', at: Date.now(), ...normalized }
  } catch (error) {
    const reason = error?.name === 'AbortError'
      ? '余额查询超时'
      : `余额查询失败：${error instanceof Error ? error.message : String(error)}`
    return unavailable(reason)
  } finally {
    clearTimeout(timer)
  }
}
