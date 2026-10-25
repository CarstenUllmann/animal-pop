import { describe, expect, it } from 'vitest'
import { PARTICLES } from '../game/constants'
import { createFrameTierMeter, type FrameTier, type FrameTierMeter } from './frameTier'

/**
 * SPEC §10.2 and issue #12: the celebration drops to the 30fps tier when frames run long, and comes
 * back when they stop running long. The meter is pure so both halves are asserted here with fabricated
 * frame times; `celebration.ts` only wires it to the animation frame loop.
 *
 * Issue #29 is the shape of the delivery. On the tablet the frames are not steadily late - the panel
 * delivers a mix, and the average over a second is what the tier has to respond to. So every case here
 * is written as a delivery pattern rather than as one frame time, and the mixed patterns are the ones
 * the old per-frame meter could never degrade on.
 */

/** Feed a repeating pattern of intervals one tick at a time; return the wall time when the tier first reads `want`. */
function runUntilTier(meter: FrameTierMeter, from: number, pattern: readonly number[], want: FrameTier): number {
  let now = from
  for (let i = 0; i < 600; i++) {
    now += pattern[i % pattern.length] as number
    meter.tick(now)
    if (meter.tier() === want) return now
  }
  return now
}

function timeUntilTier(pattern: readonly number[], want: FrameTier): number {
  return runUntilTier(createFrameTierMeter(), 0, pattern, want)
}

describe('the celebration frame tier (SPEC §10.2, issues #12 and #29)', () => {
  it('stays on 60fps and draws every frame when frames are inside the budget', () => {
    const meter = createFrameTierMeter()
    let now = 0
    for (let i = 0; i < 300; i++) {
      now += 16.7
      expect(meter.tick(now)).toEqual({ tier: '60fps', draw: true })
    }
    expect(meter.tier()).toBe('60fps')
  })

  it('does not mistake 60Hz jitter for a late frame', () => {
    // A healthy panel delivers a little unevenly. Charging the bare 16.7ms would degrade a perfect tablet.
    const meter = createFrameTierMeter()
    let now = 0
    for (let i = 0; i < 600; i++) {
      now += 17.4
      meter.tick(now)
    }
    expect(meter.tier()).toBe('60fps')
  })

  it('drops to 30fps after a second of late frames, and throttles its draws', () => {
    const meter = createFrameTierMeter()
    let now = 0
    // ~30fps: every frame is over the 60fps budget. A window is what gets classified, not a frame, so the
    // tier is still 60fps until the window that carries the second of late delivery closes - here the
    // fourth window, at 1080ms of measured wall time.
    for (let i = 0; i < 36; i++) {
      now += 30
      meter.tick(now)
    }
    expect(meter.tier()).toBe('60fps')
    now += 30
    meter.tick(now)
    expect(meter.tier()).toBe('30fps')

    const afterDegrade: boolean[] = []
    for (let i = 0; i < 6; i++) {
      now += 16.7
      afterDegrade.push(meter.tick(now).draw)
    }
    // The throttle is a throttle: every other frame is skipped, not just drawn with fewer particles.
    expect(afterDegrade).toEqual([false, true, false, true, false, true])
  })

  it('degrades on the mixed delivery the tablet actually delivers (issue #29)', () => {
    // Every one of these averages over the 25.05ms budget across a window, which is what the meter reads.
    // The old meter classified frame by frame and cleared its record on every frame inside the budget, so
    // none of these ever reached `degradeAfterMs`: the tablet ran at 31.3fps and then 27.8fps while the
    // tier stayed 60fps.
    const patterns: Array<[string, readonly number[]]> = [
      ['alternating 16.7 / 46.7 (31.7fps average)', [16.7, 46.7]],
      ['four fast then four slow (31.7fps average)', [16.7, 16.7, 16.7, 16.7, 46.7, 46.7, 46.7, 46.7]],
      ['20ms / 40ms jitter (30fps average)', [20, 40]],
    ]
    for (const [name, pattern] of patterns) {
      const at = timeUntilTier(pattern, '30fps')
      // The threshold is counted in whole windows, so the flip lands within one window of the 1s.
      expect(at, name).toBeLessThanOrEqual(PARTICLES.degradeAfterMs + PARTICLES.measureWindowMs)
    }
  })

  it('does not clear the record of lateness because one frame happened to land inside the budget', () => {
    // Two slow frames and one fast one, repeating. Charged per frame, the fast frame resets the accumulator
    // every cycle and the tier never changes; charged per window, the window averages 36.7ms and the
    // second of late delivery is what it looks like to the party.
    const at = timeUntilTier([46.7, 46.7, 16.7], '30fps')
    expect(at).toBeLessThanOrEqual(PARTICLES.degradeAfterMs + PARTICLES.measureWindowMs)
  })

  it('comes back to 60fps after the device holds the budget again', () => {
    const meter = createFrameTierMeter()
    let now = 0
    for (let i = 0; i < 40; i++) {
      now += 30
      meter.tick(now)
    }
    expect(meter.tier()).toBe('30fps')

    // The panel is delivering 60Hz again, so the window average is 16.7ms even though every other frame
    // is skipped: the throttle is not charged to the meter as a late frame, which is what makes recovery
    // mean "the device can hold 60 again" rather than "the throttle is working".
    const beforeRecovery = now
    const flipAt = runUntilTier(meter, now, [16.7], '60fps')
    // Recovery is `recoverAfterMs` of wall time, not of drawn frames. A window can be classified up to one
    // frame after it fills, because only the frames the tier draws reach the classification.
    expect(flipAt - beforeRecovery).toBeGreaterThanOrEqual(PARTICLES.recoverAfterMs)
    expect(flipAt - beforeRecovery).toBeLessThanOrEqual(PARTICLES.recoverAfterMs + PARTICLES.measureWindowMs)
    expect(meter.tick(flipAt + 16.7)).toEqual({ tier: '60fps', draw: true })
  })

  it('does not charge a hidden tab or a sleeping device to the tier', () => {
    const meter = createFrameTierMeter()
    let now = 0
    for (let i = 0; i < 120; i++) {
      now += 16.7
      meter.tick(now)
    }

    // Ten minutes in the background, then the party is back. That gap is not a slow frame.
    now += 10 * 60 * 1000
    expect(meter.tick(now)).toEqual({ tier: '60fps', draw: true })
    for (let i = 0; i < 30; i++) {
      now += 16.7
      meter.tick(now)
    }
    expect(meter.tier()).toBe('60fps')
  })

  it('drops a window interrupted by a stall but keeps what it had already measured', () => {
    const meter = createFrameTierMeter()
    let now = 0
    // Three closed windows of late delivery: 270ms each, so 810ms of the second is already measured.
    for (let i = 0; i < 30; i++) {
      now += 30
      meter.tick(now)
    }
    expect(meter.tier()).toBe('60fps')

    // A gap is charged to neither band, and the partial window it interrupted is dropped rather than
    // averaged over a gap that was never drawn.
    now += 10 * 60 * 1000
    expect(meter.tick(now)).toEqual({ tier: '60fps', draw: true })

    // What was measured before the gap is still what the 1s is read against, so the first full window of
    // late delivery after coming back is what crosses the threshold - the gap itself is not.
    for (let i = 0; i < 10; i++) {
      now += 30
      meter.tick(now)
    }
    expect(meter.tier()).toBe('30fps')
  })
})
