/**
 * The adult reset, wired to the level numeral - issue #16.
 *
 * The rules live in `game/adultReset.ts`; this is the pointer handling, the shake, and the confirm
 * icon. There is no visible button and nothing to read (SPEC §1): the path exists for an adult who
 * already knows it, so the only affordance is the half-second shake and the icon that appears after
 * the hold (SPEC §13).
 *
 * Only this module owns the timer, because the core must not touch the DOM or the clock (SPEC §15).
 * The timer comes in through the `Timer` seam, in the same spirit as `Clock` and `KeyValueStore` in
 * `bootlog.ts`, so nothing here has to be assumed to exist.
 */

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

/** The whole message is one glyph, not a word, because she cannot read (SPEC §1). */
export const CONFIRM_GLYPH = '✓'

/** Half a second on the press (issue #16). CSS cannot read a constant, so `style.css` writes the
   same number; the stylesheet test is what keeps the two from drifting apart. */
export const SHAKE_MS = 500

export interface Timer {
  /** Runs `run` after `ms`; the number it returns is what `clear` takes. */
  after(ms: number, run: () => void): number
  clear(id: number): void
}

export interface AdultResetDeps {
  clock: Clock
  timer: Timer
  /** Called when the second tap completes the reset. The run decides what the reset keeps (SPEC §14.2). */
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
  // The icon is the whole message, and she cannot read, so the label is for a screen reader.
  icon.setAttribute('aria-label', 'Confirm reset')
  icon.textContent = CONFIRM_GLYPH
  icon.hidden = true
  numeral.append(icon)

  let state: AdultResetState = initialAdultReset()
  let heldFrom = 0
  // Two timers, because they mean different things: the hold timer belongs to the finger still being
  // down, and the confirm timer belongs to the confirm step. Releasing early must clear the first and
  // leave the second alone (issue #16).
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

  /** Issue #16: a cancel is clean - no shake, no icon, and no timer left running. */
  const cancel = (): void => {
    pressed = false
    clearHold()
    clearConfirm()
    state = cancelReset()
    numeral.classList.remove('panel__level--shaking')
    show(false)
  }

  const press = (event: PointerEvent): void => {
    // While the confirm step is open, only its icon continues it. Pressing anywhere else on the numeral
    // is "any other interaction", so it cancels instead of starting a second hold.
    if (state.stage === 'confirm') {
      if (event.target !== icon) cancel()
      return
    }

    pressed = true
    heldFrom = deps.clock.now()
    // SPEC §13: the shake is the only signal before the icon appears, and reduced motion keeps the
    // icon while dropping the shake.
    numeral.classList.add('panel__level--shaking')

    clearHold()
    holdTimer = deps.timer.after(ADULT_RESET.holdMs, () => {
      holdTimer = 0
      const now = deps.clock.now()
      // A normal tap released long before this fires. The `pressed` half is what makes that true even if
      // the release handler and this timer race: a finger that is no longer down never opens the step.
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
    // SPEC §14.2: releasing before the hold completed is a normal tap, which does nothing at all.
    if (state.stage === 'idle') clearHold()
  }

  const onNumeralClick = (event: Event): void => {
    // The confirm icon is the only interaction that completes the reset; anything else on the
    // numeral cancels it (issue #16).
    if (event.target === icon) return
    if (state.stage === 'confirm') cancel()
  }

  const onIconClick = (): void => {
    if (!confirmIsLive(state, deps.clock.now())) return
    cancel()
    // The run owns the save, so the reset is one command rather than a save this view rebuilds.
    deps.onReset()
  }

  /**
   * Issue #16: any other interaction cancels the confirm step. This is on the document rather than the
   * numeral, because the adult might touch the board or the mute after opening it, and a confirm that
   * waits for its 15-second timeout is not "cancels cleanly".
   */
  const onDocumentPointerDown = (event: PointerEvent): void => {
    if (state.stage !== 'confirm') return
    if (numeral.contains(event.target as Node)) return
    cancel()
  }

  numeral.addEventListener('pointerdown', press)
  numeral.addEventListener('pointerup', release)
  numeral.addEventListener('pointerleave', release)
  numeral.addEventListener('pointercancel', cancel)
  numeral.addEventListener('click', onNumeralClick)
  icon.addEventListener('click', onIconClick)
  document.addEventListener('pointerdown', onDocumentPointerDown, true)

  return {
    element: numeral,
    destroy(): void {
      numeral.removeEventListener('pointerdown', press)
      numeral.removeEventListener('pointerup', release)
      numeral.removeEventListener('pointerleave', release)
      numeral.removeEventListener('pointercancel', cancel)
      numeral.removeEventListener('click', onNumeralClick)
      icon.removeEventListener('click', onIconClick)
      document.removeEventListener('pointerdown', onDocumentPointerDown, true)
      clearHold()
      clearConfirm()
      icon.remove()
    },
  }
}
