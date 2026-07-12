import { describe, it, expect } from 'vitest'
import { generateKeypair, TempKeyStore } from '../src/key.js'
import { sendMessage, processEvent, buildReply, fetchMissingShards } from '../src/protocol.js'
import { findShardIndex } from '../src/shard.js'
import type { ShardPayload, SignedEvent } from '../src/models.js'

const POOL = [
  'wss://r1.example.com', 'wss://r2.example.com', 'wss://r3.example.com',
  'wss://r4.example.com', 'wss://r5.example.com', 'wss://r6.example.com',
  'wss://r7.example.com', 'wss://r8.example.com', 'wss://r9.example.com',
  'wss://r10.example.com', 'wss://r11.example.com', 'wss://r12.example.com',
  'wss://r13.example.com', 'wss://r14.example.com', 'wss://r15.example.com',
  'wss://r16.example.com', 'wss://r17.example.com', 'wss://r18.example.com',
]

function collectShardLabels(events: SignedEvent[]): string[] {
  return events.map((e) => e.tags.find((t) => t[0] === 'shard')?.[1] ?? '')
}

function pTags(events: SignedEvent[]): string[] {
  return events.map((e) => e.tags.find((t) => t[0] === 'p')?.[1] ?? '')
}

function senderPubkeys(events: SignedEvent[]): string[] {
  return events.map((e) => e.pubkey)
}

describe('Alice → Bob → Alice full round trip + metadata audit', () => {
  it('completes two rounds with no metadata leak beyond the first npub', async () => {
    // =========================================================================
    //  SETUP
    // =========================================================================
    const aliceMain = generateKeypair()
    const bobMain = generateKeypair()
    const round1Relays = POOL.slice(0, 6)

    // Each party holds their own private keys
    const aliceKeyStore = new TempKeyStore()
    aliceKeyStore.store(aliceMain)

    const bobKeyStore = new TempKeyStore()
    bobKeyStore.store(bobMain)

    // Track all visible npubs across both rounds for cross-round checks
    const allVisiblePubkeys: string[] = []
    const allVisiblePTags: string[] = []
    const allShardLabels: string[] = []

    // =========================================================================
    //  ROUND 1: ALICE → BOB
    // =========================================================================

    const round1 = await sendMessage({
      recipientCurrentPubkey: bobMain.publicKey,
      plaintext: 'Hello Bob, this is a secret message from Alice!',
      currentRelays: round1Relays,
      myPrivKey: aliceMain.privateKey,
      relayPool: POOL,
    })

    expect(round1.shardEvents).toHaveLength(3)
    expect(round1.replyTargets).toHaveLength(3)
    expect(round1.nextRelays).toHaveLength(6)
    expect(round1.conversationId).toMatch(/^[0-9a-f]{64}$/)
    const conversationId = round1.conversationId

    // Next relays are disjoint from current
    for (const r of round1.nextRelays) {
      expect(round1Relays).not.toContain(r)
    }

    // ---- Visible metadata inspection (Round 1) ----
    const r1Events = round1.shardEvents.map((s) => s.signedEvent)

    // Sender pubkeys are 3 different ephemeral keys, NOT Alice's main npub
    const r1SenderPubkeys = senderPubkeys(r1Events)
    expect(new Set(r1SenderPubkeys).size).toBe(3)  // each shard signed by a different key
    for (const pk of r1SenderPubkeys) {
      expect(pk).not.toBe(aliceMain.publicKey)
      expect(pk).not.toBe(bobMain.publicKey)
    }
    allVisiblePubkeys.push(...senderPubkeys(r1Events))

    // The p-tag is Bob's main npub (initial contact — unavoidable leak)
    for (const ev of r1Events) {
      const p = ev.tags.find((t) => t[0] === 'p')?.[1]
      expect(p).toBe(bobMain.publicKey)
    }
    allVisiblePTags.push(...pTags(r1Events))

    // Shard labels are random alphanumeric (not sequential 1,2,3)
    const r1Labels = collectShardLabels(r1Events)
    for (const label of r1Labels) {
      expect(label).toMatch(/^[a-z0-9]{5}$/)
      expect(isNaN(Number(label))).toBe(true)
    }
    expect(new Set(r1Labels).size).toBe(3)  // all unique
    allShardLabels.push(...r1Labels)

    // No msg_id or linking tag in any event
    for (const ev of r1Events) {
      const tagNames = ev.tags.map((t) => t[0])
      expect(tagNames).not.toContain('msg_id')
      expect(tagNames).not.toContain('msg-id')
      expect(tagNames).not.toContain('id')
      // Only p, shard, and expiry should be visible
      for (const name of tagNames) {
        expect(['p', 'shard', 'expiry']).toContain(name)
      }
    }

    // Real npubs do NOT appear in the visible event content (encrypted)
    for (const ev of r1Events) {
      expect(ev.content).not.toContain(aliceMain.publicKey)
      expect(ev.content).not.toContain(bobMain.publicKey)
    }

    // The event's kind is 1059 (Gift Wrap) — the Seal (kind 13) is inside the encrypted content
    for (const ev of r1Events) {
      expect(ev.kind).toBe(1059)
      // The pubkey on the event is a throwaway key, NOT the true author
      expect(ev.pubkey).not.toBe(aliceMain.publicKey)
      expect(ev.pubkey).not.toBe(bobMain.publicKey)
    }

    // ---- Bob receives and decrypts Round 1 ----
    for (let i = 0; i < 3; i++) {
      const res = processEvent({
        event: r1Events[i],
        myKeys: bobKeyStore,
      })
      expect(res).not.toBeNull()
      expect(res!.payload.content).toBe('Hello Bob, this is a secret message from Alice!')
      expect(res!.payload.shard_total).toBe(3)
      expect(res!.payload.shard_index).toBe(i + 1)
      expect(res!.payload.conversation_id).toBe(conversationId)
      expect(res!.senderPubkey).toBe(aliceMain.publicKey) // Seal reveals true author
    }

    // ---- Bob finds the other 2 shards from any single shard ----
    // Test from each possible starting shard
    for (let startShard = 0; startShard < 3; startShard++) {
      const firstRes = processEvent({
        event: r1Events[startShard],
        myKeys: bobKeyStore,
      })!
      const firstPayload = firstRes.payload

      const label = r1Events[startShard].tags.find((t) => t[0] === 'shard')?.[1]
      const currentIdx = findShardIndex(label!, firstPayload.shard_labels)!
      expect(currentIdx).toBe(startShard + 1)

      const missingIndices = [1, 2, 3].filter((i) => i !== currentIdx)
      for (const missingIdx of missingIndices) {
        const expectedLabel = firstPayload.shard_labels[String(missingIdx)]
        // The relay for this shard is at peer_relays[(missingIdx-1)*2]
        const relayIdx = (missingIdx - 1) * 2
        expect(firstPayload.peer_relays[relayIdx]).toBe(round1Relays[relayIdx])
        expect(firstPayload.peer_relays[relayIdx + 1]).toBe(round1Relays[relayIdx + 1])
        expect(expectedLabel).toBe(r1Labels[missingIdx - 1])
      }
    }

    // ---- Bob collects all 3 and verifies consistency ----
    const bobReceived: ShardPayload[] = []
    for (let i = 0; i < 3; i++) {
      bobReceived.push(processEvent({ event: r1Events[i], myKeys: bobKeyStore })!.payload)
    }
    const bobRef = bobReceived[0]
    for (let i = 1; i < 3; i++) {
      expect(bobReceived[i].content).toBe(bobRef.content)
      expect(bobReceived[i].peer_relays).toEqual(bobRef.peer_relays)
      expect(bobReceived[i].next_relays).toEqual(bobRef.next_relays)
      expect(bobReceived[i].next_targets).toEqual(bobRef.next_targets)
      expect(bobReceived[i].shard_labels).toEqual(bobRef.shard_labels)
    }

    // =========================================================================
    //  ROUND 2: BOB → ALICE (reply)
    // =========================================================================
    // Bob uses the first decrypted payload to build his reply
    const bobPayload = bobReceived[0]

    // Bob's nextTargets are the public keys from round1.replyTargets
    const aliceReplyTargets = round1.replyTargets  // Alice holds these private keys
    const aliceReplyPubkeys = aliceReplyTargets.map((k) => k.publicKey)

    // Store Alice's reply-target private keys so she can decrypt the reply
    for (const kp of aliceReplyTargets) {
      aliceKeyStore.store(kp)
    }

    const reply1 = await buildReply({
      originalPayload: bobPayload,
      replyText: 'Hi Alice! Got your message. This is a secret reply.',
      myPrivKey: bobMain.privateKey,
      relayPool: POOL,
    })

    expect(reply1.shardEvents).toHaveLength(3)
    expect(reply1.nextTargets).toHaveLength(3)
    expect(reply1.nextRelays).toHaveLength(6)

    // Next relays are disjoint from the reply relays
    for (const r of reply1.nextRelays) {
      expect(round1.nextRelays).not.toContain(r)
    }

    // ---- Visible metadata inspection (Round 2) ----
    const r2Events = reply1.shardEvents.map((s) => s.signedEvent)

    // Sender pubkeys are 3 different ephemeral keys, NOT Bob's main npub
    const r2SenderPubkeys = senderPubkeys(r2Events)
    expect(new Set(r2SenderPubkeys).size).toBe(3)  // each shard signed by a different key
    for (const pk of r2SenderPubkeys) {
      expect(pk).not.toBe(bobMain.publicKey)
      expect(pk).not.toBe(aliceMain.publicKey)
      // Also different from round 1's senders
      expect(r1SenderPubkeys).not.toContain(pk)
    }
    allVisiblePubkeys.push(...senderPubkeys(r2Events))

    // The p-tags are Alice's temp npubs (reply targets from round 1)
    const r2PTags = pTags(r2Events)
    for (const p of r2PTags) {
      expect(aliceReplyPubkeys).toContain(p)
      // NEITHER Alice's nor Bob's main npub appears
      expect(p).not.toBe(aliceMain.publicKey)
      expect(p).not.toBe(bobMain.publicKey)
    }
    expect(new Set(r2PTags).size).toBe(3)  // all 3 targets used (permuted)
    allVisiblePTags.push(...r2PTags)

    // Shard labels are new random strings (different from round 1)
    const r2Labels = collectShardLabels(r2Events)
    for (const label of r2Labels) {
      expect(label).toMatch(/^[a-z0-9]{5}$/)
      expect(isNaN(Number(label))).toBe(true)
      expect(r1Labels).not.toContain(label)  // no overlap with round 1
    }
    expect(new Set(r2Labels).size).toBe(3)
    allShardLabels.push(...r2Labels)

    // No msg_id or linking tag
    for (const ev of r2Events) {
      const tagNames = ev.tags.map((t) => t[0])
      expect(tagNames).not.toContain('msg_id')
      expect(tagNames).not.toContain('msg-id')
      expect(tagNames).not.toContain('id')
      for (const name of tagNames) {
        expect(['p', 'shard', 'expiry']).toContain(name)
      }
    }

    // Real npubs not in visible content (encrypted)
    for (const ev of r2Events) {
      expect(ev.content).not.toContain(aliceMain.publicKey)
      expect(ev.content).not.toContain(bobMain.publicKey)
    }

    // Event kind is 1059 with throwaway pubkey
    for (const ev of r2Events) {
      expect(ev.kind).toBe(1059)
      expect(ev.pubkey).not.toBe(aliceMain.publicKey)
      expect(ev.pubkey).not.toBe(bobMain.publicKey)
    }

    // ---- Alice receives and decrypts Round 2 (the reply) ----
    for (let i = 0; i < 3; i++) {
      const res = processEvent({
        event: r2Events[i],
        myKeys: aliceKeyStore,
      })
      expect(res).not.toBeNull()
      expect(res!.payload.content).toBe('Hi Alice! Got your message. This is a secret reply.')
      expect(res!.payload.shard_total).toBe(3)
      expect(res!.payload.shard_index).toBe(i + 1)
      expect(res!.senderPubkey).toBe(bobMain.publicKey) // Seal reveals Bob as true author
      // Same conversation_id propagated from round 1
      expect(res!.payload.conversation_id).toBe(conversationId)
    }

    // ---- Alice finds the other 2 shards from any single shard ----
    for (let startShard = 0; startShard < 3; startShard++) {
      const firstRes = processEvent({
        event: r2Events[startShard],
        myKeys: aliceKeyStore,
      })!
      const firstPayload = firstRes.payload

      const label = r2Events[startShard].tags.find((t) => t[0] === 'shard')?.[1]
      const currentIdx = findShardIndex(label!, firstPayload.shard_labels)!
      expect(currentIdx).toBe(startShard + 1)

      const missingIndices = [1, 2, 3].filter((i) => i !== currentIdx)
      for (const missingIdx of missingIndices) {
        const expectedLabel = firstPayload.shard_labels[String(missingIdx)]
        const relayIdx = (missingIdx - 1) * 2
        expect(firstPayload.peer_relays[relayIdx]).toBe(round1.nextRelays[relayIdx])
        expect(firstPayload.peer_relays[relayIdx + 1]).toBe(round1.nextRelays[relayIdx + 1])
        expect(expectedLabel).toBe(r2Labels[missingIdx - 1])
      }
    }

    // ---- Alice collects all 3 reply shards and verifies consistency ----
    const aliceReceived: ShardPayload[] = []
    for (let i = 0; i < 3; i++) {
      aliceReceived.push(processEvent({ event: r2Events[i], myKeys: aliceKeyStore })!.payload)
    }
    const aliceRef = aliceReceived[0]
    for (let i = 1; i < 3; i++) {
      expect(aliceReceived[i].content).toBe(aliceRef.content)
      expect(aliceReceived[i].next_relays).toEqual(aliceRef.next_relays)
      expect(aliceReceived[i].next_targets).toEqual(aliceRef.next_targets)
      expect(aliceReceived[i].peer_relays).toEqual(aliceRef.peer_relays)
    }

    // =========================================================================
    //  METADATA LEAK AUDIT
    // =========================================================================

    // 1. Only Bob's main npub leaks in the visible p-tag (first contact only)
    expect(allVisiblePTags.filter((p) => p === bobMain.publicKey).length).toBe(3)  // 3 shards, all same
    expect(allVisiblePTags.filter((p) => p === aliceMain.publicKey).length).toBe(0)

    // 2. All visible pubkeys (senders) are ephemeral — never Alice or Bob's main
    for (const pk of allVisiblePubkeys) {
      expect(pk).not.toBe(aliceMain.publicKey)
      expect(pk).not.toBe(bobMain.publicKey)
    }

    // 3. No npub appears both as sender and as p-tag (cross-correlation resistance)
    //    (This would let an adversary link a sender to a recipient)
    for (const pk of allVisiblePubkeys) {
      expect(allVisiblePTags).not.toContain(pk)
    }

    // 4. All 6 shard labels (3 from each round) are unique — no cross-round linking
    expect(new Set(allShardLabels).size).toBe(6)

    // 5. Sender keys are different between rounds — 6 unique total (3 per round)
    const r1Senders = senderPubkeys(r1Events)
    const r2Senders = senderPubkeys(r2Events)
    expect(new Set([...r1Senders, ...r2Senders]).size).toBe(6)

    // 6. Relay sets are disjoint between consecutive rounds
    for (const r of round1.nextRelays) {
      expect(round1Relays).not.toContain(r)
    }
    for (const r of reply1.nextRelays) {
      expect(round1.nextRelays).not.toContain(r)
    }

    // 7. Reply target keys are unique across rounds (never reused)
    const allTargetPubkeys = [
      ...round1.replyTargets.map((k) => k.publicKey),
      ...reply1.nextTargets.map((k) => k.publicKey),
    ]
    expect(new Set(allTargetPubkeys).size).toBe(6)

    // 8. Alice can destroy round 1 reply targets after reading the reply
    for (const kp of aliceReplyTargets) {
      aliceKeyStore.destroy(kp.publicKey)
    }
    expect(aliceKeyStore.getAll().length).toBe(1)  // only her main key remains
  })

  it('propagates conversation_id across rounds and allows explicit continuation', async () => {
    const aliceMain = generateKeypair()
    const bobMain = generateKeypair()
    const relays = POOL.slice(0, 6)

    // Round 1: auto-generated conversation_id
    const round1 = await sendMessage({
      recipientCurrentPubkey: bobMain.publicKey,
      plaintext: 'First message',
      currentRelays: relays,
      myPrivKey: aliceMain.privateKey,
      relayPool: POOL,
    })
    expect(round1.conversationId).toMatch(/^[0-9a-f]{64}$/)

    // Decrypt to verify conversation_id in payload
    const bobKeys = new TempKeyStore()
    bobKeys.store(bobMain)
    const r1Res = processEvent({
      event: round1.shardEvents[0].signedEvent,
      myKeys: bobKeys,
    })!
    expect(r1Res.payload.conversation_id).toBe(round1.conversationId)

    // Reply propagates the same conversation_id
    const reply = await buildReply({
      originalPayload: r1Res.payload,
      replyText: 'Reply with same thread',
      myPrivKey: bobMain.privateKey,
      relayPool: POOL,
    })

    const aliceKeys = new TempKeyStore()
    for (const kp of round1.replyTargets) {
      aliceKeys.store(kp)
    }
    const replyRes = processEvent({
      event: reply.shardEvents[0].signedEvent,
      myKeys: aliceKeys,
    })!
    expect(replyRes.payload.conversation_id).toBe(round1.conversationId)

    // Explicit conversation_id: send to same conversation
    const round2 = await sendMessage({
      recipientCurrentPubkey: bobMain.publicKey,
      plaintext: 'Continuing the conversation',
      currentRelays: POOL.slice(6, 12),
      myPrivKey: aliceMain.privateKey,
      relayPool: POOL,
      conversationId: round1.conversationId,
    })

    expect(round2.conversationId).toBe(round1.conversationId)

    const r2Res = processEvent({
      event: round2.shardEvents[0].signedEvent,
      myKeys: bobKeys,
    })!
    expect(r2Res.payload.conversation_id).toBe(round1.conversationId)

    // Different conversations have different IDs
    const round3 = await sendMessage({
      recipientCurrentPubkey: bobMain.publicKey,
      plaintext: 'New chat',
      currentRelays: POOL.slice(6, 12),
      myPrivKey: aliceMain.privateKey,
      relayPool: POOL,
    })
    expect(round3.conversationId).not.toBe(round1.conversationId)
  })
})
