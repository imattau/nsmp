import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { generateKeypair, TempKeyStore } from '../src/key.js'
import { sendMessage, processEvent, buildReply, buildSyncRequest, buildSyncBundle } from '../src/protocol.js'
import { createShards } from '../src/shard.js'

const RELAY_POOL = [
  'wss://relay1.example.com',
  'wss://relay2.example.com',
  'wss://relay3.example.com',
  'wss://relay4.example.com',
  'wss://relay5.example.com',
  'wss://relay6.example.com',
  'wss://relay7.example.com',
  'wss://relay8.example.com',
  'wss://relay9.example.com',
  'wss://relay10.example.com',
  'wss://relay11.example.com',
  'wss://relay12.example.com',
]

describe('sendMessage', () => {
  it('should produce 3 shards and reply targets', () => {
    const senderKey = generateKeypair()
    const recipientKey = generateKeypair()

    const result = sendMessage({
      recipientCurrentPubkey: recipientKey.publicKey,
      plaintext: 'Hello NSMP!',
      currentRelays: RELAY_POOL.slice(0, 6),
      myRealNpub: senderKey.publicKey,
      recipientRealNpub: recipientKey.publicKey,
      relayPool: RELAY_POOL,
    })

    expect(result.shardEvents).toHaveLength(3)
    for (const shard of result.shardEvents) {
      expect(shard.relays).toHaveLength(2)
    }
    expect(result.replyTargets).toHaveLength(3)
    expect(result.nextRelays).toHaveLength(6)
    expect(result.conversationId).toMatch(/^[0-9a-f]{64}$/)

    const uniqueNextRelays = new Set(result.nextRelays)
    expect(uniqueNextRelays.size).toBe(6)
  })
})

describe('processEvent', () => {
  it('should decrypt a shard if recipient has the key', () => {
    const senderKey = generateKeypair()
    const recipientKey = generateKeypair()
    const relays = RELAY_POOL.slice(0, 6)

    const result = sendMessage({
      recipientCurrentPubkey: recipientKey.publicKey,
      plaintext: 'Hi there!',
      currentRelays: relays,
      myRealNpub: senderKey.publicKey,
      recipientRealNpub: recipientKey.publicKey,
      relayPool: RELAY_POOL,
    })

    const myKeys = new TempKeyStore()
    myKeys.store(recipientKey)

    const payload = processEvent({
      event: result.shardEvents[0].signedEvent,
      myKeys,
    })

    expect(payload).not.toBeNull()
    expect(payload!.content).toBe('Hi there!')
    expect(payload!.shard_total).toBe(3)
    expect(payload!.next_targets).toHaveLength(3)
    expect(payload!.next_relays).toHaveLength(6)
    expect(payload!.peer_relays).toHaveLength(6)
    expect(payload!.conversation_id).toMatch(/^[0-9a-f]{64}$/)
  })

  it('should return null if recipient does not have the key', () => {
    const senderKey = generateKeypair()
    const recipientKey = generateKeypair()

    const result = sendMessage({
      recipientCurrentPubkey: recipientKey.publicKey,
      plaintext: 'Secret',
      currentRelays: RELAY_POOL.slice(0, 6),
      myRealNpub: senderKey.publicKey,
      recipientRealNpub: recipientKey.publicKey,
      relayPool: RELAY_POOL,
    })

    const wrongKeys = new TempKeyStore()
    wrongKeys.store(generateKeypair())

    const payload = processEvent({
      event: result.shardEvents[0].signedEvent,
      myKeys: wrongKeys,
    })

    expect(payload).toBeNull()
  })
})

describe('buildSyncRequest', () => {
  it('should produce 3 shards with sync request payload', () => {
    const aliceKey = generateKeypair()
    const bobKey = generateKeypair()
    const relays = RELAY_POOL.slice(0, 6)

    const result = buildSyncRequest({
      lastSeenIndex: 3,
      recipientCurrentPubkey: bobKey.publicKey,
      currentRelays: relays,
      myRealNpub: aliceKey.publicKey,
      recipientRealNpub: bobKey.publicKey,
      relayPool: RELAY_POOL,
      conversationId: 'abc',
    })

    expect(result.shardEvents).toHaveLength(3)
    expect(result.replyTargets).toHaveLength(3)
    expect(result.nextRelays).toHaveLength(6)

    // Each shard decrypts to reveal sync request
    const bobKeys = new TempKeyStore()
    bobKeys.store(bobKey)

    for (const shard of result.shardEvents) {
      const payload = processEvent({ event: shard.signedEvent, myKeys: bobKeys })
      expect(payload).not.toBeNull()
      expect(payload!.sync?.type).toBe('request')
      if (payload!.sync?.type === 'request') {
        expect(payload!.sync.last_seen_index).toBe(3)
      }
      expect(payload!.conversation_id).toBe('abc')
    }
  })
})

describe('buildSyncBundle', () => {
  it('should produce 3 shards with sync bundle payload', () => {
    const aliceKey = generateKeypair()
    const bobKey = generateKeypair()
    const relays = RELAY_POOL.slice(0, 6)

    const messages = [
      { sender_msg_index: 2, content: 'Missed message', timestamp: 1000 },
    ]

    const result = buildSyncBundle({
      messages,
      recipientCurrentPubkey: bobKey.publicKey,
      currentRelays: relays,
      myRealNpub: aliceKey.publicKey,
      recipientRealNpub: bobKey.publicKey,
      relayPool: RELAY_POOL,
      conversationId: 'abc',
    })

    expect(result.shardEvents).toHaveLength(3)
    expect(result.replyTargets).toHaveLength(3)

    const bobKeys = new TempKeyStore()
    bobKeys.store(bobKey)

    for (const shard of result.shardEvents) {
      const payload = processEvent({ event: shard.signedEvent, myKeys: bobKeys })
      expect(payload).not.toBeNull()
      expect(payload!.sync?.type).toBe('bundle')
      if (payload!.sync?.type === 'bundle') {
        expect(payload!.sync.messages).toHaveLength(1)
        expect(payload!.sync.messages[0].content).toBe('Missed message')
      }
    }
  })
})

describe('edge cases', () => {
  it('processEvent returns null for event with no p tag', () => {
    const event = {
      id: 'a'.repeat(64),
      pubkey: 'b'.repeat(64),
      kind: 1059,
      tags: [],
      content: 'encrypted',
      sig: 'c'.repeat(128),
      created_at: 0,
    }
    const keys = new TempKeyStore()
    keys.store(generateKeypair())

    const result = processEvent({ event: event as any, myKeys: keys })
    expect(result).toBeNull()
  })

  it('processEvent returns null for event with no matching key', () => {
    const senderKey = generateKeypair()
    const recipientKey = generateKeypair()
    const result = sendMessage({
      recipientCurrentPubkey: recipientKey.publicKey,
      plaintext: 'test',
      currentRelays: RELAY_POOL.slice(0, 6),
      myRealNpub: senderKey.publicKey,
      recipientRealNpub: recipientKey.publicKey,
      relayPool: RELAY_POOL,
    })

    const wrongKeys = new TempKeyStore()
    wrongKeys.store(generateKeypair()) // different key

    const payload = processEvent({
      event: result.shardEvents[0].signedEvent,
      myKeys: wrongKeys,
    })
    expect(payload).toBeNull()
  })

  it('processEvent returns null for malformed ciphertext', () => {
    const event = {
      id: 'a'.repeat(64),
      pubkey: 'b'.repeat(64),
      kind: 1059,
      tags: [['p', 'c'.repeat(64)]],
      content: 'not-valid-ciphertext',
      sig: 'e'.repeat(128),
      created_at: 0,
    }
    const keys = new TempKeyStore()
    keys.store({ privateKey: 'f'.repeat(64), publicKey: 'c'.repeat(64) })

    const result = processEvent({ event: event as any, myKeys: keys })
    expect(result).toBeNull()
  })

  it('sendMessage with empty content still produces valid shards', () => {
    const senderKey = generateKeypair()
    const recipientKey = generateKeypair()
    const result = sendMessage({
      recipientCurrentPubkey: recipientKey.publicKey,
      plaintext: '',
      currentRelays: RELAY_POOL.slice(0, 6),
      myRealNpub: senderKey.publicKey,
      recipientRealNpub: recipientKey.publicKey,
      relayPool: RELAY_POOL,
    })

    expect(result.shardEvents).toHaveLength(3)
    const keys = new TempKeyStore()
    keys.store(recipientKey)
    const payload = processEvent({ event: result.shardEvents[0].signedEvent, myKeys: keys })
    expect(payload).not.toBeNull()
    expect(payload!.content).toBe('')
  })
})
