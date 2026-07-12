import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mergeAndDedupe, selectTopRelays } from '../src/discovery.js'
import type { RelayEntry } from '../src/models.js'

describe('discovery', () => {
  describe('mergeAndDedupe', () => {
    it('should merge multiple sources', () => {
      const a: RelayEntry[] = [
        { url: 'wss://r1.com', score: 80 },
        { url: 'wss://r2.com', score: 90 },
      ]
      const b: RelayEntry[] = [
        { url: 'wss://r3.com', score: 70 },
      ]
      const result = mergeAndDedupe([a, b])
      expect(result).toHaveLength(3)
    })

    it('should deduplicate by URL keeping higher score', () => {
      const a: RelayEntry[] = [
        { url: 'wss://r1.com', score: 80, countryCode: 'US' },
      ]
      const b: RelayEntry[] = [
        { url: 'wss://r1.com', score: 90, countryCode: 'DE' },
      ]
      const result = mergeAndDedupe([a, b])
      expect(result).toHaveLength(1)
      expect(result[0].score).toBe(90)
      expect(result[0].countryCode).toBe('DE')
    })

    it('should keep existing entry when new entry has lower score', () => {
      const a: RelayEntry[] = [
        { url: 'wss://r1.com', score: 90, countryCode: 'US' },
      ]
      const b: RelayEntry[] = [
        { url: 'wss://r1.com', score: 50, countryCode: 'DE' },
      ]
      const result = mergeAndDedupe([a, b])
      expect(result).toHaveLength(1)
      expect(result[0].score).toBe(90)
      expect(result[0].countryCode).toBe('US')
    })

    it('should handle empty sources', () => {
      const result = mergeAndDedupe([[], []])
      expect(result).toHaveLength(0)
    })
  })

  describe('selectTopRelays', () => {
    const relays: RelayEntry[] = [
      { url: 'wss://r1.com', score: 95, software: 'strfry' },
      { url: 'wss://r2.com', score: 90, software: 'nostream' },
      { url: 'wss://r3.com', score: 85, software: 'strfry' },
      { url: 'wss://r4.com', score: 80, software: 'nostream' },
      { url: 'wss://r5.com', score: 75, software: 'relay.tools' },
    ]

    it('should select top N relays with software diversity', () => {
      const result = selectTopRelays(relays, { poolSize: 3 })
      expect(result).toHaveLength(3)
      expect(result[0].score).toBe(95)
      expect(result[1].score).toBe(90)
      expect(result[0].url).toBe('wss://r1.com')
      expect(result[1].url).toBe('wss://r2.com')
      expect(result[2].url).toBe('wss://r5.com')
    })

    it('should filter by minScore', () => {
      const result = selectTopRelays(relays, { minScore: 85, poolSize: 10 })
      expect(result).toHaveLength(3)
      expect(result.every((r) => r.score >= 85)).toBe(true)
    })

    it('should distribute across software when possible', () => {
      const manyRelays: RelayEntry[] = []
      for (let i = 0; i < 10; i++) {
        manyRelays.push({ url: `wss://strfry-${i}.com`, score: 100 - i, software: 'strfry' })
        manyRelays.push({ url: `wss://nostream-${i}.com`, score: 90 - i, software: 'nostream' })
        manyRelays.push({ url: `wss://other-${i}.com`, score: 80 - i, software: 'other' })
      }
      const result = selectTopRelays(manyRelays, { poolSize: 6 })
      expect(result).toHaveLength(6)
    })

    it('should return all relays when poolSize exceeds count', () => {
      const result = selectTopRelays(relays, { poolSize: 100 })
      expect(result).toHaveLength(5)
    })

    it('should filter by required NIPs', () => {
      const withNips: RelayEntry[] = [
        { url: 'wss://r1.com', score: 95, supportedNips: [1, 11, 40] },
        { url: 'wss://r2.com', score: 90, supportedNips: [1, 11] },
        { url: 'wss://r3.com', score: 85, supportedNips: [1] },
      ]
      const result = selectTopRelays(withNips, { requireNips: [11, 40], poolSize: 10 })
      expect(result).toHaveLength(1)
      expect(result[0].url).toBe('wss://r1.com')
    })

    it('should handle relays without software field', () => {
      const mixed: RelayEntry[] = [
        { url: 'wss://r1.com', score: 95, software: 'strfry' },
        { url: 'wss://r2.com', score: 90 },
        { url: 'wss://r3.com', score: 85, software: 'strfry' },
      ]
      const result = selectTopRelays(mixed, { poolSize: 3 })
      expect(result).toHaveLength(3)
    })
  })
})
