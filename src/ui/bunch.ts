import { CELEBRATION, LAYOUT } from '../game/constants'
import type { Rng } from '../game/types'

/**
 * The bunch placement rule (SPEC §10.1 *The bunch*, issues #32 and #33). A pure rule: given the board,
 * the bunch size, and a source of randomness it answers where a balloon may go. No DOM, no drawing, no
 * timers — celebration places a balloon by asking this rule, and the tests can ask it about the real
 * tablet, phone, and portrait boards.
 *
 * The board is a `BunchMetrics`, and a place is a centre in board pixels measured from the board's left
 * and bottom edges. Celebration turns a place into CSS by writing `--balloon-px` as the place's own size,
 * so the amplitudes this rule reserves stay honest on every device.
 *
 * ## The three rules of a place
 *
 * 1. **Inside the board** — the balloon's whole region, not its centre: its half-box
 *    (`LAYOUT.balloonHeightRatio`, the height the stylesheet gives the shape), its own margin
 *    (`LAYOUT.balloonMarginPx`) and its own float amplitude (`CELEBRATION.balloonSwayPx`, `balloonBobPx`)
 *    must all be inside the board. Only the bottom edge is exempt, where the balloons start below the
 *    board and rise through it.
 * 2. **Away from the play arrow** — no part of the box may sit in the arrow's band. `arrowBandPx` already
 *    includes the margin, so the box's bottom edge has to be at or above the band top: the centre is
 *    `arrowBandPx + halfBoxPx` up from the board's bottom.
 * 3. **At least as big as the smallest balloon** — `LAYOUT.balloonMinExposure` (40%) of the *actual* size,
 *    never the nominal size. This is the ladder's floor, and it is also what governs an edge when the
 *    board is too small to reserve a whole region: a board smaller than a balloon's region cannot reserve
 *    the margin, so the balloon sticks out exactly as the responsive board already does on a phone.
 *
 * ## Spacing
 *
 * The spacing ladder is the rule's only remaining knob, and it is derived from the constants rather than
 * typed as a list: the rungs are the percents from `LAYOUT.balloonSpacingFactor` (55%) down to
 * `LAYOUT.balloonMinExposure` (40%) in steps of `balloonSpacingStepPct` (5).
 *
 * The pair rule is Euclidean centre-to-centre, as SPEC §10.1 and issue #33 state: a pair may sit wherever
 * the centre distance reaches `factor × mean(jittered sizes)`. The per-axis reading of the same sentence
 * contradicts the worked tablet example in the issue — its four balloons do not fit at 55% per axis — so
 * centre-to-centre is the reading implemented.
 *
 * `placeBunch` answers in the priority order of issue #33: as many balloons as fit at the widest rung,
 * then the biggest balloons that fit at that rung, then as many as fit at the next rung down, and so on.
 * The bottom of the ladder is the exposure floor, which no pair may break: one balloon at 40%.
 */

/** What a place reserves: the place is the balloon's centre in board pixels, measured from the board's
 * left and bottom edges, with its own size already decided. */
export interface Place {
  x: number
  y: number
  /** The jittered size of this balloon, in CSS px. */
  size: number
}

/** What the rule needs to know about the board: the painted board (already reduced by the celebration
 * padding), the nominal balloon size on this device, and where the play arrow's band begins. */
export interface BunchMetrics {
  boardWidthPx: number
  boardHeightPx: number
  /** The nominal balloon size, i.e. `--balloon-px` on this device. */
  balloonPx: number
  /** Top edge of the play-arrow band, measured up from the board's bottom edge. */
  arrowBandPx: number
}

/** The ladder, widest first: 55, 50, 45, 40 on today's constants. */
export function spacingRungs(): number[] {
  const rungs: number[] = []
  for (let pct = LAYOUT.balloonSpacingFactor * 100; pct >= LAYOUT.balloonMinExposure * 100; pct -= LAYOUT.balloonSpacingStepPct) {
    rungs.push(Math.round(pct))
  }
  return rungs
}

/** Half the balloon's box: the height `LAYOUT.balloonHeightRatio` gives the shape. */
function halfBoxPx(size: number): number {
  return (size * LAYOUT.balloonHeightRatio) / 2
}

/**
 * How much a centre must keep from one edge. The balloon's own region — half of it, its margin, and the
 * amplitude on that axis — when the board can give it; otherwise the exposure floor, because a board
 * smaller than a balloon's region cannot reserve the margin (issue #33, and the phone).
 */
function regionHalfPx(region: number, extentPx: number, size: number): number {
  if (region * 2 <= extentPx) return region
  return Math.min(LAYOUT.balloonMinExposure * size, extentPx / 2)
}

/** Half the width a centre must keep from a side edge: half the balloon, its margin, and its sway. */
function halfRegionX(metrics: BunchMetrics, size: number): number {
  return regionHalfPx(size / 2 + LAYOUT.balloonMarginPx + CELEBRATION.balloonSwayPx, metrics.boardWidthPx, size)
}

/** Half the height a centre must keep from the top edge: half the box, its margin, and its bob. */
function halfRegionY(metrics: BunchMetrics, size: number): number {
  return regionHalfPx(halfBoxPx(size) + LAYOUT.balloonMarginPx + CELEBRATION.balloonBobPx, metrics.boardHeightPx, size)
}

/** The band a centre may sit in: inside the board, out of the arrow's band. The bottom edge is open,
 * because the balloons start below the board and rise through it, so the only rule there is that no part
 * of the box reaches into the band. */
function centreBounds(metrics: BunchMetrics, size: number): { minX: number; maxX: number; minY: number; maxY: number } {
  return {
    minX: halfRegionX(metrics, size),
    maxX: metrics.boardWidthPx - halfRegionX(metrics, size),
    minY: metrics.arrowBandPx + halfBoxPx(size) + CELEBRATION.balloonBobPx,
    maxY: metrics.boardHeightPx - halfRegionY(metrics, size),
  }
}

/** The region rule on its own: is this centre far enough from every edge? */
export function canPlace(metrics: BunchMetrics, place: Place): boolean {
  const bounds = centreBounds(metrics, place.size)
  if (bounds.maxX < bounds.minX || bounds.maxY < bounds.minY) return false
  return place.x >= bounds.minX && place.x <= bounds.maxX && place.y >= bounds.minY && place.y <= bounds.maxY
}

/** The pair rule: centre-to-centre, measured against the two actual sizes. */
export function canPlaceAt(places: Place[], metrics: BunchMetrics, place: Place, factorPct: number): boolean {
  if (!canPlace(metrics, place)) return false
  for (const other of places) {
    const minimum = (factorPct / 100) * ((place.size + other.size) / 2)
    if (Math.hypot(place.x - other.x, place.y - other.y) < minimum) return false
  }
  return true
}

/**
 * How many balloons fit on the board at one rung, worst case for the jitter: the lattice is counted with the
 * worst spacing each rung allows and the largest balloon the jitter can draw, so the count is a conservative
 * floor rather than a cap - a pair of smaller-than-worst balloons packs denser than the lattice counts, and
 * an unlucky seed can place fewer than it. The game asks for at most this many, so it never depends on the
 * denser pack. Only the count and the size hierarchy read the ladder; the pair rule itself does not (#33).
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

/** The biggest rung that holds `count` balloons, or the floor rung when none holds them. */
export function bunchFactor(metrics: BunchMetrics, count: number): number {
  for (const rung of spacingRungs()) {
    if (bunchCapacity(metrics, rung) >= count) return rung
  }
  return spacingRungs()[spacingRungs().length - 1] as number
}

/** The priority order of issue #33 in one answer: the rung the bunch is placed at, and how many balloons
 * the board can hold at it. */
export interface BunchPlan {
  factorPct: number
  count: number
  /** Whether the wanted bunch fits at the widest rung, which is what `bunchFitsBoard` asserts. */
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

/** The size of one balloon: up to ±6% of the nominal size, the same draw the game uses. */
export function drawSize(metrics: BunchMetrics, rng: Rng): number {
  return Math.round(metrics.balloonPx * (1 + jitter(rng)))
}

function jitter(rng: Rng): number {
  return rng.next() * 2 * LAYOUT.balloonSizeJitter - LAYOUT.balloonSizeJitter
}

/**
 * The single source of truth for the size hierarchy: as many balloons as fit at the widest rung, then the
 * biggest balloons that fit. The jitter is drawn for the whole bunch first, because the size hierarchy is
 * based on the actual sizes, and the balloons are then positioned largest first, so the biggest get the
 * spots only they can occupy. The answer is in paint order — back to front, big to small (issue #33).
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

/** Place one balloon on an existing bunch, the way celebration refills as balloons pop: a fresh size draw,
 * then one position draw, or `null` when no spot is free. */
export function placeSlot(places: Place[], metrics: BunchMetrics, rng: Rng, factorPct: number): Place | null {
  return placeOne(places, metrics, rng, drawSize(metrics, rng), factorPct)
}

/**
 * The bounded draw: one position attempt per balloon, then a fixed scan from the bottom-left corner, then
 * `null` when no spot is free. `MAX_DRAWS_PER_BALLOON` is a bounded guard, not an infinite loop, so a full
 * board answers instead of spinning.
 */
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

  // The fixed scan from the bottom-left corner is what answers when the draws are unlucky: it walks the
  // lattice `bunchCapacity` counted, so the spot the count was derived from is checked before the rule gives
  // up. It is a guard, not a promise - a balloon placed by an earlier draw can sit off the lattice and block
  // one of its points, so the rule can still answer with fewer than the count it was asked for.
  const cell = (factorPct / 100) * size * (1 + LAYOUT.balloonSizeJitter)
  for (let row = 0; bounds.minY + row * cell <= bounds.maxY; row++) {
    for (let col = 0; bounds.minX + col * cell <= bounds.maxX; col++) {
      const place = { x: bounds.minX + col * cell, y: bounds.minY + row * cell, size }
      if (canPlaceAt(places, metrics, place, factorPct)) return place
    }
  }
  return null
}
