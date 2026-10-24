/**
 * Boot trace — issue #23.
 *
 * A force-close on the tablet leaves nothing behind: there is no console in standalone
 * mode, and the process is killed before anything renders. So the boot path records a
 * timestamped trace that survives into the next launch, and `debug.ts` shows it.
 *
 * Everything here is pure with injected dependencies (no browser, no real `localStorage`)
 * so it can be tested in the node environment, and every storage call is guarded:
 * Android WebView can deny `localStorage` outright, and a force-close can leave a half
 * written value behind. See SPEC §14.1 — the save key stays reserved, so the trace has
 * its own key.
 */

export const STORAGE_KEY = 'pop-pals.boot.v1'

/** Long enough for a whole boot, short enough to stay readable in the overlay. */
export const MAX_STEPS = 40

/** Longest error text we keep; longer messages are truncated. */
export const MAX_ERROR_LENGTH = 240

export interface BootStep {
  name: string
  /** Milliseconds after this run started. */
  at: number
}

export interface BootRun {
  startedAt: number
  steps: BootStep[]
  lastError: string | null
}

/** The storage the trace is persisted behind. Real storage is wrapped in try/catch. */
export interface BootStorage {
  /** Null when the key is absent or the read is refused. */
  read(key: string): string | null
  /** False when the write is refused. */
  write(key: string, value: string): boolean
}

export interface Clock {
  now(): number
}

export interface BootLogOptions {
  storage?: BootStorage
  clock?: Clock
  maxSteps?: number
}

export interface BootLog {
  /** Previous launch's persisted trace, or null when nothing survived. */
  previous(): BootRun | null
  /** This launch's trace as recorded so far. */
  current(): BootRun
  step(name: string): void
  error(message: string): void
  /** True when the trace can actually be persisted. */
  storageAvailable(): boolean
  /** Notified after every recorded step or error. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void
}

export function createBootLog(options: BootLogOptions = {}): BootLog {
  // An absent storage means "no storage", not `localStorage`; a fake can also be injected.
  const storage = options.storage === undefined ? defaultStorage() : options.storage
  const clock = options.clock ?? { now: () => Date.now() }
  const maxSteps = options.maxSteps ?? MAX_STEPS

  const persisted = readRun(storage)
  const run: BootRun = { startedAt: clock.now(), steps: [], lastError: null }
  const listeners: Array<() => void> = []

  const persist = (): boolean => {
    try {
      return storage.write(STORAGE_KEY, JSON.stringify(run))
    } catch {
      // Storage can refuse at any time; the trace is then only visible on screen.
      return false
    }
  }

  const notify = (): void => {
    for (const listener of listeners) {
      try {
        listener()
      } catch {
        // A listener must never break the boot path.
      }
    }
  }

  return {
    previous: () => persisted,
    current: () => run,

    step(name: string): void {
      run.steps.push({ name, at: clock.now() - run.startedAt })
      if (run.steps.length > maxSteps) run.steps.shift()
      // Persist after every step: a force-close can happen at any one of them.
      persist()
      notify()
    },

    error(message: string): void {
      run.lastError = message.slice(0, MAX_ERROR_LENGTH)
      persist()
      notify()
    },

    storageAvailable: () => persist(),

    subscribe(listener: () => void): () => void {
      listeners.push(listener)
      return () => {
        const at = listeners.indexOf(listener)
        if (at >= 0) listeners.splice(at, 1)
      }
    },
  }
}

/** Render a run as plain lines: header, offsets, then the error if there was one. */
export function traceLines(run: BootRun): string[] {
  const lines = [`run ${new Date(run.startedAt).toISOString()}`]
  for (const step of run.steps) lines.push(`+${step.at}ms ${step.name}`)
  if (run.lastError !== null) lines.push(`error ${run.lastError}`)
  return lines
}

/** Any unknown thrown value, as text we can persist. */
export function describeError(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

/**
 * Read the previous run. A half-written or invalid value from a killed process is not
 * an error: it is what a force-close looks like from the outside.
 */
function readRun(storage: BootStorage): BootRun | null {
  let raw: string | null
  try {
    raw = storage.read(STORAGE_KEY)
  } catch {
    return null
  }
  if (raw === null) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null

  const record = parsed as Record<string, unknown>
  if (typeof record.startedAt !== 'number') return null

  const steps = Array.isArray(record.steps) ? record.steps : []
  const valid: BootStep[] = []
  // No `flatMap`: `Array.prototype.flatMap` is Chrome 69, newer than the WebView engine.
  for (const step of steps) {
    if (typeof step !== 'object' || step === null) continue
    const entry = step as Record<string, unknown>
    if (typeof entry.name !== 'string' || typeof entry.at !== 'number') continue
    valid.push({ name: entry.name, at: entry.at })
  }

  return {
    startedAt: record.startedAt,
    steps: valid,
    lastError: typeof record.lastError === 'string' ? record.lastError : null,
  }
}

/**
 * The persisted store, reached through `typeof` because Chrome 61 has no global-object alias
 * (Chrome 71) and a WebView can deny `localStorage` outright. Reading it must not throw: this is
 * the code that has to survive a force-close.
 */
function defaultStorage(): BootStorage {
  const store = typeof localStorage === 'object' ? localStorage : null
  return {
    read(key: string): string | null {
      if (store === null) return null
      try {
        return store.getItem(key)
      } catch {
        return null
      }
    },
    write(key: string, value: string): boolean {
      if (store === null) return false
      try {
        store.setItem(key, value)
        return true
      } catch {
        return false
      }
    },
  }
}
