// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { BOARD_SIZE, GRID } from '../game/constants'
import type { AnimalId, Board, Goal, PopResult } from '../game/types'
import { createBoardView } from './boardView'

/**
 * The board view's glow is decided from the whole settled board, not tile by tile (SPEC §8.1, issue
 * #48). `game/highlight.test.ts` proves the rule; this mount proves the wiring: one read of the goals
 * per board, and the tiles that come out the other side.
 */

function boardWith(cells: ReadonlyArray<readonly [number, AnimalId]>): Board {
  const board: Board = Array.from({ length: BOARD_SIZE }, () => 'pig')
  for (const [index, animal] of cells) board[index] = animal
  return board
}

/** Every cell as a destination that did not move, so `settle` can rebuild a board statically. */
function settled(board: Board, cleared: number[]): PopResult {
  return {
    board,
    cleared,
    moves: board.map((animal, to) => ({ to, from: to, animal: animal ?? 'pig' })),
    animal: 'cat',
    count: cleared.length,
  }
}

function litIndexes(element: HTMLElement): number[] {
  return Array.from(element.querySelectorAll<HTMLElement>('.tile--goal'))
    .map((tile) => Number(tile.dataset.index))
    .sort((a, b) => a - b)
}

describe('the board view asks for the glow once per settled board (SPEC §8.1, issue #48)', () => {
  it('reads the goals once for the deal, not once per tile', async () => {
    const goals: Goal[] = [{ animal: 'cat', remaining: 1, target: 3 }]
    let reads = 0
    const view = createBoardView({
      onTap: () => {},
      goals: () => {
        reads += 1
        return goals
      },
    })

    await view.renderInitial(boardWith([[0, 'cat'], [1, 'cat']]))

    // 36 tiles were created, and the answer was asked for once.
    expect(view.element.querySelectorAll('.tile')).toHaveLength(GRID * GRID)
    expect(reads).toBe(1)
    expect(litIndexes(view.element)).toEqual([0, 1])

    view.destroy()
  })

  it('re-reads the goals for the settled board after a pop, and lights the new group', async () => {
    const goals: Goal[] = [{ animal: 'cat', remaining: 1, target: 3 }]
    let reads = 0
    const view = createBoardView({
      onTap: () => {},
      goals: () => {
        reads += 1
        return goals
      },
    })

    await view.renderInitial(boardWith([[0, 'cat'], [1, 'cat']]))

    goals[0] = { animal: 'cat', remaining: 2, target: 3 }
    await view.animatePop(settled(boardWith([[12, 'cat'], [13, 'cat'], [14, 'cat']]), [0, 1]))

    expect(reads).toBe(2)
    expect(litIndexes(view.element)).toEqual([12, 13, 14])

    view.destroy()
  })

  it('does not light a singleton goal animal, so no lit tile can wobble', async () => {
    const goals: Goal[] = [{ animal: 'cat', remaining: 1, target: 3 }]
    const view = createBoardView({ onTap: () => {}, goals: () => goals })

    await view.renderInitial(boardWith([[5, 'cat']]))

    expect(litIndexes(view.element)).toEqual([])

    view.destroy()
  })
})
