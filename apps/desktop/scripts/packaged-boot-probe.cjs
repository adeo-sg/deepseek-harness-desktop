// Packaged-boot smoke probe: boots the host layout of a BUILT desktop app and
// exits 0 on success. Used by the release workflow to verify "install and run
// without extra configuration" on each platform; run against the packaged
// resources/app with a scratch DSH_PROBE_HOME:
//   npx electron scripts/packaged-boot-probe.cjs <app-dir> [--no-sandbox]
//
// The probe covers the clean-machine first-run contract end to end: the host
// tree boots with the carrier + bridge services, the packaged frontend dist
// serves the shell (with the injected boot manifest), client-modules serves a
// plugin bundle from the installed packages, and a session-create round trip
// through the gateway assembles a real agent from the SHIPPED preset roster —
// the first-run path that previously failed with UnknownPresetError when no
// system-trusted preset root shipped.
const { app } = require('electron')
const { writeFileSync, rmSync } = require('node:fs')
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

    // One client bundle must resolve from the installed packages through
    // client-modules' /plugins route (the renderer fetches these at boot).
    const bundle = await carrier.dispatch(new Request('http://dsh.internal/plugins/@deepseek-ai/dsh-client-ui-layout/client.js'))
    const servesBundle = bundle.status === 200
    lines.push('bundle: ' + String(servesBundle) + ' (status ' + bundle.status + ')')

    // A session-create round trip through the gateway assembles a real agent
    // from the shipped preset roster (the composition defaults to 'standard');
    // the clean-machine first-run path.
    const apiProxy = ctx.get('apiProxy')
    const created = await apiProxy.sessions.create({ rpcId: 'probe', payload: {} })
    const createsSession = created.result?.ok === true
    lines.push('session.create: ' + String(createsSession) + (created.result?.ok === true
      ? ' (' + created.result.value.sessionId + ')'
      : ' ' + JSON.stringify(created.result?.error)))
    ok = hasCarrier && hasBridge && servesShell && servesBundle && createsSession
    await shutdown.shutdown(0)
  } catch (cause) {
    lines.push('BOOT FAILED:')
    let node = cause
    while (node) {
      if (Array.isArray(node.errors)) for (const e of node.errors) lines.push('- ' + (e instanceof Error ? e.message : String(e)))
      node = node.cause
    }
    if (lines.length === 1) lines.push(String(cause))
  }
  writeFileSync(resultFile, lines.join('\n'))
  app.exit(ok ? 0 : 1)
})
