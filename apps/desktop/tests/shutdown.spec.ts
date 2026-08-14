/**
 * The desktop shell's bounded shutdown controller (the Electron analogue of
 * the CLI's process shutdown): coalescing normal quit, escalating hard exits.
 */

import { describe, expect, it, vi } from 'vitest'
import { createShutdown } from '../src/shutdown.ts'

describe('createShutdown', () => {
  it('disposes then completes with the requested code', async () => {
    const dispose = vi.fn(async () => {})
    const complete = vi.fn()
    const shutdown = createShutdown(dispose, () => {}, complete, 10_000)
    await shutdown.shutdown(0)
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(complete).toHaveBeenCalledWith(0)
  })

  it('coalesces concurrent shutdown calls into one dispose', async () => {
    let resolveDispose: (() => void) | undefined
    const dispose = vi.fn(() => new Promise<void>((resolve) => { resolveDispose = resolve }))
    const shutdown = createShutdown(dispose, () => {}, () => {}, 10_000)
    const first = shutdown.shutdown(0)
    const second = shutdown.shutdown(0)
    // The disposer starts on a microtask; release it once it is armed.
    await Promise.resolve()
    resolveDispose?.()
    await Promise.all([first, second])
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('force-exits on dispose failure', async () => {
    const forceExit = vi.fn()
    const shutdown = createShutdown(async () => { throw new Error('boom') }, forceExit, () => {}, 10_000)
    await shutdown.shutdown(1)
    expect(forceExit).toHaveBeenCalledWith(1)
  })

  it('escalates a second interrupt to an immediate force exit', async () => {
    const forceExit = vi.fn()
    let release: () => void = () => {}
    const shutdown = createShutdown(
      () => new Promise<void>((resolve) => { release = resolve }),
      forceExit,
      () => {},
      10_000,
    )
    shutdown.interrupt(130)
    expect(forceExit).not.toHaveBeenCalled()
    shutdown.interrupt(130)
    expect(forceExit).toHaveBeenCalledWith(130)
    release()
  })

  it('force-exits after the grace timeout', async () => {
    vi.useFakeTimers()
    try {
      const forceExit = vi.fn()
      const shutdown = createShutdown(() => new Promise<void>(() => {}), forceExit, () => {}, 1_000)
      void shutdown.shutdown(0)
      await vi.advanceTimersByTimeAsync(1_100)
      expect(forceExit).toHaveBeenCalledWith(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
