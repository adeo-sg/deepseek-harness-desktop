/**
 * Desktop host boot: the canonical Web profile plus the desktop overlay
 * settles with the desktop carrier and bridge services, and the shutdown
 * controller disposes the tree. Requires a built workspace (the Loader
 * imports plugin main entries from lib/) — skipped on a clean tree.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  initProfile,
  PROFILE_PATCH_FILENAME,
  PROFILE_TEMPLATES,
  readProfileManifest,
  resolveProfileDir,
  writeProfileManifest,
} from '@deepseek-ai/dsh-app-boot'
import {
  bootDesktopHost,
  DESKTOP_OVERLAY_BUNDLE,
  PROFILE_NAME,
  resolveTelemetryPatch,
} from '../src/host.ts'
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
  it('boots the Web profile with the desktop carrier and bridge services', async () => {
    const harnessHome = stageHome()
    const envName = 'DESKTOP_EXPLICIT_HOME_SPEC'
    writeFileSync(join(harnessHome, '.env'), `${envName}=shared-home\n`)
    const { ctx, shutdown } = await bootDesktopHost({ home: harnessHome })
    try {
      const carrier = ctx.get('webServer') as unknown as DesktopWebServer
      expect(typeof carrier.dispatch).toBe('function')
      expect(ctx.get('desktopBridge')).toBeDefined()
      expect(ctx.get('connection')).toBeDefined()
      // Settings and credentials are resolved from the same launcher-owned
      // data root as the desktop profile, matching the npx/web composition.
      const settings = ctx.get('settings') as { documentPath: string }
      expect(settings.documentPath).toBe(join(harnessHome, 'settings.yaml'))
      expect(ctx.launchEnvironment?.get(envName)).toEqual({
        value: 'shared-home',
        source: 'user-env',
        path: join(harnessHome, '.env'),
      })
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
      Reflect.deleteProperty(process.env, envName)
    }
  })

  it('initializes and preserves the canonical Web profile manifest', async () => {
    const { shutdown } = await bootDesktopHost({ home: stageHome() })
    try {
      const manifest = JSON.parse(
        readFileSync(join(home as string, 'profiles', PROFILE_NAME, 'package.json'), 'utf8'),
      ) as { dsh: { profile: { bundles: string[] } } }
      expect(PROFILE_NAME).toBe('web')
      expect(manifest.dsh.profile.bundles).toEqual([...PROFILE_TEMPLATES.web ?? []])
      expect(manifest.dsh.profile.bundles).not.toContain(DESKTOP_OVERLAY_BUNDLE)
    } finally {
      await shutdown.shutdown(0)
    }
  })

  it('loads profile-installed plugins and the same Web profile patch without persisting the desktop overlay', async () => {
    const harnessHome = stageHome()
    const profileDir = resolveProfileDir('web', harnessHome)
    initProfile(profileDir, PROFILE_TEMPLATES.web ?? [])
    const packageName = 'profile-addon'
    const packageDir = join(profileDir, 'node_modules', packageName)
    mkdirSync(packageDir, { recursive: true })
    writeFileSync(join(packageDir, 'package.json'), JSON.stringify({
      name: packageName,
      version: '0.0.0',
      type: 'module',
      main: './index.js',
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    }))
    writeFileSync(join(packageDir, 'index.js'), [
      "export const name = 'profile-addon'",
      'export function apply(ctx, config) {',
      "  ctx.provide('profileAddonProof', config.value)",
      '}',
      '',
    ].join('\n'))
    writeFileSync(join(packageDir, 'cordis.patch.yml'), [
      '- insert:',
      '    - id: profile-addon',
      `      name: '${packageName}'`,
      '      config:',
      '        value: bundle-default',
      '',
    ].join('\n'))
    const manifest = readProfileManifest('test', profileDir)
    writeProfileManifest(profileDir, {
      ...manifest,
      dependencies: { ...manifest.dependencies, [packageName]: '0.0.0' },
      dsh: {
        ...manifest.dsh,
        profile: {
          ...manifest.dsh?.profile,
          bundles: [...manifest.dsh?.profile?.bundles ?? [], packageName],
        },
      },
    })
    writeFileSync(join(profileDir, PROFILE_PATCH_FILENAME), [
      '- id: profile-addon',
      '  config:',
      '    value: web-profile-patch',
      '',
    ].join('\n'))

    const { ctx, shutdown } = await bootDesktopHost({ home: harnessHome })
    try {
      expect(ctx.get('profileAddonProof')).toBe('web-profile-patch')
      expect(readProfileManifest('test', profileDir).dsh?.profile?.bundles).toEqual([
        ...PROFILE_TEMPLATES.web ?? [],
        packageName,
      ])
    } finally {
      await shutdown.shutdown(0)
    }
  })
})

describe('resolveTelemetryPatch', () => {
  it('keeps the desktop overlay outside the canonical Web profile template', () => {
    expect(PROFILE_NAME).toBe('web')
    expect(DESKTOP_OVERLAY_BUNDLE).toBe('@deepseek-ai/dsh-desktop-app')
    expect(PROFILE_TEMPLATES.web).not.toContain(DESKTOP_OVERLAY_BUNDLE)
  })

  it('disables the telemetry row on ANY non-empty value and no-ops otherwise', () => {
    expect(resolveTelemetryPatch('1', true)).toEqual({ id: 'session-telemetry-otel', disabled: true })
    expect(resolveTelemetryPatch('0', true)).toEqual({ id: 'session-telemetry-otel', disabled: true })
    expect(resolveTelemetryPatch(undefined, true)).toBeUndefined()
    expect(resolveTelemetryPatch('', true)).toBeUndefined()
    expect(resolveTelemetryPatch('1', false)).toBeUndefined()
  })
})
