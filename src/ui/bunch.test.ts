import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CELEBRATION, LAYOUT, MAX_BALLOONS } from '../game/constants'
import { createRng } from '../game/rng'
import {
  bunchCapacity,
  bunchFactor,
  bunchPlan,
  canPlace,
  canPlaceAt,
  drawSize,
  placeBunch,
  placeSlot,
  spacingRungs,
  type BunchMetrics,
  type Place,
} from './bunch'
import { bunchMetricsFor, computeLayout } from './layout'

/**
 * Issue #33: `ui/bunch.ts` is the placement rule, and the rule is what the acceptance criteria are read
 * against. It takes a board and an `Rng` and answers with places, so it can be held to every clause
 * without mounting a DOM - which is what makes the phone case testable at all, since the phone is where
 * the rule runs out of board.
 *
 * A place is a centre, measured from the board's left and bottom edges, and the sizes are the actual
 * jittered ones, never the nominal `--balloon-px` (SPEC §10.1). The numbers below are computed from the
 * constants the rule reads, so they cannot drift from it.
 */

const SRC = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(SRC, 'bunch.ts'), 'utf8')

const GRID = { rows: 6, cols: 6 }
const TABLET = computeLayout({ width: 1024, height: 600 }, GRID)
const PHONE = computeLayout({ width: 320, height: 480 }, GRID)
const PORTRAIT = computeLayout({ width: 600, height: 1024 }, GRID)

const TABLET_BOARD = bunchMetricsFor(TABLET.boardPx, TABLET.balloonPx, TABLET.arrowBandPx)
const PHONE_BOARD = bunchMetricsFor(PHONE.boardPx, PHONE.balloonPx, PHONE.arrowBandPx)
const PORTRAIT_BOARD = bunchMetricsFor(PORTRAIT.boardPx, PORTRAIT.balloonPx, PORTRAIT.arrowBandPx)

/** The worst case the jitter can draw, which is the size the count is held to (issue #33). */
const WORST = 1 + LAYOUT.balloonSizeJitter

/** What the rule reserves on a device, computed from the constants rather than from `bunch.ts`. */
function regionFor(board: BunchMetrics, size: number): { halfX: number; topY: number; bottomY: number } {
  const halfBoxPx = (size * LAYOUT.balloonHeightRatio) / 2
  return {
    halfX: size / 2 + LAYOUT.balloonMarginPx + CELEBRATION.balloonSwayPx,
    topY: halfBoxPx + LAYOUT.balloonMarginPx + CELEBRATION.balloonBobPx,
    bottomY: board.arrowBandPx + halfBoxPx + CELEBRATION.balloonBobPx,
  }
}

describe('the ladder is derived from the constants, not typed as a list (issue #33)', () => {
  it('walks the target spacing down to the exposure floor in steps of the step constant', () => {
    const rungs = spacingRungs()
    expect(rungs).toEqual([55, 50, 45, 40])
    // The rung is the percent the constant names, rounded: 0.55 x 100 is 55.00000000000001, and a ladder
    // that drifted by a float would read a rung the constants do not name.
    expect(rungs[0]).toBe(Math.round(LAYOUT.balloonSpacingFactor * 100))
    expect(rungs[rungs.length - 1]).toBe(Math.round(LAYOUT.balloonMinExposure * 100))
    for (let i = 1; i < rungs.length; i++) {
      expect(rungs[i] as number).toBe((rungs[i - 1] as number) - LAYOUT.balloonSpacingStepPct)
    }

    // The list is derived, so the source does not hold it as a literal.
    expect(source).not.toMatch(/\[\s*55,\s*50/)
  })

  it('the floor is below the target spacing, which is what makes the ladder tighten before the count drops', () => {
    expect(LAYOUT.balloonMinExposure).toBeLessThan(LAYOUT.balloonSpacingFactor)
    expect(bunchFactor(TABLET_BOARD, 1)).toBe(Math.round(LAYOUT.balloonSpacingFactor * 100))
    // The floor rung holds more than the target rung does, so a bunch that cannot be held at 55% gets
    // tighter spacing before it loses balloons.
    expect(bunchCapacity(TABLET_BOARD, LAYOUT.balloonMinExposure * 100)).toBeGreaterThan(
      bunchCapacity(TABLET_BOARD, LAYOUT.balloonSpacingFactor * 100),
    )
  })
})

describe('the whole region has to be inside the board, not the centre (issue #33)', () => {
  it('places every balloon on the tablet with its margin box inside, amplitudes reserved', () => {
    const places = placeBunch(TABLET_BOARD, createRng(7), MAX_BALLOONS)
    expect(places.length).toBeGreaterThan(0)
    for (const place of places) {
      const region = regionFor(TABLET_BOARD, place.size)
      expect(place.x).toBeGreaterThanOrEqual(region.halfX)
      expect(place.x).toBeLessThanOrEqual(TABLET_BOARD.boardWidthPx - region.halfX)
      expect(place.y).toBeGreaterThanOrEqual(region.bottomY)
      expect(place.y).toBeLessThanOrEqual(TABLET_BOARD.boardHeightPx - region.topY)
    }
  })

  it('refuses a centre that is inside while the box is not', () => {
    // The same centre on the tablet: 40 px inside on the left, so the balloon itself hangs past the edge.
    const inside = { x: 40, y: 300, size: TABLET.balloonPx }
    expect(canPlace(TABLET_BOARD, inside)).toBe(false)
    const justInside = { x: regionFor(TABLET_BOARD, TABLET.balloonPx).halfX, y: 300, size: TABLET.balloonPx }
    expect(canPlace(TABLET_BOARD, justInside)).toBe(true)
  })

  it('keeps no part of the box in the play arrow band', () => {
    const region = regionFor(TABLET_BOARD, TABLET.balloonPx)
    const onTheLine = { x: 270, y: region.bottomY, size: TABLET.balloonPx }
    expect(canPlace(TABLET_BOARD, onTheLine)).toBe(true)
    // Half the box plus the bob is what dips into the band, so the rule refuses it.
    expect(canPlace(TABLET_BOARD, { x: 270, y: region.bottomY - 1, size: TABLET.balloonPx })).toBe(false)
  })

  it('the bottom edge is open at spawn, so the only bottom rule is the band', () => {
    const region = regionFor(TABLET_BOARD, TABLET.balloonPx)
    // A balloon that would sit below the top-edge reserve, but still clear of the band: the rule takes it,
    // because the balloons start below the board and rise through it.
    expect(canPlace(TABLET_BOARD, { x: 270, y: region.bottomY + 1, size: TABLET.balloonPx })).toBe(true)
  })

  it('the 40% floor governs an edge when the board is smaller than a region (issue #33)', () => {
    // A board too small to reserve the margin box: the rule cannot promise the margin, so the exposure
    // floor is what the edge is read against, and the balloon sticks out as the responsive board already
    // does on a small phone. `cellMinPx` means today's devices never reach this, so the board is built.
    // It still has to be tall enough for the arrow band plus the box, otherwise the band alone refuses the
    // whole board and the floor never gets a chance to govern.
    const small = { boardWidthPx: 150, boardHeightPx: 170, balloonPx: LAYOUT.balloonPxMin, arrowBandPx: 30 }
    const floor = LAYOUT.balloonMinExposure * LAYOUT.balloonPxMin
    const halfBoxPx = (LAYOUT.balloonPxMin * LAYOUT.balloonHeightRatio) / 2
    const bandY = small.arrowBandPx + halfBoxPx + CELEBRATION.balloonBobPx
    // The board is smaller than the region, so the floor is what governs both edges.
    expect(regionFor(small, LAYOUT.balloonPxMin).halfX).toBeGreaterThan(floor)
    expect(regionFor(small, LAYOUT.balloonPxMin).topY).toBeGreaterThan(floor)
    expect(canPlace(small, { x: floor, y: bandY, size: LAYOUT.balloonPxMin })).toBe(true)
    expect(canPlace(small, { x: floor - 1, y: bandY, size: LAYOUT.balloonPxMin })).toBe(false)
    // The board cannot give the region, so the edge is read against the floor, which is nearer the edge than
    // the region is: the balloon hangs past the border, as the responsive board already does on a phone.
    const topEdge = small.boardHeightPx - floor
    expect(topEdge).toBeGreaterThan(small.boardHeightPx - regionFor(small, LAYOUT.balloonPxMin).topY)
    expect(canPlace(small, { x: 75, y: topEdge, size: LAYOUT.balloonPxMin })).toBe(true)
    expect(canPlace(small, { x: 75, y: topEdge + 1, size: LAYOUT.balloonPxMin })).toBe(false)
  })
})

describe('the pair rule is centre-to-centre, against the actual sizes (issue #33)', () => {
  it('takes a pair the per-axis reading of the same sentence would refuse', () => {
    // 44 px apart on x, 60 on y: under the per-axis reading the x gap alone is below the rung, under the
    // Euclidean reading SPEC §10.1 uses the pair is at 74.4 px, past 55% of two nominal balloons.
    const board = TABLET_BOARD
    const a: Place = { x: 100, y: 200, size: TABLET.balloonPx }
    const b: Place = { x: 144, y: 260, size: TABLET.balloonPx }
    const rung = LAYOUT.balloonSpacingFactor * 100
    expect(Math.abs(b.x - a.x)).toBeLessThan((rung / 100) * TABLET.balloonPx)
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThanOrEqual((rung / 100) * TABLET.balloonPx)
    expect(canPlaceAt([a], board, b, rung)).toBe(true)
  })

  it('measures the pair against the two actual sizes, so a jittered pair tightens or widens with them', () => {
    const rung = LAYOUT.balloonSpacingFactor * 100
    const small = { x: 120, y: 240, size: Math.round(TABLET.balloonPx * (1 - LAYOUT.balloonSizeJitter)) }
    // Two sizes at the extremes of the jitter: 6% on one balloon moves the required distance by 6% of half
    // the pair, which is what the issue means by "never the nominal size".
    const mean = (small.size + TABLET.balloonPx) / 2
    const required = (rung / 100) * mean
    const near = { x: small.x + required - 0.5, y: small.y, size: TABLET.balloonPx }
    expect(canPlaceAt([small], TABLET_BOARD, near, rung)).toBe(false)
    const far = { x: small.x + required, y: small.y, size: TABLET.balloonPx }
    expect(canPlaceAt([small], TABLET_BOARD, far, rung)).toBe(true)
  })

  it('the exposure floor is the last rung, and no pair may break it', () => {
    const floor = LAYOUT.balloonMinExposure * 100
    const pair = [{ x: 120, y: 240, size: TABLET.balloonPx }]
    const required = (floor / 100) * TABLET.balloonPx
    expect(canPlaceAt(pair, TABLET_BOARD, { x: 120 + required, y: 240, size: TABLET.balloonPx }, floor)).toBe(true)
    expect(canPlaceAt(pair, TABLET_BOARD, { x: 120 + required - 1, y: 240, size: TABLET.balloonPx }, floor)).toBe(false)
  })
})

describe('the priority order: size first, then spacing, then count (issue #33)', () => {
  it('counts the lattice with the worst jittered size, so the count never promises more than the rule can place', () => {
    // The count is recomputed here from the constants rather than from `bunch.ts`, which is what makes it a
    // check on the rule: the rung is charged against the largest balloon the jitter can draw, and the region
    // is charged as the rule charges it.
    const worstPx = TABLET_BOARD.balloonPx * WORST
    const halfBoxPx = (worstPx * LAYOUT.balloonHeightRatio) / 2
    const cell = (55 / 100) * worstPx
    const cols = Math.floor((TABLET_BOARD.boardWidthPx - 2 * (worstPx / 2 + LAYOUT.balloonMarginPx + CELEBRATION.balloonSwayPx)) / cell) + 1
    const rows =
      Math.floor(
        (TABLET_BOARD.boardHeightPx -
          (halfBoxPx + LAYOUT.balloonMarginPx + CELEBRATION.balloonBobPx) -
          (TABLET_BOARD.arrowBandPx + halfBoxPx + CELEBRATION.balloonBobPx)) /
          cell,
      ) + 1
    expect(cols).toBe(5)
    expect(rows).toBe(3)
    expect(bunchCapacity(TABLET_BOARD, 55)).toBe(cols * rows)

    // Every spot the lattice counts is a spot the pair rule accepts, so the game can ask for that many and
    // the rule answers with them: the count is a floor the rule keeps, not a promise it can break.
    expect(placeBunch(TABLET_BOARD, createRng(7), MAX_BALLOONS).length).toBe(MAX_BALLOONS)
    // It is a floor and not a cap: a bunch of smaller-than-worst balloons packs denser than the lattice
    // counts, so an ask above the count can still be placed. The game caps the ask at the count, so it never
    // depends on the denser pack.
    expect(bunchCapacity(PHONE_BOARD, 40)).toBe(4)
    expect(placeBunch(PHONE_BOARD, createRng(5), MAX_BALLOONS).length).toBe(6)
  })

  it('counts the tablet as holding twelve at the target rung, so the bunch keeps the target spacing', () => {
    expect(bunchCapacity(TABLET_BOARD, 55)).toBe(15)
    expect(bunchPlan(TABLET_BOARD, MAX_BALLOONS)).toEqual({ factorPct: 55, count: MAX_BALLOONS, fits: true })
    expect(bunchPlan(TABLET_BOARD, MAX_BALLOONS).fits).toBe(TABLET.bunchFitsBoard)
  })

  it('counts what the phone can hold and drops to the rung that holds it, which is the floor rung', () => {
    // The phone cannot hold twelve at any rung, so the count is what fits and the ladder lands on the rung
    // that holds it. The rule answers the count it can place, not the count the game asked for.
    const ladder = spacingRungs().map((rung) => bunchCapacity(PHONE_BOARD, rung))
    expect(ladder).toEqual([3, 3, 3, 4])
    const plan = bunchPlan(PHONE_BOARD, MAX_BALLOONS)
    expect(plan.count).toBe(4)
    expect(plan.factorPct).toBe(40)
    expect(plan.count).toBeLessThan(MAX_BALLOONS)

    // What the game asks for on a level with four bubbles left: three fit at 50%, four only at the floor,
    // so this is the ladder tightening before the count - and the four it places are the four biggest.
    const places = placeBunch(PHONE_BOARD, createRng(7), 4)
    expect(places.length).toBe(4)
    const rung = bunchFactor(PHONE_BOARD, 4)
    // Every pair, each read against the other places only: a place is never held against itself.
    expect(places.every((place) => canPlaceAt(places.filter((other) => other !== place), PHONE_BOARD, place, rung))).toBe(true)
    expect(rung).toBe(Math.round(LAYOUT.balloonMinExposure * 100))
  })

  it('holds the portrait turn at the target rung, and the phone reads as not holding them (issue #32)', () => {
    expect(bunchCapacity(PORTRAIT_BOARD, 55)).toBe(24)
    expect(PORTRAIT.bunchFitsBoard).toBe(true)
    expect(PHONE.bunchFitsBoard).toBe(false)
    // Size holds first on the phone: the balloon is at the floor, and the rule still places it.
    expect(PHONE.balloonPx).toBe(Math.ceil(LAYOUT.balloonPxMin / (1 - LAYOUT.balloonSizeJitter)))
  })

  it('draws the jitter for the whole bunch before positioning, and paints big to small', () => {
    const places = placeBunch(TABLET_BOARD, createRng(11), MAX_BALLOONS)
    const sizes = places.map((place) => place.size)
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a))
    // Back to front, big to small: the biggest balloons got the spots only they could occupy.
    expect(sizes[0]).toBeGreaterThan(sizes[sizes.length - 1] as number)
  })
})

describe('the draws are bounded and deterministic (issue #33)', () => {
  it('the same seed answers the same places', () => {
    const first = placeBunch(TABLET_BOARD, createRng(42), MAX_BALLOONS)
    const second = placeBunch(TABLET_BOARD, createRng(42), MAX_BALLOONS)
    expect(first).toEqual(second)
    expect(first.length).toBeGreaterThan(0)
    // Every place is drawn from the injected Rng, so the size and the centre come from one stream.
    // These are the sizes seed 42 draws on the target tablet, recorded from the rule: 135 px nominal,
    // each within the ±6% the jitter constant allows.
    const sizes = drawSizes(TABLET_BOARD, 4)
    expect(sizes).toEqual([137, 134, 141, 138])
    for (const size of sizes) {
      expect(size).toBeGreaterThanOrEqual(Math.round(TABLET.balloonPx * (1 - LAYOUT.balloonSizeJitter)))
      expect(size).toBeLessThanOrEqual(Math.round(TABLET.balloonPx * (1 + LAYOUT.balloonSizeJitter)))
    }
  })

  it('answers when the board is full instead of spinning', () => {
    // A board that holds one balloon at the target rung: the second draw has no spot, and the bounded
    // guard is what answers rather than the loop.
    const board = { boardWidthPx: 200, boardHeightPx: 220, balloonPx: LAYOUT.balloonPxMin, arrowBandPx: 20 }
    const first = placeSlot([], board, createRng(5), LAYOUT.balloonSpacingFactor * 100)
    expect(first).not.toBeNull()
    expect(bunchCapacity(board, LAYOUT.balloonSpacingFactor * 100)).toBe(1)
    expect(placeSlot([first as Place], board, createRng(6), LAYOUT.balloonSpacingFactor * 100)).toBeNull()
  })

  it('refills one slot at a time, so a popped balloon frees its own spot', () => {
    const places = placeBunch(TABLET_BOARD, createRng(3), 4)
    const freed = places.slice(1)
    const next = placeSlot(freed, TABLET_BOARD, createRng(9), 55)
    expect(next).not.toBeNull()
    expect(canPlaceAt(freed, TABLET_BOARD, next as Place, 55)).toBe(true)
  })

  it('is a rule, not a renderer: no DOM, and no random outside the injected Rng (issue #33)', () => {
    expect(source).not.toMatch(/document\.|window\.|getBoundingClientRect/)
    expect(source).not.toContain('Math.random')
    expect(source).toContain('LAYOUT.balloonSpacingFactor')
    expect(source).toContain('LAYOUT.balloonMinExposure')
    expect(source).toContain('LAYOUT.balloonMarginPx')
    expect(source).toContain('LAYOUT.balloonHeightRatio')
    expect(source).toContain('CELEBRATION.balloonSwayPx')
    expect(source).toContain('CELEBRATION.balloonBobPx')
  })
})

/** The sizes `placeBunch` draws for a bunch, from the same stream the rule reads. */
function drawSizes(board: BunchMetrics, count: number): number[] {
  const rng = createRng(42)
  const sizes: number[] = []
  for (let i = 0; i < count; i++) sizes.push(drawSize(board, rng))
  return sizes
}
