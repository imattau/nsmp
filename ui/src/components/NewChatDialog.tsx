import { h } from 'preact'
import { useState, useEffect, useMemo } from 'preact/hooks'
import { contacts, contactsLoading, getContactDisplayName, type Contact } from '../stores/contacts.js'
import { createConversation } from '../stores/conversations.js'
import { normalizePubkey } from '../auth/utils.js'
import { Avatar } from './Avatar.js'
import { npubEncode } from 'nostr-tools/nip19'

interface NewChatDialogProps {
  onClose: () => void
}

function hexToNpub(hex: string): string {
  try {
    return npubEncode(hex)
  } catch {
    return ''
  }
}

export function NewChatDialog({ onClose }: NewChatDialogProps) {
  const [search, setSearch] = useState('')
  const [manualPubkey, setManualPubkey] = useState('')
  const [mode, setMode] = useState<'contacts' | 'manual'>('contacts')
  const [invalid, setInvalid] = useState(false)
  const contactList = contacts

  const npubCache = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of contactList.value) {
      map.set(c.pubkey, hexToNpub(c.pubkey))
    }
    return map
  }, [contactList.value])

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    if (!q) return contactList.value
    return contactList.value.filter((c) => {
      const name = getContactDisplayName(c).toLowerCase()
      if (name.includes(q)) return true
      if (c.pubkey.toLowerCase().includes(q)) return true
      const npub = npubCache.get(c.pubkey)
      if (npub && npub.includes(q)) return true
      return false
    })
  }, [search, contactList.value, npubCache])

  function startChat(pubkey: string, picture?: string) {
    try {
      const hex = normalizePubkey(pubkey)
      createConversation(hex, picture)
      onClose()
    } catch {
      setInvalid(true)
    }
  }

  function startChatFromContact(c: Contact) {
    startChat(c.pubkey, c.picture)
  }

  function handleManualSubmit() {
    startChat(manualPubkey.trim())
  }

  function handleOverlayClick(e: h.JSX.TargetedMouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) onClose()
  }

  return (
    <div class="newchat-overlay" onClick={handleOverlayClick}>
      <div class="newchat-dialog">
        <div class="newchat-header">
          <h3>{mode === 'contacts' ? 'New Conversation' : 'Enter Public Key'}</h3>
          <button class="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div class="newchat-tabs">
          <button
            class={`newchat-tab${mode === 'contacts' ? ' active' : ''}`}
            onClick={() => setMode('contacts')}
          >
            Contacts
          </button>
          <button
            class={`newchat-tab${mode === 'manual' ? ' active' : ''}`}
            onClick={() => setMode('manual')}
          >
            Manual Entry
          </button>
        </div>

        {mode === 'contacts' && (
          <div class="newchat-contacts">
            {contactsLoading.value && (
              <div class="newchat-loading">Loading contacts...</div>
            )}

            {!contactsLoading.value && contactList.value.length === 0 && (
              <div class="newchat-empty">
                No contacts found. Your contact list will be fetched from the relays.
              </div>
            )}

            {contactList.value.length > 0 && (
              <input
                class="newchat-search"
                placeholder="Search contacts..."
                value={search}
                onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
                autoFocus
              />
            )}

            <div class="newchat-list">
              {filtered.map((c) => (
                <div
                  key={c.pubkey}
                  class="newchat-contact"
                  onClick={() => startChatFromContact(c)}
                >
                  <Avatar
                    name={getContactDisplayName(c)}
                    pubkey={c.pubkey}
                    picture={c.picture}
                    small
                  />
                  <div class="newchat-contact-info">
                    <div class="newchat-contact-name">{getContactDisplayName(c)}</div>
                    <div class="newchat-contact-pubkey">{c.pubkey.slice(0, 12)}...</div>
                  </div>
                  <button
                    class="newchat-start-btn"
                    onClick={(e) => { e.stopPropagation(); startChatFromContact(c) }}
                  >
                    Chat
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {mode === 'manual' && (
          <div class="newchat-manual">
            <p class="newchat-manual-hint">
              Enter the recipient's <strong>npub</strong> to start a stealth conversation.
              Hex format is also accepted.
            </p>
            <input
              class="newchat-pubkey-input"
              placeholder="npub1..."
              value={manualPubkey}
              onInput={(e) => { setManualPubkey((e.target as HTMLInputElement).value); setInvalid(false) }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleManualSubmit() }}
              autoFocus
            />
            {invalid && <p class="newchat-error">Invalid public key — expected npub or hex</p>}
            <button
              class="newchat-submit"
              onClick={handleManualSubmit}
              disabled={manualPubkey.trim().length < 10}
            >
              Start Conversation
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
