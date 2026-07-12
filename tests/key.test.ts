import { describe, it, expect } from 'vitest'
import { generateKeypair, secretKeyBytes, TempKeyStore } from '../src/key.js'

describe('generateKeypair', () => {
  it('should generate a keypair with hex keys', () => {
    const kp = generateKeypair()
    expect(kp.privateKey).toMatch(/^[0-9a-f]{64}$/)
    expect(kp.publicKey).toMatch(/^[0-9a-f]{64}$/)
    expect(kp.privateKey).not.toBe(kp.publicKey)
  })

  it('should generate unique keypairs each call', () => {
    const a = generateKeypair()
    const b = generateKeypair()
    expect(a.privateKey).not.toBe(b.privateKey)
    expect(a.publicKey).not.toBe(b.publicKey)
  })

  it('secretKeyBytes converts hex to bytes', () => {
    const kp = generateKeypair()
    const bytes = secretKeyBytes(kp.privateKey)
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(bytes.length).toBe(32)
    const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
    expect(hex).toBe(kp.privateKey)
  })
})

describe('TempKeyStore', () => {
  it('should store and retrieve keys', () => {
    const store = new TempKeyStore()
    const kp = generateKeypair()
    store.store(kp)
    expect(store.get(kp.publicKey)).toEqual(kp)
    expect(store.has(kp.publicKey)).toBe(true)
  })

  it('should destroy keys', () => {
    const store = new TempKeyStore()
    const kp = generateKeypair()
    store.store(kp)
    store.destroy(kp.publicKey)
    expect(store.get(kp.publicKey)).toBeUndefined()
    expect(store.has(kp.publicKey)).toBe(false)
  })

  it('should return all keys', () => {
    const store = new TempKeyStore()
    const a = generateKeypair()
    const b = generateKeypair()
    store.store(a)
    store.store(b)
    const all = store.getAll()
    expect(all).toHaveLength(2)
    expect(all).toContainEqual(a)
    expect(all).toContainEqual(b)
  })

  it('should clear all keys', () => {
    const store = new TempKeyStore()
    store.store(generateKeypair())
    store.store(generateKeypair())
    store.destroyAll()
    expect(store.getAll()).toHaveLength(0)
  })
})
