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

/** One goal card: an animal and how many of it are still wanted (SPEC §8.1). */
export interface Goal {
  animal: AnimalId
  /** Still to collect; the card's numeral. */
  remaining: number
  /** The level's goal target, which the ring fills against. */
  target: number
}

/** Everything a level needs to be resumed exactly as it was left (SPEC §9, §14.1). */
export interface LevelState {
  level: number
  /** The per-install seed, persisted so a level regenerates identically after a reload (§9.2). */
  sessionSeed: number
  /** The seed derived from it for this level. */
  seed: number
  /** Animal types in play for this level. */
  roster: AnimalId[]
  board: Board
  goals: Goal[]
  /** Bubbles left on the rack; floored at MIN_BUBBLES, so it is never zero. */
  bubbles: number
  /** Rack size at level start, which is what `partyPct` is measured against. */
  bubblesStart: number
}

export type TapOutcome = 'invalid' | 'popped'

/** What one tap did, including the settle the view has to animate. */
export interface TapResult {
  outcome: TapOutcome
  /** State after the tap; the input state is never mutated. */
  state: LevelState
  group: Group | null
  /** Popped cells, in board order. */
  cleared: number[]
  moves: TileMove[]
  /** Animals popped by type, for audio and goal accounting. */
  counts: Record<string, number>
  /** Goal progress made by this tap, counted across both goals. */
  progress: number
  /** False when the rack was already at the floor, so nothing was spent (SPEC §8.3). */
  bubbleSpent: boolean
  /** Board the dead-board reshuffle produced, or null when the board stayed playable. */
  reshuffled: Board | null
  complete: boolean
}

export type PartyTier = 'big' | 'medium' | 'small'

export interface Party {
  balloons: number
  tier: PartyTier
  /** 0..1, the ratio that drives celebration intensity (SPEC §8.4). */
  pct: number
}

/** The persisted shape (SPEC §14.1). `Goal.target` is rebuilt from the ramp on load. */
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
