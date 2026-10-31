import { PARTICLES } from '../game/constants'

/**
 * The celebration's frame-rate tier. The layer drops to 30fps when delivered frames run over
 * budget for long enough, and recovers after a stretch inside it.
 */

export type FrameTier = '60fps' | '30fps'

export interface FrameTick {
  tier: FrameTier
  /** Whether this frame should draw. The 30fps tier draws every other frame. */
  draw: boolean
}

export interface FrameTierMeter {
  tier(): FrameTier
  tick(now: number): FrameTick
}

/**
 * Frame time is the interval the browser delivers, not the time this layer spends drawing: the
 * compositor and the rest of the page are what make a frame late. Frames are averaged over a
 * window, so a mix of fast and slow frames cannot wipe the record one frame at a time.
 */
export function createFrameTierMeter(): FrameTierMeter {
  let tier: FrameTier = '60fps'

  // Skip, draw, skip, draw.
  let drawNext = true

  let lastTick: number | null = null

  let windowMs = 0
  let windowTicks = 0

  let lateMs = 0
  let onTimeMs = 0

  function tick(now: number): FrameTick {
    if (lastTick === null) {
      lastTick = now
      return { tier, draw: true }
    }

    const elapsed = now - lastTick
    lastTick = now

    // A hidden tab or a sleeping device is a pause, not a slow frame: drop the interrupted window.
    if (elapsed > PARTICLES.stallMs) {
      windowMs = 0
      windowTicks = 0
      return { tier, draw: true }
    }

    windowMs += elapsed
    windowTicks += 1

    // Every tick is counted, skipped or drawn, so a 60Hz panel still reads 16.7ms while throttled.
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

    // The bands are wall-clock time, so recovery is not twice as slow under the throttle.
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
