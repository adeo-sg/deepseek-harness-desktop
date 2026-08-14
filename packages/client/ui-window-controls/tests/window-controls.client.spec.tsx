// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import type { DesktopWindowControls } from '@deepseek-ai/dsh-client-connection/client'
import type { SessionId, SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import {
  FloatingWindowControls, WindowControls,
  type FloatingWindowControlsProps, type WindowControlsProps,
} from '../src/client/WindowControls.tsx'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/** A controllable fake bridge surface; every function member stays a Mock so assertions bind. */
type MockSurface = DesktopWindowControls & {
  minimize: Mock<() => void>
  toggleMaximize: Mock<() => void>
  close: Mock<() => void>
  isMaximized: Mock<() => Promise<boolean>>
  onMaximizedChanged: Mock<(listener: (maximized: boolean) => void) => () => void>
  detach: Mock<() => void>
}

/** Mock-typed overrides accepted by {@link controls}; tests pass real mocks. */
type MockOverrides = Partial<{
  minimize: Mock<() => void>
  toggleMaximize: Mock<() => void>
  close: Mock<() => void>
  isMaximized: Mock<() => Promise<boolean>>
  onMaximizedChanged: Mock<(listener: (maximized: boolean) => void) => () => void>
}>

function controls(over: Partial<DesktopWindowControls> = {}): MockSurface {
  const detach = vi.fn()
  const overrides = over as MockOverrides
  return {
    minimize: overrides.minimize ?? vi.fn(),
    toggleMaximize: overrides.toggleMaximize ?? vi.fn(),
    close: overrides.close ?? vi.fn(),
    isMaximized: overrides.isMaximized ?? vi.fn(async () => false),
    onMaximizedChanged: overrides.onMaximizedChanged ?? vi.fn(() => detach),
    detach,
  }
}

function inlineProps(windowControls: DesktopWindowControls | undefined): WindowControlsProps {
  return { windowControls } as unknown as WindowControlsProps
}

/** The session-list facts the floating occupant's visibility selector reads. */
interface FloatingState {
  current?: SessionId | undefined
  byId?: Record<string, { blank: boolean }> | undefined
}

function floatingProps(
  state: FloatingState,
  windowControls: DesktopWindowControls | undefined,
): FloatingWindowControlsProps {
  const useSessions = <T,>(select: (snapshot: SessionListState) => T): T => select({
    current: state.current,
    byId: state.byId ?? {},
  } as unknown as SessionListState)
  return { useSessions, windowControls } as unknown as FloatingWindowControlsProps
}

const SESSION = 's1' as SessionId

describe('WindowControls cluster', () => {
  it('renders nothing without the preload surface', () => {
    const { container } = render(<WindowControls {...inlineProps(undefined)} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders the three controls and wires each action', async () => {
    const surface = controls()
    render(<WindowControls {...inlineProps(surface)} />)
    await screen.findByRole('button', { name: '最大化' })
    expect(screen.getByRole('group', { name: '窗口控制' })).toBeDefined()
    act(() => { screen.getByRole('button', { name: '最小化' }).click() })
    act(() => { screen.getByRole('button', { name: '最大化' }).click() })
    act(() => { screen.getByRole('button', { name: '关闭' }).click() })
    expect(surface.minimize).toHaveBeenCalledTimes(1)
    expect(surface.toggleMaximize).toHaveBeenCalledTimes(1)
    expect(surface.close).toHaveBeenCalledTimes(1)
    expect(surface.isMaximized).toHaveBeenCalledTimes(1)
    expect(surface.onMaximizedChanged).toHaveBeenCalledTimes(1)
  })

  it('starts from the live maximize state and follows pushed flips', async () => {
    const surface = controls({ isMaximized: vi.fn(async () => true) })
    render(<WindowControls {...inlineProps(surface)} />)
    // Initial query resolves maximized → the restore glyph + label.
    await screen.findByRole('button', { name: '还原' })
    expect(surface.isMaximized).toHaveBeenCalledTimes(1)
    // A maximize → restore flip lands through the subscription.
    const listener = vi.mocked(surface.onMaximizedChanged).mock.calls[0]?.[0]
    expect(listener).toBeDefined()
    act(() => { listener!(false) })
    await screen.findByRole('button', { name: '最大化' })
    act(() => { listener!(true) })
    await screen.findByRole('button', { name: '还原' })
  })

  it('detaches the subscription on unmount', async () => {
    const surface = controls()
    const { unmount } = render(<WindowControls {...inlineProps(surface)} />)
    await screen.findByRole('button', { name: '最大化' })
    unmount()
    expect(surface.detach).toHaveBeenCalledTimes(1)
  })

  it('ignores a maximize query that resolves after unmount', async () => {
    let resolve!: (state: boolean) => void
    const pending = new Promise<boolean>((done) => { resolve = done })
    const surface = controls({ isMaximized: vi.fn(() => pending) })
    const { unmount } = render(<WindowControls {...inlineProps(surface)} />)
    unmount()
    expect(() => { act(() => { resolve(true) }) }).not.toThrow()
    expect(surface.detach).toHaveBeenCalledTimes(1)
  })
})

describe('FloatingWindowControls', () => {
  it('renders the cluster while no session is current', async () => {
    const surface = controls()
    render(<FloatingWindowControls {...floatingProps({ current: undefined, byId: {} }, surface)} />)
    await screen.findByRole('button', { name: '最小化' })
    expect(screen.getByRole('button', { name: '关闭' })).toBeDefined()
  })

  it('renders the cluster while the current session is blank', async () => {
    render(<FloatingWindowControls {...floatingProps({
      current: SESSION,
      byId: { [SESSION]: { blank: true } },
    }, controls())} />)
    await screen.findByRole('button', { name: '最小化' })
  })

  it('renders nothing once a real session header takes over', () => {
    const { container } = render(<FloatingWindowControls {...floatingProps({
      current: SESSION,
      byId: { [SESSION]: { blank: false } },
    }, controls())} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing while the current session summary is unknown', () => {
    const { container } = render(<FloatingWindowControls {...floatingProps({
      current: SESSION,
      byId: {},
    }, controls())} />)
    expect(container.innerHTML).toBe('')
  })
})
