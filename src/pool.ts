import type { RelayEntry, RelayPoolConfig } from './models.js'
import { RelayHealthTracker } from './health.js'
import { fetchFromTrustedRelays, fetchFromGeorelays, mergeAndDedupe, selectTopRelays } from './discovery.js'

export function chooseNextRelays(currentRelays: string[], pool: string[]): string[] {
  const available = pool.filter((r) => !currentRelays.includes(r))
  const shuffled = [...available].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, 6)
}

export function bootstrapRelays(): string[] {
  return [
    'wss://relay.damus.io',
    'wss://nos.lol',
    'wss://relay.snort.social',
    'wss://relay.nostr.band',
    'wss://relay.current.fyi',
    'wss://purplepag.es',
  ]
}

export function shardRelays(currentRelays: string[], shardIndex: number): [string, string] {
  const i = (shardIndex - 1) * 2
  return [currentRelays[i], currentRelays[i + 1]]
}

export const DEFAULT_POOL_CONFIG: RelayPoolConfig = {
  poolSize: 50,
  minScore: 70,
  refreshIntervalMs: 1800000,
  maxConsecutiveFailures: 3,
}

export type PoolUpdateCallback = (relays: string[]) => void

export class RelayPool {
  private entries = new Map<string, RelayEntry>()
  private health: RelayHealthTracker
  private config: RelayPoolConfig
  private onUpdateCallbacks: PoolUpdateCallback[] = []

  constructor(config?: Partial<RelayPoolConfig>) {
    this.config = { ...DEFAULT_POOL_CONFIG, ...config }
    this.health = new RelayHealthTracker(this.config.maxConsecutiveFailures)
  }

  getConfig(): RelayPoolConfig {
    return { ...this.config }
  }

  getRelays(): string[] {
    return [...this.entries.values()]
      .filter((e) => this.health.isHealthy(e.url))
      .map((e) => e.url)
  }

  getAllEntries(): RelayEntry[] {
    return [...this.entries.values()]
  }

  getHealthyEntries(): RelayEntry[] {
    return this.getAllEntries().filter((e) => this.health.isHealthy(e.url))
  }

  getRandomDisjoint(current: string[], n: number): string[] {
    const available = this.getRelays().filter((r) => !current.includes(r))
    const shuffled = [...available].sort(() => Math.random() - 0.5)
    return shuffled.slice(0, n)
  }

  addRelays(urls: string[]): void {
    let changed = false
    for (const url of urls) {
      if (!this.entries.has(url)) {
        this.entries.set(url, { url, score: 0 })
        changed = true
      }
    }
    if (changed) this.notify()
  }

  removeRelay(url: string): void {
    if (this.entries.delete(url)) {
      this.health.reset(url)
      this.notify()
    }
  }

  recordSuccess(url: string): void {
    this.health.recordSuccess(url)
  }

  recordFailure(url: string): void {
    this.health.recordFailure(url)
    const healthEntry = this.health.getHealth(url)
    if (healthEntry && !healthEntry.healthy) {
      this.notify()
    }
  }

  isHealthy(url: string): boolean {
    return this.health.isHealthy(url)
  }

  pruneUnhealthy(): string[] {
    const removed: string[] = []
    for (const url of this.health.getUnhealthy()) {
      this.entries.delete(url)
      this.health.reset(url)
      removed.push(url)
    }
    if (removed.length > 0) this.notify()
    return removed
  }

  async refresh(): Promise<void> {
    const [trusted, georelays] = await Promise.all([
      fetchFromTrustedRelays().catch(() => [] as RelayEntry[]),
      fetchFromGeorelays().catch(() => [] as RelayEntry[]),
    ])

    const merged = mergeAndDedupe([trusted, georelays])

    const selected = selectTopRelays(merged, {
      minScore: this.config.minScore,
      poolSize: this.config.poolSize,
    })

    const healthySelected = selected.filter((e) => this.health.isHealthy(e.url))

    let changed = false
    for (const entry of healthySelected) {
      const existing = this.entries.get(entry.url)
      if (!existing) {
        this.entries.set(entry.url, entry)
        changed = true
      }
    }

    const currentUrls = new Set(healthySelected.map((e) => e.url))
    for (const [url] of this.entries) {
      if (!currentUrls.has(url)) {
        this.entries.delete(url)
        this.health.reset(url)
        changed = true
      }
    }

    if (healthySelected.length === 0) {
      changed = true
      for (const entry of selected) {
        this.entries.set(entry.url, entry)
      }
    }

    if (changed) this.notify()
  }

  async seed(): Promise<void> {
    await this.refresh()
    if (this.entries.size < 6) {
      this.addRelays(bootstrapRelays())
    }
  }

  onPoolUpdate(cb: PoolUpdateCallback): () => void {
    this.onUpdateCallbacks.push(cb)
    return () => {
      const idx = this.onUpdateCallbacks.indexOf(cb)
      if (idx !== -1) this.onUpdateCallbacks.splice(idx, 1)
    }
  }

  private notify(): void {
    const relays = this.getRelays()
    for (const cb of this.onUpdateCallbacks) {
      try { cb(relays) } catch { }
    }
  }
}
