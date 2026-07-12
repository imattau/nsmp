export interface KeyPair {
  privateKey: string
  publicKey: string
}

export interface SyncMessage {
  sender_msg_index: number
  content: string
  timestamp: number
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
  sender_msg_index?: number
  sync?: 
    | { type: 'request'; last_seen_index: number }
    | { type: 'bundle'; messages: SyncMessage[] }
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

export interface RelayEntry {
  url: string
  score: number
  reliability?: number
  quality?: number
  accessibility?: number
  countryCode?: string
  software?: string
  supportedNips?: number[]
  observations?: number
  confidence?: 'high' | 'medium' | 'low'
  isOnline?: boolean
  lastSeen?: number
}

export interface RelayPoolConfig {
  poolSize: number
  minScore: number
  refreshIntervalMs: number
  maxConsecutiveFailures: number
}
