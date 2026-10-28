import { createLevel, resumeLevel } from './level'
import { DEFAULT_MUTED } from './mute'
import { resolveTap, shouldShowParty } from './rules'
import { createTapQueue, type TapArrival } from './tapQueue'
import type { SaveContext } from './save'
import type { AnimalId, LevelState, Rng, SaveState, TapResult } from './types'

/**
 * A level session: the run of one level, from the deal to the party, with no DOM and no clock.
 *
 * SPEC §14.1 says a save is the level, and that is the whole reason this module exists. The level, the
 * facts that belong to the run rather than to a level (`muted`, `levelsCompleted`), the queue of taps
 * that arrived mid-settle, and the party flag were nine closures in `main.ts`, and four test suites read
 * that file as text because the rules had no interface. Here they are one thing that can be played in
 * node, and `main.ts` is only what turns a decision into a screen.
 *
 * The write is a seam, not a dependency: the session never imports storage, it hands `(state, context)`
 * to the one function the composition root gives it. That keeps the module pure enough for a test and
 * still makes "written after every resolved tap" a property of the level rather than of a caller who
 * might forget.
 */

/**
 * What the session did with one tap. `blocked` is the party (SPEC §10: the board is inert under the
 * dim), and the other three are the queue's own answers (SPEC §7.5).
 */
export type SessionArrival = TapArrival | 'blocked'

/**
 * What one tap turned into, in the order the renderer needs it: the settle to animate, the state the
 * save already has, and the two moments that only happen once per run.
 */
export interface TapPlan {
  /** The cell she touched, which the invalid animation needs. */
  index: number
  arrival: SessionArrival
  /** The settle to animate; null when nothing ran (`blocked`, `wait`, `dropped`). */
  result: TapResult | null
  /** The level after this tap, which is also what was just written. */
  state: LevelState
  /** This tap earned the party (SPEC §8.1), so the renderer opens it after the animation. */
  party: boolean
  /** The first tap of the run, which the boot trace records (issue #23). */
  firstTap: boolean
  /** The first pop of the run, which the boot trace records (issue #23). */
  firstPop: boolean
}

export interface SessionDeps {
  /** The save to resume, or null for a fresh install. */
  saved: SaveState | null
  /** SPEC §9.2: the per-install seed, persisted so a level regenerates identically. */
  sessionSeed: number
  pool: readonly AnimalId[]
  /** The only randomness the core is allowed to use, shared with the celebration's placement. */
  rng: Rng
  /** The one write path. Called after every change to the level or to the run. */
  save: (state: LevelState, context: SaveContext) => void
}

export interface LevelSession {
  state(): LevelState
  /** The facts that belong to the run rather than to a level (SPEC §14.1). */
  context(): SaveContext
  /**
   * A tap arrived. Always answers, because the first tap of the run is a trace fact even when the
   * party blocks it. Only `run` opens the settle window, and only `run` carries a `result`.
   */
  beginTap(index: number): TapPlan
  /**
   * The settle's animation ended: close the window and hand back the next tap the queue released, or
   * null when nothing is waiting. This is the only thing that releases a queued tap (SPEC §7.5).
   */
  settle(): TapPlan | null
  /** The ▶ on the party: leave it and deal the next level (SPEC §10.1). */
  nextLevel(): LevelState
  /** The adult reset's confirm: level 1, the mute kept, the completion count wiped (SPEC §14.2). */
  reset(): LevelState
  /**
   * The launch of a save that was written after the goals hit zero reopens the party rather than
   * showing a finished board with no way forward (SPEC §14.1, issue #15). True when it reopened.
   */
  restoreParty(): boolean
  /** SPEC §11: remember the choice on the same write path as progress (issue #17). */
  setMuted(muted: boolean): void
  /** Taps waiting, which is the number the overlay shows (SPEC §14.3). */
  queueSize(): number
}

export function createLevelSession(deps: SessionDeps): LevelSession {
  let state = deps.saved === null ? createLevel(1, deps.sessionSeed, deps.pool) : resumeLevel(deps.saved, deps.pool)
  const context: SaveContext = {
    muted: deps.saved === null ? DEFAULT_MUTED : deps.saved.muted,
    levelsCompleted: deps.saved === null ? 0 : deps.saved.levelsCompleted,
  }

  const queue = createTapQueue()
  // The window is open for the deal, so a tap during it waits rather than running against a board that
  // is still appearing. The composition root closes it after the first frame.
  queue.openWindow()

  let partyShown = false
  let firstTap = true
  let firstPop = true

  function persist(): void {
    deps.save(state, context)
  }

  /**
   * The party is the rack, and it is the only thing that plays the completion cue. `countCompletion` is
   * false when the launch restores a party: the run that reached the level already counted it.
   */
  function openParty(countCompletion: boolean): void {
    partyShown = true
    // Issue #11, SPEC §10: a tap that arrived during the settle that won belongs to the level just
    // finished, so it goes with the level rather than into it.
    queue.clear()
    if (!countCompletion) return
    context.levelsCompleted += 1
    persist()
  }

  /** One tap that may run: resolve it, write it, and decide whether it earned the party. */
  function run(index: number): TapPlan {
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
      // The trace fact is the touch, not the pop: a first tap during a restored party is still the first
      // tap of the run (issue #23).
      const first = firstTap
      firstTap = false
      if (partyShown) {
        return { index, arrival: 'blocked', result: null, state, party: false, firstTap: first, firstPop: false }
      }

      const arrival = queue.register(index)
      if (arrival !== 'run') {
        return { index, arrival, result: null, state, party: false, firstTap: first, firstPop: false }
      }
      const plan = run(index)
      return { ...plan, firstTap: first }
    },

    settle(): TapPlan | null {
      queue.closeWindow()
      const next = queue.drain()
      return next === null ? null : run(next)
    },

    nextLevel(): LevelState {
      partyShown = false
      // Issue #11: the taps waiting belong to the level she has left, and the board they would have been
      // decided against is not the one the new level was dealt.
      queue.clear()
      state = createLevel(state.level + 1, deps.sessionSeed, deps.pool)
      persist()
      return state
    },

    reset(): LevelState {
      partyShown = false
      queue.clear()
      // `createLevel` at level 1 is what a fresh game starts with, and the session seed is what makes the
      // same animal set come back (issue #16). The mute is an adult setting, so it is not progress.
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
