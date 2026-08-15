// Packaged-boot smoke probe: boots the host layout of a BUILT desktop app and
// exits 0 on success. Used by the release workflow to verify "install and run
// without extra configuration" on each platform; run against the packaged
// resources/app with a scratch DSH_PROBE_HOME:
//   npx electron scripts/packaged-boot-probe.cjs <app-dir> [--no-sandbox]
//
// The probe covers clean-machine first boot and restart with a plugin installed
// in the shared Web profile. The host tree boots with the carrier + bridge
// services, the packaged frontend dist serves the shell (with the injected
// boot manifest), client-modules serves every advertised plugin bundle, and a
// session-create round trip assembles a real agent from the shipped preset
// roster. The second boot proves that a profile-local bundle and user patch
// reach Electron without persisting the desktop transport in that manifest.
const { app } = require('electron')
const { mkdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const { join, resolve } = require('node:path')

// The app dir may arrive relative to the caller's cwd (the workflow runs the
// probe through pnpm --filter, whose exec cwd is the desktop package); the
// file:// import below requires an absolute path.
const appDir = resolve(process.argv[2])
const home = join(process.env.TEMP ?? '/tmp', 'dsh-packaged-boot-probe')
const resultFile = join(home, 'probe-result.txt')

rmSync(home, { recursive: true, force: true })

app.whenReady().then(async () => {
  const lines = []
  let ok = false
  try {
    const { bootDesktopHost } = await import('file://' + appDir + '/lib/host.js')
    const { ctx, shutdown } = await bootDesktopHost({ home, installAnchor: appDir + '/package.json' })
    // The tree settled; the webServer-shaped carrier and the desktop bridge
    // are the desktop surface's contract.
    const carrier = ctx.get('webServer')
    const hasCarrier = typeof carrier.dispatch === 'function'
    const hasBridge = ctx.get('desktopBridge') !== undefined
    lines.push('carrier: ' + String(hasCarrier) + ', bridge: ' + String(hasBridge))

    // Clean-machine first render: the packaged dist must serve the shell
    // with the boot manifest injected by client-modules' index tap.
    const index = await carrier.dispatch(new Request('http://dsh.internal/index.html'))
    const indexText = await index.text()
    const servesShell = index.status === 200 && indexText.includes('window.__DSH_BOOT__')
    lines.push('shell: ' + String(servesShell) + ' (status ' + index.status + ')')

    // Every client bundle advertised by the installed graph must resolve
    // through client-modules' /plugins route. One representative bundle can
    // pass while another package was omitted from electron-builder's closure.
    const graph = ctx.get('clientModules').graph()
    const cleanClientIds = graph.entries.map(entry => entry.id).sort()
    const bundleResults = await Promise.all(graph.entries.map(async (entry) => {
      const response = await carrier.dispatch(new Request(new URL(entry.url, 'http://dsh.internal')))
      return { id: entry.id, status: response.status }
    }))
    const failedBundles = bundleResults.filter(result => result.status !== 200)
    const servesBundles = bundleResults.length > 0 && failedBundles.length === 0
    lines.push('bundles: ' + String(servesBundles) + ' ('
      + String(bundleResults.length - failedBundles.length) + '/' + String(bundleResults.length) + ')'
      + (failedBundles.length === 0 ? '' : ' ' + JSON.stringify(failedBundles)))
    lines.push('client-ids: ' + JSON.stringify(cleanClientIds))

    // A session-create round trip through the gateway assembles a real agent
    // from the shipped preset roster (the composition defaults to 'standard');
    // the clean-machine first-run path.
    const apiProxy = ctx.get('apiProxy')
    const created = await apiProxy.sessions.create({ rpcId: 'probe', payload: {} })
    const createsSession = created.result?.ok === true
    lines.push('session.create: ' + String(createsSession) + (created.result?.ok === true
      ? ' (' + created.result.value.sessionId + ')'
      : ' ' + JSON.stringify(created.result?.error)))
    await shutdown.shutdown(0)

    // Existing-machine path: a plugin installed into the canonical Web
    // profile, plus that profile's own patch, must reach Electron unchanged.
    // The desktop transport remains a runtime overlay and must not be written
    // into the shared manifest.
    const profileDir = join(home, 'profiles', 'web')
    const packageName = 'packaged-profile-addon'
    const packageDir = join(profileDir, 'node_modules', packageName)
    mkdirSync(packageDir, { recursive: true })
    writeFileSync(join(packageDir, 'package.json'), JSON.stringify({
      name: packageName,
      version: '0.0.0',
      type: 'module',
      exports: {
        import: './index.js',
        require: './index.cjs',
      },
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    }))
    writeFileSync(join(packageDir, 'index.js'), [
      "export const name = 'packaged-profile-addon'",
      'export function apply(ctx, config) {',
      "  ctx.provide('packagedProfileAddon', config.value)",
      '}',
      '',
    ].join('\n'))
    writeFileSync(join(packageDir, 'index.cjs'), [
      'exports.apply = function apply(ctx) {',
      "  ctx.provide('packagedRequireAddon', true)",
      '}',
      '',
    ].join('\n'))
    writeFileSync(join(packageDir, 'cordis.patch.yml'), [
      '- insert:',
      '    - id: packaged-profile-addon',
      `      name: '${packageName}'`,
      '      config:',
      '        value: bundle-default',
      '',
    ].join('\n'))
    const manifestPath = join(profileDir, 'package.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    manifest.dependencies[packageName] = '0.0.0'
    manifest.dsh.profile.bundles.push(packageName)
    writeFileSync(manifestPath, JSON.stringify(manifest, undefined, 2) + '\n')
    writeFileSync(join(profileDir, 'cordis.patch.yml'), [
      '- id: packaged-profile-addon',
      '  config:',
      '    value: web-profile-patch',
      '',
    ].join('\n'))

    const customized = await bootDesktopHost({ home, installAnchor: appDir + '/package.json' })
    const loadsProfilePlugin = customized.ctx.get('packagedProfileAddon') === 'web-profile-patch'
      && customized.ctx.get('packagedRequireAddon') === undefined
    const customizedClientIds = customized.ctx.get('clientModules').graph().entries.map(entry => entry.id).sort()
    const preservesClientGraph = JSON.stringify(customizedClientIds) === JSON.stringify(cleanClientIds)
    const persistedManifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const sharedProfile = !persistedManifest.dsh.profile.bundles.includes('@deepseek-ai/dsh-desktop-app')
    lines.push('profile-plugin: ' + String(loadsProfilePlugin)
      + ', shared-web-profile: ' + String(sharedProfile))
    lines.push('client-graph-stable: ' + String(preservesClientGraph))
    await customized.shutdown.shutdown(0)
    ok = hasCarrier && hasBridge && servesShell && servesBundles && createsSession
      && loadsProfilePlugin && sharedProfile && preservesClientGraph
  } catch (cause) {
    lines.push('BOOT FAILED:')
    let node = cause
    while (node) {
      lines.push('- ' + (node instanceof Error ? node.stack ?? node.message : String(node)))
      if (Array.isArray(node.errors)) for (const e of node.errors) lines.push('- ' + (e instanceof Error ? e.message : String(e)))
      node = node.cause
    }
  }
  // Echo the verdict so CI logs carry it even when the result write fails;
  // the exit code is the smoke verdict either way.
  console.log(lines.join('\n'))
  try {
    // The scratch home may not exist when the boot failed before creating it.
    mkdirSync(home, { recursive: true })
    writeFileSync(resultFile, lines.join('\n'))
  } catch (error) {
    // A lost result file costs only the diagnostic text, already echoed above.
    console.error('probe: failed to write result file: ' + String(error))
  } finally {
    app.exit(ok ? 0 : 1)
  }
})
