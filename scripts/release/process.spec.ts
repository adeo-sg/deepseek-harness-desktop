import { describe, expect, it } from 'vitest'
import { attempt, capture } from './process.ts'

describe('release process helpers', () => {
  it('runs package-manager command shims', () => {
    expect(capture('pnpm', ['--version'])).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('returns a failed command result', () => {
    const result = attempt(process.execPath, [
      '-e',
      'process.stderr.write("failed"); process.exit(7)',
    ])

    expect(result).toEqual({ status: 7, stdout: '', stderr: 'failed' })
  })
})
