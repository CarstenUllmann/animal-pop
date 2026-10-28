import { describe, expect, it } from 'vitest'
import { ADULT_RESET } from './constants'
import {
  cancelReset,
  confirmHasExpired,
  confirmIsLive,
  holdCompleted,
  holdOpensConfirm,
  initialAdultReset,
  openConfirm,
} from './adultReset'

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

  it('a released finger cannot open the confirm step when its old timer fires (issue #16)', () => {
    // The timer is scheduled on pointerdown and fires three seconds later. Elapsed time alone would
    // open the step for a normal tap; the finger has to still be down when it fires.
    expect(holdCompleted(false, ADULT_RESET.holdMs)).toBe(false)
    expect(holdCompleted(false, ADULT_RESET.holdMs + 5000)).toBe(false)
    expect(holdCompleted(true, ADULT_RESET.holdMs)).toBe(true)
    expect(holdCompleted(true, ADULT_RESET.holdMs - 1)).toBe(false)
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
})
