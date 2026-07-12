import { finalizeEvent } from 'nostr-tools'
import { hexToBytes } from '@noble/hashes/utils.js'
import type { KeyPair, ShardPayload, ShardEvent, SignedEvent, SyncMessage } from './models.js'
import { encrypt, decrypt } from './crypto.js'

export type EventSigner = (event: { kind: number; tags: string[][]; content: string; created_at: number }) => Promise<SignedEvent>

const LABEL_LENGTH = 5
const CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789'

function randomLabel(): string {
  let result = ''
  for (let i = 0; i < LABEL_LENGTH; i++) {
    result += CHARS[Math.floor(Math.random() * CHARS.length)]
  }
  return result
}

export function generateShardLabels(): [string, string, string] {
  return [randomLabel(), randomLabel(), randomLabel()]
}

export function buildPayload(params: {
  shardIndex: number
  content: string
  shardLabels: Record<string, string>
  peerRelays: string[]
  nextRelays: string[]
  nextTargets: string[]
  conversationId?: string
  senderMsgIndex?: number
  sync?: 
    | { type: 'request'; last_seen_index: number }
    | { type: 'bundle'; messages: SyncMessage[] }
}): ShardPayload {
  return {
    shard_index: params.shardIndex,
    shard_total: 3,
    content: params.content,
    shard_labels: params.shardLabels,
    peer_relays: params.peerRelays,
    next_relays: params.nextRelays,
    next_targets: params.nextTargets,
    ...(params.conversationId ? { conversation_id: params.conversationId } : {}),
    ...(params.senderMsgIndex !== undefined ? { sender_msg_index: params.senderMsgIndex } : {}),
    ...(params.sync ? { sync: params.sync } : {}),
  }
}

export function unwrapGiftWrap(params: {
  event: SignedEvent
  recipientPrivateKey: string
}): { payload: ShardPayload; senderPubkey: string } | null {
  try {
    const sealJson = decrypt(
      params.event.content,
      params.recipientPrivateKey,
      params.event.pubkey,
    )
    const seal = JSON.parse(sealJson) as SignedEvent & { pubkey: string }
    if (seal.kind !== 13) return null

    const rumorJson = decrypt(
      seal.content,
      params.recipientPrivateKey,
      seal.pubkey,
    )
    const rumor = JSON.parse(rumorJson)
    const payload = JSON.parse(rumor.content) as ShardPayload

    return { payload, senderPubkey: seal.pubkey }
  } catch {
    return null
  }
}

export async function createGiftWrapShard(params: {
  fullPayload: ShardPayload
  trueAuthorKey: KeyPair
  trueAuthorSigner?: EventSigner
  throwawayKey: KeyPair
  recipientPubkey: string
  label: string
  expiry: string
  created_at: number
}): Promise<SignedEvent> {
  const rumor = JSON.stringify({
    kind: 1059,
    tags: [['p', params.recipientPubkey]],
    content: JSON.stringify(params.fullPayload),
    created_at: params.created_at,
  })

  const encryptedRumor = encrypt(
    rumor,
    params.trueAuthorKey.privateKey,
    params.recipientPubkey,
  )

  const unsignedSeal = {
    kind: 13,
    tags: [],
    content: encryptedRumor,
    created_at: params.created_at,
  }
  let seal: SignedEvent
  if (params.trueAuthorSigner) {
    seal = await params.trueAuthorSigner(unsignedSeal)
  } else {
    const sealBytes = hexToBytes(params.trueAuthorKey.privateKey)
    seal = finalizeEvent(unsignedSeal, sealBytes) as SignedEvent
  }

  const encryptedSeal = encrypt(
    JSON.stringify(seal),
    params.throwawayKey.privateKey,
    params.recipientPubkey,
  )

  const unsignedGiftWrap = {
    kind: 1059,
    tags: [
      ['p', params.recipientPubkey],
      ['shard', params.label],
      ['expiry', params.expiry],
    ],
    content: encryptedSeal,
    created_at: params.created_at,
  }
  const giftWrapBytes = hexToBytes(params.throwawayKey.privateKey)
  return finalizeEvent(unsignedGiftWrap, giftWrapBytes) as SignedEvent
}

export async function createShards(params: {
  payload: Omit<ShardPayload, 'shard_index'>
  senderKeys: [KeyPair, KeyPair, KeyPair]
  trueAuthorKey: KeyPair
  trueAuthorSigner?: EventSigner
  recipientPubkey: string
  currentRelays: string[]
}): Promise<ShardEvent[]> {
  const { payload, senderKeys, trueAuthorKey, trueAuthorSigner, recipientPubkey, currentRelays } = params
  const events: ShardEvent[] = []
  const timestamp = Math.floor(Date.now() / 1000)
  const expiry = String(timestamp + 86400)

  for (let i = 0; i < 3; i++) {
    const fullPayload: ShardPayload = {
      ...payload,
      shard_index: i + 1,
    }

    const signedEvent = await createGiftWrapShard({
      fullPayload,
      trueAuthorKey,
      trueAuthorSigner,
      throwawayKey: senderKeys[i],
      recipientPubkey,
      label: payload.shard_labels[String(i + 1)],
      expiry,
      created_at: timestamp,
    })

    events.push({
      signedEvent,
      relays: [currentRelays[i * 2], currentRelays[i * 2 + 1]],
    })
  }

  return events
}

export function findShardIndex(
  shardLabel: string,
  labels: Record<string, string>,
): number | undefined {
  for (const [idx, lbl] of Object.entries(labels)) {
    if (lbl === shardLabel) {
      return parseInt(idx, 10)
    }
  }
  return undefined
}
