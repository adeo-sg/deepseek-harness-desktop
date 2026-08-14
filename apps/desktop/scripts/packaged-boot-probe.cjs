// Packaged-boot smoke probe: boots the host layout of a BUILT desktop app and
// exits 0 on success. Used by the release workflow to verify "install and run
// without extra configuration" on each platform; run against the packaged
// resources/app with a scratch DSH_PROBE_HOME:
//   npx electron scripts/packaged-boot-probe.cjs <app-dir> [--no-sandbox]
const { app } = require('electron')
const { writeFileSync, rmSync } = require('node:fs')
const { join } = require('node:path')

const appDir = process.argv[2]
const home = join(process.env.TEMP ?? '/tmp', 'dsh-packaged-boot-probe')
const resultFile = join(home, 'probe-result.txt')

rmSync(home, { recursive: true, force: true })

app.whenReady().then(async () => {
  const lines = []
  let ok = false
  try {
    const { bootDesktopHost } = await import('file://' + appDir + '/lib/host.js')
    const { ctx, shutdown } = await bootDesktopHost({ home, installAnchor: appDir + '/package.json' })
    // The tree settled; a webServer-shaped carrier and the desktop bridge are
    // the desktop surface's contract. Then dispose and finish.
    const hasCarrier = typeof ctx.get('webServer').dispatch === 'function'
    const hasBridge = ctx.get('desktopBridge') !== undefined
    lines.push('carrier: ' + String(hasCarrier) + ', bridge: ' + String(hasBridge))
    ok = hasCarrier && hasBridge
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
