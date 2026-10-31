import type { KeyValueStore } from '../game/types'
import { localStorageStore } from './storage'

/**
 * A timestamped trace of the boot path, persisted so it survives a force-close into the next launch.
 * All storage calls are guarded: Android WebView can deny `localStorage` outright.
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

export type BootStorage = KeyValueStore

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
  /** This launch's trace so far. */
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
  const storage = options.storage === undefined ? localStorageStore() : options.storage
  const clock = options.clock === undefined ? { now: () => Date.now() } : options.clock
  const maxSteps = options.maxSteps === undefined ? MAX_STEPS : options.maxSteps

  const persisted = readRun(storage)
  const run: BootRun = { startedAt: clock.now(), steps: [], lastError: null }
  const listeners: Array<() => void> = []

  const persist = (): boolean => {
    try {
      return storage.write(STORAGE_KEY, JSON.stringify(run))
    } catch (unused) {
      return false
    }
  }

  const notify = (): void => {
    for (const listener of listeners) {
      try {
        listener()
      } catch (unused) {
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
    const encoded = JSON.stringify(value)
    return encoded === null ? String(value) : encoded
  } catch (unused) {
    return String(value)
  }
}

/** A half-written or invalid value is what a force-close looks like, not an error to report. */
function readRun(storage: BootStorage): BootRun | null {
  let raw: string | null
  try {
    raw = storage.read(STORAGE_KEY)
  } catch (unused) {
    return null
  }
  if (raw === null) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (unused) {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null

  const record = parsed as Record<string, unknown>
  if (typeof record.startedAt !== 'number') return null

  const steps = Array.isArray(record.steps) ? record.steps : []
  const valid: BootStep[] = []
  // No `flatMap`: it is Chrome 69, newer than the WebView engine.
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
