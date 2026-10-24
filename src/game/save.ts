import { BOARD_SIZE, MIN_BUBBLES } from './constants'
import type { KeyValueStore, LevelState, SaveState } from './types'

/**
 * The persisted level (SPEC §14.1). Every storage call is guarded, because a WebView can refuse
 * `localStorage` outright and a force-close can leave a half-written value behind: a save we
 * cannot trust is treated as no save, so the game starts at level 1 instead of crashing on a
 * board it cannot read.
 */

export const SAVE_KEY = 'pop-pals.v1'

/** Bump when the shape changes; an old save resets to level 1 rather than being migrated. */
export const SAVE_VERSION = 1

/** Facts that belong to the run rather than to a level. */
export interface SaveContext {
  muted: boolean
  /** Internal only, never shown to her. */
  levelsCompleted: number
}

export function toSaveState(state: LevelState, context: SaveContext): SaveState {
  return {
    version: SAVE_VERSION,
    sessionSeed: state.sessionSeed,
    level: state.level,
    board: state.board.slice(),
    goals: state.goals.map((goal) => ({ animal: goal.animal, remaining: goal.remaining })),
    bubbles: state.bubbles,
    bubblesStart: state.bubblesStart,
    muted: context.muted,
    levelsCompleted: context.levelsCompleted,
  }
}

/** Written after every resolved tap and on level transition. False when storage refuses. */
export function writeSave(state: LevelState, context: SaveContext, storage: KeyValueStore): boolean {
  try {
    return storage.write(SAVE_KEY, JSON.stringify(toSaveState(state, context)))
  } catch (unused) {
    return false
  }
}

/** Null means "nothing to resume", which includes a save that does not match the shape. */
export function readSave(storage: KeyValueStore): SaveState | null {
  let text: string | null
  try {
    text = storage.read(SAVE_KEY)
  } catch (unused) {
    return null
  }
  if (text === null) return null

  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (unused) {
    return null
  }
  if (typeof value !== 'object' || value === null) return null

  const record = value as Record<string, unknown>
  // A save from another schema version is not resumable; §14.1 says resetting is acceptable.
  if (record.version !== SAVE_VERSION) return null
  if (typeof record.sessionSeed !== 'number' || typeof record.level !== 'number') return null
  if (record.level < 1 || !Number.isInteger(record.level)) return null

  const board = readBoard(record.board)
  if (board === null) return null
  const goals = readGoals(record.goals)
  if (goals === null) return null

  const bubblesStart = numberAtLeast(record.bubblesStart, MIN_BUBBLES)
  const bubbles = numberAtLeast(record.bubbles, MIN_BUBBLES)
  if (bubbles === null || bubblesStart === null || bubbles > bubblesStart) return null

  return {
    version: SAVE_VERSION,
    sessionSeed: record.sessionSeed >>> 0,
    level: record.level,
    board,
    goals,
    bubbles,
    bubblesStart,
    muted: record.muted === true,
    levelsCompleted: typeof record.levelsCompleted === 'number' ? Math.max(0, Math.floor(record.levelsCompleted)) : 0,
  }
}

function readBoard(value: unknown): Array<string | null> | null {
  if (!Array.isArray(value) || value.length !== BOARD_SIZE) return null
  const board: Array<string | null> = []
  for (const cell of value) {
    if (cell === null) {
      board.push(null)
    } else if (typeof cell === 'string') {
      board.push(cell)
    } else {
      return null
    }
  }
  return board
}

function readGoals(value: unknown): Array<{ animal: string; remaining: number }> | null {
  if (!Array.isArray(value) || value.length !== 2) return null
  const goals: Array<{ animal: string; remaining: number }> = []
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) return null
    const record = entry as Record<string, unknown>
    if (typeof record.animal !== 'string' || typeof record.remaining !== 'number') return null
    goals.push({ animal: record.animal, remaining: Math.max(0, Math.floor(record.remaining)) })
  }
  return goals
}

function numberAtLeast(value: unknown, minimum: number): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum) return null
  return value
}
