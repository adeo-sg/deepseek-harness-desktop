/**
 * Auto-update controller: the state machine over the driver events, the
 * desktop-settings wiring (auto-check, channel, auto-download), the quiet
 * check scheduling, the window push, and the Phase A release-page fallback.
 */

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { BrowserWindow } from 'electron'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import type { DesktopUpdateState } from '../src/bridge-types.ts'
import type { DesktopSettings, UpdateChannel } from '../src/desktop-settings.ts'
import {
  installUpdater,
  isPrereleaseVersion,
  resolveAllowPrerelease,
  type InstallUpdaterOptions,
  type UpdateDriver,
  type UpdateProgressInfo,
  type UpdateReleaseInfo,
} from '../src/update.ts'

/** The mocked shell surface the spec asserts against (hoisted for vi.mock). */
const shellMocks = vi.hoisted(() => ({ openExternal: vi.fn(async () => {}) }))

vi.mock('electron', () => ({
  shell: shellMocks,
}))

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** The full resolved desktop settings the fake scope serves. */
const SETTINGS: DesktopSettings = {
  closeToTray: true,
  autoCheckUpdates: true,
  updateChannel: 'follow',
  autoDownload: false,
}

/** A fake window whose pushed update states are recorded. */
function fakeWindow(): {
  webContents: { send: Mock<(channel: string, payload?: unknown) => void> }
  isDestroyed: Mock<() => boolean>
  destroy: () => void
} {
  const state: { destroyed: boolean } = { destroyed: false }
  return {
    webContents: { send: vi.fn() },
    isDestroyed: vi.fn(() => state.destroyed),
    destroy: () => { state.destroyed = true },
  }
}

/** A controllable fake driver recording listener registrations. */
function fakeDriver(): {
  driver: UpdateDriver
  emit: (event: string, payload?: unknown) => void
  listeners: Map<string, Set<(...args: unknown[]) => void>>
  checkForUpdates: Mock<() => Promise<unknown>>
  downloadUpdate: Mock<() => Promise<unknown>>
  quitAndInstall: Mock<() => void>
  readonly allowPrerelease: boolean
  readonly autoDownload: boolean
  readonly autoInstallOnAppQuit: boolean
} {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>()
  const checkForUpdates = vi.fn(async () => null)
  const downloadUpdate = vi.fn(async () => [])
  const quitAndInstall = vi.fn()
  const driver = {
    allowPrerelease: false,
    autoDownload: true,
    autoInstallOnAppQuit: true,
    on: (event: string, listener: (...args: unknown[]) => void) => {
      const set = listeners.get(event) ?? new Set()
      set.add(listener)
      listeners.set(event, set)
    },
    off: (event: string, listener: (...args: unknown[]) => void) => {
      listeners.get(event)?.delete(listener)
    },
    checkForUpdates,
    downloadUpdate,
    quitAndInstall,
  } as unknown as UpdateDriver
  return {
    driver,
    listeners,
    emit: (event, payload) => {
      for (const listener of listeners.get(event) ?? []) listener(payload)
    },
    checkForUpdates,
    downloadUpdate,
    quitAndInstall,
    get allowPrerelease(): boolean { return driver.allowPrerelease },
    get autoDownload(): boolean { return driver.autoDownload },
    get autoInstallOnAppQuit(): boolean { return driver.autoInstallOnAppQuit },
  }
}

/** A fake desktop settings scope carrying one full resolved section. */
function fakeSettingsScope(initial: Partial<DesktopSettings> = {}): {
  scope: SettingsScope<DesktopSettings>
  apply: (next: Partial<DesktopSettings>) => void
} {
  let current = { ...SETTINGS, ...initial }
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
    apply: (next) => {
      const previous = current
      current = { ...current, ...next }
      void watcher?.({ ...current }, previous)
    },
  }
}

/** Install the updater with a fake driver, window, and scope. */
function installWith(over: Partial<InstallUpdaterOptions> = {}): {
  updater: ReturnType<typeof installUpdater>
  driver: ReturnType<typeof fakeDriver>
  win: ReturnType<typeof fakeWindow>
  settings: ReturnType<typeof fakeSettingsScope>
} {
  const driver = fakeDriver()
  const win = fakeWindow()
  const settings = fakeSettingsScope()
  const updater = installUpdater({
    settingsScope: settings.scope,
    getWindow: () => win as unknown as BrowserWindow,
    currentVersion: '0.1.0-rc.9',
    isPackaged: true,
    driver: driver.driver,
    initialCheckDelayMs: 1000,
    checkIntervalMs: 2000,
    ...over,
  })
  return { updater, driver, win, settings }
}

/** The last state the window received, or undefined when none was pushed. */
function lastPushed(win: ReturnType<typeof fakeWindow>): DesktopUpdateState | undefined {
  const calls = win.webContents.send.mock.calls
  return calls[calls.length - 1]?.[1] as DesktopUpdateState | undefined
}

const INFO: UpdateReleaseInfo = {
  version: '0.1.0-rc.10',
  releaseName: 'dsh 0.1.0-rc.10',
  releaseNotes: '- bug fixes',
}
const PROGRESS: UpdateProgressInfo = {
  percent: 42, transferred: 42_000, total: 100_000, bytesPerSecond: 10_000,
}

describe('isPrereleaseVersion', () => {
  it('accepts prerelease segments and rejects stable and build-only versions', () => {
    expect(isPrereleaseVersion('0.1.0-rc.9')).toBe(true)
    expect(isPrereleaseVersion('0.1.0-rc.9+build.5')).toBe(true)
    expect(isPrereleaseVersion('0.1.0')).toBe(false)
    expect(isPrereleaseVersion('0.1.0+build.5')).toBe(false)
  })
})

describe('resolveAllowPrerelease', () => {
  it('follows the installed channel, and stable/rc override it', () => {
    expect(resolveAllowPrerelease('follow' satisfies UpdateChannel, '0.1.0-rc.9')).toBe(true)
    expect(resolveAllowPrerelease('follow', '0.1.0')).toBe(false)
    expect(resolveAllowPrerelease('stable', '0.1.0-rc.9')).toBe(false)
    expect(resolveAllowPrerelease('rc', '0.1.0')).toBe(true)
  })
})

describe('installUpdater', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('stays disabled in dev and refuses every action', async () => {
    const driver = fakeDriver()
    const win = fakeWindow()
    const updater = installUpdater({
      getWindow: () => win as unknown as BrowserWindow,
      currentVersion: '0.1.0-rc.9',
      isPackaged: false,
      driver: driver.driver,
    })
    expect(updater.getState().phase).toBe('disabled')
    await updater.checkNow()
    await updater.download()
    updater.install()
    expect(driver.checkForUpdates).not.toHaveBeenCalled()
    expect(driver.downloadUpdate).not.toHaveBeenCalled()
    expect(driver.quitAndInstall).not.toHaveBeenCalled()
    updater.dispose()
  })

  it('schedules the initial and periodic quiet checks when auto-check is on', async () => {
    const { updater, driver, win } = installWith()
    await vi.advanceTimersByTimeAsync(1000)
    expect(driver.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(lastPushed(win)?.phase).toBe('checking')
    // Settle the first check so the interval tick is not skipped as in-flight.
    driver.emit('update-not-available')
    await vi.advanceTimersByTimeAsync(2000)
    expect(driver.checkForUpdates).toHaveBeenCalledTimes(2)
    updater.dispose()
  })

  it('skips the scheduled checks when auto-check is off', async () => {
    const settings = fakeSettingsScope({ autoCheckUpdates: false })
    const { updater, driver } = installWith({ settingsScope: settings.scope })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(driver.checkForUpdates).not.toHaveBeenCalled()
    updater.dispose()
  })

  it('ignores a manual check while one is in flight', async () => {
    const { updater, driver } = installWith()
    let resolveCheck: (() => void) | undefined
    ;(driver.checkForUpdates as Mock).mockImplementationOnce(() =>
      new Promise<void>((resolve) => { resolveCheck = resolve }))
    const first = updater.checkNow()
    await vi.waitFor(() => {
      expect(driver.checkForUpdates).toHaveBeenCalledTimes(1)
    })
    void updater.checkNow()
    await Promise.resolve()
    expect(driver.checkForUpdates).toHaveBeenCalledTimes(1)
    resolveCheck?.()
    await first
    updater.dispose()
  })

  it('does not replace an offered, downloaded, or installing update with another check', async () => {
    const { updater, driver } = installWith()
    await updater.checkNow()
    driver.emit('update-available', INFO)
    await updater.checkNow()
    expect(driver.checkForUpdates).toHaveBeenCalledTimes(1)
    driver.emit('update-downloaded', INFO)
    await updater.checkNow()
    expect(driver.checkForUpdates).toHaveBeenCalledTimes(1)
    updater.install()
    await updater.checkNow()
    expect(driver.checkForUpdates).toHaveBeenCalledTimes(1)
    updater.dispose()
  })

  it('offers an available update and pushes the release metadata', async () => {
    const { updater, driver, win } = installWith()
    await updater.checkNow()
    driver.emit('update-available', INFO)
    expect(updater.getState()).toEqual({
      phase: 'available',
      canInstall: true,
      version: INFO.version,
      releaseName: INFO.releaseName,
      releaseNotes: INFO.releaseNotes,
    })
    expect(lastPushed(win)).toEqual(updater.getState())
    updater.dispose()
  })

  it('auto-downloads when the preference is on', async () => {
    const settings = fakeSettingsScope({ autoDownload: true })
    const { updater, driver } = installWith({ settingsScope: settings.scope })
    await updater.checkNow()
    driver.emit('update-available', INFO)
    await Promise.resolve()
    expect(driver.downloadUpdate).toHaveBeenCalledTimes(1)
    updater.dispose()
  })

  it('keeps checks enabled but blocks installer actions when handoff is unavailable', async () => {
    const settings = fakeSettingsScope({ autoDownload: true })
    const { updater, driver } = installWith({ settingsScope: settings.scope, canInstall: false })
    await vi.advanceTimersByTimeAsync(1000)
    expect(driver.checkForUpdates).toHaveBeenCalledTimes(1)
    driver.emit('update-not-available')
    await updater.checkNow()
    expect(driver.checkForUpdates).toHaveBeenCalledTimes(2)
    driver.emit('update-available', INFO)
    await Promise.resolve()
    expect(updater.getState()).toMatchObject({ phase: 'available', canInstall: false, version: INFO.version })
    expect(driver.downloadUpdate).not.toHaveBeenCalled()
    await updater.download()
    expect(driver.downloadUpdate).not.toHaveBeenCalled()
    driver.emit('update-downloaded', INFO)
    updater.install()
    expect(driver.quitAndInstall).not.toHaveBeenCalled()
    updater.dispose()
  })

  it('tracks download progress and completion', async () => {
    const { updater, driver, win } = installWith()
    await updater.checkNow()
    driver.emit('update-available', INFO)
    void updater.download()
    driver.emit('download-progress', PROGRESS)
    expect(updater.getState()).toMatchObject({ phase: 'downloading', version: INFO.version, progress: PROGRESS })
    driver.emit('update-downloaded', INFO)
    expect(updater.getState()).toMatchObject({ phase: 'downloaded', version: INFO.version })
    expect(lastPushed(win)?.phase).toBe('downloaded')
    updater.dispose()
  })

  it('enters the downloading phase before awaiting the driver', async () => {
    const { updater, driver } = installWith()
    await updater.checkNow()
    driver.emit('update-available', INFO)
    const first = updater.download()
    const second = updater.download()
    expect(updater.getState()).toMatchObject({ phase: 'downloading', version: INFO.version })
    await Promise.all([first, second])
    expect(driver.downloadUpdate).toHaveBeenCalledTimes(1)
    updater.dispose()
  })

  it('ignores download and install unless the phase allows them', async () => {
    const { updater, driver } = installWith()
    await updater.download()
    updater.install()
    expect(driver.downloadUpdate).not.toHaveBeenCalled()
    expect(driver.quitAndInstall).not.toHaveBeenCalled()
    updater.dispose()
  })

  it('quits into the installer from the downloaded phase', async () => {
    const { updater, driver } = installWith()
    await updater.checkNow()
    driver.emit('update-available', INFO)
    driver.emit('update-downloaded', INFO)
    updater.install()
    await vi.waitFor(() => {
      expect(driver.quitAndInstall).toHaveBeenCalledTimes(1)
    })
    expect(updater.getState().phase).toBe('installing')
    updater.dispose()
  })

  it('keeps the installer entry available when quit-and-install throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { updater, driver } = installWith()
    await updater.checkNow()
    driver.emit('update-available', INFO)
    driver.emit('update-downloaded', INFO)
    driver.quitAndInstall.mockImplementationOnce(() => { throw new Error('installer launch failed') })
    updater.install()
    await vi.waitFor(() => {
      expect(updater.getState()).toMatchObject({
        phase: 'downloaded',
        version: INFO.version,
        error: 'installer launch failed',
      })
    })
    expect(consoleError).toHaveBeenCalledWith(
      'dsh-desktop: update install unavailable:',
      expect.any(Error),
    )
    updater.dispose()
  })

  it('returns to idle with an error when a check fails without an offer', async () => {
    const { updater, driver } = installWith()
    await updater.checkNow()
    driver.emit('error', new Error('network down'))
    expect(updater.getState()).toEqual({ phase: 'idle', canInstall: true, error: 'network down' })
    updater.dispose()
  })

  it('returns to the offer with an error when a download fails', async () => {
    const { updater, driver } = installWith()
    await updater.checkNow()
    driver.emit('update-available', INFO)
    void updater.download()
    driver.emit('error', new Error('signature mismatch'))
    expect(updater.getState()).toEqual({
      phase: 'available',
      canInstall: true,
      version: INFO.version,
      releaseName: INFO.releaseName,
      releaseNotes: INFO.releaseNotes,
      error: 'signature mismatch',
    })
    updater.dispose()
  })

  it('contains a rejected check promise (driver-init failures)', async () => {
    const { updater, driver } = installWith()
    ;(driver.checkForUpdates as Mock).mockRejectedValueOnce(new Error('init failed'))
    await updater.checkNow()
    expect(updater.getState()).toEqual({ phase: 'idle', canInstall: true, error: 'init failed' })
    updater.dispose()
  })

  it('resolves the follow channel from the installed version at driver init', async () => {
    const { updater, driver } = installWith({ currentVersion: '0.1.0-rc.9' })
    await updater.checkNow()
    expect(driver.allowPrerelease).toBe(true)
    expect(driver.autoDownload).toBe(false)
    expect(driver.autoInstallOnAppQuit).toBe(false)
    updater.dispose()
  })

  it('follows channel changes live', async () => {
    const { updater, driver, settings } = installWith()
    await updater.checkNow()
    expect(driver.allowPrerelease).toBe(true)
    settings.apply({ updateChannel: 'stable' })
    await Promise.resolve()
    expect(driver.allowPrerelease).toBe(false)
    settings.apply({ updateChannel: 'rc' })
    await Promise.resolve()
    expect(driver.allowPrerelease).toBe(true)
    updater.dispose()
  })

  it('stops and restarts the scheduled checks with the auto-check switch', async () => {
    const { updater, driver, settings } = installWith()
    settings.apply({ autoCheckUpdates: false })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(driver.checkForUpdates).not.toHaveBeenCalled()
    settings.apply({ autoCheckUpdates: true })
    await vi.advanceTimersByTimeAsync(1000)
    expect(driver.checkForUpdates).toHaveBeenCalledTimes(1)
    updater.dispose()
  })

  it('opens the release page in the default browser', async () => {
    const { updater } = installWith({ releasePageUrl: 'https://example.invalid/releases' })
    updater.openReleasePage()
    await vi.waitFor(() => {
      expect(shellMocks.openExternal).toHaveBeenCalledWith('https://example.invalid/releases')
    })
    updater.dispose()
  })

  it('dispose stops the timers, detaches the watcher, and detaches the driver listeners', async () => {
    const { updater, driver, settings } = installWith()
    await updater.checkNow()
    driver.emit('update-not-available')
    updater.dispose()
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(driver.checkForUpdates).toHaveBeenCalledTimes(1)
    settings.apply({ autoCheckUpdates: true })
    // No watcher remains: the timers stay off and no channel flips arrive.
    expect(updater.getState().phase).toBe('idle')
    expect(driver.listeners.get('update-available')?.size ?? 0).toBe(0)
    expect(driver.listeners.get('error')?.size ?? 0).toBe(0)
  })

  it('does not push to a destroyed window', async () => {
    const { updater, driver, win } = installWith()
    win.destroy()
    await updater.checkNow()
    driver.emit('update-available', INFO)
    expect(win.webContents.send).not.toHaveBeenCalled()
    expect(updater.getState().phase).toBe('available')
    updater.dispose()
  })

  it('defaults to the GitHub release page and the follow channel without settings', async () => {
    const driver = fakeDriver()
    const win = fakeWindow()
    const updater = installUpdater({
      getWindow: () => win as unknown as BrowserWindow,
      currentVersion: '0.1.0-rc.9',
      isPackaged: true,
      driver: driver.driver,
      initialCheckDelayMs: 1000,
      checkIntervalMs: 2000,
    })
    updater.openReleasePage()
    await vi.waitFor(() => {
      expect(shellMocks.openExternal).toHaveBeenCalledWith(expect.stringContaining('github.com'))
    })
    expect(updater.getState().phase).toBe('idle')
    updater.dispose()
  })
})
