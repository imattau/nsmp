import { describe, it, expect, vi, beforeEach } from 'vitest'
import { chooseNextRelays, bootstrapRelays, shardRelays, RelayPool } from '../src/pool.js'
import * as discovery from '../src/discovery.js'

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

  it('chooseNextRelays returns up to 6 even when pool is small', () => {
    const small = ['wss://r1.com', 'wss://r2.com', 'wss://r3.com']
    const result = chooseNextRelays(['wss://r1.com'], small)
    expect(result.length).toBe(3)
    // No duplicates
    expect(new Set(result).size).toBe(result.length)
  })

  it('chooseNextRelays returns 6 when no disjoint relays exist (reuses from current)', () => {
    const only = ['wss://only.com']
    const result = chooseNextRelays(['wss://only.com'], only)
    expect(result).toHaveLength(1)
    expect(result).toContain('wss://only.com')
  })

  it('shardRelays maps shard index to relay pair', () => {
    const relays = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6']
    expect(shardRelays(relays, 1)).toEqual(['r1', 'r2'])
    expect(shardRelays(relays, 2)).toEqual(['r3', 'r4'])
    expect(shardRelays(relays, 3)).toEqual(['r5', 'r6'])
  })
})

describe('RelayPool', () => {
  let pool: RelayPool

  beforeEach(() => {
    vi.restoreAllMocks()
    pool = new RelayPool({ poolSize: 10, minScore: 0 })
  })

  it('should start with empty pool', () => {
    expect(pool.getRelays()).toHaveLength(0)
  })

  it('should add relays', () => {
    pool.addRelays(['wss://r1.com', 'wss://r2.com'])
    const relays = pool.getRelays()
    expect(relays).toContain('wss://r1.com')
    expect(relays).toContain('wss://r2.com')
  })

  it('should not duplicate relays', () => {
    pool.addRelays(['wss://r1.com'])
    pool.addRelays(['wss://r1.com'])
    expect(pool.getRelays()).toHaveLength(1)
  })

  it('should remove relays', () => {
    pool.addRelays(['wss://r1.com'])
    pool.removeRelay('wss://r1.com')
    expect(pool.getRelays()).toHaveLength(0)
  })

  it('should track relay health via recordSuccess/recordFailure', () => {
    pool.addRelays(['wss://r1.com'])
    expect(pool.isHealthy('wss://r1.com')).toBe(true)
    pool.recordFailure('wss://r1.com')
    pool.recordFailure('wss://r1.com')
    pool.recordFailure('wss://r1.com')
    expect(pool.isHealthy('wss://r1.com')).toBe(false)
    pool.recordSuccess('wss://r1.com')
    expect(pool.isHealthy('wss://r1.com')).toBe(true)
  })

  it('should exclude unhealthy relays from getRelays', () => {
    pool.addRelays(['wss://r1.com', 'wss://r2.com'])
    pool.recordFailure('wss://r1.com')
    pool.recordFailure('wss://r1.com')
    pool.recordFailure('wss://r1.com')
    const relays = pool.getRelays()
    expect(relays).not.toContain('wss://r1.com')
    expect(relays).toContain('wss://r2.com')
  })

  it('should prune unhealthy relays', () => {
    pool.addRelays(['wss://r1.com', 'wss://r2.com'])
    pool.recordFailure('wss://r1.com')
    pool.recordFailure('wss://r1.com')
    pool.recordFailure('wss://r1.com')
    const removed = pool.pruneUnhealthy()
    expect(removed).toContain('wss://r1.com')
    expect(pool.getRelays()).toHaveLength(1)
    expect(pool.getRelays()).toContain('wss://r2.com')
  })

  it('should provide random disjoint selection', () => {
    pool.addRelays(['wss://r1.com', 'wss://r2.com', 'wss://r3.com', 'wss://r4.com', 'wss://r5.com', 'wss://r6.com', 'wss://r7.com', 'wss://r8.com'])
    const result = pool.getRandomDisjoint(['wss://r1.com', 'wss://r2.com'], 3)
    expect(result).toHaveLength(3)
    expect(result).not.toContain('wss://r1.com')
    expect(result).not.toContain('wss://r2.com')
    expect(new Set(result).size).toBe(3)
  })

  it('should call onPoolUpdate callback when relays change', () => {
    const cb = vi.fn()
    pool.onPoolUpdate(cb)
    pool.addRelays(['wss://r1.com'])
    expect(cb).toHaveBeenCalled()
  })

  it('should allow unsubscribing from pool updates', () => {
    const cb = vi.fn()
    const unsub = pool.onPoolUpdate(cb)
    unsub()
    pool.addRelays(['wss://r1.com'])
    expect(cb).not.toHaveBeenCalled()
  })

  it('should get config', () => {
    const cfg = pool.getConfig()
    expect(cfg.poolSize).toBe(10)
    expect(cfg.minScore).toBe(0)
    expect(cfg.maxConsecutiveFailures).toBe(3)
  })

  it('should seed from bootstrap when discovery returns nothing', async () => {
    vi.spyOn(discovery, 'fetchFromTrustedRelays').mockRejectedValue(new Error('fail'))
    vi.spyOn(discovery, 'fetchFromGeorelays').mockRejectedValue(new Error('fail'))
    await pool.seed()
    expect(pool.getRelays().length).toBeGreaterThanOrEqual(6)
  })

  it('should return healthy entries only', () => {
    pool.addRelays(['wss://r1.com', 'wss://r2.com'])
    pool.recordFailure('wss://r1.com')
    pool.recordFailure('wss://r1.com')
    pool.recordFailure('wss://r1.com')
    const healthy = pool.getHealthyEntries()
    expect(healthy).toHaveLength(1)
    expect(healthy[0].url).toBe('wss://r2.com')
  })
})
