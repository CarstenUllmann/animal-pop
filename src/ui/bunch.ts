import { CELEBRATION, LAYOUT } from '../game/constants'
import type { Rng } from '../game/types'

/**
 * The balloon placement rule: a pure function from the board, a bunch size and an `Rng` to places.
 *
 * A place is a centre in board pixels measured from the board's left and bottom edges. The balloon's
 * whole region (half box, margin, float amplitude) must sit inside the board and clear of the play
 * arrow; the bottom edge is open because balloons rise through it. Pairs are at least
 * `factor × mean(size)` apart, centre to centre.
 */

/** A place is the balloon's centre, with its jittered size already decided. */
export interface Place {
  x: number
  y: number
  /** The jittered size of this balloon, in CSS px. */
  size: number
}

/** The board as the rule sees it: painted size, nominal balloon, and the arrow's band. */
export interface BunchMetrics {
  boardWidthPx: number
  boardHeightPx: number
  /** `--balloon-px` on this device. */
  balloonPx: number
  /** Top edge of the play-arrow band, measured up from the board's bottom edge. */
  arrowBandPx: number
}

/** The ladder, widest first: the target spacing down to the exposure floor. */
export function spacingRungs(): number[] {
  const rungs: number[] = []
  for (let pct = LAYOUT.balloonSpacingFactor * 100; pct >= LAYOUT.balloonMinExposure * 100; pct -= LAYOUT.balloonSpacingStepPct) {
    rungs.push(Math.round(pct))
  }
  return rungs
}

/** Half the balloon's box, from the height the stylesheet gives the shape. */
function halfBoxPx(size: number): number {
  return (size * LAYOUT.balloonHeightRatio) / 2
}

/** The room a centre keeps from one edge, or the exposure floor when the board cannot give it. */
function regionHalfPx(region: number, extentPx: number, size: number): number {
  if (region * 2 <= extentPx) return region
  return Math.min(LAYOUT.balloonMinExposure * size, extentPx / 2)
}

/** Half the width a centre keeps from a side edge: half the balloon, its margin, and its sway. */
function halfRegionX(metrics: BunchMetrics, size: number): number {
  return regionHalfPx(size / 2 + LAYOUT.balloonMarginPx + CELEBRATION.balloonSwayPx, metrics.boardWidthPx, size)
}

/** Half the height a centre keeps from the top edge: half the box, its margin, and its bob. */
function halfRegionY(metrics: BunchMetrics, size: number): number {
  return regionHalfPx(halfBoxPx(size) + LAYOUT.balloonMarginPx + CELEBRATION.balloonBobPx, metrics.boardHeightPx, size)
}

/** The band a centre may sit in: inside the board, clear of the arrow, with the bottom edge open. */
function centreBounds(metrics: BunchMetrics, size: number): { minX: number; maxX: number; minY: number; maxY: number } {
  return {
    minX: halfRegionX(metrics, size),
    maxX: metrics.boardWidthPx - halfRegionX(metrics, size),
    minY: metrics.arrowBandPx + halfBoxPx(size) + CELEBRATION.balloonBobPx,
    maxY: metrics.boardHeightPx - halfRegionY(metrics, size),
  }
}

/** Whether the centre is far enough from every edge. */
export function canPlace(metrics: BunchMetrics, place: Place): boolean {
  const bounds = centreBounds(metrics, place.size)
  if (bounds.maxX < bounds.minX || bounds.maxY < bounds.minY) return false
  return place.x >= bounds.minX && place.x <= bounds.maxX && place.y >= bounds.minY && place.y <= bounds.maxY
}

/**
 * Move a place from the board it was drawn on into a new one. This keeps the size and draws nothing
 * from `Rng`: a rotation moves the balloons she can see, it does not place them again.
 */
export function clampToBoard(metrics: BunchMetrics, place: Place): Place {
  const bounds = centreBounds(metrics, place.size)
  return {
    x: Math.min(Math.max(place.x, bounds.minX), bounds.maxX),
    y: Math.min(Math.max(place.y, bounds.minY), bounds.maxY),
    size: place.size,
  }
}

/** The pair rule: centre-to-centre, against the two actual sizes. */
export function canPlaceAt(places: Place[], metrics: BunchMetrics, place: Place, factorPct: number): boolean {
  if (!canPlace(metrics, place)) return false
  for (const other of places) {
    const minimum = (factorPct / 100) * ((place.size + other.size) / 2)
    if (Math.hypot(place.x - other.x, place.y - other.y) < minimum) return false
  }
  return true
}

/**
 * How many balloons fit at one rung, counted worst case: the rung's spacing and the largest jittered
 * balloon. This is a conservative floor rather than a cap.
 */
export function bunchCapacity(metrics: BunchMetrics, factorPct: number): number {
  const worstPx = metrics.balloonPx * (1 + LAYOUT.balloonSizeJitter)
  const cell = (factorPct / 100) * worstPx
  const usableWidthPx = metrics.boardWidthPx - 2 * halfRegionX(metrics, worstPx)
  const usableHeightPx =
    metrics.boardHeightPx - halfRegionY(metrics, worstPx) - (metrics.arrowBandPx + halfBoxPx(worstPx) + CELEBRATION.balloonBobPx)
  if (usableWidthPx < 0 || usableHeightPx < 0) return 0
  return (Math.floor(usableWidthPx / cell) + 1) * (Math.floor(usableHeightPx / cell) + 1)
}

/** The widest rung that holds `count` balloons, or the floor rung when none does. */
export function bunchFactor(metrics: BunchMetrics, count: number): number {
  for (const rung of spacingRungs()) {
    if (bunchCapacity(metrics, rung) >= count) return rung
  }
  return spacingRungs()[spacingRungs().length - 1] as number
}

/** The rung a bunch is placed at, how many fit there, and whether the wanted bunch fits at all. */
export interface BunchPlan {
  factorPct: number
  count: number
  fits: boolean
}

export function bunchPlan(metrics: BunchMetrics, wantedCount: number): BunchPlan {
  const factorPct = bunchFactor(metrics, wantedCount)
  return {
    factorPct,
    count: Math.min(wantedCount, bunchCapacity(metrics, factorPct)),
    fits: bunchCapacity(metrics, spacingRungs()[0] as number) >= wantedCount,
  }
}

/** One balloon's size: up to ±6% of nominal. */
export function drawSize(metrics: BunchMetrics, rng: Rng): number {
  return Math.round(metrics.balloonPx * (1 + jitter(rng)))
}

function jitter(rng: Rng): number {
  return rng.next() * 2 * LAYOUT.balloonSizeJitter - LAYOUT.balloonSizeJitter
}

/**
 * Place a bunch. The sizes are drawn first and sorted largest first, so the biggest balloons get the
 * spots only they can occupy; the result is in paint order, back to front.
 */
export function placeBunch(metrics: BunchMetrics, rng: Rng, count: number): Place[] {
  const sizes: number[] = []
  for (let i = 0; i < count; i++) sizes.push(drawSize(metrics, rng))
  sizes.sort((a, b) => b - a)

  const plan = bunchPlan(metrics, count)
  const places: Place[] = []
  for (const size of sizes) {
    const place = placeOne(places, metrics, rng, size, plan.factorPct)
    if (place !== null) places.push(place)
  }
  return places
}

/** Replace one popped balloon: a fresh size draw, then one position draw. */
export function placeSlot(places: Place[], metrics: BunchMetrics, rng: Rng, factorPct: number): Place | null {
  return placeOne(places, metrics, rng, drawSize(metrics, rng), factorPct)
}

/** Bounded position attempts, so a full board answers instead of spinning. */
const MAX_DRAWS_PER_BALLOON = 40

function placeOne(places: Place[], metrics: BunchMetrics, rng: Rng, size: number, factorPct: number): Place | null {
  const bounds = centreBounds(metrics, size)
  if (bounds.maxX < bounds.minX || bounds.maxY < bounds.minY) return null

  for (let draw = 0; draw < MAX_DRAWS_PER_BALLOON; draw++) {
    const place = {
      x: bounds.minX + rng.next() * (bounds.maxX - bounds.minX),
      y: bounds.minY + rng.next() * (bounds.maxY - bounds.minY),
      size,
    }
    if (canPlaceAt(places, metrics, place, factorPct)) return place
  }

  // The fixed scan walks the lattice `bunchCapacity` counted. It is a guard, not a promise: an
  // earlier off-lattice balloon can still block a point and leave the bunch one short.
  const cell = (factorPct / 100) * size * (1 + LAYOUT.balloonSizeJitter)
  for (let row = 0; bounds.minY + row * cell <= bounds.maxY; row++) {
    for (let col = 0; bounds.minX + col * cell <= bounds.maxX; col++) {
      const place = { x: bounds.minX + col * cell, y: bounds.minY + row * cell, size }
      if (canPlaceAt(places, metrics, place, factorPct)) return place
    }
  }
  return null
}
