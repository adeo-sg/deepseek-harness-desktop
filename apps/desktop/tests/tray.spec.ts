/**
 * Tray integration: menu template structure and actions, session loading from
 * the host corpus, close-to-tray settings observation, and the platform-native
 * click wiring (macOS/Linux menu-on-click, Windows show-on-click).
 */

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { BrowserWindow } from 'electron'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionQueryEngine } from '@deepseek-ai/dsh-session-query'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import type { DesktopSettings } from '../src/desktop-settings.ts'
import { IPC_CHANNELS } from '../src/bridge-types.ts'
import {
  APP_NAME,
  buildTrayMenuTemplate,
  installTray,
  loadTraySessions,
  relativeTimeLabel,
  trayImage,
  truncateTitle,
  type DesktopTray,
  type InstallTrayOptions,
  type TraySession,
} from '../src/tray.ts'

interface MockTrayInstance {
  image: unknown
  handlers: Map<string, (...args: unknown[]) => void>
  destroyed: boolean
  menu: unknown
  setToolTip: Mock<() => void>
  on: Mock<(event: string, listener: (...args: unknown[]) => void) => void>
  isDestroyed: Mock<() => boolean>
  destroy: Mock<() => void>
  popUpContextMenu: Mock<(menu: unknown) => void>
  setContextMenu: Mock<(menu: unknown) => void>
}

const trayInstances: MockTrayInstance[] = []

vi.mock('electron', () => {
  class MockTray {
    image: unknown
    handlers = new Map<string, (...args: unknown[]) => void>()
    destroyed = false
    menu: unknown
    setToolTip = vi.fn()
    constructor(image: unknown) {
      this.image = image
      trayInstances.push(this)
    }
    on = vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      this.handlers.set(event, listener)
    })
    isDestroyed = vi.fn(() => this.destroyed)
    destroy = vi.fn(() => { this.destroyed = true })
    popUpContextMenu = vi.fn((menu: unknown) => { this.menu = menu })
    setContextMenu = vi.fn((menu: unknown) => { this.menu = menu })
  }
  return {
    Tray: MockTray,
    Menu: {
      buildFromTemplate: (template: unknown) => ({ template }),
    },
    nativeImage: {
      createFromPath: vi.fn(() => ({
        isEmpty: () => false,
        resize: vi.fn((options: unknown) => ({ resized: options })),
      })),
    },
  }
})

/** A fake BrowserWindow-like surface the tray shows/focuses and writes IPC to. */
function fakeWindow(over: Partial<{
  visible: boolean
  minimized: boolean
  destroyed: boolean
}> = {}): {
  restore: Mock<() => void>
  show: Mock<() => void>
  focus: Mock<() => void>
  isMinimized: Mock<() => boolean>
  isVisible: Mock<() => boolean>
  isDestroyed: Mock<() => boolean>
  webContents: { send: Mock<(channel: string, payload?: unknown) => void> }
  on: Mock<() => void>
  removeListener: Mock<() => void>
} {
  const win = {
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    isMinimized: vi.fn(() => over.minimized ?? false),
    isVisible: vi.fn(() => over.visible ?? true),
    isDestroyed: vi.fn(() => over.destroyed ?? false),
    webContents: { send: vi.fn() },
    on: vi.fn(),
    removeListener: vi.fn(),
  }
  return win
}

/** A fake desktop settings scope carrying one full resolved section. */
function fakeSettingsScope(initial: Partial<DesktopSettings> = {}): {
  scope: SettingsScope<DesktopSettings>
  setCloseToTray: (value: boolean) => void
} {
  let current: DesktopSettings = {
    closeToTray: true, autoCheckUpdates: true, updateChannel: 'follow', autoDownload: false, ...initial,
  }
  let watcher: ((next: DesktopSettings, prev: DesktopSettings) => void | Promise<void>) | undefined
  const scope: SettingsScope<DesktopSettings> = {
    get: () => ({ ...current }),
    watch: (callback) => {
      watcher = callback
      return () => { watcher = undefined }
    },
    update: vi.fn(async () => {}),
    replace: vi.fn(async () => {}),
  }
  return {
    scope,
    setCloseToTray: (value) => {
      const previous = current
      current = { ...current, closeToTray: value }
      void watcher?.({ ...current }, previous)
    },
  }
}

/** A fake session-query service backed by canned records and titles. */
function fakeQuery(
  records: Array<{ id: string; createdAt: number; origin?: 'subagent' }>,
  titles: Record<string, string | undefined>,
): SessionQueryEngine {
  return {
    listSessions: vi.fn(async () => records.map(record => ({
      header: {
        id: record.id,
        createdAt: record.createdAt,
        ...(record.origin === undefined ? {} : { origin: record.origin }),
      },
      live: true,
      persisted: true,
    }))),
    readTitleSnapshots: vi.fn(async (ids: readonly string[]) => ids.map(sessionId => ({
      sessionId,
      status: 'fulfilled' as const,
      value: {
        session: { id: sessionId, createdAt: 0 },
        ...(titles[sessionId] === undefined ? {} : { title: { title: titles[sessionId] } }),
      },
    }))),
  } as unknown as SessionQueryEngine
}

function ctxWith(services: Record<string, unknown>): Context {
  return { get: (key: string) => services[key] } as unknown as Context
}

function installWith(
  over: Partial<InstallTrayOptions> & { ctx: Context },
): { tray: DesktopTray; win: ReturnType<typeof fakeWindow>; quit: Mock<() => void> } {
  const win = fakeWindow()
  const quit = vi.fn()
  const tray = installTray({
    ctx: over.ctx,
    getWindow: () => win as unknown as BrowserWindow,
    quit,
    iconPath: '/build/icon.png',
    platform: over.platform ?? 'win32',
    maxRecentSessions: over.maxRecentSessions ?? 8,
    ...(over.settingsScope === undefined ? {} : { settingsScope: over.settingsScope }),
    ...(over.checkUpdates === undefined ? {} : { checkUpdates: over.checkUpdates }),
  })
  return { tray, win, quit }
}

const actions = {
  open: vi.fn(),
  newSession: vi.fn(),
  openSession: vi.fn(),
  quit: vi.fn(),
}

const SESSION_1: TraySession = { id: 's1', title: '集成 Session 查询', createdAt: Date.now() - 3_600_000 }
const SESSION_2: TraySession = { id: 's2', title: '编写托盘菜单', createdAt: Date.now() - 86_400_000 }

afterEach(() => {
  trayInstances.length = 0
})

describe('relativeTimeLabel', () => {
  const now = 1_800_000_000_000
  it('labels sub-minute and minute/hours/days ranges', () => {
    expect(relativeTimeLabel(now, now)).toBe('刚刚')
    expect(relativeTimeLabel(now - 30_000, now)).toBe('刚刚')
    expect(relativeTimeLabel(now - 5 * 60_000, now)).toBe('5 分钟前')
    expect(relativeTimeLabel(now - 3 * 3_600_000, now)).toBe('3 小时前')
    expect(relativeTimeLabel(now - 2 * 86_400_000, now)).toBe('2 天前')
  })

  it('falls back to a calendar date past one week', () => {
    expect(relativeTimeLabel(now - 8 * 86_400_000, now)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('clamps a future timestamp to just now', () => {
    expect(relativeTimeLabel(now + 60_000, now)).toBe('刚刚')
  })
})

describe('truncateTitle', () => {
  it('keeps short titles verbatim', () => {
    expect(truncateTitle('short')).toBe('short')
  })

  it('cuts long titles with an ellipsis', () => {
    const long = 'x'.repeat(80)
    expect(truncateTitle(long)).toBe(`${'x'.repeat(47)}…`)
  })
})

describe('buildTrayMenuTemplate', () => {
  it('lays out Open / New Session / recent sessions / Quit', () => {
    const template = buildTrayMenuTemplate([SESSION_1], actions)
    const labels = template.map(item => 'label' in item ? item.label : '—')
    expect(labels).toEqual([
      `打开 ${APP_NAME}`,
      '—',
      '新建会话',
      '—',
      '最近会话',
      SESSION_1.title,
      '—',
      '退出',
    ])
    expect(template[5]).toMatchObject({ sublabel: '1 小时前' })
  })

  it('invokes the navigation actions on click', () => {
    const template = buildTrayMenuTemplate([SESSION_1, SESSION_2], actions)
    const byLabel = new Map(template.map(item => ['label' in item ? item.label : '', item]))
    ;(byLabel.get(`打开 ${APP_NAME}`) as { click?: () => void }).click?.()
    expect(actions.open).toHaveBeenCalledTimes(1)
    ;(byLabel.get('新建会话') as { click?: () => void }).click?.()
    expect(actions.newSession).toHaveBeenCalledTimes(1)
    ;(byLabel.get(SESSION_1.title) as { click?: () => void }).click?.()
    expect(actions.openSession).toHaveBeenCalledWith('s1')
    ;(byLabel.get('退出') as { click?: () => void }).click?.()
    expect(actions.quit).toHaveBeenCalledTimes(1)
  })

  it('adds the update-check row only when the action is wired', () => {
    const checkUpdates = vi.fn()
    const withCheck = buildTrayMenuTemplate([], { ...actions, checkUpdates })
    expect(withCheck.some(item => 'label' in item && item.label === '检查更新')).toBe(true)
    const byLabel = new Map(withCheck.map(item => ['label' in item ? item.label : '', item]))
    ;(byLabel.get('检查更新') as { click?: () => void }).click?.()
    expect(checkUpdates).toHaveBeenCalledTimes(1)

    const withoutCheck = buildTrayMenuTemplate([], actions)
    expect(withoutCheck.some(item => 'label' in item && item.label === '检查更新')).toBe(false)
  })

  it('shows an empty-state row without sessions', () => {
    const template = buildTrayMenuTemplate([], actions)
    expect(template.some(item => 'label' in item && item.label === '暂无最近会话' && item.enabled === false)).toBe(true)
  })
})

describe('loadTraySessions', () => {
  it('returns an empty list without a query service or a non-positive cap', async () => {
    await expect(loadTraySessions(undefined, 8)).resolves.toEqual([])
    await expect(loadTraySessions(fakeQuery([], {}), 0)).resolves.toEqual([])
  })

  it('lists top-level titled sessions and skips subagents and untitled rows', async () => {
    const query = fakeQuery([
      { id: 'a', createdAt: 3000 },
      { id: 'b', createdAt: 2000, origin: 'subagent' },
      { id: 'c', createdAt: 1000 },
    ], { a: '会话 A', c: undefined })
    await expect(loadTraySessions(query, 8)).resolves.toEqual([
      { id: 'a', title: '会话 A', createdAt: 3000 },
    ])
  })

  it('caps the row count at the requested maximum', async () => {
    const query = fakeQuery([
      { id: 'a', createdAt: 3000 },
      { id: 'b', createdAt: 2000 },
      { id: 'c', createdAt: 1000 },
    ], { a: 'A', b: 'B', c: 'C' })
    await expect(loadTraySessions(query, 2)).resolves.toHaveLength(2)
  })

  it('fills the cap from older sessions after skipping newer untitled rows', async () => {
    const query = fakeQuery([
      { id: 'a', createdAt: 4000 },
      { id: 'b', createdAt: 3000 },
      { id: 'c', createdAt: 2000 },
      { id: 'd', createdAt: 1000 },
    ], { a: undefined, b: 'B', c: undefined, d: 'D' })
    await expect(loadTraySessions(query, 2)).resolves.toEqual([
      { id: 'b', title: 'B', createdAt: 3000 },
      { id: 'd', title: 'D', createdAt: 1000 },
    ])
  })
})

describe('trayImage', () => {
  it('resizes the icon for the macOS menu bar', () => {
    const image = trayImage('/icon.png', 'darwin') as unknown as { resized?: unknown }
    expect(image.resized).toEqual({ width: 18, height: 18 })
  })

  it('keeps the original icon elsewhere', () => {
    const image = trayImage('/icon.png', 'win32') as unknown as { resized?: unknown }
    expect(image.resized).toBeUndefined()
  })
})

describe('installTray', () => {
  beforeEach(() => {
    trayInstances.length = 0
  })

  it('creates a tray with a tooltip and defaults close-to-tray on without settings', () => {
    const { tray } = installWith({ ctx: ctxWith({}) })
    const instance = trayInstances[0]
    expect(instance).toBeDefined()
    expect(instance?.setToolTip).toHaveBeenCalledWith(APP_NAME)
    expect(tray.closeToTray()).toBe(true)
  })

  it('follows live close-to-tray changes through the desktop settings scope', () => {
    const settings = fakeSettingsScope({ closeToTray: true })
    const { tray } = installWith({ ctx: ctxWith({}), settingsScope: settings.scope })
    expect(tray.closeToTray()).toBe(true)
    settings.setCloseToTray(false)
    expect(tray.closeToTray()).toBe(false)
    settings.setCloseToTray(true)
    expect(tray.closeToTray()).toBe(true)
  })

  it('reads an explicit user close-to-tray override', () => {
    const settings = fakeSettingsScope({ closeToTray: false })
    const { tray } = installWith({ ctx: ctxWith({}), settingsScope: settings.scope })
    expect(tray.closeToTray()).toBe(false)
  })

  it('on win32 shows the window on left click and pops the session menu on right click', async () => {
    const query = fakeQuery([{ id: 's1', createdAt: Date.now() }], { s1: '会话 A' })
    const { tray, win } = installWith({ ctx: ctxWith({ sessionQuery: query }) })
    const instance = trayInstances[0] as MockTrayInstance
    instance.handlers.get('click')?.()
    expect(win.focus).toHaveBeenCalledTimes(1)

    instance.handlers.get('right-click')?.()
    await vi.waitFor(() => {
      expect(instance.popUpContextMenu).toHaveBeenCalledTimes(1)
    })
    const template = (instance.popUpContextMenu.mock.calls[0]?.[0] as { template: unknown[] }).template
    expect(template.some(item => (item as { label?: string }).label === '会话 A')).toBe(true)
    tray.dispose()
  })

  it('falls back to the base menu when the session query rejects', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const query = {
      listSessions: vi.fn(async () => { throw new Error('query unavailable') }),
    } as unknown as SessionQueryEngine
    const { tray } = installWith({ ctx: ctxWith({ sessionQuery: query }) })
    const instance = trayInstances[0] as MockTrayInstance
    instance.handlers.get('right-click')?.()
    await vi.waitFor(() => {
      expect(instance.popUpContextMenu).toHaveBeenCalledTimes(1)
    })
    const template = (instance.popUpContextMenu.mock.calls[0]?.[0] as {
      template: Array<{ label?: string; enabled?: boolean }>
    }).template
    expect(template).toContainEqual(expect.objectContaining({ label: '暂无最近会话', enabled: false }))
    expect(consoleError).toHaveBeenCalledWith(
      'dsh-desktop: tray session list unavailable:',
      expect.any(Error),
    )
    tray.dispose()
  })

  it('wires the updater check into the installed tray menu', async () => {
    const checkUpdates = vi.fn()
    const { tray } = installWith({ ctx: ctxWith({}), checkUpdates })
    const instance = trayInstances[0] as MockTrayInstance
    instance.handlers.get('right-click')?.()
    await vi.waitFor(() => {
      expect(instance.popUpContextMenu).toHaveBeenCalledTimes(1)
    })
    const template = (instance.popUpContextMenu.mock.calls[0]?.[0] as {
      template: Array<{ label?: string; click?: () => void }>
    }).template
    template.find(item => item.label === '检查更新')?.click?.()
    expect(checkUpdates).toHaveBeenCalledTimes(1)
    tray.dispose()
  })

  it('restores a hidden or minimized window when shown', () => {
    const hidden = fakeWindow({ visible: false })
    const quit = vi.fn()
    const tray = installTray({
      ctx: ctxWith({}),
      getWindow: () => hidden as unknown as BrowserWindow,
      quit,
      iconPath: '/build/icon.png',
      platform: 'win32',
    })
    const instance = trayInstances[0] as MockTrayInstance
    instance.handlers.get('click')?.()
    expect(hidden.show).toHaveBeenCalledTimes(1)
    expect(hidden.focus).toHaveBeenCalledTimes(1)

    const minimized = fakeWindow({ minimized: true })
    const tray2 = installTray({
      ctx: ctxWith({}),
      getWindow: () => minimized as unknown as BrowserWindow,
      quit,
      iconPath: '/build/icon.png',
      platform: 'win32',
    })
    const instance2 = trayInstances[1] as MockTrayInstance
    instance2.handlers.get('click')?.()
    expect(minimized.restore).toHaveBeenCalledTimes(1)
    tray.dispose()
    tray2.dispose()
  })

  it('sends open-session and new-session IPC through the popped menu actions', async () => {
    const query = fakeQuery([{ id: 's1', createdAt: Date.now() }], { s1: '会话 A' })
    const { tray, win } = installWith({ ctx: ctxWith({ sessionQuery: query }) })
    const instance = trayInstances[0] as MockTrayInstance
    instance.handlers.get('right-click')?.()
    await vi.waitFor(() => {
      expect(instance.popUpContextMenu).toHaveBeenCalledTimes(1)
    })
    const template = (instance.popUpContextMenu.mock.calls[0]?.[0] as { template: Array<{ label?: string; click?: () => void }> }).template
    const sessionItem = template.find(item => item.label === '会话 A')
    sessionItem?.click?.()
    expect(win.webContents.send).toHaveBeenCalledWith(IPC_CHANNELS.openSession, { sessionId: 's1' })
    expect(win.focus).toHaveBeenCalledTimes(1)

    const newItem = template.find(item => item.label === '新建会话')
    newItem?.click?.()
    expect(win.webContents.send).toHaveBeenCalledWith(IPC_CHANNELS.newSession)
    tray.dispose()
  })

  it('on darwin pops the menu from both click and right-click', async () => {
    const { tray } = installWith({ ctx: ctxWith({}), platform: 'darwin' })
    const instance = trayInstances[0] as MockTrayInstance
    instance.handlers.get('click')?.()
    instance.handlers.get('right-click')?.()
    await vi.waitFor(() => {
      expect(instance.popUpContextMenu).toHaveBeenCalledTimes(2)
    })
    expect(instance.setContextMenu).not.toHaveBeenCalled()
    tray.dispose()
  })

  it('on linux sets the static context menu and refreshes it on click', async () => {
    const query = fakeQuery([{ id: 's1', createdAt: Date.now() }], { s1: '会话 A' })
    const { tray, win } = installWith({ ctx: ctxWith({ sessionQuery: query }), platform: 'linux' })
    const instance = trayInstances[0] as MockTrayInstance
    await vi.waitFor(() => {
      expect(instance.setContextMenu).toHaveBeenCalledTimes(1)
    })
    instance.handlers.get('click')?.()
    expect(win.focus).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => {
      expect(instance.setContextMenu).toHaveBeenCalledTimes(2)
    })
    expect(instance.popUpContextMenu).not.toHaveBeenCalled()
    tray.dispose()
  })

  it('dispose destroys the tray and detaches window listeners', () => {
    const { tray } = installWith({ ctx: ctxWith({}), platform: 'linux' })
    const instance = trayInstances[0] as MockTrayInstance
    tray.dispose()
    expect(instance.destroy).toHaveBeenCalledTimes(1)
  })
})
