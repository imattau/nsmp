import type { SignedEvent } from '../../../src/models.js'

export interface Nip07Extension {
  getPublicKey(): Promise<string>
  signEvent(event: { kind: number; tags: string[][]; content: string; created_at: number }): Promise<any>
  nip44?: {
    encrypt(pubkey: string, plaintext: string): Promise<string>
    decrypt(pubkey: string, ciphertext: string): Promise<string>
  }
}

export function isNip07Available(): boolean {
  return typeof window !== 'undefined' && typeof (window as any).nostr !== 'undefined'
}

export function getNip07Extension(): Nip07Extension | null {
  if (!isNip07Available()) return null
  return (window as any).nostr as Nip07Extension
}

export async function waitForNip07(timeoutMs = 3000): Promise<Nip07Extension> {
  const existing = getNip07Extension()
  if (existing) return existing

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      observer.disconnect()
      reject(new Error('NIP-07 extension not found'))
    }, timeoutMs)

    const observer = new MutationObserver(() => {
      const ext = getNip07Extension()
      if (ext) {
        clearTimeout(timer)
        observer.disconnect()
        resolve(ext)
      }
    })

    observer.observe(document.documentElement, { childList: true, subtree: true })
  })
}

export async function loginWithNip07(): Promise<{ pubkey: string }> {
  const ext = getNip07Extension()
  if (!ext) throw new Error('NIP-07 extension not found')

  const pubkey = await ext.getPublicKey()
  return { pubkey }
}

export async function signEventViaNip07(
  event: { kind: number; tags: string[][]; content: string; created_at: number },
): Promise<SignedEvent> {
  const ext = getNip07Extension()
  if (!ext) throw new Error('NIP-07 extension not found')

  return (await ext.signEvent(event)) as SignedEvent
}
