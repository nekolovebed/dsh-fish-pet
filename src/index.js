/**
 * Package entry imported by the DSH loader (see package.json "main").
 *
 * The indirection exists for one reason: a broken dependency must not take the
 * whole harness down. DSH resolves plugin entries before the app boots and
 * rethrows activation failures, so a missing `node_modules` (incomplete install,
 * `link:` dependency that was never populated, interrupted pnpm run) would
 * abort every plugin. Resolving the real module dynamically turns that into an
 * inert pet plus one console line.
 */
let impl

try {
  impl = await import('./plugin.js')
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error)
  console.error(
    '[dsh-neko-pet] 依赖加载失败，桌宠本次启动已自动停用（不影响 DSH 与其它插件）。\n'
    + `[dsh-neko-pet] 原因: ${detail}\n`
    + '[dsh-neko-pet] 修复: 退出 DSH 后重新安装 `dsh plugin --profile web add <本仓库地址>`，或补齐依赖后重启。',
  )
  impl = {
    NAMESPACE: 'dsh-neko-pet',
    Config: undefined,
    apply() {},
  }
}

export const name = 'dsh-neko-pet'
export const inject = ['sessions', 'settings']
export const Config = impl.Config

export function apply(ctx, config) {
  return impl.apply(ctx, config)
}
