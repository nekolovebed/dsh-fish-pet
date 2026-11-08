/**
 * Plugin configuration schema.
 *
 * Every field is also restated in `defaults` so the host half can keep working
 * when the settings service is unavailable (for example on a profile that does
 * not mount `settings`). Keep the two in sync: the HTTP endpoint validates
 * patches against the keys of `defaults`.
 */
import Schema from '@deepseek-ai/schemastery'

export const NAMESPACE = 'dsh-fish-pet'

export const Config = Schema.object({
  enabled: Schema.boolean().default(true)
    .description('启用桌宠。关闭后页面内的鱼立即消失，不会影响其他插件。'),

  scale: Schema.number().min(0.6).max(1.8).step(0.05).default(1).role('slider')
    .description('宠物大小'),

  bubble: Schema.boolean().default(true)
    .description('显示状态气泡'),

  showBalance: Schema.boolean().default(true)
    .description('在状态面板显示账户余额'),

  balanceProvider: Schema.union([
    Schema.const('auto').description('自动（有密钥则查 DeepSeek）'),
    Schema.const('deepseek').description('DeepSeek 官方 /user/balance'),
    Schema.const('custom').description('自定义 HTTP 接口'),
    Schema.const('off').description('关闭余额查询'),
  ]).default('auto').description('余额查询方式'),

  balanceApiKey: Schema.string().role('secret').default('')
    .description('余额查询密钥。留空则读取环境变量 DEEPSEEK_API_KEY。'),

  balanceBaseUrl: Schema.string().default('')
    .description('DeepSeek 兼容接口地址，留空使用 https://api.deepseek.com'),

  balanceUrl: Schema.string().default('')
    .description('自定义余额接口完整地址（balanceProvider=custom 时使用）'),

  balanceJsonPath: Schema.string().default('')
    .description('自定义接口中余额字段的路径，如 data.balance；留空则尝试常见字段名'),

  priceInputPerMillion: Schema.number().min(0).default(0)
    .description('输入单价（元/百万 token），用于估算费用；0 表示不估算'),

  priceOutputPerMillion: Schema.number().min(0).default(0)
    .description('输出单价（元/百万 token），用于估算费用；0 表示不估算'),

  chatEnabled: Schema.boolean().default(true)
    .description('允许在桌宠面板里对话'),

  chatMode: Schema.union([
    Schema.const('session').description('走真实 DSH 会话（可用工具，能办公）'),
    Schema.const('off').description('只做状态展示'),
  ]).default('session').description('对话后端'),

  chatCwd: Schema.string().default('')
    .description('桌宠会话的工作目录，留空使用 DSH 进程当前目录'),

  maxTasks: Schema.number().min(1).max(20).step(1).default(6).role('slider')
    .description('状态面板保留的任务条数'),
}).description('DSH 页面内的小鱼桌宠')

/** Plain-object mirror of {@link Config} defaults, usable without the schema. */
export const defaults = Object.freeze({
  enabled: true,
  scale: 1,
  bubble: true,
  showBalance: true,
  balanceProvider: 'auto',
  balanceApiKey: '',
  balanceBaseUrl: '',
  balanceUrl: '',
  balanceJsonPath: '',
  priceInputPerMillion: 0,
  priceOutputPerMillion: 0,
  chatEnabled: true,
  chatMode: 'session',
  chatCwd: '',
  maxTasks: 6,
})

/** Keys a client is allowed to PATCH through the settings endpoint. */
export const writableKeys = new Set(Object.keys(defaults))

/**
 * Coerce arbitrary input into a complete config object.
 * Unknown keys are dropped; invalid values fall back to their default so a
 * hand-edited patch file can never break the overlay.
 */
export function normalizeConfig(input) {
  const source = input && typeof input === 'object' ? input : {}
  const out = {}
  for (const [key, fallback] of Object.entries(defaults)) {
    const value = source[key]
    if (typeof fallback === 'boolean') {
      out[key] = typeof value === 'boolean' ? value : fallback
    } else if (typeof fallback === 'number') {
      out[key] = Number.isFinite(value) ? clampNumber(key, value) : fallback
    } else if (typeof value === 'string') {
      out[key] = value
    } else {
      out[key] = fallback
    }
  }
  for (const enumKey of ['balanceProvider', 'chatMode']) {
    if (source[enumKey] !== undefined && !Object.values(enumValues[enumKey]).includes(out[enumKey])) {
      out[enumKey] = defaults[enumKey]
    }
  }
  return out
}

const enumValues = {
  balanceProvider: { auto: 'auto', deepseek: 'deepseek', custom: 'custom', off: 'off' },
  chatMode: { session: 'session', off: 'off' },
}

const ranges = {
  scale: [0.6, 1.8],
  priceInputPerMillion: [0, Infinity],
  priceOutputPerMillion: [0, Infinity],
  maxTasks: [1, 20],
}

function clampNumber(key, value) {
  const range = ranges[key]
  if (!range) return value
  const [min, max] = range
  return Math.min(max, Math.max(min, value))
}
