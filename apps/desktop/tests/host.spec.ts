/**
 * Desktop host boot: the profile composition (base + web-app + desktop-app)
 * settles with the desktop carrier and bridge services, and the shutdown
 * controller disposes the tree. Requires a built workspace (the Loader
 * imports plugin main entries from lib/) — skipped on a clean tree.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { bootDesktopHost, PROFILE_BUNDLES, PROFILE_NAME, resolveTelemetryPatch } from '../src/host.ts'
import type { DesktopWebServer } from '@deepseek-ai/dsh-host-desktop-carrier'

const WORKSPACE_BUILT = existsSync(fileURLToPath(new URL('../../cli/lib/bin.js', import.meta.url)))
const maybeDescribe = WORKSPACE_BUILT ? describe : describe.skip

let home: string | undefined

afterEach(async () => {
  if (home !== undefined) rmSync(home, { recursive: true, force: true })
  home = undefined
})

function stageHome(): string {
  home = mkdtempSync(join(tmpdir(), 'dsh-desktop-host-'))
  return home
}

maybeDescribe('bootDesktopHost', () => {
  it('boots the desktop profile and provides the carrier and bridge services', async () => {
    const { ctx, shutdown } = await bootDesktopHost({ home: stageHome() })
    try {
      const carrier = ctx.get('webServer') as unknown as DesktopWebServer
      expect(typeof carrier.dispatch).toBe('function')
      expect(ctx.get('desktopBridge')).toBeDefined()
      expect(ctx.get('connection')).toBeDefined()
      // The shipped preset roster is assembled into the agent-presets row, so
      // the web composition's `default: standard` resolves (session creation
      // depends on it) and the discovery root list carries a system root.
      const agentPresets = ctx.get('agentPresets') as { roots: readonly { path: string; trust: string }[] }
      expect(agentPresets.roots.some(root =>
        root.trust === 'system' && root.path.includes('agent-presets'),
      )).toBe(true)
      // The boot manifest rides the carrier's index taps on the real dist.
      const index = await carrier.dispatch(new Request('http://dsh.internal/index.html'))
      expect((await index.text())).toContain('window.__DSH_BOOT__')
    } finally {
      await shutdown.shutdown(0)
    }
  })

  it('initializes the desktop profile directory with the bundle tuple', async () => {
    const { shutdown } = await bootDesktopHost({ home: stageHome() })
    try {
      const manifest = JSON.parse(
        readFileSync(join(home as string, 'profiles', PROFILE_NAME, 'package.json'), 'utf8'),
      ) as { dsh: { profile: { bundles: string[] } } }
      expect(manifest.dsh.profile.bundles).toEqual([...PROFILE_BUNDLES])
    } finally {
      await shutdown.shutdown(0)
    }
  })
})

describe('resolveTelemetryPatch', () => {
  it('disables the telemetry row on ANY non-empty value and no-ops otherwise', () => {
    expect(resolveTelemetryPatch('1', true)).toEqual({ id: 'session-telemetry-otel', disabled: true })
    expect(resolveTelemetryPatch('0', true)).toEqual({ id: 'session-telemetry-otel', disabled: true })
    expect(resolveTelemetryPatch(undefined, true)).toBeUndefined()
    expect(resolveTelemetryPatch('', true)).toBeUndefined()
    expect(resolveTelemetryPatch('1', false)).toBeUndefined()
  })
})
