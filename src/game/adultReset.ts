import { ADULT_RESET } from './constants'

/**
 * Adult reset - issue #16.
 *
 * SPEC §14.2: a finger held on the level numeral for `holdMs` opens a confirm step, a second tap
 * wipes progress back to level 1, and nothing a normal tap can do gets that far. Pure, so the hold,
 * the cancel and the timeout can be tested without a pointer or a clock - the same reason
 * `fallbackLines` is pure (issue #23).
 *
 * What the reset keeps is not decided here: the run owns the save, so `LevelSession.reset()` is the
 * command that rebuilds level 1 and keeps the mute (SPEC §14.2, issue #17).
 */

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
