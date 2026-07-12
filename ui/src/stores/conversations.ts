import { signal } from '@preact/signals'
import { saveConversations } from './db.js'
import { clearConversationRounds } from './pending.js'

export type MessageStatus = 'sending' | 'sent' | 'failed'

export interface UIMessage {
  id: string
  conversationId: string
  content: string
  timestamp: number
  isSent: boolean
  senderPubkey: string
  status?: MessageStatus
  peerRelays?: string[]
  peerTargets?: string[]
  senderMsgIndex?: number
}

export interface UIConversation {
  id: string
  recipientPubkey: string
  recipientName: string
  recipientPicture?: string
  messages: UIMessage[]
  lastTimestamp: number
  unread: number
}

export const conversations = signal<Map<string, UIConversation>>(new Map())
export const activeConversationId = signal<string | null>(null)

function generateId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

function shortName(pubkey: string): string {
  return pubkey.slice(0, 8) + '...' + pubkey.slice(-4)
}

export function addMessage(conversationId: string, msg: Omit<UIMessage, 'id'>): string {
  const map = conversations.value
  const existing = map.get(conversationId)

  const full: UIMessage = { ...msg, id: generateId() }
  let conv: UIConversation
  if (existing) {
    conv = existing
  } else {
    conv = {
      id: conversationId,
      recipientPubkey: msg.isSent ? '' : msg.senderPubkey,
      recipientName: msg.isSent ? '' : shortName(msg.senderPubkey),
      messages: [],
      lastTimestamp: 0,
      unread: 0,
    }
  }

  conv.messages = [...conv.messages, full]
  conv.lastTimestamp = Math.max(conv.lastTimestamp, msg.timestamp)

  if (conversationId !== activeConversationId.value && !msg.isSent) {
    conv.unread++
  }

  const updated = new Map(map)
  updated.set(conversationId, conv)
  conversations.value = updated
  saveConversations(updated)
  return full.id
}

export function selectConversation(id: string | null): void {
  activeConversationId.value = id
  if (id) {
    const map = conversations.value
    let conv = map.get(id)
    if (conv && conv.unread > 0) {
      const updated = new Map(map)
      updated.set(id, { ...conv, unread: 0 })
      conversations.value = updated
      saveConversations(updated)
    }
  }
}

export function createConversation(recipientPubkey: string, picture?: string): void {
  const map = conversations.value
  if (map.has(recipientPubkey)) {
    selectConversation(recipientPubkey)
    return
  }
  const conv: UIConversation = {
    id: recipientPubkey,
    recipientPubkey,
    recipientName: shortName(recipientPubkey),
    recipientPicture: picture,
    messages: [],
    lastTimestamp: 0,
    unread: 0,
  }
  const updated = new Map(map)
  updated.set(recipientPubkey, conv)
  conversations.value = updated
  saveConversations(updated)
  activeConversationId.value = recipientPubkey
}

export function getActiveThread(): UIMessage[] {
  const id = activeConversationId.value
  if (!id) return []
  return conversations.value.get(id)?.messages ?? []
}

export function updateMessageStatus(conversationId: string, messageId: string, status: MessageStatus): void {
  const map = conversations.value
  const conv = map.get(conversationId)
  if (!conv) return
  const idx = conv.messages.findIndex((m) => m.id === messageId)
  if (idx === -1) return
  const msg = { ...conv.messages[idx], status }
  const messages = [...conv.messages]
  messages[idx] = msg
  const updated = new Map(map)
  updated.set(conversationId, { ...conv, messages })
  conversations.value = updated
  saveConversations(updated)
}

export function deleteConversation(id: string): void {
  const map = conversations.value
  if (!map.has(id)) return
  const updated = new Map(map)
  updated.delete(id)
  conversations.value = updated
  saveConversations(updated)
  clearConversationRounds(id)
  if (activeConversationId.value === id) {
    activeConversationId.value = updated.size > 0 ? [...updated.keys()][0] : null
  }
}

export function setConversationName(conversationId: string, name: string): void {
  const map = conversations.value
  const conv = map.get(conversationId)
  if (!conv) return
  const updated = new Map(map)
  updated.set(conversationId, { ...conv, recipientName: name })
  conversations.value = updated
  saveConversations(updated)
}
