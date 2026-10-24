import type { AnimalId } from '../game/types'

/**
 * The audio seam (SPEC §11): game code only ever talks to this interface, so a
 * sample-based player can replace the synth later without touching the game.
 */
export interface AudioPlayer {
  /** Must be called from a user gesture on Android before sound is allowed. */
  unlock(): void
  /** Pop a cluster of `count` animals of one type. */
  playPop(animal: AnimalId, count: number): void
  /** Quiet, low "boop" for a tap that is not a legal group. */
  playInvalid(): void
  /** Wind-like noise sweep when the board reshuffles itself. */
  playReshuffle(): void
  setMuted(muted: boolean): void
  isMuted(): boolean
}
