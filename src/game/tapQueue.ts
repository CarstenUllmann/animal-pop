import { MAX_QUEUED_TAPS } from './constants'

/** How the queue answered a tap. `dropped` is quiet: an overflow tap costs nothing. */
export type TapArrival = 'run' | 'wait' | 'dropped'

export interface TapQueue {
  /**
   * Idle: the tap may run at once. Window open: it waits behind the earlier taps, up to the cap.
   * The tap past the cap is the one discarded, never one already waiting.
   */
  register(index: number): TapArrival

  /** Opened when a tap begins resolving. */
  openWindow(): void

  /** Closed when that animation ends; it is the only thing that releases a waiting tap. */
  closeWindow(): void

  /** The next index that may run, oldest first, or null while the window is open. */
  drain(): number | null

  /** Level change: queued taps belong to the level she has left. The window is left as it is. */
  clear(): void

  /** Taps waiting. */
  size(): number
}

export function createTapQueue(): TapQueue {
  const waiting: number[] = []
  let windowOpen = false

  return {
    register(index: number): TapArrival {
      if (!windowOpen) return 'run'
      if (waiting.length >= MAX_QUEUED_TAPS) return 'dropped'
      waiting.push(index)
      return 'wait'
    },
    openWindow(): void {
      windowOpen = true
    },
    closeWindow(): void {
      windowOpen = false
    },
    drain(): number | null {
      if (windowOpen) return null
      const index = waiting.shift()
      return index === undefined ? null : index
    },
    clear(): void {
      waiting.length = 0
    },
    size(): number {
      return waiting.length
    },
  }
}
