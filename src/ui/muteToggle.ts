/**
 * The mute toggle (SPEC §11, §14.1, issue #17).
 *
 * `createMuteController` is the half that can be tested without a browser: it decides what the
 * toggle shows at boot, what one tap changes, and what gets persisted. The player owns the audio
 * state, so the controller never keeps a second copy of it - that is what keeps the icon and the
 * sound from disagreeing (SPEC §11).
 *
 * The toggle is the only chrome on screen with no text (SPEC §1): a five-year-old cannot read, so
 * the state has to be carried by the icon alone, with `aria-pressed` as the accessible reading of
 * the same fact.
 */

import type { AudioPlayer } from '../audio/player'
import { DEFAULT_MUTED, persistMuted, resolveMuted, toggleMuted } from '../game/mute'
import type { KeyValueStore, SaveState } from '../game/types'

const SVG_NS = 'http://www.w3.org/2000/svg'

export interface MuteDeps {
  player: AudioPlayer
  store: KeyValueStore
  /** The save as the game currently holds it, so remembering mute never loses progress (§14.1). */
  currentSave: () => SaveState | null
  /** SPEC §11: what a device that has never been told otherwise gets. */
  persistedDefault?: boolean
}

export interface MuteController {
  muted(): boolean
  /** One tap. Returns the state the icon should now show. */
  toggle(): boolean
}

export function createMuteController(deps: MuteDeps): MuteController {
  const fallback = deps.persistedDefault === undefined ? DEFAULT_MUTED : deps.persistedDefault
  const restored = resolveMuted(deps.currentSave(), fallback)

  // Applied before anything can play (issue #17): the first pop already respects the remembered
  // state, and a device with no save gets the default.
  deps.player.setMuted(restored)

  return {
    muted: () => deps.player.isMuted(),

    toggle(): boolean {
      const next = toggleMuted(deps.player.isMuted())

      // Tell the player first. A running celebration is silenced by the same switch, and a
      // storage failure must never leave the icon disagreeing with what she can hear.
      deps.player.setMuted(next)
      persistMuted(deps.currentSave(), next, deps.store)

      return next
    },
  }
}

/** The button: icon only, at least 64 CSS px (SPEC §11, §13), state carried by `aria-pressed`. */
export function mountMuteToggle(mount: HTMLElement, controller: MuteController): HTMLElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'mute'
  button.append(makeIcon())
  paint(button, controller)

  button.addEventListener('click', () => {
    // The tap throws the switch first and only then repaints: a handler that only painted would show the
    // opposite of what the player is doing, and the toggle would do nothing at all (SPEC §11, issue #17).
    controller.toggle()
    paint(button, controller)
  })

  mount.append(button)
  return button
}

function makeIcon(): Element {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  // The state is on the button, so the icon is decoration alongside it.
  svg.setAttribute('aria-hidden', 'true')

  const body = document.createElementNS(SVG_NS, 'path')
  body.setAttribute('d', 'M4 9h4l5-4v14l-5-4H4z')

  // The waves are the sound-on half; the cross is the sound-off half. CSS shows one of them
  // according to `aria-pressed`, so both states read at a glance.
  const waves = document.createElementNS(SVG_NS, 'g')
  waves.setAttribute('class', 'mute__waves')
  for (const arc of ['M14 8c2 1.5 2 4.5 0 6', 'M17 6c3 2.5 3 7.5 0 10']) {
    const path = document.createElementNS(SVG_NS, 'path')
    path.setAttribute('d', arc)
    waves.append(path)
  }

  const cross = document.createElementNS(SVG_NS, 'g')
  cross.setAttribute('class', 'mute__cross')
  const slash = document.createElementNS(SVG_NS, 'path')
  slash.setAttribute('d', 'M14 9l7 7M21 9l-7 7')
  cross.append(slash)

  svg.append(body, waves, cross)
  return svg
}

/** Icon, pressed state, and title all come from the same source, so they cannot disagree (SPEC §11). */
function paint(button: HTMLElement, controller: MuteController): void {
  const muted = controller.muted()
  const state = muted ? 'muted' : 'sound on'

  button.setAttribute('aria-pressed', String(muted))
  button.classList.toggle('mute--muted', muted)

  // She cannot read, so this is for a screen reader and for an adult looking at the tablet.
  button.setAttribute('aria-label', muted ? 'Sound off' : 'Sound on')
  button.setAttribute('title', state)
}
