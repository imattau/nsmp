import { decode } from 'nostr-tools/nip19'

const HEX_RE = /^[0-9a-f]{64}$/i

export function normalizePubkey(input: string): string {
  const trimmed = input.trim()

  if (HEX_RE.test(trimmed)) {
    return trimmed.toLowerCase()
  }

  if (trimmed.startsWith('npub1')) {
    try {
      const decoded = decode(trimmed)
      if (decoded.type === 'npub' && typeof decoded.data === 'string') {
        return decoded.data
      }
    } catch {
      // fall through
    }
  }

  throw new Error('Invalid public key — expected npub or hex')
}

export function normalizePrivateKey(input: string): string {
  const trimmed = input.trim()

  if (HEX_RE.test(trimmed)) {
    return trimmed.toLowerCase()
  }

  if (trimmed.startsWith('nsec1')) {
    try {
      const decoded = decode(trimmed)
      if (decoded.type === 'nsec' && typeof decoded.data === 'string') {
        return decoded.data
      }
    } catch {
      // fall through
    }
  }

  throw new Error('Invalid private key — expected nsec or hex')
}

export function isValidNpub(input: string): boolean {
  try {
    normalizePubkey(input)
    return true
  } catch {
    return false
  }
}
