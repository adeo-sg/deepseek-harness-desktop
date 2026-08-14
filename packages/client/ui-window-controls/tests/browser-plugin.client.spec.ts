/**
 * ui-window-controls plugin halves: the browser entry registers the inline and
 * floating clusters against the real SlotRegistry (with fiber teardown proving
 * removal — HMR safety), the inert node entry, and the invariant companion's
 * ownership reservation.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import type { DesktopWindowControls } from '@deepseek-ai/dsh-client-connection/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { apply, inject } from '../src/client/index.ts'
import { apply as applyNode } from '../src/index.ts'
import * as WindowControlsInvariant from '../src/invariant.ts'

/** The two slots this plugin registers into. */
type WindowSlot = 'conversation.session.header.utilities' | 'shell.overlay'

/** Entry ids currently registered in one target slot. */
function entryIds(ctx: Context, slot: WindowSlot): (string | undefined)[] {
  return ctx.slots.entries(slot).map(entry => entry.options.id)
}

/** Boot the browser half over a real slot tree that declares both target slots. */
async function bench(): Promise<{ ctx: Context; fiber: ReturnType<Context['plugin']> }> {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root',
    children: {
      'conversation.session.header.utilities': { kind: 'list', scope: 'session' },
      'shell.overlay': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, fiber }
}

describe('ui-window-controls browser half', () => {
  it('declares the slot registry as its only service', () => {
    expect(inject).toEqual(['slots'])
  })

  it('registers both clusters, and fiber teardown removes them (HMR safety)', async () => {
    const { ctx, fiber } = await bench()
    expect(entryIds(ctx, 'conversation.session.header.utilities')).toContain('window-controls')
    expect(entryIds(ctx, 'shell.overlay')).toContain('window-controls-floating')
    await fiber.dispose()
    expect(entryIds(ctx, 'conversation.session.header.utilities')).not.toContain('window-controls')
    expect(entryIds(ctx, 'shell.overlay')).not.toContain('window-controls-floating')
  })

  it('injects the preload surface when the bridge exposes it', async () => {
    const surface = { minimize: vi.fn() } as unknown as DesktopWindowControls
    ;(globalThis as { desktopBridge?: unknown }).desktopBridge = { windowControls: surface }
    try {
      const { ctx } = await bench()
      const entry = ctx.slots.entries('shell.overlay')[0]
      const injected = entry?.inject?.()
      expect((injected as { windowControls?: unknown } | undefined)?.windowControls).toBe(surface)
    } finally {
      delete (globalThis as { desktopBridge?: unknown }).desktopBridge
    }
  })
})

describe('ui-window-controls node half', () => {
  it('contributes no host behavior', () => {
    // The node half exists only so the plugin appears in the Loader tree.
    expect(applyNode).not.toThrow()
  })
})

describe('ui-window-controls invariant companion', () => {
  it('reserves package ownership under its declared companion name', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    const fiber = ctx.plugin(WindowControlsInvariant)
    await fiber.await()
    expect(WindowControlsInvariant.name).toBe('client-ui-window-controls-invariant')
    expect(WindowControlsInvariant.inject).toEqual(['invariants'])
    // Emitting an unrelated event proves the companion installed no audit.
    expect(() => { (ctx.emit as (event: string) => void)('slots/changed') }).not.toThrow()
    await fiber.dispose()
  })
})
