import { describe, it, expect, beforeEach, vi } from 'vitest'
import { addMessage, selectConversation, deleteConversation, conversations, activeConversationId } from '../conversations.js'

// Mock idb-keyval
vi.mock('idb-keyval', () => ({
  get: vi.fn().mockResolvedValue(undefined),
  set: vi.fn().mockResolvedValue(undefined),
}))

describe('conversations store', () => {
  beforeEach(() => {
    conversations.value = new Map()
    activeConversationId.value = null
  })

  it('adds a message to a new conversation', () => {
    const id = addMessage('conv1', {
      conversationId: 'conv1',
      content: 'Hello',
      timestamp: 1000,
      isSent: true,
      senderPubkey: 'abc',
    })

    expect(id).toBeTruthy()
    expect(conversations.value.has('conv1')).toBe(true)
    const conv = conversations.value.get('conv1')!
    expect(conv.messages).toHaveLength(1)
    expect(conv.messages[0].content).toBe('Hello')
  })

  it('adds messages to an existing conversation', () => {
    addMessage('conv1', {
      conversationId: 'conv1',
      content: 'First',
      timestamp: 1000,
      isSent: true,
      senderPubkey: 'abc',
    })
    addMessage('conv1', {
      conversationId: 'conv1',
      content: 'Second',
      timestamp: 2000,
      isSent: false,
      senderPubkey: 'def',
    })

    const conv = conversations.value.get('conv1')!
    expect(conv.messages).toHaveLength(2)
    expect(conv.lastTimestamp).toBe(2000)
  })

  it('increments unread for incoming messages when not active', () => {
    addMessage('conv1', {
      conversationId: 'conv1',
      content: 'Hi',
      timestamp: 1000,
      isSent: false,
      senderPubkey: 'bob',
    })

    expect(conversations.value.get('conv1')!.unread).toBe(1)
  })

  it('clears unread on selectConversation', () => {
    addMessage('conv1', {
      conversationId: 'conv1',
      content: 'Hi',
      timestamp: 1000,
      isSent: false,
      senderPubkey: 'bob',
    })
    selectConversation('conv1')

    expect(conversations.value.get('conv1')!.unread).toBe(0)
  })

  it('deletes a conversation', () => {
    addMessage('conv1', {
      conversationId: 'conv1',
      content: 'Hi',
      timestamp: 1000,
      isSent: true,
      senderPubkey: 'abc',
    })
    expect(conversations.value.has('conv1')).toBe(true)

    deleteConversation('conv1')
    expect(conversations.value.has('conv1')).toBe(false)
  })

  it('adds a message with senderMsgIndex', () => {
    addMessage('conv1', {
      conversationId: 'conv1',
      content: 'Indexed',
      timestamp: 1000,
      isSent: true,
      senderPubkey: 'abc',
      senderMsgIndex: 5,
    })

    const msg = conversations.value.get('conv1')!.messages[0]
    expect(msg.senderMsgIndex).toBe(5)
  })

  it('adds a message with peerRelays and peerTargets', () => {
    addMessage('conv1', {
      conversationId: 'conv1',
      content: 'With targets',
      timestamp: 1000,
      isSent: false,
      senderPubkey: 'bob',
      peerRelays: ['r1', 'r2'],
      peerTargets: ['t1', 't2', 't3'],
    })

    const msg = conversations.value.get('conv1')!.messages[0]
    expect(msg.peerRelays).toEqual(['r1', 'r2'])
    expect(msg.peerTargets).toEqual(['t1', 't2', 't3'])
  })
})
