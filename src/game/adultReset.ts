/**
 * Adult reset - issue #16.
 *
 * SPEC §14.2: a finger held on the level numeral for `holdMs` opens a confirm step, a second tap
 * wipes progress back to level 1, and nothing a normal tap can do gets that far. Pure, so the hold,
 * the cancel and the timeout can be tested without a pointer or a clock - the same reason
 * `fallbackLines` is pure (issue #23).
 */

import { ADULT_RESET } from './constants'
import { createLevel } from './level'
import { DEFAULT_MUTED, resolveMuted } from './mute'
import { toSaveState, type SaveContext } from './save'
import type { AnimalId, SaveState } from './types'

export type AdultResetStage = 'idle' | 'confirm'

export interface AdultResetState {
  stage: AdultResetStage
  /** When the confirm tap stops counting; 0 while idle. */
  confirmExpiresAt: number
}

export function initialAdultReset(): AdultResetState {
  return { stage: 'idle', confirmExpiresAt: 0 }
}

/**
 * SPEC §14.2 says "for exactly 3s", so a hold of exactly `holdMs` opens the confirm step and a
 * moment less does not. A normal tap is far below this, which is what makes the path
 * undiscoverable by accident.
 */
export function holdOpensConfirm(heldMs: number): boolean {
  return heldMs >= ADULT_RESET.holdMs
}

/**
 * The timer only opens the confirm step if the finger is still down when it fires (issue #16). The
 * elapsed time alone is not enough: a normal tap also leaves a three-second timer behind it, and
 * letting that timer open the step would make the adult-only path discoverable by accident.
 */
export function holdCompleted(pressed: boolean, heldMs: number): boolean {
  return pressed && holdOpensConfirm(heldMs)
}

export function openConfirm(now: number): AdultResetState {
  return { stage: 'confirm', confirmExpiresAt: now + ADULT_RESET.confirmTimeoutMs }
}

/** SPEC §14.2, issue #16: any other interaction cancels it, and it cancels cleanly back to idle. */
export function cancelReset(): AdultResetState {
  return { stage: 'idle', confirmExpiresAt: 0 }
}

/** The confirm step gives up when the adult stops interacting, so it never lingers. */
export function confirmHasExpired(state: AdultResetState, now: number): boolean {
  return state.stage === 'confirm' && now > state.confirmExpiresAt
}

/** The second tap only counts while the confirm step is still open. */
export function confirmIsLive(state: AdultResetState, now: number): boolean {
  return state.stage === 'confirm' && !confirmHasExpired(state, now)
}

/**
 * What a completed reset keeps: the mute choice (§11) because it is an adult setting rather than
 * the child's progress, and the session seed (§9.2) because that is what makes the same animal set
 * come back. `levelsCompleted` is the progress, so the context the reset writes is the default run
 * with the remembered mute.
 */
export function resetContext(previous: SaveState | null): SaveContext {
  return { muted: resolveMuted(previous, DEFAULT_MUTED), levelsCompleted: 0 }
}

/**
 * The save a completed reset writes (SPEC §14.2, issue #16): level 1 with a full rack, which is
 * what `createLevel` produces for level 1, so the board, the goals and the rack are the ones a
 * fresh game starts with - not the ones that were wiped.
 */
export function buildResetSave(previous: SaveState | null, pool: readonly AnimalId[]): SaveState {
  const seed = previous === null ? 0 : previous.sessionSeed
  return toSaveState(createLevel(1, seed, pool), resetContext(previous))
}
