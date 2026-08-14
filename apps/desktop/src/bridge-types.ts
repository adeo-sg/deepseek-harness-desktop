/**
 * Structural mirrors of the desktop-bridge wire contract. The connection
 * package owns the authoritative types (`DesktopBridge` in its `/client`
 * half, `DesktopBridgeHost` in its `/desktop` half); this app declares only
 * the slices it wires, so the shell never needs a build-time project
 * reference into the client stack. The composition spec in the desktop-app
 * bundle proves the wire shapes end to end through the real types.
 * @module @deepseek-ai/dsh-desktop/bridge-types
 */

/** The host bridge surface the main process wires to IPC. */
export interface DesktopBridgeHost {
  fetch(request: Request): Promise<Response>
  openMux(signal: AbortSignal): AsyncIterable<{ rpcId: unknown; payload: unknown }>
  openHost(signal: AbortSignal): AsyncIterable<{ rpcId: unknown; payload: unknown }>
}

/** One unary/respond round-trip request, clone-safe for contextBridge. */
export interface DesktopBridgeRequest {
  id: string
  url: string
  method: string
  headers: Record<string, string>
  body?: string
}

/** The unary/respond response as plain JSON. */
export interface DesktopBridgeResponse {
  status: number
  headers: [string, string][]
  body: string
}

/** Handle for one downlink event-stream subscription. */
export interface DesktopBridgeSubscription {
  unsubscribe(): void
  onEnd(listener: () => void): void
}

/** The frameless window-control surface the renderer's custom title-bar chrome calls. */
export interface DesktopWindowControls {
  minimize(): void
  toggleMaximize(): void
  close(): void
  isMaximized(): Promise<boolean>
  /** Subscribe to maximize/restore flips; returns the detach function. */
  onMaximizedChanged(listener: (maximized: boolean) => void): () => void
}

/** The preload-exposed surface the renderer's connection plugin selects on. */
export interface DesktopBridge {
  fetch(request: DesktopBridgeRequest): Promise<DesktopBridgeResponse>
  cancel(id: string): void
  subscribe(stream: 'mux' | 'host', listener: (frame: unknown) => void): DesktopBridgeSubscription
  /** Custom window controls (frameless shell); absent outside the desktop preload. */
  windowControls?: DesktopWindowControls
}

/** IPC channel names, shared by the preload and the main process. */
export const IPC_CHANNELS = {
  rpc: 'dsh:rpc',
  cancel: 'dsh:cancel',
  subscribe: 'dsh:subscribe',
  unsubscribe: 'dsh:unsubscribe',
  frame: 'dsh:frame',
  streamEnd: 'dsh:stream-end',
  windowAction: 'dsh:window-action',
  windowState: 'dsh:window-state',
  windowMaximized: 'dsh:window-maximized',
} as const
