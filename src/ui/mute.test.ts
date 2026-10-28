import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { AudioPlayer } from '../audio/player'
import { DEFAULT_MUTED, resolveMuted, toggleMuted } from '../game/mute'
import type { SaveState } from '../game/types'
import { createMuteController } from './muteToggle'

const SRC = dirname(fileURLToPath(import.meta.url))
const muteSource = readFileSync(join(SRC, 'muteToggle.ts'), 'utf8')

/** The player is recorded rather than played: the tests only need to see when the switch is thrown. */
function fakePlayer(muted: boolean, order: string[]): AudioPlayer {
  const noop = (): void => {}
  return {
    unlock: noop,
    playPop: noop,
    playInvalid: noop,
    playReshuffle: noop,
    playBubble: noop,
    playBalloon: noop,
    playCompletion: noop,
    stop: noop,
    setMuted: (next: boolean) => {
      order.push('setMuted')
      muted = next
    },
    isMuted: () => muted,
  }
}

/** A save only has to say what the toggle shows at boot, so the rest of the shape is not needed here. */
function saved(muted: boolean): SaveState {
  return { muted } as SaveState
}

describe('mute', () => {
  it('falls back to the default only when nothing is persisted (SPEC §11)', () => {
    expect(resolveMuted(null)).toBe(DEFAULT_MUTED)
    expect(resolveMuted(null, true)).toBe(true)

    // A remembered state beats the default, in both directions.
    expect(resolveMuted(saved(true), false)).toBe(true)
    expect(resolveMuted(saved(false), true)).toBe(false)
  })

  it('restores the remembered state before anything can play (issue #17)', () => {
    const order: string[] = []
    const controller = createMuteController({
      player: fakePlayer(false, order),
      saved: saved(true),
      onChange: () => order.push('change'),
    })

    // The only call before the first tap is the restore, and it reads the save, not a default.
    expect(order).toEqual(['setMuted'])
    expect(controller.muted()).toBe(true)
  })

  it('one tap throws the switch and tells the run, so the next write keeps the choice (issue #17)', () => {
    const order: string[] = []
    const changes: boolean[] = []
    const controller = createMuteController({
      player: fakePlayer(false, order),
      saved: null,
      onChange: (muted: boolean) => {
        order.push('change')
        changes.push(muted)
      },
    })

    expect(controller.toggle()).toBe(true)
    // The switch is thrown before the run is told, so a write that fails cannot leave the icon and
    // the sound disagreeing.
    expect(order).toEqual(['setMuted', 'setMuted', 'change'])
    expect(changes).toEqual([true])
    expect(controller.muted()).toBe(true)

    expect(controller.toggle()).toBe(false)
    expect(changes).toEqual([true, false])
    expect(toggleMuted(true)).toBe(false)
  })

  it('never replays what muting missed: one call per tap, nothing queued', () => {
    const order: string[] = []
    const controller = createMuteController({
      player: fakePlayer(false, order),
      saved: null,
      onChange: () => order.push('change'),
    })

    controller.toggle()
    controller.toggle()
    controller.toggle()

    // The restore at boot plus one call per tap. A muted player is gated, not buffered.
    const switches = order.filter((call) => call === 'setMuted')
    expect(switches).toHaveLength(4)
    // Three taps from an unmuted start end muted — the odd count, not a replayed backlog, is what
    // decides the final state.
    expect(controller.muted()).toBe(true)
  })

  it('the button tap throws the switch, not just the icon (issue #17)', () => {
    // The controller above is tested directly, so nothing here would catch a button whose handler only
    // repainted: the icon would flip and the sound would not. Vitest runs in node (vitest.config.ts), so
    // the shipped handler is read as text.
    const handler = muteSource.slice(muteSource.indexOf("button.addEventListener('click'"))
    expect(handler).toContain('controller.toggle()')
    expect(handler.indexOf('controller.toggle()')).toBeLessThan(handler.indexOf('paint(button, controller)'))
  })
})
