export interface HealthEntry {
  url: string
  consecutiveFailures: number
  healthy: boolean
  lastFailureAt: number | null
  lastSuccessAt: number | null
}

export class RelayHealthTracker {
  private entries = new Map<string, HealthEntry>()
  private readonly maxFailures: number

  constructor(maxFailures = 3) {
    this.maxFailures = maxFailures
  }

  recordSuccess(url: string): void {
    const existing = this.entries.get(url)
    if (existing) {
      existing.consecutiveFailures = 0
      existing.healthy = true
      existing.lastSuccessAt = Date.now()
    } else {
      this.entries.set(url, {
        url,
        consecutiveFailures: 0,
        healthy: true,
        lastFailureAt: null,
        lastSuccessAt: Date.now(),
      })
    }
  }

  recordFailure(url: string): void {
    const existing = this.entries.get(url)
    if (existing) {
      existing.consecutiveFailures++
      existing.lastFailureAt = Date.now()
      if (existing.consecutiveFailures >= this.maxFailures) {
        existing.healthy = false
      }
    } else {
      this.entries.set(url, {
        url,
        consecutiveFailures: 1,
        healthy: 1 < this.maxFailures,
        lastFailureAt: Date.now(),
        lastSuccessAt: null,
      })
    }
  }

  isHealthy(url: string): boolean {
    const entry = this.entries.get(url)
    if (!entry) return true
    return entry.healthy
  }

  getUnhealthy(): string[] {
    const result: string[] = []
    for (const [url, entry] of this.entries) {
      if (!entry.healthy) result.push(url)
    }
    return result
  }

  getHealth(url: string): HealthEntry | undefined {
    return this.entries.get(url)
  }

  getAll(): HealthEntry[] {
    return [...this.entries.values()]
  }

  reset(url: string): void {
    this.entries.delete(url)
  }

  resetAll(): void {
    this.entries.clear()
  }
}
