import { LEVEL_RAMP, type LevelRampRow } from './constants'
import { createBoard } from './board'
import { createRng, mixSeed } from './rng'
import type { AnimalId, Goal, LevelState, Rng, SaveState } from './types'

/** The last ramp row that starts at or before `level`. */
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

/** Goal target per animal, which is also what the ring fills against. */
export function goalTargetForLevel(level: number): number {
  return rampForLevel(level).goalEach
}

export function bubblesForLevel(level: number): number {
  return rampForLevel(level).bubbles
}

export function levelSeed(sessionSeed: number, level: number): number {
  return mixSeed(sessionSeed, level)
}

/** Two distinct goal animals, both from the level's roster. */
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

/** A level from scratch: a shuffled roster, a playable board, and a full rack. */
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

/** A level rebuilt from a save. The roster and goal animals come back from the same seed. */
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
