import { describe, expect, it } from 'vitest'
import { PARTICLES } from '../game/constants'
import { createFrameTierMeter } from './frameTier'

/**
 * SPEC §10.2 and issue #12: the celebration drops to the 30fps tier when frames run long, and comes
 * back when they stop running long. The meter is pure so both halves are asserted here with fabricated
 * frame times; `celebration.ts` only wires it to the animation frame loop.
 */

describe('the celebration frame tier (SPEC §10.2, issue #12)', () => {
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
    // ~30fps: every frame is over the 60fps budget. One second of them is the degrade threshold. The
    // first tick has no interval to measure, so it takes 35 ticks to cross 1000ms of measured frames.
    for (let i = 0; i < 34; i++) {
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

  it('comes back to 60fps after the device holds the budget again', () => {
    const meter = createFrameTierMeter()
    let now = 0
    for (let i = 0; i < 40; i++) {
      now += 30
      meter.tick(now)
    }
    expect(meter.tier()).toBe('30fps')

    // The panel is delivering 60Hz again, so the meter's normalised frame time is 16.7ms even though
    // every other frame is skipped. Recovery is `recoverAfterMs` of wall time, not of drawn frames.
    const recoverAt = now + PARTICLES.recoverAfterMs
    while (now <= recoverAt + 40) {
      now += 16.7
      meter.tick(now)
    }
    expect(meter.tier()).toBe('60fps')
    expect(meter.tick(now + 16.7)).toEqual({ tier: '60fps', draw: true })
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
})
