/**
 * IPC carrier behavior: unary round trips and downlink streams over a fake
 * desktop bridge — the transport-aspect replacement for the WebSocket carrier,
 * with the base-class protocol invariants (rpcId echo, envelope validation,
 * value parse) exercised through the real wire schemas.
 */

import { describe, expect, it, vi } from 'vitest'
import type { ServerRequest } from '@deepseek-ai/dsh-host-apiproxy/api'
import type {
  DesktopBridge,
  DesktopBridgeRequest,
  DesktopBridgeResponse,
  DesktopBridgeSubscription,
} from '../src/client/desktop-bridge.ts'
import { IpcApiClient } from '../src/client/ipc-api-client.ts'
import { createIpcConnectionRpc } from '../src/client/ipc-rpc.ts'

/** A controllable fake bridge capturing requests and letting tests push frames. */
function fakeBridge(): {
  bridge: DesktopBridge
  requests: DesktopBridgeRequest[]
  cancelled: string[]
  respondNext: (response: DesktopBridgeResponse) => void
  subscribers: Map<string, (frame: ServerRequest) => void>
  endSubscriptions: Map<string, Set<() => void>>
} {
  const requests: DesktopBridgeRequest[] = []
  const cancelled: string[] = []
  const subscribers = new Map<string, (frame: ServerRequest) => void>()
  const endSubscriptions = new Map<string, Set<() => void>>()
  let resolveNext: ((response: DesktopBridgeResponse) => void) | undefined
  const bridge: DesktopBridge = {
    fetch: (request) => {
      requests.push(request)
      return new Promise<DesktopBridgeResponse>((resolve) => { resolveNext = resolve })
    },
    cancel: (id) => { cancelled.push(id) },
    subscribe: (_stream, listener) => {
      const subId = `sub_${String(subscribers.size + 1)}`
      subscribers.set(subId, listener)
      const ends = new Set<() => void>()
      endSubscriptions.set(subId, ends)
      const subscription: DesktopBridgeSubscription = {
        unsubscribe: () => {
          subscribers.delete(subId)
          endSubscriptions.delete(subId)
        },
        onEnd: (endListener) => { ends.add(endListener) },
      }
      return subscription
    },
    version: 'test',
  }
  return {
    bridge,
    requests,
    cancelled,
    respondNext: (response) => { resolveNext?.(response) },
    subscribers,
    endSubscriptions,
  }
}

/** A server-response body for one unary reply. */
function serverResponse(rpcId: string, result: unknown): string {
  return JSON.stringify({ type: 'server-response', rpcId, result })
}

const JSON_HEADERS: [string, string][] = [['content-type', 'application/json']]

describe('IpcApiClient unary', () => {
  it('round-trips session.list over the bridge with envelope validation', async () => {
    const fake = fakeBridge()
    const client = new IpcApiClient(fake.bridge)
    const call = client.sessions.list({})
    const request = fake.requests[0]
    expect(request).toBeDefined()
    const sent = request as DesktopBridgeRequest
    expect(sent.url).toBe('http://dsh.internal/api/session.list')
    expect(sent.method).toBe('POST')
    expect(sent.headers['content-type']).toBe('application/json')
    const envelope = JSON.parse(sent.body as string) as { rpcId: string; method: string; type: string }
    expect(envelope.type).toBe('client-request')
    expect(envelope.method).toBe('session.list')
    fake.respondNext({ status: 200, headers: JSON_HEADERS, body: serverResponse(envelope.rpcId, { ok: true, value: { items: [] } }) })
    const response = await call
    expect(response.rpcId).toBe(envelope.rpcId)
    expect(response.result).toEqual({ ok: true, value: { items: [] } })
  })

  it('throws on rpcId echo mismatch', async () => {
    const fake = fakeBridge()
    const client = new IpcApiClient(fake.bridge)
    const call = client.sessions.list({})
    const envelope = JSON.parse(fake.requests[0]?.body as string) as { rpcId: string }
    fake.respondNext({ status: 200, headers: JSON_HEADERS, body: serverResponse('different', { ok: true, value: { items: [] } }) })
    await expect(call).rejects.toThrow(`rpcId mismatch for session.list: sent ${envelope.rpcId}`)
  })

  it('throws a transport error on a non-2xx answer', async () => {
    const fake = fakeBridge()
    const client = new IpcApiClient(fake.bridge)
    const call = client.sessions.list({})
    fake.respondNext({ status: 404, headers: [], body: 'not found' })
    await expect(call).rejects.toThrow('transport failure for /api/session.list: HTTP 404')
  })

  it('rejects an already-aborted call and reports the bridge cancel', async () => {
    const fake = fakeBridge()
    const client = new IpcApiClient(fake.bridge)
    const controller = new AbortController()
    controller.abort()
    await expect(client.sessions.list({}, controller.signal)).rejects.toThrow('aborted')
    // The request never reached the bridge (aborted before send) — nothing to cancel.
    expect(fake.requests).toHaveLength(0)
  })

  it('cancels an in-flight call on abort', async () => {
    const fake = fakeBridge()
    const client = new IpcApiClient(fake.bridge)
    const controller = new AbortController()
    const call = client.sessions.list({}, controller.signal)
    const id = fake.requests[0]?.id as string
    controller.abort()
    fake.respondNext({ status: 200, headers: JSON_HEADERS, body: serverResponse('late', { ok: true, value: { items: [] } }) })
    await expect(call).rejects.toThrow('aborted')
    expect(fake.cancelled).toContain(id)
  })
})

describe('IpcApiClient streams', () => {
  it('yields validated mux frames and ends on the stream-end callback', async () => {
    const fake = fakeBridge()
    const client = new IpcApiClient(fake.bridge)
    const controller = new AbortController()
    const iterator = client.events.mux({}, controller.signal)[Symbol.asyncIterator]()
    // Starting the generator runs the subscription synchronously (up to its
    // first await); the frame push then wakes it.
    const first = iterator.next()
    const listener = [...fake.subscribers.values()][0] as (frame: ServerRequest) => void
    expect(listener).toBeDefined()
    const frame = {
      type: 'server-request' as const,
      rpcId: 'mux_1',
      method: 'session/subscribed',
      payload: { type: 'session/subscribed', sessionId: 's1', lastSeq: 7 },
    } as unknown as ServerRequest
    listener(frame)
    const result = await first
    expect(result.done).toBe(false)
    expect((result.value as { payload: { type: string } }).payload).toMatchObject({ type: 'session/subscribed', sessionId: 's1', lastSeq: 7 })
    const ends = [...fake.endSubscriptions.values()][0]
    ends?.forEach((endListener) => { endListener() })
    const second = await iterator.next()
    expect(second.done).toBe(true)
  })

  it('drops malformed frames and keeps the stream alive', async () => {
    const fake = fakeBridge()
    const client = new IpcApiClient(fake.bridge)
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const iterator = client.events.mux({}, new AbortController().signal)[Symbol.asyncIterator]()
    const first = iterator.next()
    const listener = [...fake.subscribers.values()][0] as (frame: ServerRequest) => void
    listener({ type: 'server-request', rpcId: 'mux_bad', method: 'session/subscribed', payload: { not: 'a frame' } } as unknown as ServerRequest)
    const valid = {
      type: 'server-request' as const,
      rpcId: 'mux_2',
      method: 'session/subscribed',
      payload: { type: 'session/subscribed', sessionId: 's2', lastSeq: 1 },
    } as unknown as ServerRequest
    listener(valid)
    const result = await first
    expect(result.done).toBe(false)
    expect((result.value as { payload: { lastSeq: number } }).payload.lastSeq).toBe(1)
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })

  it('unsubscribes on stream teardown', async () => {
    const fake = fakeBridge()
    const client = new IpcApiClient(fake.bridge)
    const controller = new AbortController()
    const iterator = client.events.mux({}, controller.signal)[Symbol.asyncIterator]()
    void iterator.next()
    expect(fake.subscribers.size).toBe(1)
    controller.abort()
    const ended = await iterator.next()
    expect(ended.done).toBe(true)
    expect(fake.subscribers.size).toBe(0)
  })
})

describe('createIpcConnectionRpc', () => {
  it('correlates and validates a generic channel call over the bridge', async () => {
    const fake = fakeBridge()
    const rpc = createIpcConnectionRpc(fake.bridge)
    const call = rpc.call('/channel', 'endpoint', { value: 1 })
    const request = fake.requests[0]
    expect(request?.url).toBe('http://dsh.internal/channel/endpoint')
    const envelope = JSON.parse(request?.body as string) as { rpcId: string; method: string }
    expect(envelope.method).toBe('endpoint')
    fake.respondNext({ status: 200, headers: JSON_HEADERS, body: serverResponse(envelope.rpcId, { ok: true, value: 42 }) })
    await expect(call).resolves.toEqual({ ok: true, value: 42 })
  })

  it('rejects an invalid target', async () => {
    const fake = fakeBridge()
    const rpc = createIpcConnectionRpc(fake.bridge)
    await expect(rpc.call('/bad path', 'x', {})).rejects.toThrow('invalid target')
  })
})
