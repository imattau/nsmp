export interface Scheduler {
  start(): void
  stop(): void
  isRunning(): boolean
}

export function createScheduler(task: () => Promise<void>, intervalMs: number): Scheduler {
  let timer: ReturnType<typeof setInterval> | null = null
  let running = false

  const run = (): void => {
    task().catch(() => { })
  }

  return {
    start() {
      if (running) return
      running = true
      run()
      timer = setInterval(run, intervalMs)
    },
    stop() {
      running = false
      if (timer !== null) {
        clearInterval(timer)
        timer = null
      }
    },
    isRunning() {
      return running
    },
  }
}
