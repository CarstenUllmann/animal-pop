import { LEVEL_RAMP, type LevelRampRow } from './constants'
import { createBoard } from './board'
import { createRng, mixSeed } from './rng'
import type { AnimalId, Goal, LevelState, Rng, SaveState } from './types'

/**
 * Level parameters and generation (SPEC §9). Pure: the numbers come from the ramp table in
 * `constants.ts`, and every choice is made through the injected `Rng`, so a level regenerates
 * identically for the same `(level, sessionSeed)` - which is what makes resume and bug reports
 * from the tablet mean anything.
 */

/** The ramp row that applies to a level: the last row started at or before it. */
export function rampForLevel(level: number): LevelRampRow {
  for (let i = LEVEL_RAMP.length - 1; i >= 0; i--) {
    const row = LEVEL_RAMP[i]
    if (row !== undefined && row.from <= level) return row
  }
  throw new Error('The level ramp must not be empty')
}

export function typesForLevel(level: number): number {
  return rampForLevel(level).types
}

/** Goal target per goal animal, which is also what the goal ring fills against. */
export function goalTargetForLevel(level: number): number {
  return rampForLevel(level).goalEach
}

export function bubblesForLevel(level: number): number {
  return rampForLevel(level).bubbles
}

export function levelSeed(sessionSeed: number, level: number): number {
  return mixSeed(sessionSeed, level)
}

/** Two distinct goal animals, always among the types in play (SPEC §8.1). */
export function pickGoals(roster: readonly AnimalId[], target: number, rng: Rng): Goal[] {
  if (roster.length < 2) throw new Error('A level needs at least two animal types to pick goals from')
  const shuffled = rng.shuffle(roster)
  const first = shuffled[0] as AnimalId
  const second = shuffled[1] as AnimalId
  return [
    { animal: first, remaining: target, target },
    { animal: second, remaining: target, target },
  ]
}

/**
 * A level from scratch. The roster is randomised per level, the board is a full one that is
 * guaranteed to have a legal tap, and the rack starts full.
 */
export function createLevel(
  level: number,
  sessionSeed: number,
  pool: readonly AnimalId[],
  rng: Rng = createRng(levelSeed(sessionSeed, level)),
): LevelState {
  const row = rampForLevel(level)
  const roster = rng.shuffle(pool).slice(0, row.types)
  const goals = pickGoals(roster, row.goalEach, rng)
  const bubbles = row.bubbles

  return {
    level,
    sessionSeed,
    seed: levelSeed(sessionSeed, level),
    roster,
    board: createBoard(roster, rng),
    goals,
    bubbles,
    bubblesStart: bubbles,
  }
}

/**
 * A level rebuilt from a save (SPEC §14.1). The roster and the goal animals come back from the
 * same seed, so the only things to overlay are the board, the goal counters and the rack.
 */
export function resumeLevel(saved: SaveState, pool: readonly AnimalId[]): LevelState {
  const fresh = createLevel(saved.level, saved.sessionSeed, pool)
  return {
    level: saved.level,
    sessionSeed: saved.sessionSeed,
    seed: fresh.seed,
    roster: fresh.roster,
    board: saved.board,
    goals: fresh.goals.map((goal, position) => {
      const stored = saved.goals[position]
      const animal = stored === undefined ? goal.animal : stored.animal
      const remaining = stored === undefined ? goal.remaining : stored.remaining
      return { animal, remaining, target: goal.target }
    }),
    bubbles: saved.bubbles,
    bubblesStart: saved.bubblesStart,
  }
}
