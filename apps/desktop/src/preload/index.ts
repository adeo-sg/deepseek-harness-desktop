/**
 * The sandboxed preload: exposes the desktop bridge to the renderer over
 * contextBridge. Only ipcRenderer/contextBridge are available here (sandbox),
 * and every value crossing the world boundary is plain JSON — the renderer's
 * connection plugin selects {@link IpcApiClient} on the presence of
 * `window.desktopBridge`.
 * @module @deepseek-ai/dsh-desktop/preload
 */

import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, type DesktopBridge, type DesktopBridgeResponse, type DesktopBridgeSubscription, type DesktopWindowControls } from '../bridge-types.ts'

let subscriptionCounter = 0

/** The frameless window-control surface: one-shot actions plus state query/events. */
const windowControls: DesktopWindowControls = {
  minimize: () => { ipcRenderer.send(IPC_CHANNELS.windowAction, 'minimize') },
  toggleMaximize: () => { ipcRenderer.send(IPC_CHANNELS.windowAction, 'toggle-maximize') },
  close: () => { ipcRenderer.send(IPC_CHANNELS.windowAction, 'close') },
  isMaximized: () => (ipcRenderer.invoke(IPC_CHANNELS.windowState) as Promise<{ maximized: boolean }>).then(state => state.maximized),
  onMaximizedChanged: (listener: (maximized: boolean) => void): (() => void) => {
    const handler = (_event: unknown, maximized: boolean): void => { listener(maximized) }
    ipcRenderer.on(IPC_CHANNELS.windowMaximized, handler)
    return () => { ipcRenderer.removeListener(IPC_CHANNELS.windowMaximized, handler) }
  },
}

const bridge: DesktopBridge = {
  fetch: request => ipcRenderer.invoke(IPC_CHANNELS.rpc, request) as Promise<DesktopBridgeResponse>,
  cancel: (id) => { ipcRenderer.send(IPC_CHANNELS.cancel, id) },
  subscribe: (stream, listener): DesktopBridgeSubscription => {
    const subId = `sub_${String(++subscriptionCounter)}`
    const endListeners = new Set<() => void>()
    const frameHandler = (_event: unknown, payload: { subId: string; frame: unknown }): void => {
      if (payload.subId === subId) listener(payload.frame)
    }
    const endHandler = (_event: unknown, payload: { subId: string }): void => {
      if (payload.subId !== subId) return
      for (const endListener of [...endListeners]) endListener()
    }
    ipcRenderer.on(IPC_CHANNELS.frame, frameHandler)
    ipcRenderer.on(IPC_CHANNELS.streamEnd, endHandler)
    void ipcRenderer.invoke(IPC_CHANNELS.subscribe, { stream, subId })
    return {
      unsubscribe: () => {
        ipcRenderer.removeListener(IPC_CHANNELS.frame, frameHandler)
        ipcRenderer.removeListener(IPC_CHANNELS.streamEnd, endHandler)
        ipcRenderer.send(IPC_CHANNELS.unsubscribe, subId)
      },
      onEnd: (endListener: () => void) => { endListeners.add(endListener) },
    }
  },
  windowControls,
}

contextBridge.exposeInMainWorld('desktopBridge', bridge)
