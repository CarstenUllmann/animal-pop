import { describe, expect, it } from 'vitest'
import { MAX_QUEUED_TAPS } from './constants'
import { getGroups } from './board'
import { resumeLevel } from './level'
import { createRng } from './rng'
import { createLevelSession, type LevelSession, type TapPlan } from './session'
import type { SaveContext } from './save'
import type { AnimalId, Board, LevelState, SaveState } from './types'

const POOL: AnimalId[] = ['cat', 'rabbit', 'panda', 'frog', 'dog']

/** What the one write path saw, so the test can hold the session to "written after every tap". */
function recorder(): { writes: Array<{ state: LevelState; context: SaveContext }>; save: (state: LevelState, context: SaveContext) => void } {
  const writes: Array<{ state: LevelState; context: SaveContext }> = []
  return {
    writes,
    save: (state, context) => {
      writes.push({ state, context: { ...context } })
    },
  }
}

function fresh(over: Partial<Parameters<typeof createLevelSession>[0]> = {}): {
  session: LevelSession
  writes: Array<{ state: LevelState; context: SaveContext }>
} {
  const write = recorder()
  const session = createLevelSession({
    saved: null,
    sessionSeed: 0x1234abcd,
    pool: POOL,
    rng: createRng(0x1234abcd),
    save: write.save,
    ...over,
  })
  return { session, writes: write.writes }
}

/** The launch is a deal: the window is open until the first frame lands, which is what `settle()` closes. */
function dealt(session: LevelSession): LevelSession {
  expect(session.settle()).toBeNull()
  return session
}

/** A six by six board whose first two cells are one legal group, so a tap there pops. */
function pairedBoard(): Board {
  const board: Board = new Array<string | null>(36).fill('dog')
  board[0] = 'cat'
  board[1] = 'cat'
  return board
}

/** A save whose goals are one cat short, which is the tap that earns the party. */
function nearlyWon(over: Partial<SaveState> = {}): SaveState {
  return {
    version: 1,
    sessionSeed: 0x1234abcd,
    level: 1,
    board: pairedBoard(),
    goals: [
      { animal: 'cat', remaining: 1 },
      { animal: 'dog', remaining: 0 },
    ],
    bubbles: 12,
    bubblesStart: 12,
    muted: false,
    levelsCompleted: 4,
    ...over,
  }
}

/** A save whose goals are already clear, which is the party a launch restores (issue #15). */
function won(over: Partial<SaveState> = {}): SaveState {
  const save = nearlyWon(over)
  save.goals = [
    { animal: 'cat', remaining: 0 },
    { animal: 'dog', remaining: 0 },
  ]
  return save
}

function resumed(save: SaveState): { session: LevelSession; writes: Array<{ state: LevelState; context: SaveContext }> } {
  const write = recorder()
  const session = createLevelSession({
    saved: save,
    sessionSeed: save.sessionSeed,
    pool: POOL,
    rng: createRng(save.sessionSeed),
    save: write.save,
  })
  return { session, writes: write.writes }
}

function planKeys(plan: TapPlan): string[] {
  return Object.keys(plan).sort()
}

describe('a level session starts where the save left off (SPEC §14.1)', () => {
  it('deals level 1 with the defaults when there is nothing persisted', () => {
    const { session, writes } = fresh()
    expect(session.state().level).toBe(1)
    expect(session.state().bubbles).toBe(session.state().bubblesStart)
    expect(session.context()).toEqual({ muted: false, levelsCompleted: 0 })
    // The session writes when something changes, not on construction: a save describes progress.
    expect(writes).toHaveLength(0)
  })

  it('resumes the level, the mute and the count the save holds', () => {
    const save = nearlyWon({ level: 4, muted: true, levelsCompleted: 9 })
    const { session } = resumed(save)

    expect(session.state().level).toBe(4)
    expect(session.state().board).toEqual(save.board)
    expect(session.context()).toEqual({ muted: true, levelsCompleted: 9 })
    // The roster and the targets come from the seed, so a resumed level is the level it was (SPEC §9.2).
    expect(session.state().roster).toEqual(resumeLevel(save, POOL).roster)
  })
})

describe('one tap becomes a plan the renderer can follow (SPEC §7.1, §7.5)', () => {
  it('runs the tap, writes it, and carries the settle the view has to animate', () => {
    const { session, writes } = fresh()
    dealt(session)
    const cell = firstLegalCell(session.state())
    const plan = session.beginTap(cell)

    expect(plan.arrival).toBe('run')
    expect(plan.result).not.toBeNull()
    expect(plan.result?.outcome).toBe('popped')
    expect(plan.state).toEqual(plan.result?.state)
    // Issue #8: the write happens before the animation, so the save cannot be a frame behind the screen.
    expect(writes).toHaveLength(1)
    expect(writes[0]?.state).toEqual(plan.state)
    expect(plan.party).toBe(false)
    expect(plan.firstTap).toBe(true)
    expect(plan.firstPop).toBe(true)
  })

  it('holds a tap that arrives mid-settle and releases it when the settle ends', () => {
    const { session } = fresh()
    dealt(session)
    const first = session.beginTap(firstLegalCell(session.state()))
    expect(first.arrival).toBe('run')

    // The window the first tap opened is what makes the second one wait, in arrival order (SPEC §7.5).
    const second = session.beginTap(0)
    expect(second.arrival).toBe('wait')
    expect(second.result).toBeNull()

    const released = session.settle()
    expect(released?.arrival).toBe('run')
    expect(released?.index).toBe(0)
    // The trace facts belong to the run, not to the tap that happened to run first.
    expect(released?.firstTap).toBe(false)
    expect(session.settle()).toBeNull()
  })

  it('drops the tap past the cap without recording anything (issue #11)', () => {
    const { session } = fresh()
    dealt(session)
    session.beginTap(firstLegalCell(session.state()))

    const arrivals = []
    for (let i = 0; i < MAX_QUEUED_TAPS + 1; i++) arrivals.push(session.beginTap(0).arrival)
    expect(arrivals[arrivals.length - 1]).toBe('dropped')
    expect(session.queueSize()).toBe(MAX_QUEUED_TAPS)
  })

  it('answers a tap during the party without queueing it (SPEC §10)', () => {
    const { session } = resumed(won())
    dealt(session)
    expect(session.restoreParty()).toBe(true)

    const plan = session.beginTap(0)
    expect(plan.arrival).toBe('blocked')
    expect(plan.result).toBeNull()
    expect(session.queueSize()).toBe(0)
    // The touch is still the first tap of the run for the trace, even though the board is inert.
    expect(plan.firstTap).toBe(true)
  })

  it('reports the queue size the overlay shows (SPEC §14.3)', () => {
    const { session } = fresh()
    dealt(session)
    session.beginTap(firstLegalCell(session.state()))
    session.beginTap(0)
    expect(session.queueSize()).toBe(1)
  })
})

describe('the party is earned once and restored without counting it twice (SPEC §8.1, issue #15)', () => {
  it('opens the party on the tap that clears both goals, and counts the completion', () => {
    const { session, writes } = resumed(nearlyWon())
    dealt(session)
    const before = session.context().levelsCompleted

    const plan = session.beginTap(0)
    expect(plan.result?.complete).toBe(true)
    expect(plan.party).toBe(true)
    expect(session.context().levelsCompleted).toBe(before + 1)
    // The completion is written with the tap that earned it, so a force-close cannot lose it.
    expect(writes[writes.length - 1]?.context.levelsCompleted).toBe(before + 1)
  })

  it('does not count a party the launch restores', () => {
    const save = nearlyWon()
    save.goals = [
      { animal: 'cat', remaining: 0 },
      { animal: 'dog', remaining: 0 },
    ]
    const { session, writes } = resumed(save)
    dealt(session)

    expect(session.restoreParty()).toBe(true)
    expect(session.context().levelsCompleted).toBe(save.levelsCompleted)
    // Nothing changed, so nothing was written.
    expect(writes).toHaveLength(0)
    // And a second launch of the same session does not reopen it twice.
    expect(session.restoreParty()).toBe(false)
  })

  it('leaves no queued tap to run behind the party (SPEC §10, issue #11)', () => {
    const { session } = resumed(nearlyWon())
    dealt(session)
    const winning = session.beginTap(0)
    expect(winning.party).toBe(true)
    // A tap that arrived during the settle that won belongs to the level just finished.
    expect(session.queueSize()).toBe(0)
    expect(session.settle()).toBeNull()
  })
})

describe('level changes and the adult reset go through the same write path (SPEC §10.1, §14.2)', () => {
  it('deals the next level and writes it', () => {
    const { session, writes } = fresh()
    dealt(session)

    const state = session.nextLevel()
    expect(state.level).toBe(2)
    expect(state.sessionSeed).toBe(session.state().sessionSeed)
    expect(state.bubbles).toBe(state.bubblesStart)
    expect(writes[writes.length - 1]?.state).toEqual(state)
  })

  it('resets to level 1, keeps the mute and the seed, and wipes the count (issue #16)', () => {
    const save = nearlyWon({ level: 12, muted: true, levelsCompleted: 11 })
    const { session, writes } = resumed(save)
    dealt(session)

    const state = session.reset()
    expect(state.level).toBe(1)
    expect(state.sessionSeed).toBe(save.sessionSeed)
    expect(state.board).toHaveLength(36)
    expect(state.goals.every((goal) => goal.remaining === goal.target)).toBe(true)
    expect(session.context()).toEqual({ muted: true, levelsCompleted: 0 })
    expect(writes[writes.length - 1]?.state).toEqual(state)
  })
})

describe('the mute is part of the run, not a second save (SPEC §11, issue #17)', () => {
  it('records the choice on the one write path without losing progress', () => {
    const save = nearlyWon({ level: 6, levelsCompleted: 5 })
    const { session, writes } = resumed(save)
    dealt(session)

    session.setMuted(true)
    expect(session.context()).toEqual({ muted: true, levelsCompleted: 5 })
    const written = writes[writes.length - 1]
    expect(written?.context.muted).toBe(true)
    expect(written?.state.level).toBe(6)
  })

  it('keeps a toggle made before the first tap, because there is no stale copy to merge into', () => {
    const { session } = fresh()
    session.setMuted(true)
    // The tap that follows writes the live context, not the one the run booted with (issue #17).
    dealt(session)
    session.beginTap(firstLegalCell(session.state()))
    expect(session.context().muted).toBe(true)
  })
})

describe('the plan is the whole interface to the renderer', () => {
  it('has the same shape for every arrival, so a caller never branches on a missing field', () => {
    const { session } = fresh()
    dealt(session)
    const running = planKeys(session.beginTap(firstLegalCell(session.state())))

    const waiting = planKeys(session.beginTap(0))
    expect(waiting).toEqual(running)

    const finished = resumed(won())
    dealt(finished.session)
    finished.session.restoreParty()
    expect(planKeys(finished.session.beginTap(0))).toEqual(running)
  })
})

/** The first cell of the first legal group, so a test does not depend on a fixed board. */
function firstLegalCell(state: LevelState): number {
  const group = getGroups(state.board, 2)[0]
  if (group === undefined) throw new Error('the dealt board has no legal group')
  const cell = group.cells[0]
  if (cell === undefined) throw new Error('the group has no cells')
  return cell
}
