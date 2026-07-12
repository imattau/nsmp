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
