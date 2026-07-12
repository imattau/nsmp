import { describe, it, expect } from 'vitest'
import { generateKeypair } from '../src/key.js'
import type { KeyPair } from '../src/models.js'
import {
  generateShardLabels,
  buildPayload,
  createShards,
  findShardIndex,
} from '../src/shard.js'

describe('generateShardLabels', () => {
  it('should generate 3 unique labels of length 5', () => {
    const labels = generateShardLabels()
    expect(labels).toHaveLength(3)
    for (const label of labels) {
      expect(label).toMatch(/^[a-z0-9]{5}$/)
    }
    const unique = new Set(labels)
    expect(unique.size).toBe(3)
  })
})

describe('buildPayload', () => {
  it('should create a payload with correct fields', () => {
    const labels = generateShardLabels()
    const payload = buildPayload({
      shardIndex: 1,
      content: 'Hello',
      shardLabels: { '1': labels[0], '2': labels[1], '3': labels[2] },
      peerRelays: ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'],
      nextRelays: ['r7', 'r8', 'r9', 'r10', 'r11', 'r12'],
      nextTargets: ['a1', 'a2', 'a3'],
      conversation: { sender: 'alice', recipient: 'bob' },
    })
    expect(payload.shard_index).toBe(1)
    expect(payload.shard_total).toBe(3)
    expect(payload.content).toBe('Hello')
    expect(payload.shard_labels['1']).toBe(labels[0])
    expect(payload.peer_relays).toHaveLength(6)
    expect(payload.next_relays).toHaveLength(6)
    expect(payload.next_targets).toHaveLength(3)
    expect(payload.conversation?.sender).toBe('alice')
  })
})

describe('createShards', () => {
  it('should create 3 shard events', () => {
    const senderKeys: [KeyPair, KeyPair, KeyPair] = [generateKeypair(), generateKeypair(), generateKeypair()]
    const recipientPubkey = generateKeypair().publicKey
    const labels = generateShardLabels()
    const relays = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6']

    const basePayload = {
      shard_total: 3,
      content: 'Secret message',
      shard_labels: { '1': labels[0], '2': labels[1], '3': labels[2] },
      peer_relays: ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'],
      next_relays: ['r7', 'r8', 'r9', 'r10', 'r11', 'r12'],
      next_targets: ['t1', 't2', 't3'],
    }

    const shards = createShards({
      payload: basePayload,
      senderKeys,
      recipientPubkey,
      currentRelays: relays,
    })

    expect(shards).toHaveLength(3)
    const usedPubkeys = new Set<string>()
    for (let i = 0; i < 3; i++) {
      const shard = shards[i]
      expect(shard.signedEvent.kind).toBe(1059)
      expect(shard.signedEvent.pubkey).toBe(senderKeys[i].publicKey)
      usedPubkeys.add(shard.signedEvent.pubkey)
      expect(shard.signedEvent.tags).toContainEqual(['p', recipientPubkey])
      expect(shard.signedEvent.tags).toContainEqual(['shard', labels[i]])
      expect(shard.relays).toEqual([relays[i * 2], relays[i * 2 + 1]])
    }
    expect(usedPubkeys.size).toBe(3) // each shard signed by a different key
  })
})

describe('findShardIndex', () => {
  it('should find the correct index for a label', () => {
    const labels = { '1': 'abc12', '2': 'def34', '3': 'ghi56' }
    expect(findShardIndex('def34', labels)).toBe(2)
    expect(findShardIndex('ghi56', labels)).toBe(3)
    expect(findShardIndex('unknown', labels)).toBeUndefined()
  })
})
