/** Deterministic failure and concurrency coverage for the config-only watcher. */

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'

type Listener = (...args: unknown[]) => void

interface MockWatcher {
  close: ReturnType<typeof vi.fn<() => Promise<void>>>
  emit: (event: string, ...args: unknown[]) => void
  on: (event: string, listener: Listener) => MockWatcher
  once: (event: string, listener: Listener) => MockWatcher
}

const fakeChokidar = vi.hoisted(() => ({
  initialError: undefined as Error | undefined,
  watchers: [] as MockWatcher[],
}))

vi.mock('chokidar', () => ({
  watch: vi.fn(() => {
    const listeners = new Map<string, Set<Listener>>()
    const watcher: MockWatcher = {
      close: vi.fn(async () => {}),
      emit(event, ...args) {
        for (const listener of [...listeners.get(event) ?? []]) listener(...args)
      },
      on(event, listener) {
        const eventListeners = listeners.get(event) ?? new Set<Listener>()
        eventListeners.add(listener)
        listeners.set(event, eventListeners)
        return watcher
      },
      once(event, listener) {
        const wrapper: Listener = (...args) => {
          listeners.get(event)?.delete(wrapper)
          listener(...args)
        }
        return watcher.on(event, wrapper)
      },
    }
    fakeChokidar.watchers.push(watcher)
    queueMicrotask(() => {
      if (fakeChokidar.initialError === undefined) watcher.emit('ready')
      else watcher.emit('error', fakeChokidar.initialError)
    })
    return watcher
  }),
}))

const { boot, PROFILE_PATCH_FILENAME, watchUserPatches } = await import('../src/index.ts')

const NAME = 'dsh-fallback-watch-test'

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'dsh-fallback-watch-'))
}

function writeTree(dir: string): string {
  writeFileSync(join(dir, 'noop.mjs'), 'export function apply() {}\n')
  writeFileSync(join(dir, 'cordis.yml'), '- id: noop\n  name: ./noop.mjs\n  config:\n    value: base\n')
  return join(dir, 'cordis.yml')
}

function rootInclude(ctx: Context) {
  const entry = [...ctx.loader.entries()].find(candidate => candidate.options.name === 'cordis:include')
  if (entry === undefined) throw new Error('root Include entry not found')
  return entry
}

async function eventually(test: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + 5_000
  while (!test()) {
    if (Date.now() >= deadline) throw new Error(message)
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

describe('config-only user patch watcher', () => {
  beforeEach(() => {
    fakeChokidar.initialError = undefined
    fakeChokidar.watchers.length = 0
  })

  it('closes and propagates a watcher error raised before ready', async () => {
    const ctx = await boot(NAME, writeTree(tmp()))
    const failure = new Error('watch setup failed')
    fakeChokidar.initialError = failure
    try {
      await expect(watchUserPatches(ctx, {
        binName: NAME,
        filename: join(tmp(), PROFILE_PATCH_FILENAME),
      })).rejects.toBe(failure)
      expect(fakeChokidar.watchers).toHaveLength(1)
      expect(fakeChokidar.watchers[0]?.close).toHaveBeenCalledOnce()
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('serializes refreshes, reaches quiescence on dispose, and ignores later events', async () => {
    const ctx = await boot(NAME, writeTree(tmp()))
    const first = Promise.withResolvers<number>()
    const third = Promise.withResolvers<number>()
    let calls = 0
    const update = vi.spyOn(rootInclude(ctx), 'update').mockImplementation(async () => {
      calls += 1
      if (calls === 1) await first.promise
      if (calls === 3) await third.promise
    })
    const filename = join(tmp(), PROFILE_PATCH_FILENAME)
    const dispose = await watchUserPatches(ctx, {
      binName: NAME,
      filename,
    })
    const watcher = fakeChokidar.watchers[0]
    if (watcher === undefined) throw new Error('watcher was not created')
    try {
      watcher.emit('change', join(tmp(), 'other.patch.yml'))
      await Promise.resolve()
      expect(calls).toBe(0)
      watcher.emit('change', filename)
      await eventually(() => calls === 1, 'first refresh did not start')
      watcher.emit('change', filename)
      first.resolve(1)
      await eventually(() => calls === 2, 'dirty refresh was not replayed')

      watcher.emit('unlink', filename)
      await eventually(() => calls === 3, 'third refresh did not start')
      let disposed = false
      const disposal = dispose().then(() => { disposed = true })
      watcher.emit('add', filename)
      await Promise.resolve()
      expect(calls).toBe(3)
      expect(disposed).toBe(false)
      third.resolve(3)
      await disposal
      expect(watcher.close).toHaveBeenCalledOnce()
      expect(update).toHaveBeenCalledTimes(3)
    } finally {
      third.resolve(3)
      await dispose()
      await ctx.fiber.dispose()
    }
  })

  it('normalizes refresh failures and logs watcher errors raised after ready', async () => {
    const ctx = await boot(NAME, writeTree(tmp()))
    const rawFailure = { reason: 'raw refresh failure' }
    const errorFailure = new Error('error refresh failure')
    vi.spyOn(rootInclude(ctx), 'update')
      .mockRejectedValueOnce(rawFailure)
      .mockRejectedValueOnce(errorFailure)
    const observed: Error[] = []
    ctx.on('hmr/config-update-failed', (_filename, error) => {
      observed.push(error)
    })
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    const filename = join(tmp(), PROFILE_PATCH_FILENAME)
    const dispose = await watchUserPatches(ctx, {
      binName: NAME,
      filename,
    })
    const watcher = fakeChokidar.watchers[0]
    if (watcher === undefined) throw new Error('watcher was not created')
    try {
      watcher.emit('change', filename)
      await eventually(() => observed.length === 1, 'refresh failure was not broadcast')
      expect(observed[0]).toBeInstanceOf(Error)
      expect(observed[0]?.cause).toBe(rawFailure)

      watcher.emit('change', filename)
      await eventually(() => observed.length === 2, 'Error refresh failure was not broadcast')
      expect(observed[1]).toBe(errorFailure)

      const watcherFailure = new Error('watcher failed after ready')
      watcher.emit('error', watcherFailure)
      expect(warn).toHaveBeenCalledWith(watcherFailure)
    } finally {
      await dispose()
      await ctx.fiber.dispose()
    }
  })
})
