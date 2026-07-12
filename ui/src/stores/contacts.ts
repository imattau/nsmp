import { signal } from '@preact/signals'
import { conversations as convSignal } from './conversations.js'

export interface Contact {
  pubkey: string
  relay?: string
  petname?: string
  displayName?: string
  picture?: string
  loaded: boolean
}

export const contacts = signal<Contact[]>([])
export const contactsLoading = signal(false)
export const contactsError = signal<string | null>(null)
export const contactsLastFetched = signal<number>(0)

const CACHE_TTL = 60 * 60 * 1000 // 1 hour

function shortName(pubkey: string): string {
  return pubkey.slice(0, 8) + '...' + pubkey.slice(-4)
}

function cacheKey(userPubkey: string): string {
  return `nsmp-contacts-${userPubkey}`
}

function loadFromCache(userPubkey: string): Contact[] | null {
  try {
    const raw = localStorage.getItem(cacheKey(userPubkey))
    if (!raw) return null
    const data = JSON.parse(raw)
    if (Date.now() - data.timestamp > CACHE_TTL) return null
    return data.contacts as Contact[]
  } catch {
    return null
  }
}

function saveToCache(userPubkey: string, contactsList: Contact[]): void {
  try {
    localStorage.setItem(cacheKey(userPubkey), JSON.stringify({
      timestamp: Date.now(),
      contacts: contactsList,
    }))
  } catch {
    // localStorage full or unavailable — skip
  }
}

export async function fetchContacts(relayUrls: string[], userPubkey: string, force = false): Promise<void> {
  // Try cache first
  if (!force) {
    const cached = loadFromCache(userPubkey)
    if (cached) {
      contacts.value = cached
      contactsLastFetched.value = Date.now()
      syncConversationsFromContacts()
      return
    }
  }

  contactsLoading.value = true
  contactsError.value = null

  try {
    const { queryEvents } = await import('../../../src/relay.js')

    const results: Map<string, Contact> = new Map()

    for (const relayUrl of relayUrls) {
      try {
        const events = await queryEvents(relayUrl, {
          kinds: [3],
          authors: [userPubkey],
          limit: 1,
        })

        for (const event of events) {
          for (const tag of event.tags) {
            if (tag[0] === 'p' && tag[1]) {
              if (!results.has(tag[1])) {
                results.set(tag[1], {
                  pubkey: tag[1],
                  relay: tag[2],
                  petname: tag[3],
                  loaded: false,
                })
              }
            }
          }
        }
      } catch {
        continue
      }
    }

    const contactList = Array.from(results.values())
    contacts.value = contactList

    // Fetch metadata (kind 0) for display names + avatars
    for (const relayUrl of relayUrls.slice(0, 3)) {
      try {
        const kind0Events = await queryEvents(relayUrl, {
          kinds: [0],
          authors: contactList.map((c) => c.pubkey),
          limit: contactList.length,
        })

        for (const ev of kind0Events) {
          try {
            const meta = JSON.parse(ev.content)
            const name = meta.name || meta.display_name || meta.nip05 || ''
            const picture = typeof meta.picture === 'string' ? meta.picture : undefined
            const existing = results.get(ev.pubkey)
            if (existing) {
              const idx = contactList.indexOf(existing)
              if (idx !== -1) {
                contactList[idx] = {
                  ...existing,
                  displayName: name,
                  picture,
                  loaded: true,
                }
              }
            }
          } catch {
            // invalid metadata JSON
          }
        }
      } catch {
        continue
      }
    }

    contacts.value = contactList
    contactsLastFetched.value = Date.now()

    // Sync names + pictures into existing conversations
    syncConversationsFromContacts()

    // Persist to localStorage
    saveToCache(userPubkey, contactList)
  } catch (e: any) {
    contactsError.value = e.message ?? 'Failed to fetch contacts'
  } finally {
    contactsLoading.value = false
  }
}

export function getContactDisplayName(contact: Contact): string {
  return contact.displayName || contact.petname || shortName(contact.pubkey)
}

export function getContactAvatar(contact: Contact): string | undefined {
  return contact.picture
}

function syncConversationsFromContacts(): void {
  const map = convSignal.value
  let changed = false
  for (const contact of contacts.value) {
    const conv = map.get(contact.pubkey)
    if (conv) {
      const newName = contact.displayName || contact.petname || conv.recipientName
      if (newName !== conv.recipientName || contact.picture !== conv.recipientPicture) {
        map.set(contact.pubkey, { ...conv, recipientName: newName, recipientPicture: contact.picture })
        changed = true
      }
    }
  }
  if (changed) convSignal.value = new Map(map)
}
