import { ADULT_RESET } from '../game/constants'
import {
  cancelReset,
  confirmIsLive,
  holdCompleted,
  initialAdultReset,
  openConfirm,
  type AdultResetState,
} from '../game/adultReset'
import type { Clock } from './bootlog'
import type { Timer } from './timer'

/**
 * The adult reset, wired to the level numeral. The rules live in `game/adultReset.ts`; this is the
 * pointer handling, the shake and the confirm icon. There is no visible button: the path exists for
 * an adult who already knows it.
 */

/** The whole message is one glyph, not a word, because she cannot read. */
export const CONFIRM_GLYPH = '✓'

/** CSS cannot read a constant, so the build emits `ADULT_RESET.shakeMs` as `--shake-ms`. */
export const SHAKE_MS = ADULT_RESET.shakeMs

export type { Timer } from './timer'

export interface AdultResetDeps {
  clock: Clock
  timer: Timer
  /** Called when the second tap completes the reset. */
  onReset: () => void
}

export interface AdultResetView {
  element: HTMLElement
  destroy(): void
}

export function mountAdultReset(numeral: HTMLElement, deps: AdultResetDeps): AdultResetView {
  const icon = document.createElement('span')
  icon.className = 'adult-confirm'
  icon.setAttribute('role', 'button')
  icon.setAttribute('tabindex', '0')
  icon.setAttribute('aria-label', 'Confirm reset')
  icon.textContent = CONFIRM_GLYPH
  icon.hidden = true
  numeral.append(icon)

  let state: AdultResetState = initialAdultReset()
  let heldFrom = 0
  // Two timers: the hold belongs to the finger being down, the confirm belongs to the confirm step.
  let holdTimer = 0
  let confirmTimer = 0
  let pressed = false

  const show = (on: boolean): void => {
    icon.hidden = !on
    numeral.classList.toggle('panel__level--confirming', on)
  }

  const clearHold = (): void => {
    if (holdTimer !== 0) deps.timer.clear(holdTimer)
    holdTimer = 0
  }

  const clearConfirm = (): void => {
    if (confirmTimer !== 0) deps.timer.clear(confirmTimer)
    confirmTimer = 0
  }

  /** A cancel is clean: no shake, no icon, and no timer left running. */
  const cancel = (): void => {
    pressed = false
    clearHold()
    clearConfirm()
    state = cancelReset()
    numeral.classList.remove('panel__level--shaking')
    show(false)
  }

  const confirm = (): void => {
    if (!confirmIsLive(state, deps.clock.now())) return
    cancel()
    deps.onReset()
  }

  const press = (): void => {
    // The confirm step is open, so this pointerdown is the second tap.
    if (state.stage === 'confirm') {
      confirm()
      return
    }

    pressed = true
    heldFrom = deps.clock.now()
    numeral.classList.add('panel__level--shaking')

    clearHold()
    holdTimer = deps.timer.after(ADULT_RESET.holdMs, () => {
      holdTimer = 0
      const now = deps.clock.now()
      // The `pressed` half holds even if the release handler and this timer race.
      if (!holdCompleted(pressed, now - heldFrom)) return
      state = openConfirm(now)
      numeral.classList.remove('panel__level--shaking')
      show(true)
      confirmTimer = deps.timer.after(ADULT_RESET.confirmTimeoutMs, cancel)
    })
  }

  const release = (): void => {
    pressed = false
    numeral.classList.remove('panel__level--shaking')
    // Releasing before the hold completed is a normal tap, which does nothing at all.
    if (state.stage === 'idle') clearHold()
  }

  const onIconClick = (): void => {
    // Assistive tech or a synthetic click is the same confirmation; a pointer tap already handled it.
    confirm()
  }

  const onIconKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    confirm()
  }

  /** Any other interaction cancels the confirm step, rather than waiting for its timeout. */
  const onDocumentPointerDown = (event: PointerEvent): void => {
    if (state.stage !== 'confirm') return
    if (numeral.contains(event.target as Node)) return
    cancel()
  }

  numeral.addEventListener('pointerdown', press)
  numeral.addEventListener('pointerup', release)
  numeral.addEventListener('pointerleave', release)
  numeral.addEventListener('pointercancel', cancel)
  icon.addEventListener('click', onIconClick)
  icon.addEventListener('keydown', onIconKey)
  document.addEventListener('pointerdown', onDocumentPointerDown, true)

  return {
    element: numeral,
    destroy(): void {
      numeral.removeEventListener('pointerdown', press)
      numeral.removeEventListener('pointerup', release)
      numeral.removeEventListener('pointerleave', release)
      numeral.removeEventListener('pointercancel', cancel)
      icon.removeEventListener('click', onIconClick)
      icon.removeEventListener('keydown', onIconKey)
      document.removeEventListener('pointerdown', onDocumentPointerDown, true)
      clearHold()
      clearConfirm()
      icon.remove()
    },
  }
}
