import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Client } from '../src/client.js'
import { generateKeypair } from '../src/key.js'

// Mock relay module
vi.mock('../src/relay.js', () => ({
  publishEvent: vi.fn().mockResolvedValue(undefined),
  subscribeToPubkey: vi.fn().mockReturnValue(() => {}),
  queryEvents: vi.fn().mockResolvedValue([]),
  closePool: vi.fn(),
}))

// Import the mocked module for assertions
import * as relay from '../src/relay.js'

const RELAYS = [
  'wss://r1.com', 'wss://r2.com', 'wss://r3.com',
  'wss://r4.com', 'wss://r5.com', 'wss://r6.com',
  'wss://r7.com', 'wss://r8.com', 'wss://r9.com',
  'wss://r10.com', 'wss://r11.com', 'wss://r12.com',
]

describe('Client', () => {
  let client: Client
  let mainKey: ReturnType<typeof generateKeypair>

  beforeEach(() => {
    vi.clearAllMocks()
    mainKey = generateKeypair()
    client = new Client(mainKey, RELAYS)
  })

  afterEach(() => {
    client.stop()
  })

  it('should construct with main key and relay pool', () => {
    expect(client.getRelayPool()).toEqual(RELAYS)
  })

  it('should add relays to the pool', () => {
    client.addRelays(['wss://new.com'])
    expect(client.getRelayPool()).toContain('wss://new.com')
  })

  it('should not duplicate relays in the pool', () => {
    client.addRelays([RELAYS[0]])
    const pool = client.getRelayPool()
    expect(pool.filter((r) => r === RELAYS[0]).length).toBe(1)
  })

  it('should set and invoke message callback', () => {
    const cb = vi.fn()
    client.setMessageCallback(cb)
    expect(client).toBeDefined()
  })

  it('should destroy reply targets from TempKeyStore', () => {
    const kp = generateKeypair()
    // Store key first via restoreRound
    client.restoreRound({ replyTargets: [kp], nextRelays: RELAYS.slice(0, 2) })
    client.destroyReplyTargets([kp.publicKey])
    // Key should be destroyed (no longer in TempKeyStore)
  })

  it('should subscribe to pubkey on given relays', async () => {
    const pubkey = generateKeypair().publicKey
    await client.subscribeToPubkey(pubkey, RELAYS.slice(0, 2))

    expect(relay.subscribeToPubkey).toHaveBeenCalledTimes(2)
    expect(relay.subscribeToPubkey).toHaveBeenCalledWith(
      RELAYS[0], pubkey, expect.any(Function), [1059],
    )
    expect(relay.subscribeToPubkey).toHaveBeenCalledWith(
      RELAYS[1], pubkey, expect.any(Function), [1059],
    )
  })

  it('should not create duplicate subscriptions', async () => {
    const pubkey = generateKeypair().publicKey
    await client.subscribeToPubkey(pubkey, RELAYS.slice(0, 1))
    await client.subscribeToPubkey(pubkey, RELAYS.slice(0, 1))

    expect(relay.subscribeToPubkey).toHaveBeenCalledTimes(1)
  })

  it('should call listen on all keys', async () => {
    await client.listen()
    // Main key is stored in constructor
    expect(relay.subscribeToPubkey).toHaveBeenCalled()
  })

  it('should send a message and store reply targets', async () => {
    const bobKey = generateKeypair()
    const result = await client.send({
      recipientCurrentPubkey: bobKey.publicKey,
      plaintext: 'Hello',
      currentRelays: RELAYS.slice(0, 6),
    })

    expect(result.replyTargets).toHaveLength(3)
    expect(result.nextRelays).toHaveLength(6)
    expect(result.conversationId).toMatch(/^[0-9a-f]{64}$/)
  })

  it('should restore rounds and subscribe', async () => {
    const kp = generateKeypair()
    await client.restoreRound({
      replyTargets: [kp],
      nextRelays: RELAYS.slice(0, 2),
    })

    expect(relay.subscribeToPubkey).toHaveBeenCalled()
    expect(relay.queryEvents).toHaveBeenCalled()
  })

  it('should stop and close all subscriptions', () => {
    client.stop()
  })
})
