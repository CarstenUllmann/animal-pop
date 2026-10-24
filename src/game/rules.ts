import { deadBoard, legalGroupAt, popGroup, reshuffleBoard } from './board'
import { MAX_BALLOONS, MIN_BUBBLES, PARTY_TIERS } from './constants'
import type { Group, LevelState, Party, PartyTier, Rng, TapResult } from './types'

/**
 * Tap resolution and party math (SPEC §7, §8). Pure: a tap returns a new state rather than
 * changing the one it was given, so the view, the save and the simulator can all look at the
 * same settle. No DOM and no timers here, which is what makes §16.1 testable.
 */

/** How many of each animal type a group contains, for audio and goal accounting. */
export function countByAnimal(group: Group): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const cell of group.cells) {
    if (cell === null) continue
    const animal = group.animal
    const before = counts[animal]
    counts[animal] = (before === undefined ? 0 : before) + 1
  }
  return counts
}

/** How full a goal ring is, 0..1. The ring has to carry the meaning without the numeral. */
export function goalProgress(goal: { animal: string; remaining: number; target: number }): number {
  if (goal.target <= 0) return 1
  return Math.min(1, Math.max(0, (goal.target - goal.remaining) / goal.target))
}

/** Both goals must reach zero; one is not a win (SPEC §8.1). */
export function isComplete(state: LevelState): boolean {
  return state.goals.length > 0 && state.goals.every((goal) => goal.remaining <= 0)
}

/** The party tier a share falls in (SPEC §8.4): the celebration reads its intensity from this. */
export function partyTier(pct: number): PartyTier {
  if (pct >= PARTY_TIERS.big) return 'big'
  if (pct >= PARTY_TIERS.medium) return 'medium'
  return 'small'
}

/** Celebration size follows the party, and the party is a ratio, not a count (SPEC §8.4). */
export function partySize(state: LevelState): Party {
  const pct = state.bubblesStart > 0 ? state.bubbles / state.bubblesStart : 0
  return { balloons: Math.min(state.bubbles, MAX_BALLOONS), tier: partyTier(pct), pct }
}

/**
 * Resolve one tap (SPEC §7.1). A group of 2 or more pops, spends exactly one bubble however big
 * the group is, credits the goals, and settles with gravity and refill; a single animal or an
 * empty cell is an invalid tap that costs nothing (SPEC §7.2). The rack floors at MIN_BUBBLES, so
 * a tap at the floor spends nothing (SPEC §8.3).
 *
 * `moves` and `cleared` describe the settle for the view, and `reshuffled` is the board the
 * dead-board check produced, so the caller animates the same thing the core decided.
 */
export function resolveTap(state: LevelState, index: number, rng: Rng): TapResult {
  const group = legalGroupAt(state.board, index)

  if (group === null) {
    return {
      outcome: 'invalid',
      state,
      group: null,
      cleared: [],
      moves: [],
      counts: {},
      progress: 0,
      bubbleSpent: false,
      reshuffled: null,
      complete: isComplete(state),
    }
  }

  const counts = countByAnimal(group)
  const bubbleSpent = state.bubbles > MIN_BUBBLES
  const bubbles = bubbleSpent ? state.bubbles - 1 : state.bubbles

  let progress = 0
  const goals = state.goals.map((goal) => {
    const count = counts[goal.animal]
    const got = count === undefined ? 0 : count
    const remaining = Math.max(0, goal.remaining - got)
    progress += goal.remaining - remaining
    return { animal: goal.animal, remaining, target: goal.target }
  })

  const settle = popGroup(state.board, group, state.roster, rng)
  const board = settle.board
  const reshuffled = deadBoard(board) ? reshuffleBoard(state.roster, rng) : null

  const next: LevelState = {
    ...state,
    board: reshuffled === null ? board : reshuffled,
    goals,
    bubbles,
  }

  return {
    outcome: 'popped',
    state: next,
    group,
    cleared: settle.cleared,
    moves: settle.moves,
    counts,
    progress,
    bubbleSpent,
    reshuffled,
    complete: isComplete(next),
  }
}
