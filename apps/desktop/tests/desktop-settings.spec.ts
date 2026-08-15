/**
 * Desktop settings: the shared schema resolving the shell preferences, and the
 * single namespace registration against the host settings service.
 */

import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { SettingsProvider } from '@deepseek-ai/dsh-settings'
import {
  DesktopSettingsSchema,
  registerDesktopSettings,
} from '../src/desktop-settings.ts'

describe('DesktopSettingsSchema', () => {
  it('resolves the shell defaults: close-to-tray and auto-check on, follow channel, no auto-download', () => {
    // The settings service calls the schema over merged layers with `as never`;
    // absent fields resolve their schema defaults, exactly as here.
    expect(DesktopSettingsSchema({} as never)).toEqual({
      closeToTray: true,
      autoCheckUpdates: true,
      updateChannel: 'follow',
      autoDownload: false,
    })
  })

  it('accepts explicit overrides', () => {
    expect(DesktopSettingsSchema({
      closeToTray: false,
      autoCheckUpdates: false,
      updateChannel: 'rc',
      autoDownload: true,
    })).toEqual({
      closeToTray: false,
      autoCheckUpdates: false,
      updateChannel: 'rc',
      autoDownload: true,
    })
  })

  it('rejects an unknown update channel', () => {
    expect(() => DesktopSettingsSchema({ updateChannel: 'nightly' } as never)).toThrow()
  })
})

describe('registerDesktopSettings', () => {
  it('registers the desktop namespace once and returns the owner scope', () => {
    const scope = { get: vi.fn() }
    const register = vi.fn(() => scope)
    const settings = { register } as unknown as SettingsProvider
    const ctx = { get: (key: string) => key === 'settings' ? settings : undefined } as unknown as Context
    expect(registerDesktopSettings(ctx)).toBe(scope)
    expect(register).toHaveBeenCalledWith('desktop', DesktopSettingsSchema, { applies: 'live' })
  })

  it('returns undefined without a settings service', () => {
    const ctx = { get: () => undefined } as unknown as Context
    expect(registerDesktopSettings(ctx)).toBeUndefined()
  })
})
