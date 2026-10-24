import type { AnimalId, PartyTier } from '../game/types'

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
  /** Tiny high tick as one bubble leaves the rack, distinct from an animal pop (SPEC §11). */
  playBubble(): void
  /** Balloon pop: filtered noise plus a pitch blip, ascending with the balloon index (SPEC §11). */
  playBalloon(index: number): void
  /** Completion cue: fanfare for a big or medium party, soft two-note chime for a small one. */
  playCompletion(tier: PartyTier): void
  setMuted(muted: boolean): void
  isMuted(): boolean
}
