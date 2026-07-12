import { isPRFSupported, unlockPasskeyIdentity, registerPasskeyIdentity } from 'nostr-passkey'
import { getPublicKey } from 'nostr-tools'

export async function isPasskeySupported(): Promise<boolean> {
  return isPRFSupported()
}

export interface PasskeyResult {
  secretKey: string
  pubkey: string
}

export async function registerPasskey(): Promise<PasskeyResult> {
  const result = await registerPasskeyIdentity({
    rpName: 'NSMP Messenger',
  })
  return {
    secretKey: result.secretKey as unknown as string,
    pubkey: result.pubkey,
  }
}

export async function unlockPasskey(): Promise<PasskeyResult> {
  const result = await unlockPasskeyIdentity()
  return {
    secretKey: result.secretKey as unknown as string,
    pubkey: result.pubkey,
  }
}
