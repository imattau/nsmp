import { describe, it, expect, beforeEach } from 'vitest'
import { RelayHealthTracker } from '../src/health.js'

describe('RelayHealthTracker', () => {
  let tracker: RelayHealthTracker

  beforeEach(() => {
    tracker = new RelayHealthTracker(3)
  })

  it('should consider unknown relays as healthy', () => {
    expect(tracker.isHealthy('wss://unknown.com')).toBe(true)
  })

  it('should mark relay healthy after successful operation', () => {
    tracker.recordSuccess('wss://r1.com')
    expect(tracker.isHealthy('wss://r1.com')).toBe(true)
  })

  it('should mark relay unhealthy after max consecutive failures', () => {
    tracker.recordFailure('wss://r1.com')
    tracker.recordFailure('wss://r1.com')
    tracker.recordFailure('wss://r1.com')
    expect(tracker.isHealthy('wss://r1.com')).toBe(false)
  })

  it('should allow failures below threshold', () => {
    tracker.recordFailure('wss://r1.com')
    tracker.recordFailure('wss://r1.com')
    expect(tracker.isHealthy('wss://r1.com')).toBe(true)
  })

  it('should reset failure count on success', () => {
    tracker.recordFailure('wss://r1.com')
    tracker.recordFailure('wss://r1.com')
    tracker.recordSuccess('wss://r1.com')
    tracker.recordFailure('wss://r1.com')
    tracker.recordFailure('wss://r1.com')
    expect(tracker.isHealthy('wss://r1.com')).toBe(true)
    tracker.recordFailure('wss://r1.com')
    expect(tracker.isHealthy('wss://r1.com')).toBe(false)
  })

  it('should return list of unhealthy relays', () => {
    tracker.recordFailure('wss://r1.com')
    tracker.recordFailure('wss://r2.com')
    tracker.recordFailure('wss://r2.com')
    tracker.recordFailure('wss://r2.com')
    tracker.recordFailure('wss://r3.com')
    tracker.recordFailure('wss://r3.com')
    tracker.recordFailure('wss://r3.com')
    const unhealthy = tracker.getUnhealthy()
    expect(unhealthy).toContain('wss://r2.com')
    expect(unhealthy).toContain('wss://r3.com')
    expect(unhealthy).not.toContain('wss://r1.com')
  })

  it('should reset a specific relay', () => {
    tracker.recordFailure('wss://r1.com')
    tracker.recordFailure('wss://r1.com')
    tracker.recordFailure('wss://r1.com')
    expect(tracker.isHealthy('wss://r1.com')).toBe(false)
    tracker.reset('wss://r1.com')
    expect(tracker.isHealthy('wss://r1.com')).toBe(true)
  })

  it('should reset all relays', () => {
    tracker.recordFailure('wss://r1.com')
    tracker.recordFailure('wss://r1.com')
    tracker.recordFailure('wss://r1.com')
    tracker.recordFailure('wss://r2.com')
    tracker.recordFailure('wss://r2.com')
    tracker.recordFailure('wss://r2.com')
    tracker.resetAll()
    expect(tracker.isHealthy('wss://r1.com')).toBe(true)
    expect(tracker.isHealthy('wss://r2.com')).toBe(true)
  })

  it('should support custom max failure threshold', () => {
    const strict = new RelayHealthTracker(1)
    strict.recordFailure('wss://r1.com')
    expect(strict.isHealthy('wss://r1.com')).toBe(false)
  })

  it('should track timestamps', () => {
    const before = Date.now()
    tracker.recordSuccess('wss://r1.com')
    const entry = tracker.getHealth('wss://r1.com')
    expect(entry).toBeDefined()
    expect(entry!.lastSuccessAt).toBeGreaterThanOrEqual(before)
    expect(entry!.lastFailureAt).toBeNull()
  })

  it('should return all tracked entries', () => {
    tracker.recordSuccess('wss://r1.com')
    tracker.recordFailure('wss://r2.com')
    const all = tracker.getAll()
    expect(all).toHaveLength(2)
  })
})
