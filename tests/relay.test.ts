import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { publishEvent, queryEvents, setWebSocketImpl, trustUrlForTesting, closePool } from '../src/relay.js'
import type { SignedEvent } from '../src/models.js'

function createMockEvent(overrides?: Partial<SignedEvent>): SignedEvent {
  return {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    kind: 1059,
    tags: [],
    content: 'encrypted',
    sig: 'c'.repeat(128),
    created_at: 1000,
    ...overrides,
  } as SignedEvent
}

interface MockWebSocket {
  url: string
  readyState: number
  onopen: ((ev: Event) => void) | null
  onclose: ((ev: Event) => void) | null
  onerror: ((ev: Event) => void) | null
  onmessage: ((ev: MessageEvent) => void) | null
  send: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  addEventListener: ReturnType<typeof vi.fn>
  removeEventListener: ReturnType<typeof vi.fn>
  _open: () => void
  _message: (data: string) => void
  _close: () => void
  _error: () => void
}

let mockWebSocketInstances: MockWebSocket[] = []

function createMockWebSocket(): MockWebSocket {
  const handlers = new Map<string, Set<(...args: any[]) => void>>()
  function fire(event: string, ...args: any[]) {
    handlers.get(event)?.forEach((h) => h.call(ws as any, ...args))
  }
  const ws: MockWebSocket = {
    url: '',
    readyState: 0,
    onopen: null,
    onclose: null,
    onerror: null,
    onmessage: null,
    send: vi.fn(),
    close: vi.fn(),
    addEventListener: vi.fn((event: string, handler: (...args: any[]) => void) => {
      if (!handlers.has(event)) handlers.set(event, new Set())
      handlers.get(event)!.add(handler)
    }),
    removeEventListener: vi.fn((event: string, handler: (...args: any[]) => void) => {
      handlers.get(event)?.delete(handler)
    }),
    _open() {
      ws.readyState = 1
      fire('open', new Event('open'))
      ws.onopen?.call(ws as any, new Event('open'))
    },
    _message(data: string) {
      fire('message', new MessageEvent('message', { data }))
      ws.onmessage?.call(ws as any, new MessageEvent('message', { data }))
    },
    _close() {
      ws.readyState = 3
      fire('close', new Event('close'))
      ws.onclose?.call(ws as any, new Event('close'))
    },
    _error() {
      fire('error', new Event('error'))
      ws.onerror?.call(ws as any, new Event('error'))
    },
  }
  return ws
}

beforeEach(() => {
  mockWebSocketInstances = []
  trustUrlForTesting('wss://relay.example.com')
  const mockWs = vi.fn().mockImplementation((url: string) => {
    const ws = createMockWebSocket()
    ws.url = url
    mockWebSocketInstances.push(ws)
    return ws
  }) as any
  setWebSocketImpl(mockWs)
})

afterEach(() => {
  closePool()
  setWebSocketImpl(undefined)
})

describe('publishEvent', () => {
  it('should resolve when relay sends OK', async () => {
    const event = createMockEvent({ id: 'test-id-123' })
    const promise = publishEvent('wss://relay.example.com', event)

    await vi.waitFor(() => {
      expect(mockWebSocketInstances[0]).toBeDefined()
    })

    const ws = mockWebSocketInstances[0]
    ws._open()

    // Flush microtasks so the pool's send() fires after connection resolves
    await new Promise((r) => setTimeout(r, 0))

    ws._message(JSON.stringify(['OK', 'test-id-123', true]))

    await expect(promise).resolves.toBeUndefined()
    expect(ws.send).toHaveBeenCalledWith(expect.stringContaining('EVENT'))
  })

  it('should reject when relay sends OK false', async () => {
    const event = createMockEvent({ id: 'test-id-456' })
    const promise = publishEvent('wss://relay.example.com', event)

    await vi.waitFor(() => {
      expect(mockWebSocketInstances[0]).toBeDefined()
    })

    const ws = mockWebSocketInstances[0]
    ws._open()
    await new Promise((r) => setTimeout(r, 0))
    ws._message(JSON.stringify(['OK', 'test-id-456', false, 'blocked']))

    await expect(promise).rejects.toThrow('blocked')
  })

  it('should handle WebSocket error gracefully', async () => {
    const event = createMockEvent()
    const promise = publishEvent('wss://relay.example.com', event)

    await vi.waitFor(() => {
      expect(mockWebSocketInstances[0]).toBeDefined()
    })

    const ws = mockWebSocketInstances[0]
    ws._error()

    // Pool handles connection errors gracefully — doesn't throw
    await expect(promise).resolves.toBeUndefined()
  })
})

describe('queryEvents', () => {
  it('should collect events and resolve on EOSE', async () => {
    const reqSend = vi.fn()
    const mockWs = vi.fn().mockImplementation((url: string) => {
      const ws = createMockWebSocket()
      ws.url = url
      ws.send = reqSend
      mockWebSocketInstances.push(ws)
      return ws
    }) as any
    setWebSocketImpl(mockWs)

    const promise = queryEvents('wss://relay.example.com', { kinds: [1059] })

    await vi.waitFor(() => {
      expect(mockWebSocketInstances[0]).toBeDefined()
    })

    const ws = mockWebSocketInstances[0]
    ws._open()

    // Flush microtasks so the subscription is created and REQ is sent
    await new Promise((r) => setTimeout(r, 0))

    expect(reqSend.mock.calls.length).toBeGreaterThan(0)

    const reqCall = reqSend.mock.calls[0]?.[0]
    const reqParsed = JSON.parse(reqCall)
    const subId = reqParsed[1]

    ws._message(JSON.stringify(['EVENT', subId, { id: 'ev1', pubkey: 'x', kind: 1059, tags: [], content: '', sig: 'y', created_at: 0 }]))
    ws._message(JSON.stringify(['EOSE', subId]))

    const events = await promise
    expect(events.length).toBe(1)
    expect(events[0].id).toBe('ev1')
  })

  it('should timeout and return partial results', async () => {
    const promise = queryEvents('wss://relay.example.com', { kinds: [1059] }, 100)

    await vi.waitFor(() => {
      expect(mockWebSocketInstances[0]).toBeDefined()
    })

    const ws = mockWebSocketInstances[0]
    ws._open()

    await expect(promise).resolves.toBeDefined()
  })
})
