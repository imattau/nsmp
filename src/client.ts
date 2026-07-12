import type { KeyPair, ShardPayload, SignedEvent, Subscription, SyncMessage } from './models.js'
import type { EventSigner } from './shard.js'
import { TempKeyStore } from './key.js'
import { sendMessage, buildReply, buildSyncRequest, buildSyncBundle, processEvent, fetchMissingShards } from './protocol.js'
import { publishEvent, subscribeToPubkey, queryEvents, closePool } from './relay.js'
import { bootstrapRelays, RelayPool } from './pool.js'
import { createScheduler } from './scheduler.js'
import type { Scheduler } from './scheduler.js'

const KIND_NSMP = 1059

export class Client {
  private readonly myKeys: TempKeyStore = new TempKeyStore()
  private readonly subscriptions: Map<string, Subscription> = new Map()
  private readonly shardCache: Map<string, Map<number, ShardPayload>> = new Map()
  private readonly pendingFetches: Map<string, ReturnType<typeof setTimeout>> = new Map()
  private readonly firstEvent: Map<string, SignedEvent> = new Map()
  private readonly firstSenderPubkey: Map<string, string> = new Map()
  private relayPool: string[]
  private relayPoolManager?: RelayPool
  private maintenanceScheduler?: Scheduler

  private mainKey: KeyPair
  private myRealNpub: string
  private onMessageCallback?: (payload: ShardPayload, senderPubkey: string, matchedPubkey: string) => void
  private nip44Decrypt?: (senderPubkey: string, ciphertext: string) => Promise<string>
  private signEvent?: EventSigner

  constructor(mainKey: KeyPair, relayPool?: string[] | RelayPool) {
    this.mainKey = mainKey
    this.myKeys.store(mainKey)
    this.myRealNpub = mainKey.publicKey

    if (relayPool instanceof RelayPool) {
      this.relayPoolManager = relayPool
      this.relayPool = relayPool.getRelays()
      if (this.relayPool.length === 0) {
        this.relayPool = bootstrapRelays()
      }
    } else {
      this.relayPool = relayPool ?? bootstrapRelays()
    }
  }

  getRelayPool(): string[] {
    return this.relayPool
  }

  setMessageCallback(cb: (payload: ShardPayload, senderPubkey: string, matchedPubkey: string) => void): void {
    this.onMessageCallback = cb
  }

  setNip44Decrypt(fn: (senderPubkey: string, ciphertext: string) => Promise<string>): void {
    this.nip44Decrypt = fn
  }

  setSigner(fn: EventSigner): void {
    this.signEvent = fn
  }

  addRelays(relays: string[]): void {
    for (const r of relays) {
      if (!this.relayPool.includes(r)) {
        this.relayPool.push(r)
      }
    }
    if (this.relayPoolManager) {
      this.relayPoolManager.addRelays(relays)
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

    const senderPubkey = this.firstSenderPubkey.get(cacheKey) ?? ''
    if (cache.size >= 1) {
      this.completeMessage(cacheKey, cache, senderPubkey)
    }
  }

  private completeMessage(cacheKey: string, cache: Map<number, ShardPayload>, senderPubkey: string): void {
    const fullPayload = cache.get(1) ?? cache.get(2) ?? cache.get(3)!
    const firstEvent = this.firstEvent.get(cacheKey)
    const matchedPubkey = firstEvent?.tags.find((t) => t[0] === 'p')?.[1] ?? ''

    console.warn('completeMessage: assembled shards', cache.size, 'matchedPubkey', matchedPubkey.slice(0, 12), 'content', fullPayload.content?.slice(0, 30))

    this.shardCache.delete(cacheKey)
    this.firstEvent.delete(cacheKey)
    this.firstSenderPubkey.delete(cacheKey)

    const timer = this.pendingFetches.get(cacheKey)
    if (timer) {
      clearTimeout(timer)
      this.pendingFetches.delete(cacheKey)
    }

    if (this.onMessageCallback) {
      this.onMessageCallback(fullPayload, senderPubkey, matchedPubkey)
    }
  }

  private async handleEvent(event: SignedEvent): Promise<void> {
    if (event.kind === 1059) {
      console.warn('handleEvent: got kind 1059 event', event.id.slice(0, 8), 'shard tag:', event.tags.find((t) => t[0] === 'shard')?.[1])
    }
    let result = processEvent({ event, myKeys: this.myKeys })

    if (!result && this.nip44Decrypt && this.mainKey.privateKey === '') {
      try {
        const pTag = event.tags.find((t) => t[0] === 'p')
        if (pTag) {
          // Gift Wrap layer: decrypt → Seal (kind 13)
          const sealJson = await this.nip44Decrypt(event.pubkey, event.content)
          const seal = JSON.parse(sealJson)
          if (seal.kind === 13) {
            // Seal layer: decrypt → Rumor
            const rumorJson = await this.nip44Decrypt(seal.pubkey, seal.content)
            const rumor = JSON.parse(rumorJson)
            const payload = JSON.parse(rumor.content) as ShardPayload
            result = { payload, senderPubkey: seal.pubkey }
            console.warn('nip44 fallback decrypt succeeded for', event.id.slice(0, 8))
          }
        }
      } catch (e) {
        console.warn('nip44 fallback decrypt failed for', event.id.slice(0, 8), e)
      }
    }

    if (!result) {
      console.warn('processEvent returned null — could not decrypt event', event.id.slice(0, 8))
      return
    }

    const { payload, senderPubkey } = result

    const shardLabel = event.tags.find((t) => t[0] === 'shard')?.[1]
    if (!shardLabel) {
      console.warn('handleEvent: no shard label on event', event.id.slice(0, 8))
      return
    }

    const firstLabel = payload.shard_labels?.['1'] ?? shardLabel
    const cacheKey = `${payload.conversation_id ?? firstLabel}:${firstLabel}`
    if (!this.shardCache.has(cacheKey)) {
      this.shardCache.set(cacheKey, new Map())
      this.firstEvent.set(cacheKey, event)
      this.firstSenderPubkey.set(cacheKey, senderPubkey)

      this.pendingFetches.set(cacheKey, setTimeout(() => {
        this.tryFetchMissingShards(cacheKey)
      }, 500))
    }

    const cache = this.shardCache.get(cacheKey)!
    cache.set(payload.shard_index, payload)

    if (cache.size >= 3) {
      this.completeMessage(cacheKey, cache, senderPubkey)
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

  async restoreRound(round: {
    replyTargets: KeyPair[]
    nextRelays: string[]
  }): Promise<void> {
    for (const target of round.replyTargets) {
      this.myKeys.store(target)
    }
    for (const target of round.replyTargets) {
      await this.subscribeToPubkey(target.publicKey, round.nextRelays)
    }
    await this.catchUpMissedEvents(round)
  }

  private async catchUpMissedEvents(round: {
    replyTargets: KeyPair[]
    nextRelays: string[]
  }): Promise<void> {
    const promises: Promise<void>[] = []
    for (const target of round.replyTargets) {
      for (const relayUrl of round.nextRelays) {
        promises.push(
          queryEvents(relayUrl, {
            kinds: [KIND_NSMP],
            '#p': [target.publicKey],
            limit: 100,
          }).then((events) => {
            for (const event of events) {
              this.handleEvent(event)
            }
          }).catch(() => {
            // ignore per-relay query failures during catch-up
          }),
        )
      }
    }
    await Promise.allSettled(promises)
  }

  async sendReply(params: {
    peerTargets: string[]
    peerRelays: string[]
    replyText: string
    conversationId: string
    msgIndex?: number
  }): Promise<{ replyTargets: KeyPair[]; nextRelays: string[]; conversationId: string }> {
    console.warn('sendReply: replying', params.replyText?.slice(0, 30), 'to targets', params.peerTargets.map((t) => t.slice(0, 8)))

    const payload = {
      next_targets: params.peerTargets,
      next_relays: params.peerRelays,
      conversation_id: params.conversationId,
    }
    const result = await buildReply({
      originalPayload: payload as unknown as ShardPayload,
      replyText: params.replyText,
      myPrivKey: this.mainKey.privateKey,
      mySigner: this.signEvent,
      relayPool: this.relayPool,
      msgIndex: params.msgIndex,
    })

    const publishPromises: Promise<void>[] = []
    for (const shard of result.shardEvents) {
      for (const relayUrl of shard.relays) {
        publishPromises.push(
          publishEvent(relayUrl, shard.signedEvent)
            .then(() => { console.warn('  reply publish OK to', relayUrl); this.recordRelaySuccess(relayUrl) })
            .catch((e) => { console.warn('  reply publish FAIL to', relayUrl, e?.message?.slice(0, 50)); this.recordRelayFailure(relayUrl) }),
        )
      }
    }
    const publishResults = await Promise.allSettled(publishPromises)
    const anySuccess = publishResults.some((r) => r.status === 'fulfilled')
    if (!anySuccess) {
      console.warn('sendReply: ALL publishes failed')
      throw new Error('Failed to publish reply to any relay')
    }
    console.warn('sendReply: at least one shard published successfully')

    for (const target of result.nextTargets) {
      this.myKeys.store(target)
    }
    for (const target of result.nextTargets) {
      await this.subscribeToPubkey(target.publicKey, result.nextRelays)
    }

    return {
      replyTargets: result.nextTargets,
      nextRelays: result.nextRelays,
      conversationId: params.conversationId,
    }
  }

  async send(params: {
    recipientCurrentPubkey: string
    plaintext: string
    currentRelays?: string[]
    conversationId?: string
    msgIndex?: number
  }): Promise<{ replyTargets: KeyPair[]; nextRelays: string[]; conversationId: string }> {
    const relays = params.currentRelays ?? this.relayPool.slice(0, 6)
    const result = await sendMessage({
      recipientCurrentPubkey: params.recipientCurrentPubkey,
      plaintext: params.plaintext,
      currentRelays: relays,
      myPrivKey: this.mainKey.privateKey,
      mySigner: this.signEvent,
      relayPool: this.relayPool,
      conversationId: params.conversationId,
      msgIndex: params.msgIndex,
    })

    console.warn('send: sending', params.plaintext?.slice(0, 30), 'to', params.recipientCurrentPubkey?.slice(0, 12), 'on relays', relays)

    const publishPromises: Promise<void>[] = []
    for (const shard of result.shardEvents) {
      for (const relayUrl of shard.relays) {
        publishPromises.push(
          publishEvent(relayUrl, shard.signedEvent)
            .then(() => { console.warn('  publish OK to', relayUrl); this.recordRelaySuccess(relayUrl) })
            .catch((e) => { console.warn('  publish FAIL to', relayUrl, e?.message?.slice(0, 50)); this.recordRelayFailure(relayUrl) }),
        )
      }
    }
    const publishResults = await Promise.allSettled(publishPromises)
    const anySuccess = publishResults.some((r) => r.status === 'fulfilled')
    if (!anySuccess) {
      console.warn('send: ALL publishes failed')
      throw new Error('Failed to publish to any relay')
    }
    console.warn('send: at least one shard published successfully')

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

  async sendSyncRequest(params: {
    lastSeenIndex: number
    recipientCurrentPubkey: string
    currentRelays: string[]
    conversationId: string
  }): Promise<{ replyTargets: KeyPair[]; nextRelays: string[] }> {
    const result = await buildSyncRequest({
      lastSeenIndex: params.lastSeenIndex,
      recipientCurrentPubkey: params.recipientCurrentPubkey,
      currentRelays: params.currentRelays,
      myPrivKey: this.mainKey.privateKey,
      mySigner: this.signEvent,
      relayPool: this.relayPool,
      conversationId: params.conversationId,
    })

    const publishPromises: Promise<void>[] = []
    for (const shard of result.shardEvents) {
      for (const relayUrl of shard.relays) {
        publishPromises.push(
          publishEvent(relayUrl, shard.signedEvent)
            .then(() => this.recordRelaySuccess(relayUrl))
            .catch(() => this.recordRelayFailure(relayUrl)),
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

    return { replyTargets: result.replyTargets, nextRelays: result.nextRelays }
  }

  async sendSyncBundle(params: {
    messages: SyncMessage[]
    recipientCurrentPubkey: string
    currentRelays: string[]
    conversationId: string
  }): Promise<{ replyTargets: KeyPair[]; nextRelays: string[] }> {
    const result = await buildSyncBundle({
      messages: params.messages,
      recipientCurrentPubkey: params.recipientCurrentPubkey,
      currentRelays: params.currentRelays,
      myPrivKey: this.mainKey.privateKey,
      mySigner: this.signEvent,
      relayPool: this.relayPool,
      conversationId: params.conversationId,
    })

    const publishPromises: Promise<void>[] = []
    for (const shard of result.shardEvents) {
      for (const relayUrl of shard.relays) {
        publishPromises.push(
          publishEvent(relayUrl, shard.signedEvent)
            .then(() => this.recordRelaySuccess(relayUrl))
            .catch(() => this.recordRelayFailure(relayUrl)),
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

    return { replyTargets: result.replyTargets, nextRelays: result.nextRelays }
  }

  private recordRelaySuccess(url: string): void {
    this.relayPoolManager?.recordSuccess(url)
  }

  private recordRelayFailure(url: string): void {
    this.relayPoolManager?.recordFailure(url)
  }

  startMaintenance(intervalMs?: number): void {
    if (!this.relayPoolManager) {
      this.relayPoolManager = new RelayPool()
      this.relayPoolManager.addRelays(this.relayPool)
    }
    this.relayPoolManager.seed().catch(() => {})

    this.maintenanceScheduler = createScheduler(
      async () => {
        await this.relayPoolManager!.refresh()
        this.relayPool = this.relayPoolManager!.getRelays()
        if (this.relayPool.length < 6) {
          this.relayPool = bootstrapRelays()
        }
      },
      intervalMs ?? 1800000,
    )

    this.relayPoolManager.onPoolUpdate((relays) => {
      this.relayPool = relays.length >= 6 ? relays : bootstrapRelays()
    })

    this.relayPool = this.relayPoolManager.getRelays()
    if (this.relayPool.length < 6) {
      this.relayPool = bootstrapRelays()
    }

    this.maintenanceScheduler.start()
  }

  stopMaintenance(): void {
    this.maintenanceScheduler?.stop()
    this.maintenanceScheduler = undefined
  }

  destroyReplyTargets(pubkeys: string[]): void {
    for (const pubkey of pubkeys) {
      this.myKeys.destroy(pubkey)
    }
  }

  stop(): void {
    this.stopMaintenance()
    for (const [, sub] of this.subscriptions) {
      sub.close()
    }
    for (const [, timer] of this.pendingFetches) {
      clearTimeout(timer)
    }
    this.subscriptions.clear()
    this.shardCache.clear()
    this.firstEvent.clear()
    this.firstSenderPubkey.clear()
    this.pendingFetches.clear()
    closePool()
  }
}
