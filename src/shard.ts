import { finalizeEvent } from 'nostr-tools'
import { hexToBytes } from '@noble/hashes/utils.js'
import type { KeyPair, ShardPayload, ShardEvent, SignedEvent } from './models.js'
import { encrypt } from './crypto.js'

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
  conversation?: { sender: string; recipient: string }
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
    ...(params.conversation ? { conversation: params.conversation } : {}),
  }
}

export function createShards(params: {
  payload: Omit<ShardPayload, 'shard_index'>
  senderKey: KeyPair
  recipientPubkey: string
  currentRelays: string[]
}): ShardEvent[] {
  const { payload, senderKey, recipientPubkey, currentRelays } = params
  const events: ShardEvent[] = []
  const skBytes = hexToBytes(senderKey.privateKey)

  for (let i = 0; i < 3; i++) {
    const fullPayload: ShardPayload = {
      ...payload,
      shard_index: i + 1,
    }

    const encrypted = encrypt(
      JSON.stringify(fullPayload),
      senderKey.privateKey,
      recipientPubkey,
    )

    const unsignedEvent = {
      kind: 1059,
      tags: [
        ['p', recipientPubkey],
        ['shard', payload.shard_labels[String(i + 1)]],
        ['expiry', String(Math.floor(Date.now() / 1000) + 86400)],
      ],
      content: encrypted,
      created_at: Math.floor(Date.now() / 1000),
    }

    const signedEvent = finalizeEvent(unsignedEvent, skBytes) as SignedEvent

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
