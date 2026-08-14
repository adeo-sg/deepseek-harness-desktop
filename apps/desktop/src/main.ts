/**
 * The desktop shell's Electron entry: single-instance lock, scheme
 * registration, host boot, protocol + IPC wiring, window creation, and
 * ordered shutdown (dispose the host tree before exit).
 * @module @deepseek-ai/dsh-desktop
 */

import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, Menu } from 'electron'
import type { DesktopWebServer } from '@deepseek-ai/dsh-host-desktop-carrier'
import { bootDesktopHost } from './host.ts'
import { IPC_CHANNELS } from './bridge-types.ts'
import { registerIpc, registerWindowIpc } from './ipc.ts'
import { APP_INDEX_URL, registerAppScheme, registerDesktopProtocol } from './protocol.ts'
import type { DesktopBridgeHost } from './bridge-types.ts'

/** The CJS preload artifact (sandboxed preloads cannot be ESM), beside lib/main.js. */
const PRELOAD_PATH = fileURLToPath(new URL('./preload.cjs', import.meta.url))

/** The app icon (generated from the DeepSeek mark), used for the window on Windows/Linux. */
const WINDOW_ICON = join(app.getAppPath(), 'build', 'icon.png')

let window: BrowserWindow | undefined
let disposing = false

/**
 * Boot the host and open the shell window.
 */
async function start(): Promise<void> {
  // The installation anchor is the app's own package.json: `app.getAppPath()`
  // is apps/desktop in dev and resources/app in the packaged build, so the
  // module fallback heals against the real installation in both layouts.
  const { ctx, shutdown } = await bootDesktopHost({
    installAnchor: join(app.getAppPath(), 'package.json'),
  })
  const carrier = ctx.get('webServer') as DesktopWebServer | undefined
  if (carrier === undefined) throw new Error('dsh-desktop: webServer service missing after boot')
  const bridge = ctx.get('desktopBridge') as DesktopBridgeHost | undefined
  if (bridge === undefined) throw new Error('dsh-desktop: desktopBridge service missing after boot')

  registerDesktopProtocol(carrier)
  registerIpc(bridge)
  registerWindowIpc()

  // Ordered quit: prevent the default, dispose the host tree (bounded by the
  // shutdown controller's timeout), then exit for real.
  app.on('before-quit', (event) => {
    if (disposing) return
    disposing = true
    event.preventDefault()
    void shutdown.shutdown(0).then(() => { app.exit(0) })
  })

  // No default application menu (the shell is frameless; the custom title-bar
  // chrome owns window control) and no native title bar — the renderer draws
  // its own drag region and window controls.
  Menu.setApplicationMenu(null)
  window = new BrowserWindow({
    width: 1280,
    height: 820,
    title: 'DeepSeek Harness',
    icon: WINDOW_ICON,
    frame: false,
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  window.on('closed', () => { window = undefined })
  // Push maximize/restore flips to the custom controls so the toggle glyph
  // tracks the real window state (keyboard snap, double-click drag region).
  const forwardMaximizeState = (): void => {
    if (window !== undefined && !window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.windowMaximized, window.isMaximized())
    }
  }
  window.on('maximize', forwardMaximizeState)
  window.on('unmaximize', forwardMaximizeState)
  // Renderer crashes (a GPU/utility fault, an out-of-memory kill) blank the
  // shell; the host tree lives in this process, so reloading the page restores
  // the UI over the same sessions. Clean exits (window close, our own quit)
  // never reach this branch.
  window.webContents.on('render-process-gone', (_event, details) => {
    console.error(`dsh-desktop: renderer gone (${details.reason}${details.exitCode !== 0 ? `, exit ${details.exitCode}` : ''}) — reloading the shell`)
    if (window !== undefined && !window.isDestroyed()) {
      void window.webContents.reload()
    }
  })
  await window.loadURL(APP_INDEX_URL)
}

// Diagnose background-process faults (GPU compositor, utility, zygote): a GPU
// crash can freeze the window while Electron restarts it, and the log is the
// only record after the fact.
app.on('child-process-gone', (_event, details) => {
  if (details.type === 'GPU' || details.type === 'Utility') {
    console.error(`dsh-desktop: ${details.type} process gone (${details.reason}${details.exitCode !== 0 ? `, exit ${details.exitCode}` : ''})`)
  }
})

registerAppScheme()

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (window !== undefined) {
      if (window.isMinimized()) window.restore()
      window.focus()
    }
  })
  void app.whenReady().then(() => {
    void start().catch((error: unknown) => {
      console.error('dsh-desktop: startup failed:', error)
      app.exit(1)
    })
  })
}

app.on('window-all-closed', () => {
  app.quit()
})
