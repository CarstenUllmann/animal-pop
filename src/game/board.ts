import { BOARD_SIZE, GRID, MIN_GROUP, RESHUFFLE_MIN_GROUP } from './constants'
import type { AnimalId, Board, Cell, Group, PopResult, Rng, TileMove } from './types'

export function rowOf(index: number): number {
  return Math.floor(index / GRID)
}

export function colOf(index: number): number {
  return index % GRID
}

export function indexOf(row: number, col: number): number {
  return row * GRID + col
}

/** Orthogonal neighbours only; diagonals never connect. */
export function neighbours(index: number): number[] {
  const row = rowOf(index)
  const col = colOf(index)
  const result: number[] = []
  if (row > 0) result.push(index - GRID)
  if (row < GRID - 1) result.push(index + GRID)
  if (col > 0) result.push(index - 1)
  if (col < GRID - 1) result.push(index + 1)
  return result
}

export function fillBoard(pool: readonly AnimalId[], rng: Rng): Board {
  assertPool(pool)
  return Array.from({ length: BOARD_SIZE }, () => rng.pick(pool))
}

/** A full random board with at least one legal tap. */
export function createBoard(pool: readonly AnimalId[], rng: Rng): Board {
  return ensureGroup(fillBoard(pool, rng), pool, rng, MIN_GROUP)
}

/** The maximal same-animal group at `index`, of any size; null for an empty cell. */
export function groupAt(board: Board, index: number): Group | null {
  const animal = board[index]
  if (animal === null || animal === undefined) return null

  const cells: number[] = []
  const seen = new Set<number>([index])
  const stack = [index]

  while (stack.length > 0) {
    const current = stack.pop() as number
    cells.push(current)
    for (const next of neighbours(current)) {
      if (seen.has(next)) continue
      if (board[next] !== animal) continue
      seen.add(next)
      stack.push(next)
    }
  }

  cells.sort((a, b) => a - b)
  return { animal, cells }
}

/** The group at `index` when it is big enough to tap. */
export function legalGroupAt(board: Board, index: number): Group | null {
  const group = groupAt(board, index)
  return group !== null && group.cells.length >= MIN_GROUP ? group : null
}

/** Every maximal group with at least `minSize` cells, in board order. */
export function getGroups(board: Board, minSize: number = MIN_GROUP): Group[] {
  const seen = new Set<number>()
  const groups: Group[] = []

  for (let index = 0; index < BOARD_SIZE; index++) {
    if (seen.has(index) || board[index] === null || board[index] === undefined) continue
    const group = groupAt(board, index)
    if (group === null) continue
    for (const cell of group.cells) seen.add(cell)
    if (group.cells.length >= minSize) groups.push(group)
  }

  return groups
}

export function hasLegalGroup(board: Board): boolean {
  return getGroups(board, MIN_GROUP).length > 0
}

export function hasGroupOfAtLeast(board: Board, minSize: number): boolean {
  return getGroups(board, minSize).length > 0
}

export function deadBoard(board: Board): boolean {
  return !hasLegalGroup(board)
}

/**
 * Pop a group, then apply gravity and refill. `moves` describe every destination cell, with the
 * source it fell from or null for a refill. Pure: no mutation, no cascades.
 */
export function popGroup(
  board: Board,
  group: Group,
  refillPool: readonly AnimalId[],
  rng: Rng,
): PopResult {
  assertPool(refillPool)

  const cleared = [...group.cells].sort((a, b) => a - b)
  const working = board.slice()
  for (const index of cleared) working[index] = null

  const next: Board = Array.from<Cell>({ length: BOARD_SIZE }).fill(null)
  const moves: TileMove[] = []

  for (let col = 0; col < GRID; col++) {
    // Bottom-up, so assigning them bottom-up preserves their order.
    const survivors: Array<{ animal: AnimalId; row: number }> = []
    for (let row = GRID - 1; row >= 0; row--) {
      const animal = working[indexOf(row, col)]
      if (animal !== null && animal !== undefined) survivors.push({ animal, row })
    }

    const refillCount = GRID - survivors.length
    for (let row = 0; row < refillCount; row++) {
      const animal = rng.pick(refillPool)
      const to = indexOf(row, col)
      next[to] = animal
      moves.push({ to, from: null, animal })
    }

    for (let i = 0; i < survivors.length; i++) {
      const survivor = survivors[i] as { animal: AnimalId; row: number }
      const to = indexOf(GRID - 1 - i, col)
      next[to] = survivor.animal
      moves.push({ to, from: indexOf(survivor.row, col), animal: survivor.animal })
    }
  }

  return { board: next, cleared, moves, animal: group.animal, count: cleared.length }
}

/** A fresh board guaranteed to contain a group of `RESHUFFLE_MIN_GROUP`. */
export function reshuffleBoard(pool: readonly AnimalId[], rng: Rng): Board {
  return ensureGroup(fillBoard(pool, rng), pool, rng, RESHUFFLE_MIN_GROUP)
}

/** Return `board` when it holds a group of `minSize`, otherwise plant one. */
export function ensureGroup(
  board: Board,
  pool: readonly AnimalId[],
  rng: Rng,
  minSize: number,
): Board {
  if (hasGroupOfAtLeast(board, minSize)) return board
  return plantGroup(board, pool, rng, Math.min(minSize, GRID))
}

/** Write one contiguous horizontal or vertical run into a copy of the board. */
function plantGroup(board: Board, pool: readonly AnimalId[], rng: Rng, size: number): Board {
  const copy = board.slice()
  const animal = rng.pick(pool)
  const horizontal = rng.int(2) === 0
  const row = horizontal ? rng.int(GRID) : rng.int(GRID - size + 1)
  const col = horizontal ? rng.int(GRID - size + 1) : rng.int(GRID)

  for (let step = 0; step < size; step++) {
    const cellRow = horizontal ? row : row + step
    const cellCol = horizontal ? col + step : col
    copy[indexOf(cellRow, cellCol)] = animal
  }

  return copy
}

function assertPool(pool: readonly AnimalId[]): void {
  if (pool.length === 0) throw new Error('Animal pool must not be empty')
}
