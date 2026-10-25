/**
 * The tap queue - issue #11, SPEC §7.5.
 *
 * The whole module is one sentence: a tap that arrives while the board is still settling is kept, and
 * it is decided later against the board as it has become, never against the board she tapped on. So the
 * queue stores indices and nothing else. It holds no copy of the board, because a copy would be a second
 * board with its own opinion about what her tap does, and the board the game shows, saves and charges a
 * bubble for has to be the settled one.
 *
 * Pure (SPEC §15), which is what makes the criteria in issue #11 assertable without a screen: no DOM, no
 * clock, no randomness. The animation window is a seam - the caller opens it when a tap begins resolving
 * and closes it when that animation ends. The queue owns no clock, so it cannot hold a tap past the
 * animation it was waiting for; that is §7.5's rule that input is never blocked longer than the running
 * animation, and it is a property of this module rather than a promise about the view.
 */

import { MAX_QUEUED_TAPS } from './constants'

/**
 * How the queue answered a tap. `dropped` is quiet on purpose: an overflow tap is not something she can
 * see, and nothing is recorded for it, so there is no penalty and no bubble that could be charged for it
 * later (SPEC §7.2 says exploring is already free, so an overflow tap must cost less, not more).
 */
export type TapArrival = 'run' | 'wait' | 'dropped'

export interface TapQueue {
  /**
   * One tap arrived. Idle: it may run straight away, so cause and effect stay inside a single frame
   * (SPEC §3). Window open: it joins the queue behind the taps that arrived earlier, up to the cap. The
   * cap is what keeps the queue from running ahead of what she is looking at, and the tap past the cap is
   * the one discarded - never a tap already waiting, so a later tap cannot displace an earlier one.
   */
  register(index: number): TapArrival

  /** The window a settle occupies, opened by the caller when a tap begins resolving. */
  openWindow(): void

  /** Closed when that animation ends. It is the only thing that releases a waiting tap. */
  closeWindow(): void

  /** The next index that may run, oldest first, or null while the window is still open. */
  drain(): number | null

  /**
   * Level change: the taps waiting belong to the level she has left, so they go with it. Clearing drops
   * the indices only, not the window, because the new level is dealt by an animation of its own - a tap
   * during that deal still has to wait, and nothing may run against a board that is still being dealt.
   */
  clear(): void

  /** Taps waiting, which is the number the debug overlay shows (SPEC §14.3). */
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
      // Blocked only while the window is open, and only in arrival order (SPEC §7.5).
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
