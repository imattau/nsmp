import type { RelayEntry } from './models.js'

const TRUSTED_RELAYS_URL = 'https://trustedrelays.xyz/api/relays'
const GEORELAYS_URL = 'https://raw.githubusercontent.com/permissionlesstech/georelays/main/relay_discovery_results.json'

interface TrustedRelayResponse {
  url: string
  name?: string
  score?: number
  reliability?: number
  quality?: number
  accessibility?: number
  countryCode?: string
  countryName?: string
  supportedNips?: number[]
  observations?: number
  confidence?: 'high' | 'medium' | 'low'
  isOnline?: boolean
  lastSeen?: number
}

interface GeorelaysResponse {
  relays: string[]
  results: Array<{ url: string }>
  total?: number
  timestamp?: string
}

export async function fetchFromTrustedRelays(timeoutMs = 4000): Promise<RelayEntry[]> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const resp = await fetch(TRUSTED_RELAYS_URL, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })

    if (!resp.ok) {
      throw new Error(`trustedrelays.xyz returned ${resp.status}`)
    }

    const data = (await resp.json()) as TrustedRelayResponse[] | TrustedRelayResponse

    const items = Array.isArray(data) ? data : [data]
    return items
      .filter((r) => r.url && r.score !== undefined)
      .map((r) => ({
        url: r.url,
        score: r.score ?? 0,
        reliability: r.reliability,
        quality: r.quality,
        accessibility: r.accessibility,
        countryCode: r.countryCode,
        supportedNips: r.supportedNips,
        observations: r.observations,
        confidence: r.confidence,
        isOnline: r.isOnline,
        lastSeen: r.lastSeen,
      }))
  } finally {
    clearTimeout(timer)
  }
}

export async function fetchFromGeorelays(timeoutMs = 4000): Promise<RelayEntry[]> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const resp = await fetch(GEORELAYS_URL, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })

    if (!resp.ok) {
      throw new Error(`georelays returned ${resp.status}`)
    }

    const data = (await resp.json()) as GeorelaysResponse

    const urls: string[] = []
    if (Array.isArray(data.relays)) {
      urls.push(...data.relays)
    }
    if (Array.isArray(data.results)) {
      urls.push(...data.results.map((r) => r.url))
    }

    return urls.map((url) => ({
      url,
      score: 0,
    }))
  } finally {
    clearTimeout(timer)
  }
}

export function mergeAndDedupe(sources: RelayEntry[][]): RelayEntry[] {
  const seen = new Map<string, RelayEntry>()

  for (const source of sources) {
    for (const entry of source) {
      const existing = seen.get(entry.url)
      if (!existing) {
        seen.set(entry.url, entry)
      } else if (entry.score > existing.score) {
        seen.set(entry.url, { ...existing, ...entry })
      }
    }
  }

  return [...seen.values()]
}

export interface SelectOptions {
  minScore?: number
  poolSize?: number
  requireNips?: number[]
}

export function selectTopRelays(candidates: RelayEntry[], options?: SelectOptions): RelayEntry[] {
  const minScore = options?.minScore ?? 0
  const poolSize = options?.poolSize ?? 50
  const requireNips = options?.requireNips

  let filtered = candidates.filter((r) => r.score >= minScore)

  if (requireNips && requireNips.length > 0) {
    filtered = filtered.filter(
      (r) =>
        r.supportedNips &&
        requireNips.every((n) => r.supportedNips!.includes(n)),
    )
  }

  filtered.sort((a, b) => b.score - a.score)

  const softwareBuckets = new Map<string, RelayEntry[]>()
  const others: RelayEntry[] = []

  for (const r of filtered) {
    const sw = r.software ?? 'unknown'
    if (sw === 'unknown') {
      others.push(r)
      continue
    }
    if (!softwareBuckets.has(sw)) softwareBuckets.set(sw, [])
    softwareBuckets.get(sw)!.push(r)
  }

  const result: RelayEntry[] = []
  const buckets = [...softwareBuckets.entries()].sort((a, b) => b[1].length - a[1].length)

  while (result.length < poolSize) {
    let added = 0
    for (const [, bucket] of buckets) {
      if (bucket.length === 0) continue
      result.push(bucket.shift()!)
      added++
      if (result.length >= poolSize) break
    }
    if (added === 0) break
  }

  while (result.length < poolSize && others.length > 0) {
    result.push(others.shift()!)
  }

  return result.slice(0, poolSize)
}
