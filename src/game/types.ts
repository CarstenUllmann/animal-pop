export type AnimalId = string
export type Cell = AnimalId | null
export type Board = Cell[]

/** The only randomness the core is allowed to use (SPEC §9.2). */
export interface Rng {
  /** Float in [0, 1). */
  next(): number
  /** Integer in [0, maxExclusive). */
  int(maxExclusive: number): number
  pick<T>(items: readonly T[]): T
  /** Returns a shuffled copy; never mutates the input. */
  shuffle<T>(items: readonly T[]): T[]
}

/** A maximal set of orthogonally connected cells with the same animal. */
export interface Group {
  animal: AnimalId
  cells: number[]
}

/** Where a tile at a destination cell came from after a pop + settle. */
export interface TileMove {
  to: number
  /** Source cell on the pre-pop board, or null for a freshly refilled animal. */
  from: number | null
  animal: AnimalId
}

export interface PopResult {
  board: Board
  cleared: number[]
  moves: TileMove[]
  animal: AnimalId
  count: number
}
