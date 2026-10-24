import { describe, expect, it } from 'vitest'
import { BOARD_SIZE, MIN_BUBBLES } from './constants'
import { createLevel, goalTargetForLevel, resumeLevel } from './level'
import { SAVE_KEY, SAVE_VERSION, readSave, toSaveState, writeSave } from './save'
import type { KeyValueStore, SaveState } from './types'

const POOL = ['cat', 'rabbit', 'panda', 'frog']
const RUN = { muted: false, levelsCompleted: 3 }

function fakeStore(initial: Record<string, string> = {}): KeyValueStore {
  const values = new Map(Object.entries(initial))
  return {
    read: (key: string) => (values.has(key) ? (values.get(key) as string) : null),
    write: (key: string, value: string) => {
      values.set(key, value)
      return true
    },
  }
}

/** A store that behaves like a WebView that refuses `localStorage` outright. */
function deniedStore(): KeyValueStore {
  return {
    read: () => {
      throw new Error('localStorage is disabled')
    },
    write: () => {
      throw new Error('quota exceeded')
    },
  }
}

describe('save', () => {
  it('round-trips a mid-level board through storage', () => {
    const state = createLevel(5, 0xdeadbeef, POOL)
    state.board[7] = null
    state.board[8] = null
    state.goals[0] = { animal: state.goals[0]!.animal, remaining: 2, target: state.goals[0]!.target }
    state.bubbles = 11

    const storage = fakeStore()
    expect(writeSave(state, RUN, storage)).toBe(true)

    const saved = readSave(storage)
    expect(saved).not.toBeNull()
    expect(saved!.version).toBe(SAVE_VERSION)
    expect(saved!.sessionSeed).toBe(state.sessionSeed)
    expect(saved!.level).toBe(5)
    expect(saved!.board).toHaveLength(BOARD_SIZE)
    expect(saved!.board).toEqual(state.board)
    expect(saved!.board[7]).toBeNull()
    expect(saved!.goals).toEqual(state.goals.map((goal) => ({ animal: goal.animal, remaining: goal.remaining })))
    expect(saved!.bubbles).toBe(11)
    expect(saved!.levelsCompleted).toBe(3)
  })

  it('rebuilds the level from a save on the same roster the generator would have picked', () => {
    const state = createLevel(12, 0x11112222, POOL)
    const storage = fakeStore()
    writeSave(state, RUN, storage)

    const resumed = resumeLevel(readSave(storage)!, POOL)
    expect(resumed.roster).toEqual(state.roster)
    expect(resumed.goals).toEqual(state.goals)
    expect(resumed.bubbles).toBe(state.bubbles)
    expect(resumed.level).toBe(12)
    expect(resumed.sessionSeed).toBe(state.sessionSeed)
  })

  it('keeps the mute flag across a round-trip', () => {
    const storage = fakeStore()
    const state = createLevel(2, 0x12345678, POOL)
    writeSave(state, { muted: true, levelsCompleted: 1 }, storage)
    expect(readSave(storage)!.muted).toBe(true)
  })

  it('treats a half-written save as no save, so the game starts at level 1', () => {
    expect(readSave(fakeStore({ [SAVE_KEY]: '{"version":1,"sessionSeed":1' }))).toBeNull()
    expect(readSave(fakeStore({ [SAVE_KEY]: '' }))).toBeNull()
    expect(readSave(fakeStore({ [SAVE_KEY]: 'null' }))).toBeNull()
  })

  it('does not accept a save from another schema version', () => {
    const saved = baseSave()
    expect(readSave(fakeStore({ [SAVE_KEY]: JSON.stringify({ ...saved, version: 0 }) }))).toBeNull()
    expect(readSave(fakeStore({ [SAVE_KEY]: JSON.stringify({ ...saved, version: 2 }) }))).toBeNull()
  })

  it('rejects a board that is not the board it expects', () => {
    const saved = baseSave()
    expect(readSave(fakeStore({ [SAVE_KEY]: JSON.stringify({ ...saved, board: saved.board.slice(0, 20) }) }))).toBeNull()
    expect(readSave(fakeStore({ [SAVE_KEY]: JSON.stringify({ ...saved, board: saved.board.map(() => 7) }) }))).toBeNull()
  })

  it('rejects goals that are not exactly the two it is looking for', () => {
    const saved = baseSave()
    const oneGoal = { ...saved, goals: [saved.goals[0]] }
    expect(readSave(fakeStore({ [SAVE_KEY]: JSON.stringify(oneGoal) }))).toBeNull()
    expect(
      readSave(fakeStore({ [SAVE_KEY]: JSON.stringify({ ...saved, goals: [saved.goals[0], { animal: 'cat' }] }) })),
    ).toBeNull()
  })

  it('never restores a rack below the floor or above the level start', () => {
    const saved = baseSave()
    expect(readSave(fakeStore({ [SAVE_KEY]: JSON.stringify({ ...saved, bubbles: MIN_BUBBLES - 1 }) }))).toBeNull()
    expect(readSave(fakeStore({ [SAVE_KEY]: JSON.stringify({ ...saved, bubbles: saved.bubblesStart + 1 }) }))).toBeNull()
    expect(readSave(fakeStore({ [SAVE_KEY]: JSON.stringify({ ...saved, level: 0 }) }))).toBeNull()
  })

  it('survives storage that throws, which is the whole point of the seam (SPEC §14.1)', () => {
    const storage = deniedStore()
    const state = createLevel(1, 0x0badc0de, POOL)
    expect(readSave(storage)).toBeNull()
    expect(writeSave(state, RUN, storage)).toBe(false)
  })

  it('reads nothing when nothing was written', () => {
    expect(readSave(fakeStore())).toBeNull()
  })

  it('targets the goal counters against the ramp, which a save does not carry', () => {
    const saved = baseSave()
    const state = resumeLevel(saved, POOL)
    for (const goal of state.goals) {
      expect(goal.target).toBe(goalTargetForLevel(saved.level))
    }
  })
})

function baseSave(): SaveState {
  const state = createLevel(4, 0xfeedf00d, POOL)
  return toSaveState(state, RUN)
}
