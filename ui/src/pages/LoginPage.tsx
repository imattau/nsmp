import { h } from 'preact'
import { useState, useEffect, useRef } from 'preact/hooks'
import { getPublicKey } from 'nostr-tools'
import { hexToBytes } from '@noble/hashes/utils.js'
import { authState, saveAuth } from '../stores/auth.js'
import { isNip07Available, getNip07Extension, waitForNip07 } from '../auth/nip07.js'
import { isPasskeySupported, registerPasskey, unlockPasskey } from '../auth/passkey.js'
import { normalizePrivateKey } from '../auth/utils.js'
import { startClient } from '../nsmp/bridge.js'

export function LoginPage() {
  const [nip07, setNip07] = useState<'detecting' | 'available' | 'unavailable'>('detecting')
  const [passkey, setPasskey] = useState(false)
  const [nsec, setNsec] = useState('')
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    // Detect NIP-07 with retry via MutationObserver
    waitForNip07(4000)
      .then(() => setNip07('available'))
      .catch(() => setNip07(isNip07Available() ? 'available' : 'unavailable'))

    isPasskeySupported().then(setPasskey)
  }, [])

  async function loginWithNip07() {
    setLoading(true)
    setStatus('Requesting extension access...')
    try {
      const ext = getNip07Extension()
      if (!ext) throw new Error('NIP-07 extension not found')

      const pubkey = await ext.getPublicKey()
      const keypair = { privateKey: '', publicKey: pubkey }
      const client = await startClient(keypair, ext)

      authState.value = {
        pubkey,
        npub: pubkey,
        loginMethod: 'nip07',
        client,
        nip07Signer: ext.signEvent.bind(ext),
      }
      saveAuth('nip07')
    } catch (e: any) {
      setStatus(e.message ?? 'Extension login failed')
    } finally {
      setLoading(false)
    }
  }

  async function loginWithPasskey() {
    setLoading(true)
    setStatus('Unlocking passkey...')
    try {
      const result = await unlockPasskey()
      const keypair = { privateKey: result.secretKey, publicKey: result.pubkey }
      const client = await startClient(keypair)

      authState.value = {
        pubkey: result.pubkey,
        npub: result.pubkey,
        loginMethod: 'passkey',
        client,
      }
      saveAuth('passkey')
    } catch (e: any) {
      setStatus(e.message ?? 'Passkey login failed')
    } finally {
      setLoading(false)
    }
  }

  async function registerWithPasskey() {
    setLoading(true)
    setStatus('Creating passkey...')
    try {
      const result = await registerPasskey()
      const keypair = { privateKey: result.secretKey, publicKey: result.pubkey }
      const client = await startClient(keypair)

      authState.value = {
        pubkey: result.pubkey,
        npub: result.pubkey,
        loginMethod: 'passkey',
        client,
      }
      saveAuth('passkey')
    } catch (e: any) {
      setStatus(e.message ?? 'Passkey registration failed')
    } finally {
      setLoading(false)
    }
  }

  function handleNsecLogin() {
    const raw = nsec.trim()
    if (!raw) return
    setLoading(true)
    setStatus('Logging in...')
    try {
      const privkey = normalizePrivateKey(raw)
      const pubkey = getPublicKey(hexToBytes(privkey))
      const keypair = { privateKey: privkey, publicKey: pubkey }
      startClient(keypair).then((client) => {
        authState.value = {
          pubkey,
          npub: pubkey,
          loginMethod: 'nsec',
          client,
        }
        saveAuth('nsec')
      })
    } catch (e: any) {
      setStatus('Invalid nsec')
      setLoading(false)
    }
  }

  const nip07Label = nip07 === 'detecting' ? 'Detecting extension...'
    : nip07 === 'available' ? 'NIP-07 browser extension detected'
    : 'No extension found'

  return (
    <div class="login-page">
      <div class="login-logo">🛡️</div>
      <h1 class="login-title">NSMP Messenger</h1>
      <p class="login-subtitle">Nostr Stealth Messaging Protocol</p>

      <div class="login-buttons">
        <button
          class="login-btn"
          onClick={loginWithNip07}
          disabled={nip07 !== 'available' || loading}
        >
          <span class="login-btn-icon">🦊</span>
          <span class="login-btn-label">
            Sign with Extension
            <small>{nip07Label}</small>
          </span>
        </button>

        <button
          class="login-btn"
          onClick={loginWithPasskey}
          disabled={!passkey || loading}
        >
          <span class="login-btn-icon">🔑</span>
          <span class="login-btn-label">
            Sign with Passkey
            <small>
              {passkey ? 'Face ID / Touch ID / Windows Hello' : 'Not supported in this browser'}
            </small>
          </span>
        </button>

        {passkey && (
          <button
            class="login-btn"
            onClick={registerWithPasskey}
            disabled={loading}
          >
            <span class="login-btn-icon">➕</span>
            <span class="login-btn-label">
              Create New Passkey
              <small>Generate a new Nostr identity</small>
            </span>
          </button>
        )}
      </div>

      <div class="login-divider">or</div>

      <div class="login-nsec-form">
          <input
            class="login-nsec-input"
            type="password"
            placeholder="nsec1... or hex private key..."
            value={nsec}
            onInput={(e) => setNsec((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleNsecLogin() }}
          />
        <button
          class="login-submit-btn"
          onClick={handleNsecLogin}
          disabled={!nsec.trim() || loading}
        >
          Sign In
        </button>
      </div>

      {status && <p class="login-status">{status}</p>}
    </div>
  )
}
