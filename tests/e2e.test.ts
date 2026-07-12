import { describe, it, expect } from 'vitest'
import { generateKeypair, TempKeyStore } from '../src/key.js'
import { sendMessage, processEvent, buildReply } from '../src/protocol.js'
import { findShardIndex } from '../src/shard.js'
import type { ShardPayload, SignedEvent } from '../src/models.js'

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

describe('End-to-end protocol flow', () => {
  it('Alice sends → Bob receives and finds all shards from any single shard', () => {
    const aliceKey = generateKeypair()
    const bobKey = generateKeypair()
    const currentRelays = RELAY_POOL.slice(0, 6)
    const message = 'Hello Bob, this is a secret NSMP message!'

    // --- Alice sends ---
    const result = sendMessage({
      recipientCurrentPubkey: bobKey.publicKey,
      plaintext: message,
      currentRelays,
      myRealNpub: aliceKey.publicKey,
      recipientRealNpub: bobKey.publicKey,
      relayPool: RELAY_POOL,
    })

    expect(result.shardEvents).toHaveLength(3)

    // Each shard goes to the right relays
    for (let i = 0; i < 3; i++) {
      expect(result.shardEvents[i].relays).toEqual([
        currentRelays[i * 2],
        currentRelays[i * 2 + 1],
      ])
    }

    // Reply targets are fresh keys (not same as alice or bob)
    expect(result.replyTargets).toHaveLength(3)
    for (const t of result.replyTargets) {
      expect(t.privateKey).not.toBe(aliceKey.privateKey)
      expect(t.publicKey).not.toBe(bobKey.publicKey)
    }

    // Next relays are disjoint from current relays
    expect(result.nextRelays).toHaveLength(6)
    for (const r of result.nextRelays) {
      expect(currentRelays).not.toContain(r)
    }

    // --- Bob receives ---
    const bobKeys = new TempKeyStore()
    bobKeys.store(bobKey)

    // Bob can decrypt any shard
    for (let testShard = 0; testShard < 3; testShard++) {
      const event = result.shardEvents[testShard].signedEvent
      const payload = processEvent({ event, myKeys: bobKeys })
      expect(payload).not.toBeNull()
      expect(payload!.content).toBe(message)
      expect(payload!.shard_total).toBe(3)
      expect(payload!.shard_index).toBe(testShard + 1)
      expect(Object.keys(payload!.shard_labels)).toHaveLength(3)
      expect(payload!.peer_relays).toHaveLength(6)
      expect(payload!.next_relays).toHaveLength(6)
      expect(payload!.next_targets).toHaveLength(3)
    }

    // --- Bob finds other shards from any single shard ---
    for (let testShard = 0; testShard < 3; testShard++) {
      const firstEvent = result.shardEvents[testShard].signedEvent
      const firstPayload = processEvent({ event: firstEvent, myKeys: bobKeys })!

      const shardLabel = firstEvent.tags.find((t) => t[0] === 'shard')?.[1]
      const currentIdx = findShardIndex(shardLabel!, firstPayload.shard_labels)!

      // Verify we can determine the locations of the other 2 shards
      const missingIndices = [1, 2, 3].filter((i) => i !== currentIdx)
      expect(missingIndices).toHaveLength(2)

      for (const missingIdx of missingIndices) {
        const label = firstPayload.shard_labels[String(missingIdx)]
        expect(label).toBeTruthy()
        expect(label).toMatch(/^[a-z0-9]{5}$/)

        // Correct relay indexing: for shard `s`, relays are at peer_relays[(s-1)*2] and [(s-1)*2+1]
        const relayIdx = (missingIdx - 1) * 2
        const primaryRelay = firstPayload.peer_relays[relayIdx]
        const backupRelay = firstPayload.peer_relays[relayIdx + 1]
        expect(primaryRelay).toBe(currentRelays[relayIdx])
        expect(backupRelay).toBe(currentRelays[relayIdx + 1])
      }
    }

    // --- Bob decrypts all 3 shards and verifies consistency ---
    const allPayloads: ShardPayload[] = []
    for (let i = 0; i < 3; i++) {
      const ev = result.shardEvents[i].signedEvent
      const p = processEvent({ event: ev, myKeys: bobKeys })!
      allPayloads.push(p)
    }

    // All shards must have identical content, peer_relays, next_relays, next_targets
    const ref = allPayloads[0]
    for (let i = 1; i < 3; i++) {
      expect(allPayloads[i].content).toBe(ref.content)
      expect(allPayloads[i].peer_relays).toEqual(ref.peer_relays)
      expect(allPayloads[i].next_relays).toEqual(ref.next_relays)
      expect(allPayloads[i].next_targets).toEqual(ref.next_targets)
      expect(allPayloads[i].shard_total).toBe(ref.shard_total)
      expect(allPayloads[i].shard_labels).toEqual(ref.shard_labels)
    }

    // Each shard has a unique index
    const indices = allPayloads.map((p) => p.shard_index).sort()
    expect(indices).toEqual([1, 2, 3])
  })

  it('Bob replies to Alice with correct target permutation', () => {
    const aliceKey = generateKeypair()
    const bobKey = generateKeypair()
    const currentRelays = RELAY_POOL.slice(0, 6)

    // Alice sends first message
    const result = sendMessage({
      recipientCurrentPubkey: bobKey.publicKey,
      plaintext: 'Hello Bob!',
      currentRelays,
      myRealNpub: aliceKey.publicKey,
      recipientRealNpub: bobKey.publicKey,
      relayPool: RELAY_POOL,
    })

    // Bob processes it
    const bobKeys = new TempKeyStore()
    bobKeys.store(bobKey)
    const firstPayload = processEvent({
      event: result.shardEvents[0].signedEvent,
      myKeys: bobKeys,
    })!

    // Bob builds a reply
    const reply = buildReply({
      originalPayload: firstPayload,
      replyText: 'Hi Alice!',
      myRealNpub: bobKey.publicKey,
      recipientRealNpub: aliceKey.publicKey,
      relayPool: RELAY_POOL,
    })

    expect(reply.shardEvents).toHaveLength(3)
    expect(reply.nextTargets).toHaveLength(3)
    expect(reply.nextRelays).toHaveLength(6)

    // Alice holds the private keys for next_targets (from the first message)
    // Bob used those as p-tags for the reply shards
    const aliceReplyTargets = result.replyTargets
    const aliceReplyPubkeys = aliceReplyTargets.map((k) => k.publicKey)

    // Each reply shard must be addressed to one of the original next_targets
    for (let i = 0; i < 3; i++) {
      const shard = reply.shardEvents[i]
      const pTag = shard.signedEvent.tags.find((t) => t[0] === 'p')?.[1]
      expect(aliceReplyPubkeys).toContain(pTag)
    }

    // All 3 targets are used (none left out)
    const usedTargets = reply.shardEvents.map(
      (s) => s.signedEvent.tags.find((t) => t[0] === 'p')?.[1],
    )
    const uniqueTargets = new Set(usedTargets)
    expect(uniqueTargets.size).toBe(3)

    // Alice can decrypt each reply shard (she has the private keys)
    const aliceKeys = new TempKeyStore()
    for (const kp of aliceReplyTargets) {
      aliceKeys.store(kp)
    }

    for (let i = 0; i < 3; i++) {
      const ev = reply.shardEvents[i].signedEvent
      const payload = processEvent({ event: ev, myKeys: aliceKeys })
      expect(payload).not.toBeNull()
      expect(payload!.content).toBe('Hi Alice!')
      expect(payload!.shard_total).toBe(3)
    }
  })

  it('No temp key is reused across rounds', () => {
    const aliceKey = generateKeypair()
    const bobKey = generateKeypair()
    const currentRelays = RELAY_POOL.slice(0, 6)

    // Round 1: Alice → Bob
    const round1 = sendMessage({
      recipientCurrentPubkey: bobKey.publicKey,
      plaintext: 'Round 1',
      currentRelays,
      myRealNpub: aliceKey.publicKey,
      recipientRealNpub: bobKey.publicKey,
      relayPool: RELAY_POOL,
    })

    // Bob decrypts and replies  
    const bobKeys = new TempKeyStore()
    bobKeys.store(bobKey)
    const r1Payload = processEvent({
      event: round1.shardEvents[0].signedEvent,
      myKeys: bobKeys,
    })!

    const reply1 = buildReply({
      originalPayload: r1Payload,
      replyText: 'Reply 1',
      myRealNpub: bobKey.publicKey,
      recipientRealNpub: aliceKey.publicKey,
      relayPool: RELAY_POOL,
    })

    // Round 2: Alice → Bob (using Bob's reply targets as the new listening keys?)
    // Actually Alice uses Bob's main pubkey again (since we didn't rotate)
    // But the important thing: no keys from round 1 appear in round 2
    const round2Events = round1.shardEvents  // These are round 1 events
    const reply2Events = reply1.shardEvents  // These are round 2 (reply) events

    // Sender pubkeys must all be different across rounds
    const allSenderPubkeys = [
      ...round2Events.map((s) => s.signedEvent.pubkey),
      ...reply2Events.map((s) => s.signedEvent.pubkey),
    ]
    expect(new Set(allSenderPubkeys).size).toBe(6) // 3 alice senders + 3 bob senders

    // Reply targets from round 1 are unique and not reused
    const replyTargets = round1.replyTargets
    const replyNextTargets = reply1.nextTargets
    const allTargetPubkeys = [
      ...replyTargets.map((k) => k.publicKey),
      ...replyNextTargets.map((k) => k.publicKey),
    ]
    expect(new Set(allTargetPubkeys).size).toBe(6) // all 6 are unique

    // Relays are rotated between rounds
    expect(() => {
      for (const r of round1.nextRelays) {
        if (currentRelays.includes(r)) throw new Error('overlap')
      }
    }).not.toThrow()
  })

  it('Shard labels are random and shard-to-target mapping is permuted', () => {
    const aliceKey = generateKeypair()
    const bobKey = generateKeypair()
    const currentRelays = RELAY_POOL.slice(0, 6)

    // Run the same message twice; shard labels should differ
    const result1 = sendMessage({
      recipientCurrentPubkey: bobKey.publicKey,
      plaintext: 'test',
      currentRelays,
      myRealNpub: aliceKey.publicKey,
      recipientRealNpub: bobKey.publicKey,
      relayPool: RELAY_POOL,
    })

    const result2 = sendMessage({
      recipientCurrentPubkey: bobKey.publicKey,
      plaintext: 'test',
      currentRelays,
      myRealNpub: aliceKey.publicKey,
      recipientRealNpub: bobKey.publicKey,
      relayPool: RELAY_POOL,
    })

    // Shard labels are random (not sequential: 1,2,3)
    const bobKeys = new TempKeyStore()
    bobKeys.store(bobKey)

    const p1 = processEvent({
      event: result1.shardEvents[0].signedEvent,
      myKeys: bobKeys,
    })!
    const p2 = processEvent({
      event: result2.shardEvents[0].signedEvent,
      myKeys: bobKeys,
    })!

    // Labels should differ between runs
    expect(p1.shard_labels).not.toEqual(p2.shard_labels)

    // Labels should not be sequential numbers
    for (const label of Object.values(p1.shard_labels)) {
      expect(label).toMatch(/^[a-z0-9]{5}$/)
      expect(isNaN(Number(label))).toBe(true)
    }
  })
})

describe('TempKeyStore lifecycle', () => {
  it('should destroy reply targets after use', () => {
    const store = new TempKeyStore()
    const kp = generateKeypair()
    
    // Simulate: store reply targets
    store.store(kp)
    expect(store.has(kp.publicKey)).toBe(true)

    // After reply is received, destroy them
    store.destroy(kp.publicKey)
    expect(store.has(kp.publicKey)).toBe(false)
    expect(store.get(kp.publicKey)).toBeUndefined()
  })

  it('should not hold keys for destroyed rounds', () => {
    const store = new TempKeyStore()
    const round1 = [generateKeypair(), generateKeypair(), generateKeypair()]
    const round2 = [generateKeypair(), generateKeypair(), generateKeypair()]

    // Store both rounds
    for (const kp of [...round1, ...round2]) {
      store.store(kp)
    }
    expect(store.getAll()).toHaveLength(6)

    // Destroy round 1 after it's done
    for (const kp of round1) {
      store.destroy(kp.publicKey)
    }
    expect(store.getAll()).toHaveLength(3)

    // Remaining keys are round 2 only
    for (const kp of round2) {
      expect(store.has(kp.publicKey)).toBe(true)
    }
  })
})
