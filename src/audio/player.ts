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
  /**
   * Balloon pop: the latex snapping over a body that drops in pitch (SPEC §11). `seed` is 0-1 and
   * drifts the pitch a little, so a handful of taps is not one sound replayed; the celebration takes it
   * from the injected `Rng`, so a replayed session pops at the same pitches (SPEC §2).
   */
  playBalloon(seed: number): void
  /**
   * One firework, as the party's background bed (SPEC §10.1 phase 4, §11): a muffled thump and a
   * sparkle tail, well under a plopp. `seed` is 0-1 and decides this burst's pitch, level, spark count
   * and scatter, from the same `Rng` as the burst that is drawn for it.
   */
  playFirework(seed: number): void
  /** Completion cue: fanfare for a big or medium party, soft two-note chime for a small one. */
  playCompletion(tier: PartyTier): void
  /**
   * Cancels everything still sounding or still scheduled (SPEC §10.1, issue #14). Mute alone only
   * drops the master gain, so a fanfare scheduled before the play arrow is tapped would keep playing
   * into the next level; this is what the celebration calls when the party ends.
   */
  stop(): void
  setMuted(muted: boolean): void
  isMuted(): boolean
}
