export type AnimalId = string
export type Cell = AnimalId | null
export type Board = Cell[]

/** The only randomness the core is allowed to use. */
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

/** Where a tile at a destination cell came from after a pop and settle. */
export interface TileMove {
  to: number
  /** Source cell before the pop, or null for a freshly refilled animal. */
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

export interface Goal {
  animal: AnimalId
  /** Still to collect: the card's numeral. */
  remaining: number
  /** The level's target, which the ring fills against. */
  target: number
}

/** Everything needed to resume a level exactly as it was left. */
export interface LevelState {
  level: number
  /** The per-install seed, so a level regenerates identically after a reload. */
  sessionSeed: number
  /** The seed derived from it for this level. */
  seed: number
  roster: AnimalId[]
  board: Board
  goals: Goal[]
  /** Bubbles left on the rack, never below `MIN_BUBBLES`. */
  bubbles: number
  /** Rack size at level start, which `partyPct` is measured against. */
  bubblesStart: number
}

export type TapOutcome = 'invalid' | 'popped'

export interface TapResult {
  outcome: TapOutcome
  /** State after the tap; the input state is never mutated. */
  state: LevelState
  group: Group | null
  cleared: number[]
  moves: TileMove[]
  /** Animals popped, by type. */
  counts: Record<string, number>
  /** Goal progress made by this tap, across both goals. */
  progress: number
  /** False when the rack was already at the floor. */
  bubbleSpent: boolean
  /** The board the dead-board reshuffle produced, or null when the board stayed playable. */
  reshuffled: Board | null
  complete: boolean
}

export type PartyTier = 'big' | 'medium' | 'small'

export interface Party {
  balloons: number
  tier: PartyTier
  /** 0..1, the ratio that drives celebration intensity. */
  pct: number
}

/** The persisted shape. `Goal.target` is rebuilt from the ramp on load. */
export interface SaveState {
  version: number
  sessionSeed: number
  level: number
  board: (string | null)[]
  goals: Array<{ animal: string; remaining: number }>
  bubbles: number
  bubblesStart: number
  muted: boolean
  /** Internal only, never shown to her. */
  levelsCompleted: number
}

/** Storage as the core sees it: read may refuse, write may fail, and neither may throw. */
export interface KeyValueStore {
  read(key: string): string | null
  write(key: string, value: string): boolean
}
