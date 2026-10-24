import { describe, expect, it } from 'vitest'
import { ADULT_RESET } from './constants'
import { rampForLevel } from './level'
import type { SaveState } from './types'
import {
  buildResetSave,
  cancelReset,
  confirmHasExpired,
  confirmIsLive,
  holdOpensConfirm,
  initialAdultReset,
  openConfirm,
  resetContext,
} from './adultReset'

const POOL = ['cat', 'rabbit', 'panda', 'frog']

/** A save as it would look mid-game, which is what the reset has to decide about. */
function progress(over: Partial<SaveState> = {}): SaveState {
  return {
    version: 1,
    sessionSeed: 0x11112222,
    level: 12,
    board: ['cat', 'frog'],
    goals: [{ animal: 'cat', remaining: 1 }, { animal: 'frog', remaining: 0 }],
    bubbles: 3,
    bubblesStart: 26,
    muted: true,
    levelsCompleted: 11,
    ...over,
  }
}

describe('adult reset', () => {
  it('opens the confirm step at exactly the hold, and not a moment before (issue #16)', () => {
    expect(holdOpensConfirm(ADULT_RESET.holdMs)).toBe(true)
    expect(holdOpensConfirm(ADULT_RESET.holdMs - 1)).toBe(false)
    expect(holdOpensConfirm(ADULT_RESET.holdMs + 1000)).toBe(true)
  })

  it('a normal tap never gets that far', () => {
    // The child's taps are hundreds of times shorter than the adult hold.
    expect(holdOpensConfirm(120)).toBe(false)
    expect(initialAdultReset().stage).toBe('idle')
  })

  it('any other interaction cancels it cleanly (issue #16)', () => {
    const confirm = openConfirm(1000)
    const after = cancelReset()

    // The confirm step it was cancelled from really was open, so the cancel is what did the change.
    expect(confirm.stage).toBe('confirm')
    expect(after.stage).toBe('idle')
    // Nothing is left running: the timeout has no expiry left to fire against.
    expect(after.confirmExpiresAt).toBe(0)
    expect(confirmIsLive(after, 1000)).toBe(false)
    expect(confirmHasExpired(after, 1000)).toBe(false)
  })

  it('the confirm step counts for its timeout and then gives up', () => {
    const confirm = openConfirm(1000)
    expect(confirm.confirmExpiresAt).toBe(1000 + ADULT_RESET.confirmTimeoutMs)

    expect(confirmIsLive(confirm, 1000)).toBe(true)
    expect(confirmIsLive(confirm, confirm.confirmExpiresAt)).toBe(true)
    expect(confirmHasExpired(confirm, confirm.confirmExpiresAt + 1)).toBe(true)
    expect(confirmIsLive(confirm, confirm.confirmExpiresAt + 1)).toBe(false)

    // An idle numeral has nothing to expire, so a stray tap in idle is just a tap.
    expect(confirmIsLive(initialAdultReset(), 1000)).toBe(false)
    expect(confirmHasExpired(initialAdultReset(), 1000)).toBe(false)
  })

  it('confirming writes the reset save: level 1 with a full rack (issue #16)', () => {
    const before = progress()
    const save = buildResetSave(before, POOL)

    expect(save.level).toBe(1)
    expect(save.bubbles).toBe(rampForLevel(1).bubbles)
    expect(save.bubblesStart).toBe(rampForLevel(1).bubbles)

    // Issue #16 wipes the progress, so the count the game keeps for itself restarts too.
    expect(save.levelsCompleted).toBe(0)

    // A fresh level 1 starts with both goals uncollected, not with the goals it was wiped from.
    // `SaveState.goals` is the persisted shape, so the target is the ramp's, not one it carries.
    expect(save.goals.every((goal) => goal.remaining === rampForLevel(1).goalEach)).toBe(true)
    expect(save.goals).toHaveLength(2)

    // §9.2: the session seed is what makes the same animal set come back, so a reset is a fresh
    // game rather than a re-run of the level she was on.
    expect(save.sessionSeed).toBe(before.sessionSeed)
    // §11: the mute choice is an adult setting, so it is not part of what gets wiped.
    expect(save.muted).toBe(true)
  })

  it('the reset save is what a fresh game writes, when there is nothing to keep', () => {
    const save = buildResetSave(null, POOL)

    expect(save.level).toBe(1)
    expect(save.levelsCompleted).toBe(0)
    expect(save.muted).toBe(false)
    expect(save.board).toHaveLength(36)
    expect(resetContext(null).muted).toBe(false)
  })

  it('the mute choice a reset keeps is the remembered one, not the default', () => {
    expect(resetContext(progress({ muted: false })).muted).toBe(false)
    expect(resetContext(progress({ muted: true })).muted).toBe(true)
    expect(resetContext(null).muted).toBe(false)
  })
})
