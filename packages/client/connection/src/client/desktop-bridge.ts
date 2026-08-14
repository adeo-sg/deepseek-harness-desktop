/**
 * Wire types for the Electron desktop bridge: the plain-JSON surface the
 * sandboxed preload exposes to the renderer. Context isolation forbids passing
 * `Response`/`AbortSignal` objects across the world boundary, so unary RPC
 * round-trips as JSON request → `{status, headers, body}` response, streams
 * arrive as per-frame listener callbacks, and cancellation is a named
 * request-id call.
 * @module @deepseek-ai/dsh-client-connection/desktop-bridge
 */

import type { ServerRequest } from '@deepseek-ai/dsh-host-apiproxy/api'

/** One unary/respond round-trip request, clone-safe for contextBridge. */
export interface DesktopBridgeRequest {
  /** Caller-chosen id echoed by {@link DesktopBridge.cancel}. */
  id: string
  /** Absolute URL; the main process routes on its pathname. */
  url: string
  /** HTTP method (POST for every RPC call today). */
  method: string
  /** Headers as a plain record (lowercase names). */
  headers: Record<string, string>
  /** Request body text; absent for body-less calls. */
  body?: string
}

/** The unary/respond response as plain JSON (Response objects cannot cross the bridge). */
export interface DesktopBridgeResponse {
  status: number
  headers: [string, string][]
  body: string
}

/** Handle for one downlink event-stream subscription. */
export interface DesktopBridgeSubscription {
  /** Detach the frame listener; the main process stops pumping the stream. */
  unsubscribe(): void
  /**
   * Register the stream-end callback: fires once the host side finished the
   * generator (host teardown, explicit abort) — the IPC analogue of a
   * WebSocket close.
   * @param listener - invoked at most once.
   */
  onEnd(listener: () => void): void
}

/**
 * The frameless window-control surface a renderer may use when it runs inside
 * the Electron app. Rendered by this repo's custom title-bar chrome
 * (`dsh-client-ui-window-controls`); absent in the browser composition.
 */
export interface DesktopWindowControls {
  /** Minimize the window. */
  minimize(): void
  /** Maximize, or restore when already maximized. */
  toggleMaximize(): void
  /** Close the window (and, with it, the app). */
  close(): void
  /** Resolve the current maximize state (for the initial toggle glyph). */
  isMaximized(): Promise<boolean>
  /**
   * Subscribe to maximize/restore flips so the glyph follows the real state
   * (keyboard snap, double-click drag region).
   * @param listener - called with the new maximized flag.
   * @returns the detach function.
   */
  onMaximizedChanged(listener: (maximized: boolean) => void): () => void
}

/**
 * The desktop shell surface a renderer may use when it runs inside the
 * Electron app (exposed as `window.desktopBridge` by the preload; the
 * connection plugin selects {@link IpcApiClient} on its presence).
 */
export interface DesktopBridge {
  /** Unary/respond round trip: POST-shaped JSON over IPC. */
  fetch(request: DesktopBridgeRequest): Promise<DesktopBridgeResponse>
  /** Abandon an in-flight request; the main process aborts its fetch handler. */
  cancel(id: string): void
  /**
   * Subscribe to one downlink event stream (`mux` or `host`). The listener
   * receives validated full-form ServerRequests; frames are pushed in order.
   * @param stream - the logical stream name (mirrors the WebSocket path tail).
   * @param listener - per-frame callback.
   */
  subscribe(stream: 'mux' | 'host', listener: (frame: ServerRequest) => void): DesktopBridgeSubscription
  /** The desktop app version, for diagnostics. */
  version: string
  /** Custom window controls (frameless shell); present only in the desktop preload. */
  windowControls?: DesktopWindowControls
}
