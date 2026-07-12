import { fetchFromTrustedRelays, fetchFromGeorelays, mergeAndDedupe, selectTopRelays } from '../../../src/discovery.js'

let intervalTimer: ReturnType<typeof setInterval> | null = null

self.onmessage = (event: MessageEvent) => {
  const { command, intervalMs, poolSize, minScore } = event.data

  if (command === 'start') {
    if (intervalTimer !== null) return

    const runTask = async () => {
      try {
        const [trusted, georelays] = await Promise.all([
          fetchFromTrustedRelays().catch(() => []),
          fetchFromGeorelays().catch(() => []),
        ])
        const merged = mergeAndDedupe([trusted, georelays])
        const selected = selectTopRelays(merged, {
          minScore: minScore ?? 70,
          poolSize: poolSize ?? 50,
        })
        self.postMessage({
          type: 'relays',
          relays: selected.map((r) => r.url),
        })
      } catch (err) {
        self.postMessage({ type: 'error', error: String(err) })
      }
    }

    runTask()
    intervalTimer = setInterval(runTask, intervalMs ?? 1800000)
  }

  if (command === 'stop') {
    if (intervalTimer !== null) {
      clearInterval(intervalTimer)
      intervalTimer = null
    }
  }
}
