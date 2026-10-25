import { PARTICLES } from '../game/constants'

/**
 * The celebration's framerate tier (SPEC §10.2, issue #12).
 *
 * The pure part of the party: it decides when the layer is running late enough to drop to the 30fps
 * tier and when the device has recovered enough to come back. It is separate from `celebration.ts`
 * because vitest runs in node and cannot mount a canvas, and because "the degrade is reversible" is a
 * claim that should be asserted rather than described.
 */

export type FrameTier = '60fps' | '30fps'

export interface FrameTick {
  /** The tier after this tick. */
  tier: FrameTier
  /** Whether this frame should draw. The 30fps tier is a throttle, so it draws every other frame. */
  draw: boolean
}

export interface FrameTierMeter {
  tier(): FrameTier
  /** Feed one animation-frame timestamp and get the tier plus whether this frame should draw. */
  tick(now: number): FrameTick
}

/**
 * SPEC §10.2: "degrade particle count (30fps tier) if frame time exceeds budget for 1s".
 *
 * Frame time here is the interval the browser actually delivers, not the time this layer spends inside
 * `draw()`. The layer's own work is a few hundred arcs - well under a millisecond - so timing only that
 * reports a healthy tier while the screen is running at 25fps, which is exactly the reading #12's device
 * check needs to be able to trust. The compositor, the page and the rest of the game are what make a
 * frame late, and the animation frame ticks are where the browser tells us about them.
 *
 * "For 1s" is a window, and issue #29 is what happens when it is not read as one. The meter used to
 * classify each frame on its own and clear `lateMs` whenever a frame landed inside the budget, so a
 * tablet delivering a mix - 16.7ms, then 46.7ms, which is 31fps averaged over a second - never
 * accumulated the second, because every fast frame wiped the record of the slow ones. It also counted
 * `sinceMeasureMs` per tick, so its "window" was always one frame wide. The meter now accumulates
 * `measureWindowMs` of delivered frames, averages that window, and charges the window's wall time to one
 * band. A mixed delivery averages over budget on every window, so it degrades, which is what the tablet
 * actually needs the tier to do.
 *
 * The 30fps tier is a throttle, so its frames are ~33ms apart by design. The window counts every tick in
 * it, skipped or drawn, so a panel still delivering 60Hz reads 16.7ms even while every other frame is
 * skipped, and a panel that has actually fallen to 30Hz reads 33ms and stays degraded. That is what lets
 * `recoverAfterMs` mean "the device can hold 60 again" rather than "the throttle is working".
 */
export function createFrameTierMeter(): FrameTierMeter {
  let tier: FrameTier = '60fps'

  // The 30fps throttle alternates skip, draw, skip, draw. It starts on a skip after a degrade so the
  // frame that noticed the problem is not immediately followed by two draws.
  let drawNext = true

  let lastTick: number | null = null

  /** The window being accumulated: its wall time and the animation frames inside it. */
  let windowMs = 0
  let windowTicks = 0

  /**
   * The two bands. Only the window is cleared when it is classified; the bands keep what they have
   * measured, because "over budget for 1s" is a stretch of delivery, not the last frame seen.
   */
  let lateMs = 0
  let onTimeMs = 0

  function tick(now: number): FrameTick {
    if (lastTick === null) {
      lastTick = now
      return { tier, draw: true }
    }

    const elapsed = now - lastTick
    lastTick = now

    // A hidden tab, a sleeping device, or a stall outside this layer is not a slow frame: coming back to
    // a party after ten minutes on another app must not drop it to 30fps for a gap that was never drawn.
    // The window a gap interrupted is dropped, the gap is charged to neither band, and what was already
    // measured stays measured.
    if (elapsed > PARTICLES.stallMs) {
      windowMs = 0
      windowTicks = 0
      return { tier, draw: true }
    }

    windowMs += elapsed
    windowTicks += 1

    // Every tick in the window is counted, skipped or drawn, so a 33ms gap split over two animation
    // frames reads as 16.7ms each - the panel's real rate - rather than as a late frame caused by the
    // throttle this module asked for.
    if (tier === '30fps') {
      if (!drawNext) {
        drawNext = true
        return { tier, draw: false }
      }
      drawNext = false
    }

    if (windowMs < PARTICLES.measureWindowMs) return { tier, draw: true }

    const frameMs = windowMs / windowTicks
    const wallMs = windowMs
    windowMs = 0
    windowTicks = 0

    // The bands are wall-clock time, so a degraded party still recovers in `recoverAfterMs` of real
    // seconds rather than double that because only every other frame is measured.
    const budget = PARTICLES.frameBudgetMs * PARTICLES.lateFrameFactor
    if (frameMs > budget) {
      lateMs += wallMs
      onTimeMs = 0
      if (tier === '60fps' && lateMs >= PARTICLES.degradeAfterMs) {
        tier = '30fps'
        drawNext = false
      }
    } else {
      onTimeMs += wallMs
      lateMs = 0
      if (tier === '30fps' && onTimeMs >= PARTICLES.recoverAfterMs) {
        tier = '60fps'
        drawNext = true
      }
    }

    return { tier, draw: true }
  }

  return { tier: () => tier, tick }
}
