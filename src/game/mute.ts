/**
 * Mute (SPEC §11, issue #17).
 *
 * The rules are on their own here, with no audio device and no browser, so the default and the
 * remembered state can be tested - and because the game has to know the state before anything can
 * sound, the toggle restores it from the save rather than from last session's variables.
 *
 * There is no write here. The run owns the mute as part of its own save, so a toggle is one command on
 * the session (`setMuted`), and the one write path is what remembers it (issue #17).
 */

import type { SaveState } from './types'

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
