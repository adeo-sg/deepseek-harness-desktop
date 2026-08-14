import { defineConfig } from 'tsdown'

/**
 * The desktop app's own bundle: the ESM main-process half (emitted beside the
 * preload in one `lib/` dir) and the CJS preload artifact — sandboxed preload
 * scripts cannot use ESM, so the preload is the single CJS file Electron loads
 * from `webPreferences.preload`.
 */
export default defineConfig([
  {
    name: 'dsh-desktop',
    entry: 'lib/types/{main,host,ipc,protocol,shutdown,bridge-types}.js',
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    external: ['electron'],
  },
  {
    name: 'dsh-desktop-preload',
    entry: { preload: 'lib/types/preload/index.js' },
    outDir: 'lib',
    format: ['cjs'],
    platform: 'node',
    target: 'es2024',
    dts: false,
    clean: false,
    external: ['electron'],
    outputOptions: {
      entryFileNames: 'preload.cjs',
    },
  },
])
