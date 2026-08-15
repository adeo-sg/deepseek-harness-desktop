/** The patched electron-updater GitHub provider against a real Atom feed document. */

import { createRequire } from 'node:module'
import type { RequestOptions } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import type { AppUpdater } from 'electron-updater'
import { GitHubProvider } from 'electron-updater/out/providers/GitHubProvider.js'
import type { ProviderRuntimeOptions } from 'electron-updater/out/providers/Provider.js'

const require = createRequire(import.meta.url)
const requireFromUpdater = createRequire(require.resolve('electron-updater/package.json'))
const semver = requireFromUpdater('semver') as { parse(version: string): object | null }
const { HttpError } = requireFromUpdater('builder-util-runtime') as {
  HttpError: new (statusCode: number, message?: string) => Error
}

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>foreign product</title>
    <link href="https://github.com/sdkwork-ai/deepseek-harness-desktop/releases/tag/desktop-v0.1.0-rc.99"/>
    <content type="html">foreign notes</content>
  </entry>
  <entry>
    <title>dsh rc 11</title>
    <link href="https://github.com/sdkwork-ai/deepseek-harness-desktop/releases/tag/dsh-v0.1.0-rc.11"/>
    <content type="html">rc 11 notes</content>
  </entry>
  <entry>
    <title>dsh rc 10</title>
    <link href="https://github.com/sdkwork-ai/deepseek-harness-desktop/releases/tag/v0.1.0-rc.10"/>
    <content type="html">rc 10 notes</content>
  </entry>
  <entry>
    <title>dsh rc 9</title>
    <link href="https://github.com/sdkwork-ai/deepseek-harness-desktop/releases/tag/dsh-v0.1.0-rc.9"/>
    <content type="html">rc 9 notes</content>
  </entry>
</feed>`

const UPDATE_METADATA = `version: 0.1.0-rc.11
files:
  - url: DeepSeek-Harness-0.1.0-rc.11-win-x64.exe
    sha512: AA==
path: DeepSeek-Harness-0.1.0-rc.11-win-x64.exe
sha512: AA==
releaseDate: '2026-08-15T00:00:00.000Z'
`

describe('patched electron-updater GitHubProvider', () => {
  it('selects dsh-v prereleases while retaining the raw tag in release download URLs', async () => {
    const currentVersion = semver.parse('0.1.0-rc.9')
    if (currentVersion === null) throw new Error('test setup: current version is not valid semver')

    const requestedPaths: string[] = []
    const request = vi.fn(async (options: RequestOptions): Promise<string> => {
      const path = options.path ?? ''
      requestedPaths.push(path)
      if (path.endsWith('/releases.atom')) return FEED
      if (path.endsWith('/download/dsh-v0.1.0-rc.11/rc.yml')) {
        throw new HttpError(404)
      }
      if (path.endsWith('/download/dsh-v0.1.0-rc.11/latest.yml')) return UPDATE_METADATA
      throw new Error(`unexpected provider request ${path}`)
    })
    const provider = new GitHubProvider(
      { provider: 'github', owner: 'sdkwork-ai', repo: 'deepseek-harness-desktop' },
      {
        allowPrerelease: true,
        channel: null,
        currentVersion,
        fullChangelog: true,
      } as unknown as AppUpdater,
      {
        isUseMultipleRangeRequest: false,
        platform: 'win32',
        executor: { request } as unknown as ProviderRuntimeOptions['executor'],
      },
    )

    const info = await provider.getLatestVersion()

    expect(requestedPaths).toEqual([
      '/sdkwork-ai/deepseek-harness-desktop/releases.atom',
      '/sdkwork-ai/deepseek-harness-desktop/releases/download/dsh-v0.1.0-rc.11/rc.yml',
      '/sdkwork-ai/deepseek-harness-desktop/releases/download/dsh-v0.1.0-rc.11/latest.yml',
    ])
    expect(info).toMatchObject({
      tag: 'dsh-v0.1.0-rc.11',
      version: '0.1.0-rc.11',
      releaseName: 'dsh rc 11',
      releaseNotes: [
        { version: '0.1.0-rc.11', note: 'rc 11 notes' },
        { version: '0.1.0-rc.10', note: 'rc 10 notes' },
      ],
    })
    expect(provider.resolveFiles(info)[0]?.url.href).toBe(
      'https://github.com/sdkwork-ai/deepseek-harness-desktop/releases/download/dsh-v0.1.0-rc.11/DeepSeek-Harness-0.1.0-rc.11-win-x64.exe',
    )
  })
})
