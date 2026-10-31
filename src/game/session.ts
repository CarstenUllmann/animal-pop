import { createLevel, resumeLevel } from './level'
import { DEFAULT_MUTED } from './mute'
import { resolveTap, shouldShowParty } from './rules'
import { createTapQueue, type TapArrival } from './tapQueue'
import type { SaveContext } from './save'
import type { AnimalId, LevelState, Rng, SaveState, TapResult } from './types'

/** One level run: state, the tap queue and the party flag, with no DOM and no clock. */

/** What the session did with one tap. `blocked` means the party is showing. */
export type SessionArrival = TapArrival | 'blocked'

/** What one tap turned into, in the order the renderer needs it. */
export interface TapPlan {
  /** The cell she touched, which the invalid animation needs. */
  index: number
  arrival: SessionArrival
  /** The settle to animate; null when nothing ran (`blocked`, `wait`, `dropped`). */
  result: TapResult | null
  /** The level after this tap, which is also what was just written. */
  state: LevelState
  /** This tap earned the party, so the renderer opens it after the animation. */
  party: boolean
  /** The first tap of the run, which the boot trace records. */
  firstTap: boolean
  /** The first pop of the run, which the boot trace records. */
  firstPop: boolean
}

export interface SessionDeps {
  /** The save to resume, or null for a fresh install. */
  saved: SaveState | null
  sessionSeed: number
  pool: readonly AnimalId[]
  /** Shared with the celebration, so visual randomness replays too. */
  rng: Rng
  /** Called after every change to the level or to the run. */
  save: (state: LevelState, context: SaveContext) => void
}

export interface LevelSession {
  state(): LevelState
  context(): SaveContext
  /**
   * A tap arrived. Only `run` opens the settle window and carries a result; the first tap of the
   * run is recorded even when the party blocks it.
   */
  beginTap(index: number): TapPlan
  /**
   * The settle ended: close the window and release the next queued tap, or null when none is
   * waiting.
   */
  settle(): TapPlan | null
  nextLevel(): LevelState
  /** Wipe progress back to level 1, keeping the mute. */
  reset(): LevelState
  /** Reopen a party the save was written into. True when it reopened. */
  restoreParty(): boolean
  setMuted(muted: boolean): void
  queueSize(): number
}

export function createLevelSession(deps: SessionDeps): LevelSession {
  let state = deps.saved === null ? createLevel(1, deps.sessionSeed, deps.pool) : resumeLevel(deps.saved, deps.pool)
  const context: SaveContext = {
    muted: deps.saved === null ? DEFAULT_MUTED : deps.saved.muted,
    levelsCompleted: deps.saved === null ? 0 : deps.saved.levelsCompleted,
  }

  const queue = createTapQueue()
  // Open for the deal, so a tap during it waits rather than running against a board still appearing.
  queue.openWindow()

  let partyShown = false
  let firstTap = true
  let firstPop = true

  function persist(): void {
    deps.save(state, context)
  }

  /** The party is the only thing that plays the completion cue. */
  function openParty(countCompletion: boolean): void {
    partyShown = true
    // Taps queued during the winning settle belong to the level just finished.
    queue.clear()
    if (!countCompletion) return
    context.levelsCompleted += 1
    persist()
  }

  function runTap(index: number): TapPlan {
    queue.openWindow()
    const result = resolveTap(state, index, deps.rng)
    state = result.state
    persist()

    const party = shouldShowParty(state, partyShown)
    if (party) openParty(true)
    const poppedFirst = firstPop && result.outcome === 'popped'
    if (poppedFirst) firstPop = false

    return { index, arrival: 'run', result, state, party, firstTap: false, firstPop: poppedFirst }
  }

  return {
    state: () => state,
    context: () => context,

    beginTap(index: number): TapPlan {
      const first = firstTap
      firstTap = false
      if (partyShown) {
        return { index, arrival: 'blocked', result: null, state, party: false, firstTap: first, firstPop: false }
      }

      const arrival = queue.register(index)
      if (arrival !== 'run') {
        return { index, arrival, result: null, state, party: false, firstTap: first, firstPop: false }
      }
      const plan = runTap(index)
      return { ...plan, firstTap: first }
    },

    settle(): TapPlan | null {
      queue.closeWindow()
      const next = queue.drain()
      return next === null ? null : runTap(next)
    },

    nextLevel(): LevelState {
      partyShown = false
      queue.clear()
      state = createLevel(state.level + 1, deps.sessionSeed, deps.pool)
      persist()
      return state
    },

    reset(): LevelState {
      partyShown = false
      queue.clear()
      state = createLevel(1, deps.sessionSeed, deps.pool)
      context.levelsCompleted = 0
      persist()
      return state
    },

    restoreParty(): boolean {
      if (!shouldShowParty(state, partyShown)) return false
      openParty(false)
      return true
    },

    setMuted(muted: boolean): void {
      context.muted = muted
      persist()
    },

    queueSize: () => queue.size(),
  }
}
