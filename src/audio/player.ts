import type { AnimalId, PartyTier } from '../game/types'

/** The audio seam: game code only talks to this interface, so a sample player can replace the synth. */
export interface AudioPlayer {
  /** Must be called from a user gesture on Android before sound is allowed. */
  unlock(): void
  /** Pop a cluster of `count` animals of one type. */
  playPop(animal: AnimalId, count: number): void
  /** Quiet, low "boop" for a tap that is not a legal group. */
  playInvalid(): void
  /** Wind-like noise sweep when the board reshuffles itself. */
  playReshuffle(): void
  /** Tiny high tick as one bubble leaves the rack, distinct from an animal pop. */
  playBubble(): void
  /**
   * A balloon pop: the latex snapping over a body that drops in pitch. `seed` is 0-1 and drifts the
   * pitch a little, so a handful of taps is not one sound replayed.
   */
  playBalloon(seed: number): void
  /**
   * One firework for the party bed: a muffled thump and a sparkle tail, well under a balloon pop.
   * `seed` decides this burst's pitch, level, spark count and scatter.
   */
  playFirework(seed: number): void
  /** Completion cue: fanfare for a big or medium party, soft two-note chime for a small one. */
  playCompletion(tier: PartyTier): void
  /** Cancels everything still sounding or still scheduled, so a cue cannot bleed into the next level. */
  stop(): void
  setMuted(muted: boolean): void
  isMuted(): boolean
}
