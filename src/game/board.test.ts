import { describe, expect, it } from 'vitest'
import {
  colOf,
  createBoard,
  deadBoard,
  getGroups,
  groupAt,
  hasLegalGroup,
  indexOf,
  legalGroupAt,
  neighbours,
  popGroup,
  reshuffleBoard,
  rowOf,
} from './board'
import { createRng } from './rng'
import type { Board, Group } from './types'

function boardFromRows(rows: string[]): Board {
  expect(rows).toHaveLength(6)
  const board: Board = []
  for (const row of rows) {
    expect(row).toHaveLength(6)
    for (const char of row) board.push(char === '.' ? null : char)
  }
  return board
}

function column(board: Board, col: number): Array<string | null> {
  return Array.from({ length: 6 }, (_, row) => board[indexOf(row, col)] ?? null)
}

describe('group detection', () => {
  it('finds maximal orthogonally connected groups and excludes diagonals', () => {
    const board = boardFromRows([
      'aab...',
      'abb...',
      'aab...',
      '..c...',
      '......',
      '......',
    ])

    expect(groupAt(board, 0)).toEqual({ animal: 'a', cells: [0, 1, 6, 12, 13] })
    expect(groupAt(board, 2)).toEqual({ animal: 'b', cells: [2, 7, 8, 14] })
    expect(groupAt(board, 7)?.cells).toEqual([2, 7, 8, 14])
  })

  it('returns lone animals but never treats them as legal', () => {
    const board = boardFromRows(['a.....', '......', '......', '......', '......', '......'])

    expect(groupAt(board, 0)).toEqual({ animal: 'a', cells: [0] })
    expect(legalGroupAt(board, 0)).toBeNull()
    expect(getGroups(board)).toEqual([])
  })

  it('returns null for empty cells', () => {
    const board = boardFromRows(['......', '......', '......', '......', '......', '......'])
    expect(groupAt(board, 14)).toBeNull()
    expect(legalGroupAt(board, 14)).toBeNull()
  })

  it('lists every group once, skipping single animals', () => {
    const board = boardFromRows([
      'aab...',
      'abb...',
      'aab...',
      '..c...',
      '......',
      '......',
    ])

    const groups = getGroups(board)
    expect(groups).toHaveLength(2)
    expect(groups.map((group) => group.cells.length)).toEqual([5, 4])
    expect(groups.flatMap((group) => group.cells).sort((a, b) => a - b)).toEqual([
      0, 1, 2, 6, 7, 8, 12, 13, 14,
    ])
  })

  it('connects only orthogonal neighbours', () => {
    expect(neighbours(0)).toEqual([6, 1])
    expect(neighbours(5)).toEqual([11, 4])
    expect(new Set(neighbours(indexOf(2, 2)))).toEqual(
      new Set([indexOf(1, 2), indexOf(3, 2), indexOf(2, 1), indexOf(2, 3)]),
    )
    expect(rowOf(indexOf(4, 3))).toBe(4)
    expect(colOf(indexOf(4, 3))).toBe(3)
  })
})

describe('pop, gravity and refill', () => {
  it('clears exactly the popped group and refills the whole board', () => {
    const rng = createRng(7)
    const board = createBoard(['a', 'b', 'c', 'd'], rng)
    const group = getGroups(board)[0] as Group
    const result = popGroup(board, group, ['a', 'b', 'c', 'd'], rng)

    expect(result.cleared).toEqual(group.cells)
    expect(result.count).toBe(group.cells.length)
    expect(result.animal).toBe(group.animal)
    expect(result.board).toHaveLength(36)
    expect(result.board.every((cell) => cell !== null)).toBe(true)

    const destinations = result.moves.map((move) => move.to).sort((a, b) => a - b)
    expect(destinations).toEqual(Array.from({ length: 36 }, (_, index) => index))
    expect(new Set(destinations).size).toBe(36)

    for (const move of result.moves) {
      expect(result.board[move.to]).toBe(move.animal)
      if (move.from !== null) expect(board[move.from]).toBe(move.animal)
    }
  })

  it('preserves order within a column while animals fall', () => {
    const board: Board = Array.from({ length: 36 }, () => 'x')
    const column0 = ['b', 'c', 'd', 'a', 'a', 'a']
    column0.forEach((animal, row) => {
      board[indexOf(row, 0)] = animal
    })

    const group: Group = {
      animal: 'a',
      cells: [indexOf(3, 0), indexOf(4, 0), indexOf(5, 0)],
    }
    const result = popGroup(board, group, ['z'], createRng(1))

    expect(column(result.board, 0)).toEqual(['z', 'z', 'z', 'b', 'c', 'd'])

    const byDestination = new Map(result.moves.map((move) => [move.to, move]))
    expect(byDestination.get(indexOf(3, 0))?.from).toBe(indexOf(0, 0))
    expect(byDestination.get(indexOf(4, 0))?.from).toBe(indexOf(1, 0))
    expect(byDestination.get(indexOf(5, 0))?.from).toBe(indexOf(2, 0))
    expect(byDestination.get(indexOf(0, 0))?.from).toBeNull()
  })

  it('is deterministic for a given seed', () => {
    const board = createBoard(['a', 'b', 'c', 'd'], createRng(99))
    const group = getGroups(board)[0] as Group

    const first = popGroup(board, group, ['a', 'b', 'c', 'd'], createRng(5))
    const second = popGroup(board, group, ['a', 'b', 'c', 'd'], createRng(5))

    expect(second).toEqual(first)
  })

  it('never triggers a cascade: only the tapped group is cleared', () => {
    const rng = createRng(3)
    const board = createBoard(['a', 'b', 'c', 'd'], rng)
    const group = getGroups(board)[0] as Group
    const result = popGroup(board, group, ['a', 'b', 'c', 'd'], rng)

    expect(result.cleared).toEqual(group.cells)
    expect(result.board).toHaveLength(36)
    expect(result.board.every((cell) => cell !== null)).toBe(true)
  })
})

describe('board generation', () => {
  it('fills all 36 cells and always leaves a legal tap', () => {
    for (let seed = 0; seed < 200; seed++) {
      const board = createBoard(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], createRng(seed))
      expect(board).toHaveLength(36)
      expect(board.every((cell) => cell !== null)).toBe(true)
      expect(hasLegalGroup(board)).toBe(true)
    }
  })

  it('is deterministic for a given seed', () => {
    const first = createBoard(['a', 'b', 'c', 'd'], createRng(1234))
    const second = createBoard(['a', 'b', 'c', 'd'], createRng(1234))
    expect(second).toEqual(first)
  })

  it('detects a dead board', () => {
    const board = boardFromRows([
      'ababab',
      'bababa',
      'ababab',
      'bababa',
      'ababab',
      'bababa',
    ])
    expect(deadBoard(board)).toBe(true)
    expect(hasLegalGroup(board)).toBe(false)
  })

  it('reshuffles into a board with a group of at least three, for hundreds of seeds', () => {
    const pool = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    for (let seed = 0; seed < 500; seed++) {
      const board = reshuffleBoard(pool, createRng(seed))
      expect(board).toHaveLength(36)
      expect(board.every((cell) => cell !== null)).toBe(true)
      const groups = getGroups(board, 3)
      expect(groups.length).toBeGreaterThan(0)
      expect(Math.max(...groups.map((group) => group.cells.length))).toBeGreaterThanOrEqual(3)
    }
  })
})

