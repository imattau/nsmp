import { describe, it, expect } from 'vitest'
import { generateKeypair } from '../src/key.js'
import { encrypt, decrypt } from '../src/crypto.js'

describe('NIP-44 encrypt/decrypt', () => {
  it('should encrypt and decrypt a message', () => {
    const alice = generateKeypair()
    const bob = generateKeypair()
    const plaintext = 'Hello Bob, this is a secret message!'

    const ciphertext = encrypt(plaintext, alice.privateKey, bob.publicKey)
    expect(ciphertext).toBeTruthy()
    expect(ciphertext).not.toBe(plaintext)

    const decrypted = decrypt(ciphertext, bob.privateKey, alice.publicKey)
    expect(decrypted).toBe(plaintext)
  })

  it('should fail to decrypt with wrong key', () => {
    const alice = generateKeypair()
    const bob = generateKeypair()
    const eve = generateKeypair()
    const plaintext = 'Secret'

    const ciphertext = encrypt(plaintext, alice.privateKey, bob.publicKey)
    expect(() => decrypt(ciphertext, eve.privateKey, alice.publicKey)).toThrow()
  })
})
