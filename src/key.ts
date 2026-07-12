import { generateSecretKey, getPublicKey } from 'nostr-tools'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import type { KeyPair } from './models.js'

export function generateKeypair(): KeyPair {
  const secretKey = generateSecretKey()
  const privateKey = bytesToHex(secretKey)
  const publicKey = getPublicKey(secretKey)
  return { privateKey, publicKey }
}

export function secretKeyBytes(privateKeyHex: string): Uint8Array {
  return hexToBytes(privateKeyHex)
}

export class TempKeyStore {
  private keys = new Map<string, KeyPair>()

  store(key: KeyPair): void {
    this.keys.set(key.publicKey, key)
  }

  get(publicKey: string): KeyPair | undefined {
    return this.keys.get(publicKey)
  }

  destroy(publicKey: string): void {
    this.keys.delete(publicKey)
  }

  destroyAll(): void {
    this.keys.clear()
  }

  getAll(): KeyPair[] {
    return Array.from(this.keys.values())
  }

  has(publicKey: string): boolean {
    return this.keys.has(publicKey)
  }
}
