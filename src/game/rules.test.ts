import { describe, expect, it } from 'vitest'
import { getGroups, hasGroupOfAtLeast, hasLegalGroup, indexOf } from './board'
import { BOARD_SIZE, GRID, MAX_BALLOONS, MIN_BUBBLES, RESHUFFLE_MIN_GROUP } from './constants'
import { createLevel } from './level'
import { createRng } from './rng'
import { countByAnimal, goalProgress, isComplete, partySize, resolveTap, shouldShowParty } from './rules'
import type { Goal, LevelState, Rng } from './types'

const POOL = ['cat', 'rabbit', 'panda', 'frog']

/** A full board with one named run, so the test can point at the exact group it taps. */
function boardWith(run: { animal: string; row: number; col: number; size: number }): Array<string | null> {
  const board: Array<string | null> = Array.from({ length: BOARD_SIZE }, () => 'panda')
  for (let step = 0; step < run.size; step++) {
    board[indexOf(run.row, run.col + step)] = run.animal
  }
  return board
}

function goal(animal: string, remaining: number, target: number): Goal {
  return { animal, remaining, target }
}

function stateWith(board: Array<string | null>, goals: Goal[], bubbles: number, bubblesStart: number): LevelState {
  return {
    level: 1,
    sessionSeed: 1,
    seed: 1,
    roster: ['panda', 'frog'],
    board,
    goals,
    bubbles,
    bubblesStart,
  }
}

/** Answers `pick` in a checkerboard pattern, which is how a settle can end up with no legal tap. */
function checkerboardRng(pool: readonly string[]): Rng {
  let calls = 0
  return {
    next: () => 0,
    int: () => 0,
    pick<T>(_items: readonly T[]): T {
      const column = Math.floor(calls / GRID)
      const row = calls % GRID
      const wanted = pool[(row + column) % 2] as unknown as T
      calls += 1
      return wanted
    },
    shuffle<T>(items: readonly T[]): T[] {
      return items.slice()
    },
  }
}

describe('tap resolution', () => {
  it('spends exactly one bubble however big the group is', () => {
    const board = boardWith({ animal: 'frog', row: 1, col: 0, size: 4 })
    const goals = [goal('frog', 8, 8), goal('panda', 8, 8)]
    const state = stateWith(board, goals, 12, 12)

    const result = resolveTap(state, indexOf(1, 0), createRng(3))
    expect(result.outcome).toBe('popped')
    expect(result.group!.cells).toHaveLength(4)
    expect(result.bubbleSpent).toBe(true)
    expect(result.state.bubbles).toBe(11)
  })

  it('does not mutate the state it was given', () => {
    const board = boardWith({ animal: 'frog', row: 1, col: 0, size: 3 })
    const state = stateWith(board, [goal('frog', 3, 3), goal('panda', 3, 3)], 12, 12)
    const before = JSON.stringify(state)

    resolveTap(state, indexOf(1, 0), createRng(5))
    expect(JSON.stringify(state)).toBe(before)
  })

  it('floors the rack at one bubble, so a tap at the floor spends nothing', () => {
    const board = boardWith({ animal: 'frog', row: 0, col: 0, size: 2 })
    const state = stateWith(board, [goal('frog', 4, 4), goal('panda', 4, 4)], MIN_BUBBLES, 12)

    const result = resolveTap(state, indexOf(0, 0), createRng(7))
    expect(result.outcome).toBe('popped')
    expect(result.bubbleSpent).toBe(false)
    expect(result.state.bubbles).toBe(MIN_BUBBLES)
  })

  it('costs nothing for a single animal, which is not a legal tap (SPEC §7.2)', () => {
    const board: Array<string | null> = Array.from({ length: BOARD_SIZE }, () => 'panda')
    board[indexOf(2, 2)] = 'frog'
    const state = stateWith(board, [goal('frog', 4, 4), goal('panda', 4, 4)], 12, 12)

    const result = resolveTap(state, indexOf(2, 2), createRng(11))
    expect(result.outcome).toBe('invalid')
    expect(result.group).toBeNull()
    expect(result.progress).toBe(0)
    expect(result.bubbleSpent).toBe(false)
    expect(result.state).toBe(state)
    expect(result.state.bubbles).toBe(12)
    expect(result.complete).toBe(false)
  })

  it('costs nothing for an empty cell', () => {
    const board: Array<string | null> = Array.from({ length: BOARD_SIZE }, () => 'panda')
    board[0] = null
    const state = stateWith(board, [goal('frog', 4, 4), goal('panda', 4, 4)], 12, 12)

    const result = resolveTap(state, 0, createRng(13))
    expect(result.outcome).toBe('invalid')
    expect(result.state.bubbles).toBe(12)
  })

  it('credits the goals for the animals it popped', () => {
    const board = boardWith({ animal: 'frog', row: 3, col: 1, size: 3 })
    const state = stateWith(board, [goal('frog', 5, 5), goal('panda', 5, 5)], 12, 12)

    const result = resolveTap(state, indexOf(3, 1), createRng(17))
    expect(countByAnimal(result.group!)).toEqual({ frog: 3 })
    expect(result.progress).toBe(3)
    expect(result.state.goals[0]).toEqual({ animal: 'frog', remaining: 2, target: 5 })
    expect(result.state.goals[1]!.remaining).toBe(5)
    expect(goalProgress(result.state.goals[0]!)).toBe(0.6)
  })

  it('is only a win when both goals are done (SPEC §8.1)', () => {
    const board = boardWith({ animal: 'frog', row: 0, col: 0, size: 2 })
    const state = stateWith(board, [goal('frog', 2, 2), goal('panda', 5, 5)], 12, 12)

    const first = resolveTap(state, 0, createRng(19))
    expect(first.state.goals[0]!.remaining).toBe(0)
    expect(first.complete).toBe(false)

    const done = stateWith(board, [goal('frog', 0, 2), goal('panda', 0, 5)], 12, 12)
    expect(isComplete(done)).toBe(true)
    expect(isComplete(stateWith(board, [goal('frog', 0, 2), goal('panda', 1, 5)], 12, 12))).toBe(false)
  })

  it('reshuffles when the settle leaves no legal tap (SPEC §7.4)', () => {
    // The settle refills through the injected rng, so a scripted one that answers in a checkerboard
    // pattern is the only way to reach the dead-board branch without gambling on a seed.
    const board: Array<string | null> = Array.from({ length: BOARD_SIZE }, () => null)
    board[0] = 'frog'
    board[1] = 'frog'
    const state = stateWith(board, [goal('frog', 1, 1), goal('panda', 1, 1)], 12, 12)

    const result = resolveTap(state, 0, checkerboardRng(['frog', 'panda']))
    expect(result.outcome).toBe('popped')
    expect(result.reshuffled).not.toBeNull()
    expect(result.state.board).toEqual(result.reshuffled)
    expect(hasGroupOfAtLeast(result.state.board, RESHUFFLE_MIN_GROUP)).toBe(true)
  })

  it('keeps the settled board when it is still playable', () => {
    const board = boardWith({ animal: 'frog', row: 2, col: 2, size: 3 })
    const single = stateWith(board, [goal('frog', 3, 3), goal('panda', 3, 3)], 12, 12)
    const state: LevelState = { ...single, roster: ['frog'] }

    const result = resolveTap(state, indexOf(2, 2), createRng(23))
    expect(result.reshuffled).toBeNull()
    expect(hasLegalGroup(result.state.board)).toBe(true)
  })

  it('is deterministic for the same seed and the same tap sequence (SPEC §9.2)', () => {
    const fresh = createLevel(7, 0x5af00000, POOL)
    const target = getGroups(fresh.board)[0]!

    const first = resolveTap(fresh, target.cells[0]!, createRng(fresh.seed))
    const second = resolveTap(fresh, target.cells[0]!, createRng(fresh.seed))
    expect(first.state.board).toEqual(second.state.board)
    expect(first.state.goals).toEqual(second.state.goals)
    expect(first.moves).toEqual(second.moves)

    const different = resolveTap(fresh, target.cells[0]!, createRng(fresh.seed + 1))
    expect(different.state.board).not.toEqual(first.state.board)
  })
})

describe('the party on screen (SPEC §10, §14.1)', () => {
  const board = boardWith({ animal: 'frog', row: 0, col: 0, size: 2 })

  it('opens when the goals are done and not before', () => {
    const unfinished = stateWith(board, [goal('frog', 0, 2), goal('panda', 1, 5)], 12, 12)
    const finished = stateWith(board, [goal('frog', 0, 2), goal('panda', 0, 5)], 12, 12)

    expect(shouldShowParty(unfinished, false)).toBe(false)
    expect(shouldShowParty(finished, false)).toBe(true)
  })

  it('opens a party restored from a save, which no tap has triggered yet', () => {
    // SPEC §14.1: a force-close during the celebration leaves a completed save. Reopening used to show the
    // finished board with the party hidden and no play arrow - stuck until she happened to pop again.
    const finished = stateWith(board, [goal('frog', 0, 2), goal('panda', 0, 5)], 12, 12)
    expect(shouldShowParty(finished, false)).toBe(true)
  })

  it('does not reopen a party that is already showing', () => {
    // SPEC §10.1: the party never ends by itself, and a tap on the completed board behind it must not start
    // a second one. `partyShown` is the game's "already open" fact.
    const finished = stateWith(board, [goal('frog', 0, 2), goal('panda', 0, 5)], 12, 12)
    expect(shouldShowParty(finished, true)).toBe(false)
  })

  it('needs both goals, because one is not a win (SPEC §8.1)', () => {
    const oneDone = stateWith(board, [goal('frog', 0, 2), goal('panda', 2, 5)], 12, 12)
    expect(shouldShowParty(oneDone, false)).toBe(false)
  })
})

describe('party', () => {
  it('is the ratio of the rack spent, not the number popped (SPEC §8.4)', () => {
    expect(partySize(stateWith([], [goal('frog', 4, 4), goal('panda', 4, 4)], 6, 12)).pct).toBe(0.5)
    expect(partySize(stateWith([], [goal('frog', 4, 4), goal('panda', 4, 4)], 4, 16)).pct).toBe(0.25)
  })

  it('breaks at the tier boundaries', () => {
    const at = (bubbles: number, bubblesStart: number) =>
      partySize(stateWith([], [goal('frog', 4, 4), goal('panda', 4, 4)], bubbles, bubblesStart))

    expect(at(6, 12).tier).toBe('big') // 50%
    expect(at(5, 12).tier).toBe('medium') // 41.7%
    expect(at(3, 12).tier).toBe('medium') // 25%
    expect(at(2, 12).tier).toBe('small') // 16.7%
    expect(at(0, 12).tier).toBe('small')
  })

  it('caps the balloons at 12 whatever the rack holds', () => {
    const party = partySize(stateWith([], [goal('frog', 4, 4), goal('panda', 4, 4)], 20, 40))
    expect(party.balloons).toBe(MAX_BALLOONS)
    expect(partySize(stateWith([], [goal('frog', 4, 4), goal('panda', 4, 4)], 3, 40)).balloons).toBe(3)
  })
})
