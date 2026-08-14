/**
 * Custom window controls for the frameless Electron shell. Two registrations
 * render the same cluster: inline at the right end of the Session header
 * utilities (beside "Session log"), and — while that header is hidden (no
 * current session, or a blank one showing the hero) — as a floating strip in
 * the shell overlay. The cluster is pure presentation over the preload's
 * `windowControls` surface: one-shot actions, an initial maximize query, and
 * a maximize/restore subscription so the toggle glyph follows the real state
 * (keyboard snap, double-click drag region). Absent the bridge surface (web
 * composition, fixture mode) nothing renders.
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import type { DesktopWindowControls } from '@deepseek-ai/dsh-client-connection/client'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './WindowControls.module.css'

/** Business face the plugin injects: the preload's window surface, when present. */
export interface WindowControlsInjected {
  /** The Electron preload surface; undefined in the browser composition. */
  windowControls: DesktopWindowControls | undefined
}

/** Full props of the inline Session-header utility occupant. */
export type WindowControlsProps =
  PropsRuntime<'conversation.session.header.utilities'>
  & InjectFace<WindowControlsInjected>

/** Full props of the floating shell-overlay occupant. */
export type FloatingWindowControlsProps =
  PropsRuntime<'shell.overlay'>
  & InjectFace<WindowControlsInjected>

/** One glyph box; the 10x10 viewBox keeps the strokes metric-crisp at 10px. */
function Glyph(props: { children: ReactNode }): ReactNode {
  return (
    <svg className={css.glyph} viewBox="0 0 10 10" aria-hidden="true">
      {props.children}
    </svg>
  )
}

/** Minimize glyph: a centered horizontal rule. */
function MinimizeGlyph(): ReactNode {
  return <Glyph><path d="M1 5h8" stroke="currentColor" strokeWidth="1" /></Glyph>
}

/** Maximize glyph: one hollow square. */
function MaximizeGlyph(): ReactNode {
  return <Glyph><rect x="1" y="1" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1" /></Glyph>
}

/** Restore glyph: the front square over the back square's top/right edges. */
function RestoreGlyph(): ReactNode {
  return (
    <Glyph>
      <path d="M3.5 0.5h6v6" fill="none" stroke="currentColor" strokeWidth="1" />
      <rect x="0.5" y="3.5" width="6" height="6" fill="none" stroke="currentColor" strokeWidth="1" />
    </Glyph>
  )
}

/** Close glyph: an X. */
function CloseGlyph(): ReactNode {
  return <Glyph><path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1" /></Glyph>
}

/**
 * The three-button control cluster (minimize / maximize-restore / close).
 * Component-private state only: the toggle glyph's live bit. Subscribing to
 * the bridge here is the one external read this component owns — window state
 * is window-global but only the controls consume it, so a store would be a
 * shared source with a single reader.
 * @param props - the bridge surface, or undefined outside the desktop shell.
 * @returns the cluster, or nothing when no surface exists.
 */
function ControlsCluster(props: { controls: DesktopWindowControls | undefined }): ReactNode {
  const { controls } = props
  const [maximized, setMaximized] = useState(false)
  useEffect(() => {
    if (controls === undefined) return
    let alive = true
    void controls.isMaximized().then((state) => { if (alive) setMaximized(state) })
    const detach = controls.onMaximizedChanged(setMaximized)
    return () => { alive = false; detach() }
  }, [controls])
  if (controls === undefined) return null
  const maximizeLabel = maximized ? '还原' : '最大化'
  return (
    <div className={css.cluster} role="group" aria-label="窗口控制">
      <button type="button" className={css.button} aria-label="最小化" title="最小化" onClick={() => { controls.minimize() }}>
        <MinimizeGlyph />
      </button>
      <button type="button" className={css.button} aria-label={maximizeLabel} title={maximizeLabel} onClick={() => { controls.toggleMaximize() }}>
        {maximized ? <RestoreGlyph /> : <MaximizeGlyph />}
      </button>
      <button type="button" className={clsx(css.button, css.close)} aria-label="关闭" title="关闭" onClick={() => { controls.close() }}>
        <CloseGlyph />
      </button>
    </div>
  )
}

/**
 * The inline occupant of `conversation.session.header.utilities`: the cluster
 * sits at the right end of the Session header, after the Session-log utility.
 * @param props - session runtime share plus the injected window surface.
 * @returns the control cluster (rendered only inside the visible header).
 */
export function WindowControls({ windowControls }: WindowControlsProps): ReactNode {
  return <ControlsCluster controls={windowControls} />
}

/**
 * The floating occupant of `shell.overlay`: shows the same cluster pinned to
 * the window's top-right exactly while the Session header is hidden (no
 * current session, or a blank one in the hero) — the window must stay
 * closable before the first message exists. Renders nothing once a real
 * session header takes over the top-right.
 * @param props - root runtime share (global session list) plus the injected window surface.
 * @returns the floating cluster, or nothing while a header is visible.
 */
export function FloatingWindowControls({ useSessions, windowControls }: FloatingWindowControlsProps): ReactNode {
  const headerHidden = useSessions(state =>
    state.current === undefined || state.byId[state.current]?.blank === true)
  if (!headerHidden) return null
  return (
    <div className={css.floating}>
      <ControlsCluster controls={windowControls} />
    </div>
  )
}
