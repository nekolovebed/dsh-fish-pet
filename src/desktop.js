/**
 * Optional desktop overlay window.
 *
 * The desktop build of DSH is Electron, and the harness runs inside it, so a
 * plugin can ask the host process for a frameless, transparent, always-on-top
 * BrowserWindow. On the plain Node build (`dsh web`) there is no Electron, and
 * every call degrades to `{ supported: false }` — the in-page pet keeps working.
 *
 * The window loads a tiny page served by this plugin's own HTTP routes, so it
 * shares the same SSE stream and asset URLs as the overlay.
 */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

/** Electron's API surface, or `null` when this process is not Electron. */
export function electronRuntime() {
  if (!process.versions.electron) return null
  try {
    const electron = require('electron')
    if (electron && typeof electron.BrowserWindow === 'function') return electron
  } catch {}
  return null
}

export class DesktopPetWindow {
  /**
   * @param {object} [options]
   * @param {number} [options.width]
   * @param {number} [options.height]
   * @param {(note: string) => void} [options.log]
   */
  constructor(options = {}) {
    this.width = Math.max(160, Number(options.width) || 280)
    this.height = Math.max(200, Number(options.height) || 420)
    this.log = typeof options.log === 'function' ? options.log : () => {}
    this.win = null
    this.hoverTimer = null
    this.mouseIgnored = false
  }

  get isOpen() {
    return Boolean(this.win && !this.win.isDestroyed?.())
  }

  status() {
    return {
      supported: Boolean(electronRuntime()),
      open: this.isOpen,
      size: { width: this.width, height: this.height },
    }
  }

  /**
   * Open (or focus) the overlay.
   * @param {string} url page served by this plugin
   * @returns {{ok: boolean, reason?: string}}
   */
  open(url) {
    const electron = electronRuntime()
    if (!electron) {
      return { ok: false, reason: '当前不是 DSH 桌面版，无法创建窗口外的悬浮窗；页面内桌宠不受影响' }
    }
    if (this.isOpen) {
      try {
        this.win.showInactive()
      } catch {}
      return { ok: true }
    }

    const { BrowserWindow, screen } = electron
    let bounds = { x: undefined, y: undefined }
    try {
      const area = screen.getPrimaryDisplay().workArea
      bounds = {
        x: Math.round(area.x + area.width - this.width - 36),
        y: Math.round(area.y + area.height - this.height - 16),
      }
    } catch {}

    try {
      const win = new BrowserWindow({
        width: this.width,
        height: this.height,
        ...bounds,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        resizable: false,
        maximizable: false,
        minimizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        hasShadow: false,
        alwaysOnTop: true,
        show: false,
        title: 'dsh-neko-pet',
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          backgroundThrottling: false,
        },
      })
      this.win = win
      win.setAlwaysOnTop(true, 'floating')
      try {
        win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
      } catch {}
      this.#enableClickThrough(win, electron)
      win.on('closed', () => {
        this.#stopHoverTimer()
        if (this.win === win) this.win = null
      })
      win.once('ready-to-show', () => {
        try {
          win.showInactive()
        } catch {}
      })
      win.loadURL(url).catch((error) => {
        this.log(`desktop window load failed: ${error instanceof Error ? error.message : String(error)}`)
      })
      this.log(`desktop window opened ${this.width}x${this.height}`)
      return { ok: true }
    } catch (error) {
      this.win = null
      return { ok: false, reason: `创建悬浮窗失败：${error instanceof Error ? error.message : String(error)}` }
    }
  }

  /**
   * A transparent, always-on-top window would otherwise be an invisible mouse
   * trap over whatever the user is doing. Ignore clicks everywhere except the
   * pet/bubble column and the close button. Polling the cursor in the host
   * process avoids a preload script and a shared IPC channel.
   */
  #enableClickThrough(win, electron) {
    const getPoint = electron?.screen?.getCursorScreenPoint?.bind(electron.screen)
    if (!getPoint) return
    const hitRects = (bounds) => {
      const column = Math.min(this.width - 16, 236)
      return [
        {
          x: bounds.x + (this.width - column) / 2 - 8,
          y: bounds.y + 4,
          w: column + 16,
          h: this.height - 10,
        },
        { x: bounds.x + this.width - 34, y: bounds.y, w: 34, h: 34 },
      ]
    }
    this.#stopHoverTimer()
    try {
      win.setIgnoreMouseEvents(true, { forward: true })
      this.mouseIgnored = true
    } catch {
      return
    }
    this.hoverTimer = setInterval(() => {
      if (win.isDestroyed?.()) {
        this.#stopHoverTimer()
        return
      }
      let inside = false
      try {
        const point = getPoint()
        const rects = hitRects(win.getBounds())
        inside = rects.some((rect) => (
          point.x >= rect.x && point.x <= rect.x + rect.w
          && point.y >= rect.y && point.y <= rect.y + rect.h
        ))
      } catch {}
      const shouldIgnore = !inside
      if (shouldIgnore === this.mouseIgnored) return
      try {
        win.setIgnoreMouseEvents(shouldIgnore, { forward: true })
        this.mouseIgnored = shouldIgnore
      } catch {}
    }, 120)
    this.hoverTimer.unref?.()
  }

  #stopHoverTimer() {
    if (this.hoverTimer) clearInterval(this.hoverTimer)
    this.hoverTimer = null
    this.mouseIgnored = false
  }

  close() {
    this.#stopHoverTimer()
    const win = this.win
    this.win = null
    if (!win) return { ok: true }
    try {
      win.destroy()
    } catch {}
    return { ok: true }
  }
}
