import { SimplePool } from 'nostr-tools'
import type { Filter, Event as NostrEvent } from 'nostr-tools'
import type { SignedEvent } from './models.js'

const pool = new SimplePool()

pool.enableReconnect = true

export function closePool(): void {
  pool.destroy()
}

// Exposed for testing — lets tests inject a mock WebSocket into the pool
export function setWebSocketImpl(ws: any): void {
  ;(pool as any)._WebSocket = ws
}

export function trustUrlForTesting(url: string): void {
  try {
    pool.trustedRelayURLs.add(new URL(url).toString())
  } catch {}
}

export function publishEvent(relayUrl: string, event: SignedEvent): Promise<void> {
  if (!relayUrl) {
    return Promise.reject(new Error('No relay URL provided'))
  }
  return pool.publish([relayUrl], event)[0].then((result) => {
    if (typeof result === 'string' && result.startsWith('connection failure')) {
      throw new Error(result)
    }
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

export function isPoolReady(url: string): boolean {
  return pool.listConnectionStatus().get(url) ?? false
}

export async function queryEvents(
  relayUrl: string,
  filter: Record<string, unknown>,
  timeoutMs = 2000,
): Promise<SignedEvent[]> {
  const events = await pool.querySync([relayUrl], filter as Filter, { maxWait: timeoutMs })
  return events as SignedEvent[]
}
