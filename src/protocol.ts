import { randomBytes, bytesToHex } from '@noble/hashes/utils.js'
import type { KeyPair, ShardPayload, ShardEvent, SignedEvent, SyncMessage } from './models.js'
import { generateKeypair, TempKeyStore } from './key.js'
import { generateShardLabels, buildPayload, createShards, createGiftWrapShard, unwrapGiftWrap, findShardIndex } from './shard.js'
import type { EventSigner } from './shard.js'
import { queryEvents } from './relay.js'
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

export async function sendMessage(params: {
  recipientCurrentPubkey: string
  plaintext: string
  currentRelays: string[]
  myPrivKey: string
  mySigner?: EventSigner
  relayPool: string[]
  conversationId?: string
  msgIndex?: number
}): Promise<{ shardEvents: ShardEvent[]; replyTargets: KeyPair[]; nextRelays: string[]; conversationId: string }> {
  const { recipientCurrentPubkey, plaintext, currentRelays, myPrivKey, mySigner, relayPool, conversationId: existingId, msgIndex } = params

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
    senderMsgIndex: msgIndex,
  })

  const shardEvents = await createShards({
    payload: basePayload(payload),
    senderKeys: threeSenderKeys(),
    trueAuthorKey: { privateKey: myPrivKey, publicKey: '' },
    trueAuthorSigner: mySigner,
    recipientPubkey: recipientCurrentPubkey,
    currentRelays,
  })

  return { shardEvents, replyTargets, nextRelays, conversationId }
}

export function processEvent(params: {
  event: SignedEvent
  myKeys: TempKeyStore
}): { payload: ShardPayload; senderPubkey: string } | null {
  const { event, myKeys } = params

  const pTag = event.tags.find((t) => t[0] === 'p')
  if (!pTag) return null

  const keyPair = myKeys.get(pTag[1])
  if (!keyPair) return null

  return unwrapGiftWrap({ event, recipientPrivateKey: keyPair.privateKey })
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

          const result = unwrapGiftWrap({ event: events[0], recipientPrivateKey: keyPair.privateKey })
          if (result) {
            found.push(result.payload)
            break
          }
        }
      } catch {
        continue
      }
    }
  }

  return found
}

export async function buildReply(params: {
  originalPayload: ShardPayload
  replyText: string
  myPrivKey: string
  mySigner?: EventSigner
  relayPool: string[]
  msgIndex?: number
}): Promise<{ shardEvents: ShardEvent[]; nextTargets: KeyPair[]; nextRelays: string[] }> {
  const { originalPayload, replyText, myPrivKey, mySigner, relayPool, msgIndex } = params

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
    senderMsgIndex: msgIndex,
  })

  const senderKeys = threeSenderKeys()
  const timestamp = Math.floor(Date.now() / 1000)
  const expiry = String(timestamp + 86400)
  const shardEvents: ShardEvent[] = []
  for (let i = 0; i < 3; i++) {
    const targetPub = nextTargets[permutation[i]]
    const fullPayload: ShardPayload = { ...basePayload(payload), shard_index: i + 1 }
    const signedEvent = await createGiftWrapShard({
      fullPayload,
      trueAuthorKey: { privateKey: myPrivKey, publicKey: '' },
      trueAuthorSigner: mySigner,
      throwawayKey: senderKeys[i],
      recipientPubkey: targetPub,
      label: labels[i],
      expiry,
      created_at: timestamp,
    })
    shardEvents.push({
      signedEvent,
      relays: [nextRelays[i * 2], nextRelays[i * 2 + 1]],
    })
  }

  return { shardEvents, nextTargets: myNextTargets, nextRelays: myNextRelays }
}

export async function buildSyncRequest(params: {
  lastSeenIndex: number
  recipientCurrentPubkey: string
  currentRelays: string[]
  myPrivKey: string
  mySigner?: EventSigner
  relayPool: string[]
  conversationId: string
}): Promise<{ shardEvents: ShardEvent[]; replyTargets: KeyPair[]; nextRelays: string[] }> {
  const { lastSeenIndex, recipientCurrentPubkey, currentRelays, myPrivKey, mySigner, relayPool, conversationId } = params

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
    sync: { type: 'request', last_seen_index: lastSeenIndex },
  })

  const shardEvents = await createShards({
    payload: basePayload(payload),
    senderKeys: threeSenderKeys(),
    trueAuthorKey: { privateKey: myPrivKey, publicKey: '' },
    trueAuthorSigner: mySigner,
    recipientPubkey: recipientCurrentPubkey,
    currentRelays,
  })

  return { shardEvents, replyTargets, nextRelays }
}

export async function buildSyncBundle(params: {
  messages: SyncMessage[]
  recipientCurrentPubkey: string
  currentRelays: string[]
  myPrivKey: string
  mySigner?: EventSigner
  relayPool: string[]
  conversationId: string
}): Promise<{ shardEvents: ShardEvent[]; replyTargets: KeyPair[]; nextRelays: string[] }> {
  const { messages, recipientCurrentPubkey, currentRelays, myPrivKey, mySigner, relayPool, conversationId } = params

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
    sync: { type: 'bundle', messages },
  })

  const shardEvents = await createShards({
    payload: basePayload(payload),
    senderKeys: threeSenderKeys(),
    trueAuthorKey: { privateKey: myPrivKey, publicKey: '' },
    trueAuthorSigner: mySigner,
    recipientPubkey: recipientCurrentPubkey,
    currentRelays,
  })

  return { shardEvents, replyTargets, nextRelays }
}
