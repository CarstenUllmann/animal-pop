import { ADULT_RESET } from './constants'

export type AdultResetStage = 'idle' | 'confirm'

export interface AdultResetState {
  stage: AdultResetStage
  /** When the confirm tap stops counting; 0 while idle. */
  confirmExpiresAt: number
}

export function initialAdultReset(): AdultResetState {
  return { stage: 'idle', confirmExpiresAt: 0 }
}

/** A hold of exactly `holdMs` opens the confirm step; anything shorter is a normal tap. */
export function holdOpensConfirm(heldMs: number): boolean {
  return heldMs >= ADULT_RESET.holdMs
}

/** The timer only opens the step if the finger is still down when it fires. */
export function holdCompleted(pressed: boolean, heldMs: number): boolean {
  return pressed && holdOpensConfirm(heldMs)
}

export function openConfirm(now: number): AdultResetState {
  return { stage: 'confirm', confirmExpiresAt: now + ADULT_RESET.confirmTimeoutMs }
}

export function cancelReset(): AdultResetState {
  return { stage: 'idle', confirmExpiresAt: 0 }
}

export function confirmHasExpired(state: AdultResetState, now: number): boolean {
  return state.stage === 'confirm' && now > state.confirmExpiresAt
}

/** The second tap only counts while the confirm step is still open. */
export function confirmIsLive(state: AdultResetState, now: number): boolean {
  return state.stage === 'confirm' && !confirmHasExpired(state, now)
}
