/**
 * Real-process spawn plumbing: the dialog child must run as plain Node even
 * when the host is the Electron desktop shell — `process.execPath` is the
 * Electron binary there, so the worker is opted into ELECTRON_RUN_AS_NODE —
 * and must carry the IPC channel, the hidden window, and the dialog title.
 */

import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn(() => new EventEmitter()) }))
vi.mock('node:child_process', () => ({ spawn: spawnMock }))

import { spawnDialogWorker } from '../src/win32-dialog-host.ts'

interface SpawnOptions {
  env: NodeJS.ProcessEnv
  stdio: unknown[]
  windowsHide: boolean
}

afterEach(() => {
  spawnMock.mockClear()
})

describe('spawnDialogWorker', () => {
  it('spawns the worker as plain node with the IPC channel, hidden window, and dialog title', () => {
    spawnDialogWorker({ title: 'Choose a folder' })
    expect(spawnMock).toHaveBeenCalledTimes(1)
    const [execPath, args, options] = spawnMock.mock.calls[0] as unknown as [string, string[], SpawnOptions]
    expect(execPath).toBe(process.execPath)
    // The source-plane launch bootstraps tsx; the bundled arm loads worker.cjs.
    expect(args.join(' ')).toContain('win32-dialog-worker')
    expect(options.env.DSH_DIALOG_TITLE).toBe('Choose a folder')
    // The Electron desktop shell must run the worker as plain Node, or it
    // boots as an Electron app and exits before reporting.
    expect(options.env.ELECTRON_RUN_AS_NODE).toBe('1')
    expect(options.stdio).toContain('ipc')
    expect(options.windowsHide).toBe(true)
  })
})
