import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { AudioPlayer } from '../audio/player'
import { createLevel } from '../game/level'
import { DEFAULT_MUTED, persistMuted, resolveMuted, toggleMuted } from '../game/mute'
import { readSave, toSaveState, writeSave } from '../game/save'
import type { KeyValueStore, LevelState, SaveState } from '../game/types'
import { createMuteController } from './muteToggle'

const SRC = dirname(fileURLToPath(import.meta.url))
const muteSource = readFileSync(join(SRC, 'muteToggle.ts'), 'utf8')

const POOL = ['cat', 'rabbit', 'panda', 'frog']

/** A fake storage, so the tests never touch real `localStorage`. */
function fakeStore(order: string[], initial: Record<string, string> = {}): KeyValueStore {
  const values = new Map(Object.entries(initial))
  return {
    read: (key: string) => (values.has(key) ? (values.get(key) as string) : null),
    write: (key: string, value: string) => {
      order.push('write')
      values.set(key, value)
      return true
    },
  }
}

/** A store that behaves like a WebView that refuses `localStorage` outright. */
function deniedStore(): KeyValueStore {
  return {
    read: () => {
      throw new Error('localStorage is disabled')
    },
    write: () => {
      throw new Error('quota exceeded')
    },
  }
}

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

/** The save as the game would have written it, so the mute write has something to merge into. */
function writeProgress(state: LevelState, muted: boolean, storage: KeyValueStore): boolean {
  return writeSave(state, { muted: muted, levelsCompleted: 2 }, storage)
}

describe('mute', () => {
  it('falls back to the default only when nothing is persisted (SPEC §11)', () => {
    expect(resolveMuted(null)).toBe(DEFAULT_MUTED)
    expect(resolveMuted(null, true)).toBe(true)

    // A remembered state beats the default, in both directions.
    expect(resolveMuted({ muted: true } as SaveState, false)).toBe(true)
    expect(resolveMuted({ muted: false } as SaveState, true)).toBe(false)
  })

  it('restores the remembered state before anything can play (issue #17)', () => {
    const order: string[] = []
    const storage = fakeStore(order)
    writeProgress(createLevel(5, 0x5a5a5a5a, POOL), true, storage)
    // The setup write is not the controller's doing, so the recorded order starts at the boot.
    order.length = 0

    const controller = createMuteController({
      player: fakePlayer(false, order),
      store: storage,
      currentSave: () => readSave(storage),
    })

    // The only call before the first tap is the restore, and it reads the save, not a default.
    expect(order).toEqual(['setMuted'])
    expect(controller.muted()).toBe(true)
  })

  it('one tap toggles and writes the state through with the rest of the save', () => {
    const state = createLevel(7, 0x11112222, POOL)
    const order: string[] = []
    const storage = fakeStore(order)
    writeProgress(state, false, storage)
    // Only the controller's own calls count here: the boot restore, the tap, then the write.
    order.length = 0

    const controller = createMuteController({
      player: fakePlayer(false, order),
      store: storage,
      currentSave: () => readSave(storage),
    })

    expect(controller.toggle()).toBe(true)
    // The switch is thrown before the write, so a store that fails cannot leave the icon and the
    // sound disagreeing.
    expect(order).toEqual(['setMuted', 'setMuted', 'write'])

    const written = readSave(storage)
    expect(written).not.toBeNull()
    expect(written!.muted).toBe(true)
    // Remembering mute must not lose the level it was remembered on (§14.1).
    expect(written!.level).toBe(7)
    expect(written!.board).toEqual(state.board)
    expect(written!.levelsCompleted).toBe(2)

    expect(controller.toggle()).toBe(false)
    expect(readSave(storage)!.muted).toBe(false)
    expect(toggleMuted(true)).toBe(false)
  })

  it('still toggles, and still tells the player, when storage refuses (issue #17)', () => {
    const order: string[] = []
    const store = deniedStore()
    const controller = createMuteController({
      player: fakePlayer(false, order),
      store: store,
      currentSave: () => readSave(store),
    })

    expect(controller.toggle()).toBe(true)
    expect(controller.muted()).toBe(true)
    expect(order).toEqual(['setMuted', 'setMuted'])
  })

  it('writes nothing before the game has a save, so the game keeps the choice', () => {
    const order: string[] = []
    const storage = fakeStore(order)
    const controller = createMuteController({
      player: fakePlayer(false, order),
      store: storage,
      currentSave: () => readSave(storage),
    })

    expect(controller.toggle()).toBe(true)
    // Nothing to merge into yet: the toggle works now, and the game's next write remembers it.
    expect(order).toEqual(['setMuted', 'setMuted'])

    writeProgress(createLevel(1, 0x00000007, POOL), controller.muted(), storage)
    expect(readSave(storage)!.muted).toBe(true)
  })

  it('writes through the save shape the game itself uses, so the toggle keeps the context (§14.1)', () => {
    const state = createLevel(9, 0x22223333, POOL)
    const order: string[] = []
    const storage = fakeStore(order)

    const written = persistMuted(toSaveState(state, { muted: false, levelsCompleted: 3 }), true, storage)
    expect(written).toBe(true)
    expect(order).toEqual(['write'])

    const saved = readSave(storage)
    expect(saved).not.toBeNull()
    expect(saved!.muted).toBe(true)
    expect(saved!.levelsCompleted).toBe(3)
    expect(saved!.level).toBe(9)
    expect(saved!.board).toEqual(state.board)
  })

  it('never replays what muting missed: one call per tap, nothing queued', () => {
    const order: string[] = []
    const storage = fakeStore(order)
    const controller = createMuteController({
      player: fakePlayer(false, order),
      store: storage,
      currentSave: () => readSave(storage),
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
