export const GRID = 6
export const BOARD_SIZE = GRID * GRID
export const MIN_GROUP = 2
export const RESHUFFLE_MIN_GROUP = 3
export const MAX_QUEUED_TAPS = 2

/**
 * M1 has no levels yet (SPEC §9 arrives in M2). A board with four types gives a
 * five-year-old plenty of legal taps, matching the provisional level 1–2 ramp.
 */
export const M1_ANIMAL_TYPES = 4

/** Motion timings, all in one place (SPEC §21). */
export const MOTION = {
  dealStagger: 18,
  dropDuration: 190,
  dropPerRow: 14,
  pop: 200,
  wobble: 150,
  reshuffleShake: 420,
  reshuffleScatter: 260,
  reshuffleStagger: 22,
} as const

/** Synth levels and timings, all in one place (SPEC §11, §21). */
export const AUDIO = {
  masterGain: 0.5,
  popGain: 0.16,
  popDuration: 0.16,
  popNoteSpacing: 0.05,
  popMaxNotes: 6,
  boopPitch: 155,
  boopGain: 0.09,
  boopDuration: 0.18,
  whooshDuration: 0.45,
  whooshGain: 0.16,
} as const
