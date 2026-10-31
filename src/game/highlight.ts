import { getGroups } from './board'
import { MIN_GROUP } from './constants'
import type { Board, Goal } from './types'

/**
 * The cells that may carry the goal glow: a goal animal in a legal group. A singleton stays dark
 * (its tap would wobble) and a completed goal's animals go dark too.
 */
export function goalHighlightCells(board: Board, goals: readonly Goal[]): Set<number> {
  const live = new Set<string>()
  for (const goal of goals) {
    if (goal.remaining > 0) live.add(goal.animal)
  }

  const highlighted = new Set<number>()
  for (const group of getGroups(board, MIN_GROUP)) {
    if (!live.has(group.animal)) continue
    for (const cell of group.cells) highlighted.add(cell)
  }
  return highlighted
}
