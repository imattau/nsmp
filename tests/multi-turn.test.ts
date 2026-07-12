import { describe, it, expect } from 'vitest'
import { generateKeypair, TempKeyStore } from '../src/key.js'
import { sendMessage, processEvent, buildReply } from '../src/protocol.js'
import type { ShardPayload } from '../src/models.js'

const POOL = [
  'wss://r1.example.com', 'wss://r2.example.com', 'wss://r3.example.com',
  'wss://r4.example.com', 'wss://r5.example.com', 'wss://r6.example.com',
  'wss://r7.example.com', 'wss://r8.example.com', 'wss://r9.example.com',
  'wss://r10.example.com', 'wss://r11.example.com', 'wss://r12.example.com',
  'wss://r13.example.com', 'wss://r14.example.com', 'wss://r15.example.com',
  'wss://r16.example.com', 'wss://r17.example.com', 'wss://r18.example.com',
]

function senderPubkeys(events: { signedEvent: { pubkey: string } }[]): string[] {
  return events.map((e) => e.signedEvent.pubkey)
}

function pTags(events: { signedEvent: { tags: string[][] } }[]): string[] {
  return events.map((e) => e.signedEvent.tags.find((t) => t[0] === 'p')?.[1] ?? '')
}

function extractPayload(event: { signedEvent: { pubkey: string; tags: string[][]; content: string } }, keys: TempKeyStore): ShardPayload | null {
  const r = processEvent({ event: event.signedEvent as any, myKeys: keys })
  return r ? r.payload : null
}

describe('Multi-turn conversation (Alice → Bob → Alice → Bob)', () => {
  it('completes 4 rounds with relay rotation and no main npub leak after round 1', async () => {
    const aliceMain = generateKeypair()
    const bobMain = generateKeypair()

    const aliceKeys = new TempKeyStore()
    aliceKeys.store(aliceMain)

    const bobKeys = new TempKeyStore()
    bobKeys.store(bobMain)

    let currentRelays = POOL.slice(0, 6)
    let conversationId: string

    const allSenderPubkeys: string[] = []
    const allPTags: string[] = []

    // =========================================================================
    //  ROUND 1: Alice → Bob (Alice's msgIndex = 1)
    // =========================================================================
    const r1 = await sendMessage({
      recipientCurrentPubkey: bobMain.publicKey,
      plaintext: 'Round 1: Hello Bob!',
      currentRelays,
      myPrivKey: aliceMain.privateKey,
      relayPool: POOL,
      msgIndex: 1,
    })
    conversationId = r1.conversationId
    allSenderPubkeys.push(...senderPubkeys(r1.shardEvents))
    allPTags.push(...pTags(r1.shardEvents))

    // Bob decrypts
    const r1Payload = extractPayload(r1.shardEvents[0], bobKeys)!
    expect(r1Payload.content).toBe('Round 1: Hello Bob!')
    expect(r1Payload.conversation_id).toBe(conversationId)
    expect(r1Payload.sender_msg_index).toBe(1)

    // Alice stores reply targets for her side
    for (const kp of r1.replyTargets) {
      aliceKeys.store(kp)
    }

    // =========================================================================
    //  ROUND 2: Bob → Alice reply (Bob's msgIndex = 1)
    // =========================================================================
    const r2 = await buildReply({
      originalPayload: r1Payload,
      replyText: 'Round 2: Hi Alice!',
      myPrivKey: bobMain.privateKey,
      relayPool: POOL,
      msgIndex: 1,
    })
    allSenderPubkeys.push(...senderPubkeys(r2.shardEvents))
    allPTags.push(...pTags(r2.shardEvents))

    // Alice decrypts
    const r2Payload = extractPayload(r2.shardEvents[0], aliceKeys)!
    expect(r2Payload.content).toBe('Round 2: Hi Alice!')
    expect(r2Payload.conversation_id).toBe(conversationId)
    expect(r2Payload.sender_msg_index).toBe(1)

    // Clean up old round 1 reply targets, store Bob's new reply targets
    for (const kp of r1.replyTargets) {
      aliceKeys.destroy(kp.publicKey)
    }
    for (const kp of r2.nextTargets) {
      bobKeys.store(kp)
    }

    // =========================================================================
    //  ROUND 3: Alice → Bob reply (Alice's msgIndex = 2)
    // =========================================================================
    const r3 = await buildReply({
      originalPayload: r2Payload,
      replyText: 'Round 3: How are you Bob?',
      myPrivKey: aliceMain.privateKey,
      relayPool: POOL,
      msgIndex: 2,
    })
    allSenderPubkeys.push(...senderPubkeys(r3.shardEvents))
    allPTags.push(...pTags(r3.shardEvents))

    // Bob decrypts
    const r3Payload = extractPayload(r3.shardEvents[0], bobKeys)!
    expect(r3Payload.content).toBe('Round 3: How are you Bob?')
    expect(r3Payload.conversation_id).toBe(conversationId)
    expect(r3Payload.sender_msg_index).toBe(2)

    // Clean up Bob's old targets, store Alice's new targets
    for (const kp of r2.nextTargets) {
      bobKeys.destroy(kp.publicKey)
    }
    for (const kp of r3.nextTargets) {
      aliceKeys.store(kp)
    }

    // =========================================================================
    //  ROUND 4: Bob → Alice reply (Bob's msgIndex = 2)
    // =========================================================================
    const r4 = await buildReply({
      originalPayload: r3Payload,
      replyText: 'Round 4: Doing great, thanks!',
      myPrivKey: bobMain.privateKey,
      relayPool: POOL,
      msgIndex: 2,
    })
    allSenderPubkeys.push(...senderPubkeys(r4.shardEvents))
    allPTags.push(...pTags(r4.shardEvents))

    // Alice decrypts
    const r4Payload = extractPayload(r4.shardEvents[0], aliceKeys)!
    expect(r4Payload.content).toBe('Round 4: Doing great, thanks!')
    expect(r4Payload.conversation_id).toBe(conversationId)
    expect(r4Payload.sender_msg_index).toBe(2)

    // Clean up
    for (const kp of r3.nextTargets) {
      aliceKeys.destroy(kp.publicKey)
    }
    for (const kp of r4.nextTargets) {
      bobKeys.store(kp)
    }

    // =========================================================================
    //  AUDIT
    // =========================================================================

    // All 4 rounds use the same conversation_id
    expect(r4Payload.conversation_id).toBe(conversationId)

    // Each round has 3 unique sender pubkeys (never repeated across rounds)
    expect(new Set(allSenderPubkeys).size).toBe(12) // 3 × 4 rounds

    // No sender pubkey is a main npub
    for (const pk of allSenderPubkeys) {
      expect(pk).not.toBe(aliceMain.publicKey)
      expect(pk).not.toBe(bobMain.publicKey)
    }

    // Round 1 p-tags are Bob's main npub (initial contact)
    const round1PTags = allPTags.slice(0, 3)
    for (const p of round1PTags) {
      expect(p).toBe(bobMain.publicKey)
    }

    // Rounds 2-4 p-tags are ephemeral temp npubs, never main npubs
    const laterPTags = allPTags.slice(3)
    for (const p of laterPTags) {
      expect(p).not.toBe(aliceMain.publicKey)
      expect(p).not.toBe(bobMain.publicKey)
    }

    // No npub appears both as sender and as p-tag
    for (const pk of allSenderPubkeys) {
      expect(allPTags).not.toContain(pk)
    }

    // Message indices increment per-direction across rounds
    expect(r1Payload.sender_msg_index).toBe(1)  // Alice → Bob, first message
    expect(r2Payload.sender_msg_index).toBe(1)  // Bob → Alice, first reply
    expect(r3Payload.sender_msg_index).toBe(2)  // Alice → Bob, second message
    expect(r4Payload.sender_msg_index).toBe(2)  // Bob → Alice, second reply
  })
})
