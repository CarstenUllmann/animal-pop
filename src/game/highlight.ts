import { getGroups } from './board'
import { MIN_GROUP } from './constants'
import type { Board, Goal } from './types'

/**
 * The cells that may carry the goal glow (SPEC §8.1, issue #48).
 *
 * The glow is a promise that a tap on this tile will pop something, so a cell is lit only when it
 * belongs to a *legal* group (`MIN_GROUP` or more, SPEC §6) of an animal that is still wanted. A
 * singleton goal animal stays unmarked — it would answer a tap with a wobble — and a completed
 * goal's animals go dark, because collecting more of them no longer moves the level.
 *
 * Pure, like `game/board.ts` and `ui/bunch.ts`: the board view asks once for a settled board and
 * decorates tiles from the answer, so the rule can be tested without a DOM.
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
