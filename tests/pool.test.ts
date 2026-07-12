import { describe, it, expect } from 'vitest'
import { chooseNextRelays, bootstrapRelays, shardRelays } from '../src/pool.js'

const POOL = [
  'wss://a.example.com', 'wss://b.example.com', 'wss://c.example.com',
  'wss://d.example.com', 'wss://e.example.com', 'wss://f.example.com',
  'wss://g.example.com', 'wss://h.example.com', 'wss://i.example.com',
  'wss://j.example.com', 'wss://k.example.com', 'wss://l.example.com',
]

describe('pool', () => {
  it('bootstrapRelays returns 6 relays', () => {
    const relays = bootstrapRelays()
    expect(relays).toHaveLength(6)
    for (const r of relays) {
      expect(r).toMatch(/^wss:\/\//)
    }
  })

  it('chooseNextRelays returns 6 disjoint relays', () => {
    const current = POOL.slice(0, 6)
    const next = chooseNextRelays(current, POOL)
    expect(next).toHaveLength(6)
    for (const r of next) {
      expect(current).not.toContain(r)
      expect(POOL).toContain(r)
    }
  })

  it('chooseNextRelays returns fewer than 6 when pool is small', () => {
    const small = ['wss://r1.com', 'wss://r2.com', 'wss://r3.com']
    const result = chooseNextRelays(['wss://r1.com'], small)
    expect(result.length).toBe(2)
    expect(result).not.toContain('wss://r1.com')
  })

  it('chooseNextRelays returns empty when no disjoint relays exist', () => {
    const only = ['wss://only.com']
    const result = chooseNextRelays(['wss://only.com'], only)
    expect(result).toHaveLength(0)
  })

  it('shardRelays maps shard index to relay pair', () => {
    const relays = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6']
    expect(shardRelays(relays, 1)).toEqual(['r1', 'r2'])
    expect(shardRelays(relays, 2)).toEqual(['r3', 'r4'])
    expect(shardRelays(relays, 3)).toEqual(['r5', 'r6'])
  })
})
