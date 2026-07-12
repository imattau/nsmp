import { SimplePool } from 'nostr-tools'
import type { Filter, Event as NostrEvent } from 'nostr-tools'
import type { SignedEvent } from './models.js'

const pool = new SimplePool()

pool.enableReconnect = true

export function closePool(): void {
  pool.close([])
}

export function publishEvent(relayUrl: string, event: SignedEvent): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new globalThis.WebSocket(relayUrl)

    const timer = setTimeout(() => {
      ws.close()
      reject(new Error(`Publish timeout: ${relayUrl}`))
    }, 10000)

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify(['EVENT', event]))
    })

    ws.addEventListener('message', (raw: MessageEvent) => {
      try {
        const data = JSON.parse(raw.data as string)
        if (data[0] === 'OK' && data[1] === event.id) {
          clearTimeout(timer)
          ws.close()
          if (data[2] === true) {
            resolve()
          } else {
            reject(new Error(`Relay rejected event: ${data[3] ?? 'unknown'}`))
          }
        }
      } catch {
        // ignore non-OK messages
      }
    })

    ws.addEventListener('error', () => {
      clearTimeout(timer)
      reject(new Error(`WebSocket error: ${relayUrl}`))
    })

    ws.addEventListener('close', () => {
      clearTimeout(timer)
    })
  })
}

export function subscribeToPubkey(
  relayUrl: string,
  pubkey: string,
  onEvent: (event: SignedEvent) => void,
  kinds?: number[],
): () => void {
  const filter: Record<string, unknown> = { '#p': [pubkey] }
  if (kinds) filter.kinds = kinds

  const sub = pool.subscribe(
    [relayUrl],
    filter as Filter,
    {
      onevent(event: NostrEvent) {
        onEvent(event as unknown as SignedEvent)
      },
    },
  )

  return () => sub.close()
}

export async function queryEvents(
  relayUrl: string,
  filter: Record<string, unknown>,
  timeoutMs = 5000,
): Promise<SignedEvent[]> {
  return new Promise((resolve, reject) => {
    const ws = new globalThis.WebSocket(relayUrl)
    const subId = Math.random().toString(36).slice(2, 10)
    const events: SignedEvent[] = []

    const timer = setTimeout(() => {
      ws.close()
      resolve(events)
    }, timeoutMs)

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify(['REQ', subId, filter]))
    })

    ws.addEventListener('message', (raw: MessageEvent) => {
      try {
        const data = JSON.parse(raw.data as string)
        if (data[0] === 'EVENT' && data[1] === subId) {
          events.push(data[2] as SignedEvent)
        }
        if (data[0] === 'EOSE' && data[1] === subId) {
          clearTimeout(timer)
          ws.close()
          resolve(events)
        }
      } catch {
        // ignore
      }
    })

    ws.addEventListener('error', () => {
      clearTimeout(timer)
      reject(new Error(`Query failed: ${relayUrl}`))
    })

    ws.addEventListener('close', () => {
      clearTimeout(timer)
      resolve(events)
    })
  })
}
