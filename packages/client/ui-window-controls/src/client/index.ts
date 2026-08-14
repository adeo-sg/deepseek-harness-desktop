/**
 * Desktop window-controls plugin, browser half: contributes the custom
 * minimize/maximize/close cluster to the Session header utilities (right of
 * Session log) and a floating top-right fallback while that header is hidden.
 * The row lives in the dsh-desktop-app bundle patch only, so the web
 * composition never loads this plugin; the component still guards on the
 * preload surface's presence (fixture mode, accidental composition).
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pull the conversation + layout SlotMap merges that declare the
// two target slots (declaration stays with those packages).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { DesktopWindowControls } from '@deepseek-ai/dsh-client-connection/client'
import { FloatingWindowControls, WindowControls, type WindowControlsInjected } from './WindowControls.tsx'

export type {
  FloatingWindowControlsProps, WindowControlsInjected, WindowControlsProps,
} from './WindowControls.tsx'

/** Required services: the slot registry only (the bridge surface is environment data). */
export const inject = ['slots']

/** Read the preload's window surface; undefined in the web composition. */
function windowControlsOf(): DesktopWindowControls | undefined {
  return (globalThis as { desktopBridge?: { windowControls?: DesktopWindowControls } })
    .desktopBridge?.windowControls
}

/**
 * Client plugin body: register the inline and floating control clusters. Both
 * target slots are declared by other entries, so each registration rides
 * `slots.inject` on its declaration lifetime (late activation, redeclaration,
 * teardown with the caller's fiber).
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const injectWindowControls = (): WindowControlsInjected => ({ windowControls: windowControlsOf() })
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'window-controls',
    // Right of the Session-log utility: the shipped utility registers at the
    // default order 0, this positive order keeps the cluster the last entry.
    order: 100,
    inject: injectWindowControls,
  }, WindowControls))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'window-controls-floating',
    inject: injectWindowControls,
  }, FloatingWindowControls))
}
