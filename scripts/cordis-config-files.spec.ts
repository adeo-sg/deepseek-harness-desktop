import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cordisConfigFiles } from './cordis-config-files.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('cordisConfigFiles', () => {
  it('finds Loader YAML without treating translation records as configs', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-cordis-config-files-'))
    roots.push(root)
    for (const directory of [
      '.claude', 'docs', 'examples', 'node_modules/pkg', 'vendor/pkg', 'dist/pkg',
      'apps/desktop/release/win-unpacked', 'apps/desktop/release-20260815',
      'apps/desktop/install-probe-20260815',
    ]) {
      mkdirSync(join(root, directory), { recursive: true })
    }
    for (const file of [
      '.claude/hidden.cordis.yml',
      'docs/cordis-primer.i18n.yaml',
      'examples/agent.cordis.yaml',
      'examples/headless.cordis.yml',
      'node_modules/pkg/hidden.cordis.yml',
      'vendor/pkg/hidden.cordis.yml',
      'dist/pkg/hidden.cordis.yml',
      'apps/desktop/release/win-unpacked/hidden.cordis.yml',
      'apps/desktop/release-20260815/hidden.cordis.yml',
      'apps/desktop/install-probe-20260815/hidden.cordis.yml',
    ]) {
      writeFileSync(join(root, file), '[]\n')
    }

    expect(cordisConfigFiles(root)).toEqual([
      join('examples', 'agent.cordis.yaml'),
      join('examples', 'headless.cordis.yml'),
    ])
  })
})
