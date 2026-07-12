import { get, set, del } from 'idb-keyval'
import type { KeyPair } from '../../../src/models.js'

export interface PendingRound {
  replyTargets: KeyPair[]
  nextRelays: string[]
  createdAt: number
}

const PENDING_KEY = 'nsmp-pending-rounds'

export async function loadPendingRounds(): Promise<Map<string, PendingRound[]>> {
  const arr = await get<[string, PendingRound[]][]>(PENDING_KEY)
  if (!arr) return new Map()
  return new Map(arr)
}

export async function savePendingRound(conversationId: string, round: PendingRound): Promise<void> {
  const map = await loadPendingRounds()
  const rounds = map.get(conversationId) ?? []
  rounds.push(round)
  map.set(conversationId, rounds)
  await set(PENDING_KEY, Array.from(map.entries()))
}

export async function clearConversationRounds(conversationId: string): Promise<void> {
  const map = await loadPendingRounds()
  map.delete(conversationId)
  if (map.size === 0) {
    await del(PENDING_KEY)
  } else {
    await set(PENDING_KEY, Array.from(map.entries()))
  }
}
