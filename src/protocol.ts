import { finalizeEvent } from 'nostr-tools'
import { randomBytes, bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import type { KeyPair, ShardPayload, ShardEvent, SignedEvent, SyncMessage } from './models.js'
import { generateKeypair, TempKeyStore } from './key.js'
import { encrypt, decrypt } from './crypto.js'
import { generateShardLabels, buildPayload, createShards, findShardIndex } from './shard.js'
import { publishEvent, queryEvents } from './relay.js'
import { chooseNextRelays } from './pool.js'

function generateConversationId(): string {
  return bytesToHex(randomBytes(32))
}

const KIND = 1059

function basePayload(payload: ShardPayload): Omit<ShardPayload, 'shard_index'> {
  const { shard_index, ...rest } = payload
  return rest
}

function threeSenderKeys(): [KeyPair, KeyPair, KeyPair] {
  return [generateKeypair(), generateKeypair(), generateKeypair()]
}

export function sendMessage(params: {
  recipientCurrentPubkey: string
  plaintext: string
  currentRelays: string[]
  myRealNpub: string
  recipientRealNpub: string
  relayPool: string[]
  conversationId?: string
  msgIndex?: number
}): { shardEvents: ShardEvent[]; replyTargets: KeyPair[]; nextRelays: string[]; conversationId: string } {
  const { recipientCurrentPubkey, plaintext, currentRelays, myRealNpub, recipientRealNpub, relayPool, conversationId: existingId, msgIndex } = params

  const conversationId = existingId ?? generateConversationId()
  const replyTargets = [generateKeypair(), generateKeypair(), generateKeypair()]
  const replyTargetsPubs = replyTargets.map((kp) => kp.publicKey)
  const nextRelays = chooseNextRelays(currentRelays, relayPool)
  const labels = generateShardLabels()

  const payload = buildPayload({
    shardIndex: 1,
    content: plaintext,
    shardLabels: { '1': labels[0], '2': labels[1], '3': labels[2] },
    peerRelays: currentRelays,
    nextRelays,
    nextTargets: replyTargetsPubs,
    conversationId,
    conversation: { sender: myRealNpub, recipient: recipientRealNpub },
    senderMsgIndex: msgIndex,
  })

  const shardEvents = createShards({
    payload: basePayload(payload),
    senderKeys: threeSenderKeys(),
    recipientPubkey: recipientCurrentPubkey,
    currentRelays,
  })

  return { shardEvents, replyTargets, nextRelays, conversationId }
}

export function processEvent(params: {
  event: SignedEvent
  myKeys: TempKeyStore
}): ShardPayload | null {
  const { event, myKeys } = params

  const pTag = event.tags.find((t) => t[0] === 'p')
  if (!pTag) return null

  const recipientPub = pTag[1]
  const keyPair = myKeys.get(recipientPub)
  if (!keyPair) return null

  try {
    const decrypted = decrypt(event.content, keyPair.privateKey, event.pubkey)
    const payload: ShardPayload = JSON.parse(decrypted)
    return payload
  } catch {
    return null
  }
}

export async function fetchMissingShards(params: {
  firstPayload: ShardPayload
  firstEvent: SignedEvent
  myKeys: TempKeyStore
}): Promise<ShardPayload[]> {
  const { firstPayload, firstEvent, myKeys } = params
  const found: ShardPayload[] = [firstPayload]

  const shardLabel = firstEvent.tags.find((t) => t[0] === 'shard')?.[1]
  if (!shardLabel) return found

  const currentIndex = findShardIndex(shardLabel, firstPayload.shard_labels)
  if (!currentIndex) return found

  const missingIndices = [1, 2, 3].filter((i) => i !== currentIndex)
  const pTag = firstEvent.tags.find((t) => t[0] === 'p')?.[1]

  for (const missingIdx of missingIndices) {
    const label = firstPayload.shard_labels[String(missingIdx)]
    const primaryIdx = (missingIdx - 1) * 2

    for (const relayUrl of [firstPayload.peer_relays[primaryIdx], firstPayload.peer_relays[primaryIdx + 1]]) {
      try {
        const events = await queryEvents(relayUrl, {
          kinds: [KIND],
          '#p': [pTag],
          '#shard': [label],
          limit: 1,
        })

        if (events.length > 0) {
          const evPtag = events[0].tags.find((t) => t[0] === 'p')
          if (!evPtag) continue
          const keyPair = myKeys.get(evPtag[1])
          if (!keyPair) continue

          const decrypted = decrypt(events[0].content, keyPair.privateKey, events[0].pubkey)
          const payload: ShardPayload = JSON.parse(decrypted)
          found.push(payload)
          break
        }
      } catch {
        continue
      }
    }
  }

  return found
}

export function buildReply(params: {
  originalPayload: ShardPayload
  replyText: string
  myRealNpub: string
  recipientRealNpub: string
  relayPool: string[]
  msgIndex?: number
}): { shardEvents: ShardEvent[]; nextTargets: KeyPair[]; nextRelays: string[] } {
  const { originalPayload, replyText, myRealNpub, recipientRealNpub, relayPool, msgIndex } = params

  const nextTargets = originalPayload.next_targets
  const nextRelays = originalPayload.next_relays

  const myNextTargets = [generateKeypair(), generateKeypair(), generateKeypair()]
  const myNextTargetsPubs = myNextTargets.map((kp) => kp.publicKey)
  const myNextRelays = chooseNextRelays(nextRelays, relayPool)
  const labels = generateShardLabels()

  const permutation = [0, 1, 2].sort(() => Math.random() - 0.5)

  const conversationId = originalPayload.conversation_id

  const payload = buildPayload({
    shardIndex: 1,
    content: replyText,
    shardLabels: { '1': labels[0], '2': labels[1], '3': labels[2] },
    peerRelays: nextRelays,
    nextRelays: myNextRelays,
    nextTargets: myNextTargetsPubs,
    conversationId,
    conversation: { sender: myRealNpub, recipient: recipientRealNpub },
    senderMsgIndex: msgIndex,
  })

  const senderKeys = threeSenderKeys()
  const shardEvents: ShardEvent[] = []
  for (let i = 0; i < 3; i++) {
    const skBytes = hexToBytes(senderKeys[i].privateKey)
    const targetPub = nextTargets[permutation[i]]
    const fullPayload: ShardPayload = { ...basePayload(payload), shard_index: i + 1 }
    const ciphertext = encrypt(
      JSON.stringify(fullPayload),
      senderKeys[i].privateKey,
      targetPub,
    )
    const unsignedEvent = {
      kind: 1059,
      tags: [
        ['p', targetPub],
        ['shard', labels[i]],
        ['expiry', String(Math.floor(Date.now() / 1000) + 86400)],
      ],
      content: ciphertext,
      created_at: Math.floor(Date.now() / 1000),
    }
    const signedEvent = finalizeEvent(unsignedEvent, skBytes) as SignedEvent
    shardEvents.push({
      signedEvent,
      relays: [nextRelays[i * 2], nextRelays[i * 2 + 1]],
    })
  }

  return { shardEvents, nextTargets: myNextTargets, nextRelays: myNextRelays }
}

export function buildSyncRequest(params: {
  lastSeenIndex: number
  recipientCurrentPubkey: string
  currentRelays: string[]
  myRealNpub: string
  recipientRealNpub: string
  relayPool: string[]
  conversationId: string
}): { shardEvents: ShardEvent[]; replyTargets: KeyPair[]; nextRelays: string[] } {
  const { lastSeenIndex, recipientCurrentPubkey, currentRelays, myRealNpub, recipientRealNpub, relayPool, conversationId } = params

  const replyTargets = [generateKeypair(), generateKeypair(), generateKeypair()]
  const replyTargetsPubs = replyTargets.map((kp) => kp.publicKey)
  const nextRelays = chooseNextRelays(currentRelays, relayPool)
  const labels = generateShardLabels()

  const payload = buildPayload({
    shardIndex: 1,
    content: '',
    shardLabels: { '1': labels[0], '2': labels[1], '3': labels[2] },
    peerRelays: currentRelays,
    nextRelays,
    nextTargets: replyTargetsPubs,
    conversationId,
    conversation: { sender: myRealNpub, recipient: recipientRealNpub },
    sync: { type: 'request', last_seen_index: lastSeenIndex },
  })

  const shardEvents = createShards({
    payload: basePayload(payload),
    senderKeys: threeSenderKeys(),
    recipientPubkey: recipientCurrentPubkey,
    currentRelays,
  })

  return { shardEvents, replyTargets, nextRelays }
}

export function buildSyncBundle(params: {
  messages: SyncMessage[]
  recipientCurrentPubkey: string
  currentRelays: string[]
  myRealNpub: string
  recipientRealNpub: string
  relayPool: string[]
  conversationId: string
}): { shardEvents: ShardEvent[]; replyTargets: KeyPair[]; nextRelays: string[] } {
  const { messages, recipientCurrentPubkey, currentRelays, myRealNpub, recipientRealNpub, relayPool, conversationId } = params

  const replyTargets = [generateKeypair(), generateKeypair(), generateKeypair()]
  const replyTargetsPubs = replyTargets.map((kp) => kp.publicKey)
  const nextRelays = chooseNextRelays(currentRelays, relayPool)
  const labels = generateShardLabels()

  const payload = buildPayload({
    shardIndex: 1,
    content: '',
    shardLabels: { '1': labels[0], '2': labels[1], '3': labels[2] },
    peerRelays: currentRelays,
    nextRelays,
    nextTargets: replyTargetsPubs,
    conversationId,
    conversation: { sender: myRealNpub, recipient: recipientRealNpub },
    sync: { type: 'bundle', messages },
  })

  const shardEvents = createShards({
    payload: basePayload(payload),
    senderKeys: threeSenderKeys(),
    recipientPubkey: recipientCurrentPubkey,
    currentRelays,
  })

  return { shardEvents, replyTargets, nextRelays }
}
