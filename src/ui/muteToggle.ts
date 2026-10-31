import type { AudioPlayer } from '../audio/player'
import { DEFAULT_MUTED, resolveMuted, toggleMuted } from '../game/mute'
import type { SaveState } from '../game/types'

/**
 * The mute toggle. The player owns the audio state, so the controller never keeps a second copy:
 * the icon and the sound cannot disagree. The toggle has no text, because a five-year-old cannot
 * read; `aria-pressed` carries the same fact for a screen reader.
 */

const SVG_NS = 'http://www.w3.org/2000/svg'

export interface MuteDeps {
  player: AudioPlayer
  /** The save the run resumed from, which is what the toggle shows at boot. */
  saved: SaveState | null
  /** What a device that has never been told otherwise gets. */
  persistedDefault?: boolean
  /** Told when the switch moves, so the run can remember it. */
  onChange: (muted: boolean) => void
}

export interface MuteController {
  muted(): boolean
  /** One tap. Returns the state the icon should now show. */
  toggle(): boolean
}

export function createMuteController(deps: MuteDeps): MuteController {
  const fallback = deps.persistedDefault === undefined ? DEFAULT_MUTED : deps.persistedDefault
  const restored = resolveMuted(deps.saved, fallback)

  // Applied before anything can play, so the first pop already respects the remembered state.
  deps.player.setMuted(restored)

  return {
    muted: () => deps.player.isMuted(),

    toggle(): boolean {
      const next = toggleMuted(deps.player.isMuted())

      // The player first: a storage failure must never leave the icon disagreeing with what she hears.
      deps.player.setMuted(next)
      deps.onChange(next)

      return next
    },
  }
}

/** The button: icon only, at least 64 CSS px, with the state on `aria-pressed`. */
export function mountMuteToggle(mount: HTMLElement, controller: MuteController): HTMLElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'mute'
  button.append(makeIcon())
  paint(button, controller)

  button.addEventListener('click', () => {
    // Throw the switch before repainting, so the icon shows what the player is actually doing.
    controller.toggle()
    paint(button, controller)
  })

  mount.append(button)
  return button
}

function makeIcon(): Element {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('aria-hidden', 'true')

  const body = document.createElementNS(SVG_NS, 'path')
  body.setAttribute('d', 'M4 9h4l5-4v14l-5-4H4z')

  // CSS shows the waves or the cross according to `aria-pressed`.
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

/** Icon, pressed state and title all come from the same source. */
function paint(button: HTMLElement, controller: MuteController): void {
  const muted = controller.muted()
  const state = muted ? 'muted' : 'sound on'

  button.setAttribute('aria-pressed', String(muted))
  button.classList.toggle('mute--muted', muted)
  button.setAttribute('aria-label', muted ? 'Sound off' : 'Sound on')
  button.setAttribute('title', state)
}
