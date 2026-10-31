import type { SaveState } from './types'

/** Sound is on unless this device has been told otherwise. */
export const DEFAULT_MUTED = false

/** A save always wins; only a device with nothing persisted gets the default. */
export function resolveMuted(saved: SaveState | null, persistedDefault: boolean = DEFAULT_MUTED): boolean {
  return saved === null ? persistedDefault : saved.muted
}

export function toggleMuted(current: boolean): boolean {
  return !current
}
