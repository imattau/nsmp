import { get, set } from 'idb-keyval'
import type { UIConversation } from './conversations.js'

const CONVERSATIONS_KEY = 'nsmp-conversations'

export async function saveConversations(map: Map<string, UIConversation>): Promise<void> {
  const arr = Array.from(map.entries())
  await set(CONVERSATIONS_KEY, arr)
}

export async function loadConversations(): Promise<Map<string, UIConversation>> {
  const arr = await get<[string, UIConversation][]>(CONVERSATIONS_KEY)
  if (!arr) return new Map()
  return new Map(arr)
}
