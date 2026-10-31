import { deadBoard, legalGroupAt, popGroup, reshuffleBoard } from './board'
import { MAX_BALLOONS, MIN_BUBBLES, PARTY_TIERS } from './constants'
import type { Group, LevelState, Party, PartyTier, Rng, TapResult } from './types'

/** How many animals of each type a group contains. */
export function groupCounts(group: Group): Record<string, number> {
  return { [group.animal]: group.cells.length }
}

/** How full a goal ring is, 0..1. */
export function goalProgress(goal: { animal: string; remaining: number; target: number }): number {
  if (goal.target <= 0) return 1
  return Math.min(1, Math.max(0, (goal.target - goal.remaining) / goal.target))
}

/** Both goals must reach zero. */
export function isComplete(state: LevelState): boolean {
  return state.goals.length > 0 && state.goals.every((goal) => goal.remaining <= 0)
}

/** Whether the party belongs on screen: the level is complete and no party is showing yet. */
export function shouldShowParty(state: LevelState, partyShown: boolean): boolean {
  return !partyShown && isComplete(state)
}

/** The party tier a share falls in. */
export function partyTier(pct: number): PartyTier {
  if (pct >= PARTY_TIERS.big) return 'big'
  if (pct >= PARTY_TIERS.medium) return 'medium'
  return 'small'
}

/** Celebration size follows the share of the rack that is left, not the raw count. */
export function partySize(state: LevelState): Party {
  const pct = state.bubblesStart > 0 ? state.bubbles / state.bubblesStart : 0
  return { balloons: Math.min(state.bubbles, MAX_BALLOONS), tier: partyTier(pct), pct }
}

/**
 * Resolve one tap. A legal group spends one bubble however big it is, credits the goals and
 * settles; an invalid tap costs nothing. The rack floors at `MIN_BUBBLES`.
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

  const counts = groupCounts(group)
  const bubbleSpent = state.bubbles > MIN_BUBBLES
  const bubbles = bubbleSpent ? state.bubbles - 1 : state.bubbles

  let progress = 0
  const goals = state.goals.map((goal) => {
    const collected = counts[goal.animal]
    const hit = collected === undefined ? 0 : collected
    const remaining = Math.max(0, goal.remaining - hit)
    progress += goal.remaining - remaining
    return { animal: goal.animal, remaining, target: goal.target }
  })

  const settle = popGroup(state.board, group, state.roster, rng)
  const reshuffled = deadBoard(settle.board) ? reshuffleBoard(state.roster, rng) : null

  const next: LevelState = {
    ...state,
    board: reshuffled === null ? settle.board : reshuffled,
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
