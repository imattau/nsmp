import { describe, it, expect } from 'vitest'
import { generateKeypair, TempKeyStore } from '../src/key.js'
import { sendMessage, processEvent } from '../src/protocol.js'
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
      senderKey,
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
      senderKey,
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
      senderKey,
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
