import { describe, it, expect } from 'vitest'
import { generateKeypair, TempKeyStore } from '../src/key.js'
import { sendMessage, processEvent, buildReply } from '../src/protocol.js'

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
  'wss://relay13.example.com',
  'wss://relay14.example.com',
  'wss://relay15.example.com',
  'wss://relay16.example.com',
]

describe('Multi-round accumulation and cleanup on reply', () => {
  it('accumulates rounds from multiple sends, then cleans up all on any reply', () => {
    const aliceKey = generateKeypair()
    const bobKey = generateKeypair()
    const currentRelays = RELAY_POOL.slice(0, 6)

    // Alice sends 3 messages in succession before Bob replies.
    // All 3 go to Bob's main npub on the same relays, but each
    // embeds its own next_targets and next_relays for the reply.
    const msg1 = sendMessage({
      recipientCurrentPubkey: bobKey.publicKey,
      plaintext: 'Message 1',
      currentRelays,
      senderKey: aliceKey,
      myRealNpub: aliceKey.publicKey,
      recipientRealNpub: bobKey.publicKey,
      relayPool: RELAY_POOL,
    })
    const msg2 = sendMessage({
      recipientCurrentPubkey: bobKey.publicKey,
      plaintext: 'Message 2',
      currentRelays,
      senderKey: aliceKey,
      myRealNpub: aliceKey.publicKey,
      recipientRealNpub: bobKey.publicKey,
      relayPool: RELAY_POOL,
    })
    const msg3 = sendMessage({
      recipientCurrentPubkey: bobKey.publicKey,
      plaintext: 'Message 3',
      currentRelays,
      senderKey: aliceKey,
      myRealNpub: aliceKey.publicKey,
      recipientRealNpub: bobKey.publicKey,
      relayPool: RELAY_POOL,
    })

    // All 3 rounds have unique reply targets (9 unique pubkeys)
    const roundA = msg1.replyTargets
    const roundB = msg2.replyTargets
    const roundC = msg3.replyTargets
    const allKeys = [...roundA, ...roundB, ...roundC]
    expect(new Set(allKeys.map((k) => k.publicKey)).size).toBe(9)

    // Bob processes each message — he receives all 3
    const bobKeys = new TempKeyStore()
    bobKeys.store(bobKey)

    const payload1 = processEvent({
      event: msg1.shardEvents[0].signedEvent,
      myKeys: bobKeys,
    })!
    const payload2 = processEvent({
      event: msg2.shardEvents[0].signedEvent,
      myKeys: bobKeys,
    })!
    const payload3 = processEvent({
      event: msg3.shardEvents[0].signedEvent,
      myKeys: bobKeys,
    })!

    // Bob replies only to the latest message (Message 3).
    // He uses Message 3's next_targets and next_relays.
    const reply = buildReply({
      originalPayload: payload3,
      replyText: 'Reply to latest',
      senderKey: bobKey,
      myRealNpub: bobKey.publicKey,
      recipientRealNpub: aliceKey.publicKey,
      relayPool: RELAY_POOL,
    })

    // Bob's reply is tagged to Round C's pubkeys
    const pTag = reply.shardEvents[0].signedEvent.tags.find((t) => t[0] === 'p')![1]
    expect(roundC.some((t) => t.publicKey === pTag)).toBe(true)

    // Simulate restart: fresh TempKeyStore with all 3 rounds' keys
    const aliceKeys = new TempKeyStore()
    for (const kp of allKeys) {
      aliceKeys.store(kp)
    }
    expect(aliceKeys.getAll()).toHaveLength(9)

    // Alice decrypts Bob's reply (uses Round C's key)
    const r = processEvent({
      event: reply.shardEvents[0].signedEvent,
      myKeys: aliceKeys,
    })!
    expect(r.content).toBe('Reply to latest')

    // Once a reply is received, all prior messages are assumed delivered.
    // All rounds for this conversation are cleaned up at once.
    for (const kp of allKeys) {
      aliceKeys.destroy(kp.publicKey)
    }
    expect(aliceKeys.getAll()).toHaveLength(0)

    // No more events can be decrypted
    expect(processEvent({
      event: reply.shardEvents[0].signedEvent,
      myKeys: aliceKeys,
    })).toBeNull()
  })
})
