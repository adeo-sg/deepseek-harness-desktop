/**
 * Boot the harness host tree for the desktop shell: the `desktop` profile
 * composed from the dsh-base, dsh-web-app, and dsh-desktop-app bundles, with
 * the web composition's HTTP carrier swapped for the desktop carrier by the
 * bundle patch. Mirrors the `dsh` CLI's profile boot minus its flag parsing —
 * the desktop app is its own launcher.
 * @module @deepseek-ai/dsh-desktop/host
 */

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import {
  boot,
  composeEntries,
  healProfilesModuleFallback,
  initProfile,
  installFailLoud,
  loadLayeredEnv,
  loadOptionalPatches,
  loadProfile,
  PROFILE_PATCH_FILENAME,
  resolveProfileDir,
} from '@deepseek-ai/dsh-app-boot'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { DSH_LAUNCH_ENVIRONMENT_KEY } from '@deepseek-ai/dsh-launch-environment'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { createShutdown, type Shutdown } from './shutdown.ts'

/** Diagnostic prefix for boot and fail-loud lines. */
const NAME = 'dsh-desktop'

/** The profile name the desktop shell boots. */
export const PROFILE_NAME = 'desktop'

/** Bundle layers of the desktop profile, in application order. */
export const PROFILE_BUNDLES: readonly string[] = [
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-web-app',
  '@deepseek-ai/dsh-desktop-app',
]

/** The root config filename inside a profile directory. */
const PROFILE_ROOT_FILENAME = 'cordis.yml'

/** The empty root entry list every profile tree patches over. */
const PROFILE_ROOT_CONFIG = `# dsh profile root — an empty entry list. The tree is composed as patches:
# each bundle in package.json's dsh.profile.bundles, then cordis.patch.yml, then any
# home-layer patches. Edit cordis.patch.yml, not this file.
[]
`

/** The session-telemetry row id the DSH_TELEMETRY_DISABLED switch targets. */
const TELEMETRY_ROW_ID = 'session-telemetry-otel'

/** Shipped agent-preset root: beside this app's own config, in both source and built layouts. */
const SHIPPED_PRESET_ROOT = fileURLToPath(new URL('../config/agent-presets/', import.meta.url))

/** Absolute path of this app's package.json (both anchors: src/ and lib/ sit one level under apps/desktop). */
const INSTALL_ANCHOR = fileURLToPath(new URL('../package.json', import.meta.url))

/** Options for {@link bootDesktopHost}. */
export interface DesktopHostOptions {
  /** Harness home override (defaults to {@link resolveDshHome}); tests pass a temp dir. */
  home?: string
  /** Working directory whose `.env` is the project layer (defaults to process.cwd()). */
  cwd?: string
  /** Inner arguments handed to the tree through `ctx.cmdlineArgs` (defaults to none). */
  args?: readonly string[]
  /**
   * The installation anchor for the module fallback closure — the app's own
   * package.json. The desktop shell passes `app.getAppPath()/package.json` so
   * dev and packaged runs heal against the same real installation directory.
   */
  installAnchor?: string
}

/** A settled desktop host tree plus its shutdown controller. */
export interface BootedDesktopHost {
  ctx: Context
  shutdown: Shutdown
}

/**
 * Resolve the telemetry opt-out switch into its boot patch. ANY non-empty
 * value (including `'0'`/`'false'`) disables: a privacy switch prefers
 * off-by-mistake over on-by-mistake.
 * @param disabledEnv - the raw `DSH_TELEMETRY_DISABLED` value (`undefined` when unset).
 * @param hasRow - whether the composition carries the telemetry row.
 * @returns the disable patch, or `undefined` when no hard-disable patch is required.
 */
export function resolveTelemetryPatch(disabledEnv: string | undefined, hasRow: boolean): PatchOptions | undefined {
  if ((disabledEnv ?? '') === '' || !hasRow) return undefined
  return { id: TELEMETRY_ROW_ID, disabled: true }
}

/**
 * Boot the desktop profile end to end: initialize the profile directory,
 * heal the module fallback, compose the patch stack (bundles + profile user
 * layer + home layer + telemetry switch), and return the settled tree.
 * @param options - home/cwd/args overrides (tests).
 * @returns the settled root context and the shutdown controller.
 */
export async function bootDesktopHost(options: DesktopHostOptions = {}): Promise<BootedDesktopHost> {
  const home = options.home ?? resolveDshHome()
  const cwd = options.cwd ?? process.cwd()
  const installAnchor = options.installAnchor ?? INSTALL_ANCHOR
  // The frozen environment snapshot, provided before any entry mounts; the
  // layered .env load also materializes unset project/user values.
  const environment = loadLayeredEnv(NAME, cwd)
  const profileDir = resolveProfileDir(PROFILE_NAME, home)
  initProfile(profileDir, PROFILE_BUNDLES)
  healProfilesModuleFallback(installAnchor, home)
  const profile = loadProfile(NAME, PROFILE_NAME, INSTALL_ANCHOR, home)
  const homePatches = loadOptionalPatches(NAME, join(home, PROFILE_PATCH_FILENAME)) ?? []
  const composed = composeEntries([
    ...profile.layers.map(layer => layer.patches),
    profile.patches,
    homePatches,
  ])
  const rows = new Map<string, PatchOptions>()
  for (const entry of composed) {
    if (typeof entry.id === 'string') rows.set(entry.id, entry)
  }
  const telemetryPatch = resolveTelemetryPatch(process.env.DSH_TELEMETRY_DISABLED, rows.has(TELEMETRY_ROW_ID))
  const overlays: PatchOptions[] = telemetryPatch === undefined ? [] : [telemetryPatch]
  // The shipped preset roster is an assembly fact of this app: it sits beside
  // the app's own config (the CLI's shipped root is apps/cli's — this app
  // must carry its own or the web composition's `default: standard` resolves
  // nothing and every session creation fails).
  if (rows.has('agent-presets')) {
    overlays.push({
      id: 'agent-presets',
      config: {
        ...(rows.get('agent-presets')?.config ?? {}) as Record<string, unknown>,
        roots: [{ path: SHIPPED_PRESET_ROOT, trust: 'system' }],
      },
    })
  }
  const patches: PatchOptions[] = [
    ...profile.layers.flatMap(layer => layer.patches),
    ...profile.patches,
    ...homePatches,
    ...overlays,
  ]
  const rootConfig = join(profileDir, PROFILE_ROOT_FILENAME)
  // The root is always rewritten: the whole composition is patch layers, and
  // the vendored Loader's tree write-back could otherwise bake composed rows
  // into this file (duplicating every bundle insert on the next boot).
  writeFileSync(rootConfig, PROFILE_ROOT_CONFIG)

  const app: { current?: Context } = {}
  const shutdown = createShutdown(async () => { await app.current?.fiber.dispose() })
  installFailLoud(NAME, process, async () => { await app.current?.fiber.dispose() })
  const ctx = await boot(NAME, rootConfig, patches, (hostCtx) => {
    app.current = hostCtx
    // Before any config-tree entry mounts, so plugins resolve all launch-time
    // environment values from the same immutable provenance snapshot.
    hostCtx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, environment)
    provideCmdline(hostCtx, {
      args: options.args ?? [],
      exit: code => void shutdown.shutdown(code),
    })
  })
  app.current = ctx
  return { ctx, shutdown }
}
