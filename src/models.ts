export interface KeyPair {
  privateKey: string
  publicKey: string
}

export interface ShardPayload {
  shard_index: number
  shard_total: number
  content: string
  shard_labels: Record<string, string>
  peer_relays: string[]
  next_relays: string[]
  next_targets: string[]
  conversation_id?: string
  conversation?: {
    sender: string
    recipient: string
  }
}

export interface SignedEvent {
  id: string
  pubkey: string
  kind: number
  tags: string[][]
  content: string
  sig: string
  created_at: number
}

export interface ShardEvent {
  signedEvent: SignedEvent
  relays: [string, string]
}

export interface PendingMessage {
  shardCache: Map<number, ShardPayload>
  lastPayload?: ShardPayload
}

export interface Subscription {
  relayUrl: string
  pubkey: string
  close: () => void
}
