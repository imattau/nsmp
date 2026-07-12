import type { KeyPair, ShardPayload, SignedEvent, Subscription } from './models.js'
import { TempKeyStore, generateKeypair } from './key.js'
import { sendMessage, processEvent, fetchMissingShards } from './protocol.js'
import { publishEvent, subscribeToPubkey } from './relay.js'
import { bootstrapRelays } from './pool.js'

const KIND_NSMP = 1059

export class Client {
  private readonly myKeys: TempKeyStore = new TempKeyStore()
  private readonly subscriptions: Map<string, Subscription> = new Map()
  private readonly shardCache: Map<string, Map<number, ShardPayload>> = new Map()
  private readonly pendingFetches: Map<string, ReturnType<typeof setTimeout>> = new Map()
  private readonly firstEvent: Map<string, SignedEvent> = new Map()
  private relayPool: string[]

  private mainKey: KeyPair
  private myRealNpub: string
  private onMessageCallback?: (payload: ShardPayload) => void

  constructor(mainKey: KeyPair, relayPool?: string[]) {
    this.mainKey = mainKey
    this.myKeys.store(mainKey)
    this.myRealNpub = mainKey.publicKey
    this.relayPool = relayPool ?? bootstrapRelays()
  }

  setMessageCallback(cb: (payload: ShardPayload) => void): void {
    this.onMessageCallback = cb
  }

  addRelays(relays: string[]): void {
    for (const r of relays) {
      if (!this.relayPool.includes(r)) {
        this.relayPool.push(r)
      }
    }
  }

  private async tryFetchMissingShards(cacheKey: string): Promise<void> {
    const event = this.firstEvent.get(cacheKey)
    const cache = this.shardCache.get(cacheKey)
    if (!event || !cache || cache.size === 0) return

    const firstKey = [...cache.keys()][0]
    const firstPayload = cache.get(firstKey)
    if (!firstPayload) return

    const payloads = await fetchMissingShards({
      firstPayload,
      firstEvent: event,
      myKeys: this.myKeys,
    })

    for (const p of payloads) {
      cache.set(p.shard_index, p)
    }

    if (cache.size >= 3) {
      this.completeMessage(cacheKey, cache)
    }
  }

  private completeMessage(cacheKey: string, cache: Map<number, ShardPayload>): void {
    const fullPayload = cache.get(1) ?? cache.get(2) ?? cache.get(3)!
    this.shardCache.delete(cacheKey)
    this.firstEvent.delete(cacheKey)

    const timer = this.pendingFetches.get(cacheKey)
    if (timer) {
      clearTimeout(timer)
      this.pendingFetches.delete(cacheKey)
    }

    if (this.onMessageCallback) {
      this.onMessageCallback(fullPayload)
    }
  }

  private handleEvent(event: SignedEvent): void {
    const payload = processEvent({ event, myKeys: this.myKeys })
    if (!payload) return

    const shardLabel = event.tags.find((t) => t[0] === 'shard')?.[1]
    if (!shardLabel) return

    const cacheKey = `${event.pubkey}:${payload.shard_labels['1']}`
    if (!this.shardCache.has(cacheKey)) {
      this.shardCache.set(cacheKey, new Map())
      this.firstEvent.set(cacheKey, event)

      this.pendingFetches.set(cacheKey, setTimeout(() => {
        this.tryFetchMissingShards(cacheKey)
      }, 500))
    }

    const cache = this.shardCache.get(cacheKey)!
    cache.set(payload.shard_index, payload)

    if (cache.size >= 3) {
      this.completeMessage(cacheKey, cache)
    }
  }

  async subscribeToPubkey(pubkey: string, relays?: string[]): Promise<void> {
    const targets = relays ?? this.relayPool
    for (const relayUrl of targets) {
      const key = `${relayUrl}:${pubkey}`
      if (this.subscriptions.has(key)) continue

      const close = subscribeToPubkey(
        relayUrl,
        pubkey,
        (event) => this.handleEvent(event),
        [KIND_NSMP],
      )
      this.subscriptions.set(key, { relayUrl, pubkey, close })
    }
  }

  async listen(): Promise<void> {
    const allKeys = this.myKeys.getAll()
    for (const kp of allKeys) {
      await this.subscribeToPubkey(kp.publicKey)
    }
  }

  async send(params: {
    recipientCurrentPubkey: string
    plaintext: string
    currentRelays?: string[]
    myRealNpub?: string
    recipientRealNpub?: string
    conversationId?: string
  }): Promise<{ replyTargets: KeyPair[]; nextRelays: string[]; conversationId: string }> {
    const relays = params.currentRelays ?? this.relayPool.slice(0, 6)
    const senderKey = generateKeypair()
    const result = sendMessage({
      recipientCurrentPubkey: params.recipientCurrentPubkey,
      plaintext: params.plaintext,
      currentRelays: relays,
      senderKey,
      myRealNpub: params.myRealNpub ?? this.myRealNpub,
      recipientRealNpub: params.recipientRealNpub ?? params.recipientCurrentPubkey,
      relayPool: this.relayPool,
      conversationId: params.conversationId,
    })

    const publishPromises: Promise<void>[] = []
    for (const shard of result.shardEvents) {
      for (const relayUrl of shard.relays) {
        publishPromises.push(
          publishEvent(relayUrl, shard.signedEvent).catch(() => {
            // ignore per-shard publish failures
          }),
        )
      }
    }
    await Promise.allSettled(publishPromises)

    for (const target of result.replyTargets) {
      this.myKeys.store(target)
    }
    for (const target of result.replyTargets) {
      await this.subscribeToPubkey(target.publicKey, result.nextRelays)
    }

    return {
      replyTargets: result.replyTargets,
      nextRelays: result.nextRelays,
      conversationId: result.conversationId,
    }
  }

  destroyReplyTargets(pubkeys: string[]): void {
    for (const pubkey of pubkeys) {
      this.myKeys.destroy(pubkey)
    }
  }

  stop(): void {
    for (const [, sub] of this.subscriptions) {
      sub.close()
    }
    for (const [, timer] of this.pendingFetches) {
      clearTimeout(timer)
    }
    this.subscriptions.clear()
    this.shardCache.clear()
    this.firstEvent.clear()
    this.pendingFetches.clear()
  }
}
