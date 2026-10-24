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
  buildResetSave,
  cancelReset,
  confirmIsLive,
  holdOpensConfirm,
  initialAdultReset,
  openConfirm,
  type AdultResetState,
} from '../game/adultReset'
import type { AnimalId, SaveState } from '../game/types'
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
  /** The pool the game plays with, so the fresh level 1 is a real level rather than a blank one. */
  pool: readonly AnimalId[]
  /** The save as the game currently holds it, which is what the reset keeps the seed and mute from. */
  currentSave: () => SaveState | null
  /** Called when the second tap completes the reset, with the save the game should now show (SPEC §14.2). */
  onReset: (save: SaveState) => void
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
  let timeoutId = 0

  const show = (on: boolean): void => {
    icon.hidden = !on
    numeral.classList.toggle('panel__level--confirming', on)
  }

  /** Issue #16: a cancel is clean - no shake, no icon, and no timer left running. */
  const cancel = (): void => {
    if (timeoutId !== 0) deps.timer.clear(timeoutId)
    timeoutId = 0
    state = cancelReset()
    numeral.classList.remove('panel__level--shaking')
    show(false)
  }

  const press = (): void => {
    heldFrom = deps.clock.now()
    // SPEC §13: the shake is the only signal before the icon appears, and reduced motion keeps the
    // icon while dropping the shake.
    numeral.classList.add('panel__level--shaking')

    deps.timer.after(ADULT_RESET.holdMs, () => {
      // Only a hold that really reached `holdMs` gets here; a normal tap released long before it.
      if (!holdOpensConfirm(deps.clock.now() - heldFrom)) return
      state = openConfirm(deps.clock.now())
      numeral.classList.remove('panel__level--shaking')
      show(true)
      timeoutId = deps.timer.after(ADULT_RESET.confirmTimeoutMs, cancel)
    })
  }

  const release = (): void => {
    numeral.classList.remove('panel__level--shaking')
    // Releasing before the hold completed is a normal tap, which does nothing at all (SPEC §14.2).
  }

  const onNumeralClick = (event: Event): void => {
    // The confirm icon is the only interaction that completes the reset; anything else on the
    // numeral cancels it (issue #16).
    if (event.target === icon) return
    if (state.stage === 'confirm') cancel()
  }

  const onIconClick = (): void => {
    if (!confirmIsLive(state, deps.clock.now())) return
    const save = buildResetSave(deps.currentSave(), deps.pool)
    cancel()
    deps.onReset(save)
  }

  numeral.addEventListener('pointerdown', press)
  numeral.addEventListener('pointerup', release)
  numeral.addEventListener('pointercancel', cancel)
  numeral.addEventListener('click', onNumeralClick)
  icon.addEventListener('click', onIconClick)

  return {
    element: numeral,
    destroy(): void {
      numeral.removeEventListener('pointerdown', press)
      numeral.removeEventListener('pointerup', release)
      numeral.removeEventListener('pointercancel', cancel)
      numeral.removeEventListener('click', onNumeralClick)
      icon.removeEventListener('click', onIconClick)
      if (timeoutId !== 0) deps.timer.clear(timeoutId)
      icon.remove()
    },
  }
}
