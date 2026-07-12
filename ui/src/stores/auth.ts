import { signal } from '@preact/signals'
import type { Client } from '../../../src/client.js'

export type LoginMethod = 'nip07' | 'passkey' | 'nsec'

export interface AuthState {
  pubkey: string
  npub: string
  loginMethod: LoginMethod
  client: Client
  nip07Signer?: (event: { kind: number; tags: string[][]; content: string; created_at: number }) => Promise<any>
}

export const authState = signal<AuthState | null>(null)

const STORAGE_KEY = 'nsmp-auth'

export function saveAuth(method: LoginMethod): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ method }))
}

export function clearAuth(): void {
  localStorage.removeItem(STORAGE_KEY)
}

export function getSavedAuthMethod(): LoginMethod | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw)
    return data.method ?? null
  } catch {
    return null
  }
}
