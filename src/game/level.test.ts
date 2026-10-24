import { describe, expect, it } from 'vitest'
import { hasLegalGroup } from './board'
import { LEVEL_RAMP } from './constants'
import { createLevel, goalTargetForLevel, pickGoals, rampForLevel, resumeLevel, typesForLevel, bubblesForLevel } from './level'
import { createRng } from './rng'
import type { SaveState } from './types'

const POOL = ['cat', 'rabbit', 'panda', 'frog', 'pig', 'penguin', 'monkey', 'fox']

describe('level ramp', () => {
  it('matches the table in SPEC §9.1', () => {
    // Rows 1-10 are §9.1's design numbers; the rows from level 11 are what the §16.2 simulator
    // measured, which is what §9.1 says the ramp is written from. The numbers therefore live in
    // `LEVEL_RAMP` and are asserted there by `sim.test.ts`; what this test can assert is that a level
    // reads the row that covers it — the last row started at or before the level.
    expect(rampForLevel(1)).toBe(LEVEL_RAMP[0])
    expect(rampForLevel(2)).toBe(LEVEL_RAMP[0])
    expect(rampForLevel(3)).toBe(LEVEL_RAMP[1])
    expect(rampForLevel(6)).toBe(LEVEL_RAMP[1])
    expect(rampForLevel(7)).toBe(LEVEL_RAMP[2])
    expect(rampForLevel(8)).toBe(LEVEL_RAMP[2])
    expect(rampForLevel(9)).toBe(LEVEL_RAMP[3])
    expect(rampForLevel(10)).toBe(LEVEL_RAMP[3])
    expect(rampForLevel(11)).toBe(LEVEL_RAMP[4])
    expect(rampForLevel(12)).toBe(LEVEL_RAMP[4])
    expect(rampForLevel(13)).toBe(LEVEL_RAMP[5])
    expect(rampForLevel(15)).toBe(LEVEL_RAMP[5])
    expect(rampForLevel(16)).toBe(LEVEL_RAMP[6])
  })

  it('plateaus at level 16, so only the roster and goals rotate afterwards', () => {
    const plateau = LEVEL_RAMP[LEVEL_RAMP.length - 1]
    for (const level of [17, 20, 30, 60]) {
      expect(rampForLevel(level)).toBe(plateau)
      expect(typesForLevel(level)).toBe(6)
      expect(goalTargetForLevel(level)).toBe(8)
      expect(bubblesForLevel(level)).toBe(35)
    }
  })

  it('level 1 is over-funded so the first party is a big one', () => {
    const level = createLevel(1, 0x12345678, POOL)
    expect(level.bubblesStart).toBe(12)
    expect(level.goals.reduce((total, goal) => total + goal.target, 0)).toBe(6)
  })
})

describe('level generation', () => {
  it('is deterministic for the same (level, sessionSeed)', () => {
    const first = createLevel(9, 0xabcdef01, POOL)
    const second = createLevel(9, 0xabcdef01, POOL)
    expect(first).toEqual(second)
  })

  it('differs between levels and between sessions', () => {
    const a = createLevel(9, 0xabcdef01, POOL)
    const b = createLevel(10, 0xabcdef01, POOL)
    const c = createLevel(9, 0xabcdef02, POOL)
    expect(a.seed).not.toBe(b.seed)
    expect(a.seed).not.toBe(c.seed)
  })

  it('plays only the types the ramp allows, and picks two distinct goals among them', () => {
    for (const level of [1, 4, 8, 12, 17]) {
      const state = createLevel(level, 0x5eb00b1e, POOL)
      expect(state.roster).toHaveLength(typesForLevel(level))
      expect(state.goals).toHaveLength(2)
      expect(new Set(state.goals.map((goal) => goal.animal)).size).toBe(2)
      for (const goal of state.goals) {
        expect(state.roster).toContain(goal.animal)
        expect(goal.remaining).toBe(goal.target)
        expect(goal.target).toBe(goalTargetForLevel(level))
      }
    }
  })

  it('starts with a full board that has a legal tap', () => {
    for (let level = 1; level <= 20; level++) {
      const state = createLevel(level, 0x2468ace0, POOL)
      expect(state.board).toHaveLength(36)
      expect(state.board.filter((cell) => cell === null).length).toBe(0)
      expect(hasLegalGroup(state.board)).toBe(true)
    }
  })

  it('keeps the rack full at level start and records what the party is measured against', () => {
    const state = createLevel(12, 0x11112222, POOL)
    expect(state.bubbles).toBe(29)
    expect(state.bubblesStart).toBe(29)
  })

  it('resumes a mid-level save on the same roster the generator would have picked', () => {
    // The roster is derived from (sessionSeed, level), so a save written from a generated level
    // must come back with the same roster, the same goal animals, and only the counters changed.
    const fresh = createLevel(5, 0xdeadbeef, POOL)
    const saved: SaveState = {
      version: 1,
      sessionSeed: 0xdeadbeef,
      level: 5,
      board: fresh.board.map((cell, position) => (position === 0 ? null : cell)),
      goals: fresh.goals.map((goal, position) => ({
        animal: goal.animal,
        remaining: position === 0 ? goal.remaining - 1 : goal.remaining,
      })),
      bubbles: 7,
      bubblesStart: 16,
      muted: false,
      levelsCompleted: 4,
    }

    const state = resumeLevel(saved, POOL)
    expect(state.sessionSeed).toBe(saved.sessionSeed)
    expect(state.level).toBe(5)
    expect(state.roster).toEqual(fresh.roster)
    expect(state.board).toEqual(saved.board)
    expect(state.bubbles).toBe(7)
    expect(state.bubblesStart).toBe(16)
    expect(state.goals).toEqual([
      { animal: fresh.goals[0]!.animal, remaining: fresh.goals[0]!.remaining - 1, target: 4 },
      { animal: fresh.goals[1]!.animal, remaining: fresh.goals[1]!.remaining, target: 4 },
    ])
  })

  it('picks two distinct goals from the roster through the injected rng', () => {
    const goals = pickGoals(['cat', 'frog', 'pig'], 3, createRng(7))
    expect(goals).toHaveLength(2)
    expect(goals[0]!.animal).not.toBe(goals[1]!.animal)
    for (const goal of goals) {
      expect(['cat', 'frog', 'pig']).toContain(goal.animal)
      expect(goal.remaining).toBe(3)
      expect(goal.target).toBe(3)
    }
  })
})
