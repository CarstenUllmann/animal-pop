import { describe, expect, it } from 'vitest'
import { GRID } from './constants'
import { goalHighlightCells } from './highlight'
import type { AnimalId, Board, Goal } from './types'

/** A board of one non-goal animal with the given cells overwritten. */
function boardWith(cells: ReadonlyArray<readonly [number, AnimalId]>): Board {
  const board: Board = Array.from({ length: GRID * GRID }, () => 'pig')
  for (const [index, animal] of cells) board[index] = animal
  return board
}

function goal(animal: AnimalId, remaining: number): Goal {
  return { animal, remaining, target: 3 }
}

const cellsOf = (set: Set<number>): number[] => [...set].sort((a, b) => a - b)

describe('the goal glow marks a tap that will pop (SPEC §8.1, issue #48)', () => {
  it('leaves an isolated goal animal unmarked, because tapping it only wobbles', () => {
    const board = boardWith([[0, 'cat']])
    expect(goalHighlightCells(board, [goal('cat', 1)])).toEqual(new Set())
  })

  it('marks every cell of a live goal group of two', () => {
    const board = boardWith([[0, 'cat'], [1, 'cat']])
    expect(cellsOf(goalHighlightCells(board, [goal('cat', 2)]))).toEqual([0, 1])
  })

  it('marks every cell of a live goal group of three', () => {
    const board = boardWith([[7, 'cat'], [8, 'cat'], [9, 'cat']])
    expect(cellsOf(goalHighlightCells(board, [goal('cat', 2)]))).toEqual([7, 8, 9])
  })

  it('turns a completed goal dark, even where its animals are grouped', () => {
    const board = boardWith([[0, 'cat'], [1, 'cat'], [7, 'cat']])
    expect(goalHighlightCells(board, [goal('cat', 0)])).toEqual(new Set())
  })

  it('never marks a non-goal group, however large', () => {
    const board = boardWith([[0, 'dog'], [1, 'dog'], [2, 'dog'], [6, 'dog']])
    expect(goalHighlightCells(board, [goal('cat', 3)])).toEqual(new Set())
  })

  it('keeps a finished goal dark while the other goal is still live', () => {
    const board = boardWith([[0, 'cat'], [1, 'cat'], [8, 'dog'], [9, 'dog']])
    const highlighted = goalHighlightCells(board, [goal('cat', 0), goal('dog', 1)])
    expect(cellsOf(highlighted)).toEqual([8, 9])
  })
})
