/**
 * Mute (SPEC §11, issue #17).
 *
 * The rules are on their own here, with no audio device and no browser, so the default and the
 * remembered state can be tested - and because the game has to know the state before anything can
 * sound, the toggle restores it from the save rather than from last session's variables.
 */

import { SAVE_KEY } from './save'
import type { KeyValueStore, SaveState } from './types'

/** SPEC §11: sound is on unless this device has been told otherwise. */
export const DEFAULT_MUTED = false

/**
 * What the toggle shows at boot. Only a device with nothing persisted gets the default; a save
 * always wins, because the whole point of issue #17 is that the choice survives a reload.
 * `readSave` already answers a save that has no `muted` field with the default, so nothing has to
 * be guessed here.
 */
export function resolveMuted(saved: SaveState | null, persistedDefault: boolean = DEFAULT_MUTED): boolean {
  return saved === null ? persistedDefault : saved.muted
}

export function toggleMuted(current: boolean): boolean {
  return !current
}

/**
 * The save a mute change writes: the new state merged into whatever the game last persisted, so
 * remembering the toggle never clobbers the level (§14.1). Nothing is written when there is no
 * save yet - the game's own next write carries `muted` from the save context.
 */
export function persistMuted(saved: SaveState | null, muted: boolean, storage: KeyValueStore): boolean {
  if (saved === null) return false
  try {
    return storage.write(SAVE_KEY, JSON.stringify(Object.assign({}, saved, { muted: muted })))
  } catch (unused) {
    // A WebView can refuse storage at any time; the toggle still works, it just is not remembered.
    return false
  }
}
