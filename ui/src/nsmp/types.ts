export interface NSMPConfig {
  relayPool: string[]
  relayPoolSize?: number
  relayMinScore?: number
  relayRefreshIntervalMs?: number
  relayMaxConsecutiveFailures?: number
}
