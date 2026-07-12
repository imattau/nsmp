import { h } from 'preact'
import { useComputed } from '@preact/signals'
import { useEffect, useState } from 'preact/hooks'
import { getPublicKey } from 'nostr-tools'
import { hexToBytes } from '@noble/hashes/utils.js'
import { authState, saveAuth, getSavedAuthMethod, getSavedNsecKey, clearAuth } from './stores/auth.js'
import { waitForNip07 } from './auth/nip07.js'
import { startClient } from './nsmp/bridge.js'
import { LoginPage } from './pages/LoginPage.js'
import { ChatPage } from './pages/ChatPage.js'

export function App() {
  const auth = useComputed(() => authState.value)
  const [busy, setBusy] = useState(true)

  useEffect(() => {
    const saved = getSavedAuthMethod()
    if (!saved) {
      setBusy(false)
      return
    }

    let cancelled = false

    async function autoLogin() {
      try {
        if (saved === 'nsec') {
          const hexKey = getSavedNsecKey()
          if (!hexKey) return
          const pubkey = getPublicKey(hexToBytes(hexKey))
          const keypair = { privateKey: hexKey, publicKey: pubkey }
          const client = await startClient(keypair)
          if (cancelled) return
          authState.value = { pubkey, npub: pubkey, loginMethod: 'nsec', client }
          return
        }

        if (saved === 'nip07') {
          const ext = await waitForNip07(4000)
          const pubkey = await ext.getPublicKey()
          const keypair = { privateKey: '', publicKey: pubkey }
          const client = await startClient(keypair, ext)
          if (cancelled) return
          authState.value = {
            pubkey,
            npub: pubkey,
            loginMethod: 'nip07',
            client,
            nip07Signer: ext.signEvent.bind(ext),
          }
          return
        }
      } catch {
        clearAuth()
      } finally {
        if (!cancelled) setBusy(false)
      }
    }

    autoLogin()

    return () => { cancelled = true }
  }, [])

  if (busy) return null
  return auth.value ? <ChatPage /> : <LoginPage />
}
