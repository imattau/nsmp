import { nip44 } from 'nostr-tools'
import { hexToBytes } from '@noble/hashes/utils.js'

export function encrypt(
  plaintext: string,
  senderPrivateKeyHex: string,
  recipientPublicKeyHex: string,
): string {
  const convKey = nip44.getConversationKey(hexToBytes(senderPrivateKeyHex), recipientPublicKeyHex)
  return nip44.encrypt(plaintext, convKey)
}

export function decrypt(
  ciphertext: string,
  recipientPrivateKeyHex: string,
  senderPublicKeyHex: string,
): string {
  const convKey = nip44.getConversationKey(hexToBytes(recipientPrivateKeyHex), senderPublicKeyHex)
  return nip44.decrypt(ciphertext, convKey)
}
