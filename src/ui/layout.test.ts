import { describe, expect, it } from 'vitest'
import { CELEBRATION, LAYOUT } from '../game/constants'
import { computeLayout } from './layout'

/**
 * `applyLayout` needs a DOM, which the node test environment does not have (vitest.config.ts pins
 * `environment: 'node'`), so these check `computeLayout`, which is pure. They lock the SPEC §13 clauses that
 * could not both hold while the celebration was a band of its own: a 90 CSS px cell on the target device's
 * 600 CSS px height, and the panel keeping its 28-32% column. Making the party an overlay over the board is
 * what resolves the contradiction (issue #10), so the numbers are asserted here rather than in prose.
 */

const TABLET = { width: 1024, height: 600 }
const GRID = { rows: 6, cols: 6 }

describe('layout on the target tablet (SPEC §13)', () => {
  it('gives a 90 CSS px cell in landscape, which is the tap target the spec asks for', () => {
    const metrics = computeLayout(TABLET, GRID)
    expect(metrics.portrait).toBe(false)
    expect(metrics.cell).toBe(90)
    expect(metrics.tapTargetTooSmall).toBe(false)

    // Six rows of 90 need 540 of the 600 CSS px height. The board has the row the celebration no longer
    // claims, and the 60 CSS px left over is the breathing room §13 asks for.
    expect(6 * metrics.cell).toBeLessThanOrEqual(Math.floor(TABLET.height * LAYOUT.landscapeBoardFraction))
    expect(6 * metrics.cell).toBeLessThan(TABLET.height)
  })

  it('keeps the panel its column and shows the board inside what is left', () => {
    const metrics = computeLayout(TABLET, GRID)
    expect(metrics.panelWidthFraction).toBe(LAYOUT.panelWidthFraction)
    // In landscape the panel is a full-height column, so the board has the whole row: the grid's second
    // track is what the panel does not take.
    expect(metrics.panelHeightFraction).toBe(1)
    expect(6 * metrics.cell).toBeLessThanOrEqual(Math.round(TABLET.width * (1 - LAYOUT.panelWidthFraction)))

    // Every interactive element is at least 64 CSS px, and the play arrow is a tap target in its own right.
    expect(metrics.interactivePx).toBe(64)
    expect(metrics.playPx).toBeGreaterThanOrEqual(LAYOUT.tapTargetCssPx)
    // Numerals scale with the cell inside the bounds §13 gives.
    expect(metrics.levelPx).toBeGreaterThanOrEqual(metrics.goalPx)
  })

  it('sizes the party balloon from the measured board area, never below 120px (issues #25, #32)', () => {
    const landscape = computeLayout(TABLET, GRID)
    // The factors are 1.5x the ones #25 measured: min(717 x 0.195, 600 x 0.225) = 135 CSS px, which is
    // 1.5x the 90 px those factors gave on the same device.
    expect(landscape.balloonPx).toBe(135)
    expect(landscape.balloonPx).toBe(1.5 * 90)
    expect(landscape.balloonPx).toBeGreaterThanOrEqual(LAYOUT.balloonPxMin)

    // The floor is 120 px *after* the -6% jitter has been applied, so the base is 128 px: the smallest
    // balloon the jitter can draw is 120.3, still past the 90 CSS px tap target. On a phone, where the
    // factors give 66 px, the floor is what the bunch is drawn at - a bunch, not fingertip balloons.
    const phone = computeLayout({ width: 480, height: 320 }, GRID)
    expect(phone.balloonPx).toBe(Math.ceil(LAYOUT.balloonPxMin / (1 - LAYOUT.balloonSizeJitter)))
    expect(phone.balloonPx * (1 - LAYOUT.balloonSizeJitter)).toBeGreaterThanOrEqual(LAYOUT.balloonPxMin)
    expect(phone.balloonPx * (1 - LAYOUT.balloonSizeJitter)).toBeGreaterThanOrEqual(LAYOUT.tapTargetCssPx)
    expect(computeLayout({ width: 600, height: 1024 }, GRID).balloonPx).toBe(128)

    // A bigger board gets a bigger balloon: the size is derived, not fixed.
    const desktop = computeLayout({ width: 1920, height: 1080 }, GRID)
    expect(desktop.balloonPx).toBeGreaterThan(landscape.balloonPx)
  })

  it('the whole rack fits the panel without scrolling, at the measured plateau size of 35 (issue #8)', () => {
    const metrics = computeLayout(TABLET, GRID)
    // SPEC §8.2: 22-26 CSS px bubbles and 3-4 per row. The rows are the wrap, so the panel has to hold the
    // wrapped rack plus the reserved level label and the goal cards.
    expect(metrics.bubblePx).toBeGreaterThanOrEqual(LAYOUT.bubblePxMin)
    expect(metrics.bubblePx).toBeLessThanOrEqual(LAYOUT.bubblePxMax)
    expect(metrics.rackColumns).toBeGreaterThanOrEqual(LAYOUT.rackColumnsMin)
    expect(metrics.rackColumns).toBeLessThanOrEqual(LAYOUT.rackColumnsMax)

    const gap = Math.round(metrics.bubblePx * 0.25)
    const rackHeight = Math.ceil(35 / metrics.rackColumns) * (metrics.bubblePx + gap)
    const reserved = metrics.interactivePx + metrics.goalPx + 40
    expect(rackHeight + reserved).toBeLessThanOrEqual(TABLET.height)
  })

  it('in portrait the panel is the row above the board and the board stays square (issue #19)', () => {
    const portrait = computeLayout({ width: 600, height: 1024 }, GRID)
    expect(portrait.portrait).toBe(true)
    expect(portrait.panelWidthFraction).toBe(1)
    expect(portrait.panelHeightFraction).toBeCloseTo(1 - LAYOUT.portraitBoardFraction, 10)

    // The board is square: six columns of the same cell as six rows, inside the share it is given.
    expect(6 * portrait.cell).toBeLessThanOrEqual(Math.floor(1024 * LAYOUT.portraitBoardFraction))
    expect(6 * portrait.cell).toBeLessThanOrEqual(600)
    expect(portrait.cell).toBeGreaterThanOrEqual(LAYOUT.tapTargetCssPx)

    // Goals and rack are all reachable without scrolling: the panel row has the height the wrapped rack,
    // the level label and the two goal cards take. Issue #19's "two lines" is what the early levels look
    // like; the measured plateau rack of 35 wraps to more rows than that in either orientation.
    const gap = Math.round(portrait.bubblePx * 0.25)
    const rackHeight = Math.ceil(35 / portrait.rackColumns) * (portrait.bubblePx + gap)
    const panelRow = Math.floor(1024 * (1 - LAYOUT.portraitBoardFraction))
    expect(rackHeight + portrait.interactivePx + portrait.goalPx + 40).toBeLessThanOrEqual(panelRow)
  })

  it('keeps the whole board inside the viewport in portrait, its padding included (issue #19)', () => {
    // The board was sized from the board's share without charging `.board-area`'s padding, so on a 600x1024
    // viewport it painted 11 CSS px below the page and the bottom row of tiles was cut off. The share is the
    // board's whole area now, and the padding comes out of it before the cell is chosen.
    for (const viewport of [
      { width: 600, height: 1024 },
      { width: 800, height: 1280 },
      { width: 834, height: 1112 },
    ]) {
      const metrics = computeLayout(viewport, GRID)
      const areaHeight = viewport.height - metrics.panelRowPx
      expect(metrics.portrait).toBe(true)
      expect(metrics.boardFitsArea).toBe(true)
      expect(metrics.cell).toBeGreaterThanOrEqual(LAYOUT.tapTargetCssPx)

      // Centre the board in its row: the margin left over is the padding plus a remainder, so the board is
      // fully visible at both ends rather than flush against one and past the other.
      const margin = (areaHeight - metrics.boardPx) / 2
      expect(margin).toBeGreaterThanOrEqual(LAYOUT.chrome.boardAreaPaddingPx - 1)
      expect(metrics.boardPx + 2 * LAYOUT.chrome.boardAreaPaddingPx).toBeLessThanOrEqual(areaHeight)
    }
  })

  it('flags a device smaller than the spec assumes rather than shrinking the target', () => {
    const small = computeLayout({ width: 480, height: 320 }, GRID)
    expect(small.cell).toBeLessThan(LAYOUT.tapTargetCssPx)
    expect(small.tapTargetTooSmall).toBe(true)
    expect(small.cell).toBeGreaterThanOrEqual(LAYOUT.cellMinPx)
  })
})

/**
 * Issue #10's acceptance criteria are numbers, so they are asserted as numbers: the panel has to show the
 * level label, both goal cards and a whole rack at once without scrolling, the board has to be the dominant
 * half, and nothing in the shell may be a fixed pixel layout. `LAYOUT.chrome` is the stylesheet's own chrome
 * mirrored, so these are the same measurements `style.css` makes (styles.test.ts compares the mirror).
 */
describe('the panel shows everything at once (SPEC §8.2, §13, issue #10)', () => {
  it('holds the level label, both goal cards and the whole rack in the panel column', () => {
    const metrics = computeLayout(TABLET, GRID)

    // ADR 0001 sizes the rack from the measurement, 35, which is where §9.1's ramp tops out. In landscape the
    // rack keeps §8.2's 3-4 per row, so at 4 per row that is 9 wrapped rows.
    expect(metrics.rackBubbles).toBe(LAYOUT.rackSizingBubbles)
    expect(metrics.rackRows).toBe(Math.ceil(LAYOUT.rackSizingBubbles / metrics.rackColumns))
    // 574 - 180 - 16 for the rack's own padding, in rows of 29: thirteen rows fit where nine are needed.
    expect(metrics.rackRowsFit).toBe(13)
    expect(metrics.rackRowsFit).toBeGreaterThanOrEqual(metrics.rackRows)
    expect(metrics.rackRowsFit * metrics.rackColumns).toBeGreaterThanOrEqual(LAYOUT.rackSizingBubbles)
    expect(metrics.rackFitsPanel).toBe(true)

    // The fit is charged against the panel row inside its padding, not against the page: 600 - 26, with the
    // level label's reserved place and two goal card rows taken before the rack is allowed any.
    expect(metrics.panelColumnPx).toBe(307)
    expect(metrics.panelContentPx).toBe(574)
    expect(metrics.panelChromePx).toBe(LAYOUT.interactiveMinPx + 2 * goalCardRowPxFor(metrics.goalPx))

    // The headroom is the spare rows, which is what keeps the panel from clipping a rack at the plateau.
    const headroom = metrics.panelContentPx - metrics.panelChromePx - metrics.rackHeightPx
    expect(headroom).toBeGreaterThanOrEqual(3 * (metrics.bubblePx + LAYOUT.chrome.rackRowPx))
  })

  it('the same fit holds at the measured plateau, which is what ADR 0001 sizes for (issue #8)', () => {
    const metrics = computeLayout(TABLET, GRID)
    const plateauRows = Math.ceil(35 / metrics.rackColumns)
    expect(plateauRows).toBeLessThanOrEqual(metrics.rackRowsFit)
    expect(plateauRows).toBe(9)
  })

  it('the goal cards fit side by side when the panel is wide enough, which is the room the model gives up', () => {
    // The fit above is the pessimistic case, two stacked card rows. Charged as one row instead, the panel
    // has room to spare on the target device, so the criterion holds whichever way the cards sit (issue #19).
    const metrics = computeLayout(TABLET, GRID)
    const oneRow = metrics.panelContentPx - metrics.panelChromePx - goalCardRowPxFor(metrics.goalPx)
    expect(metrics.rackHeightPx + LAYOUT.interactiveMinPx + goalCardRowPxFor(metrics.goalPx)).toBeLessThanOrEqual(metrics.panelContentPx)
    expect(oneRow).toBeGreaterThan(metrics.rackHeightPx)
  })

  it('in portrait the rack is §13\'s band across the panel width, and the sized rack fits the panel row (ADR 0001)', () => {
    const portrait = computeLayout({ width: 600, height: 1024 }, GRID)

    // The panel row on a 600x1024 viewport is 430 CSS px (0.42 of the height; the board takes the rest, with
    // its own padding charged inside that share). The level label plus two goal cards take 180 of it, leaving
    // 208 for the rack. Sized from the measurement rather than the pre-measurement guess, and laid out as §13's
    // horizontal band, it needs 3 rows of the 6 those measurements allow - so this is the criterion holding,
    // not a shortfall reported against it.
    const bandWidth = 600 - 2 * LAYOUT.chrome.panelPaddingXPx - LAYOUT.chrome.rackMarginPx - 2 * LAYOUT.chrome.rackPaddingXPx
    const rackRowPx = portrait.bubblePx + LAYOUT.chrome.rackRowPx
    expect(bandWidth).toBe(532)
    expect(portrait.rackColumns).toBe(17)
    expect(portrait.rackColumns * rackRowPx).toBeLessThanOrEqual(bandWidth)
    expect(portrait.rackRows).toBe(3)
    expect(portrait.rackRowsFit).toBe(6)
    expect(portrait.rackFitsPanel).toBe(true)

    // An early level is one row of the band plus a second: level 1 starts at 12 bubbles (SPEC §9.1).
    expect(Math.ceil(12 / portrait.rackColumns)).toBeLessThanOrEqual(portrait.rackRowsFit)

    // And what the band shows is inside the panel: it keeps its reserved place and its cards.
    expect(portrait.rackRows * rackRowPx + 2 * LAYOUT.chrome.rackPaddingPx + portrait.panelChromePx)
      .toBeLessThanOrEqual(portrait.panelContentPx)
  })
})

describe('the board is the dominant half (SPEC §13, issue #10)', () => {
  it('takes the larger share of the page in both orientations', () => {
    const landscape = computeLayout(TABLET, GRID)
    const portrait = computeLayout({ width: 600, height: 1024 }, GRID)

    // The celebration is an overlay over the board (issue #12), so it claims no share here and the board's
    // share is the whole page less the panel's.
    expect(landscape.boardAreaFraction).toBeGreaterThan(landscape.panelAreaFraction)
    expect(portrait.boardAreaFraction).toBeGreaterThan(portrait.panelAreaFraction)

    // The board box itself is bigger than the panel box in landscape, and the cell is bigger than every
    // numeral and bubble it scales.
    expect(landscape.boardPx).toBeGreaterThan(landscape.panelColumnPx)
    for (const metrics of [landscape, portrait]) {
      expect(metrics.cell).toBeGreaterThanOrEqual(metrics.levelPx)
      expect(metrics.cell).toBeGreaterThanOrEqual(metrics.goalPx)
      expect(metrics.cell).toBeGreaterThanOrEqual(metrics.bubblePx)
    }
  })

  it('keeps the panel its 28-32% column and the board inside the area the fractions give it', () => {
    const metrics = computeLayout(TABLET, GRID)
    expect(metrics.panelWidthFraction * TABLET.width).toBeGreaterThanOrEqual(0.28 * TABLET.width)
    expect(metrics.panelWidthFraction * TABLET.width).toBeLessThanOrEqual(0.32 * TABLET.width)
    expect(metrics.boardFitsArea).toBe(true)

    // The board is centred inside its area, so what the cell does not use is the margin §13 asks for.
    expect(TABLET.height - metrics.boardPx).toBeGreaterThanOrEqual(2 * LAYOUT.chrome.boardAreaPaddingPx)
  })
})

describe('the bunch geometry layout owns (SPEC §10.1, issue #32)', () => {
  it('reports the board\'s offset inside the overlay, not the overlay\'s size', () => {
    // `.board-area` centres the board inside its padding box, and the celebration overlay *is* that padding
    // box, so a place inside the board is not a place inside the overlay. On the target tablet the board
    // starts 16 px of padding plus half the 145 px of horizontal slack the cell does not use.
    const metrics = computeLayout(TABLET, GRID)
    expect(metrics.boardOffsetXPx).toBe(89)
    expect(metrics.boardOffsetYPx).toBe(30)

    // The two offsets are the slack shared between the two sides, so the board is inside the overlay at both
    // ends rather than flush against one: the padding plus half the slack inside the content box, which is a
    // half pixel on the tablet and therefore rounded - so the check is within the rounding it is allowed.
    const slackX = Math.round(TABLET.width * (1 - LAYOUT.panelWidthFraction)) - 2 * LAYOUT.chrome.boardAreaPaddingPx - metrics.boardPx
    const slackY = TABLET.height - 2 * LAYOUT.chrome.boardAreaPaddingPx - metrics.boardPx
    expect(Math.abs(2 * (metrics.boardOffsetXPx - LAYOUT.chrome.boardAreaPaddingPx) - slackX)).toBeLessThanOrEqual(1)
    expect(Math.abs(2 * (metrics.boardOffsetYPx - LAYOUT.chrome.boardAreaPaddingPx) - slackY)).toBeLessThanOrEqual(1)

    // The same measurement on a portrait turn, where the board is 558 px inside a 600 px row.
    const portrait = computeLayout({ width: 600, height: 1024 }, GRID)
    expect(portrait.boardOffsetXPx).toBe(21)
    expect(portrait.boardOffsetYPx).toBe(18)
  })

  it('keeps the arrow\'s band inside the offsets, from the same margin constant', () => {
    // The band is `.celebration`'s `padding-bottom` (4% of the overlay's width), plus the arrow's own box,
    // plus the same `balloonMarginPx` the balloon keep-out uses - there is no second spacing constant for it.
    const metrics = computeLayout(TABLET, GRID)
    const bandPx = Math.ceil((LAYOUT.celebrationBottomPaddingPct / 100) * Math.round(TABLET.width * (1 - LAYOUT.panelWidthFraction)))
    expect(LAYOUT.celebrationBottomPaddingPct).toBe(4)
    expect(bandPx).toBe(29)
    expect(metrics.arrowBandPx - metrics.playPx - LAYOUT.balloonMarginPx).toBe(Math.max(0, bandPx - metrics.boardOffsetYPx))
    // On the tablet the band is shallower than the board's offset, so the arrow sits below the board's
    // bottom edge and the band contributes nothing: the no-go line is the arrow box plus the margin. The
    // arrow cannot be smaller than the tap target, so `playPx` is 90 here even though the cell is 90.
    expect(metrics.arrowBandPx).toBe(106)

    // On a phone the board is clamped past its area, so the offset is 0 and the band is measured whole:
    // 14 px of padding, the 90 px tap target the arrow cannot be smaller than, and the same 16 px.
    const phone = computeLayout({ width: 480, height: 320 }, GRID)
    expect(phone.boardOffsetYPx).toBe(0)
    expect(phone.arrowBandPx).toBe(120)
  })

  it('holds twelve balloons at the target spacing on the tablet and reports the phone as not holding them', () => {
    // The fit is the worst-case lattice the placement rule samples inside: at 55% of the largest jittered
    // balloon, the tablet has five lattice columns and five rows - twenty centres for twelve balloons - while
    // a phone has three by three, which is what makes the count drop there rather than the size (issue #33).
    const tablet = computeLayout(TABLET, GRID)
    expect(tablet.bunchFitsBoard).toBe(true)
    const phone = computeLayout({ width: 480, height: 320 }, GRID)
    expect(phone.bunchFitsBoard).toBe(false)

    // A portrait turn keeps the fit: the board is 558 px, so the lattice is six by five.
    expect(computeLayout({ width: 600, height: 1024 }, GRID).bunchFitsBoard).toBe(true)

    // The keep-out is what makes the two disagree, so it is asserted as numbers rather than as a claim:
    // half the largest jittered balloon, the float amplitude, and `balloonMarginPx` on each side.
    const jitterMax = 1 + LAYOUT.balloonSizeJitter
    const halfMaxPx = (tablet.balloonPx * jitterMax) / 2
    expect(halfMaxPx + CELEBRATION.balloonSwayPx + LAYOUT.balloonMarginPx).toBeCloseTo(94.55, 2)
    const usableWidthPx = tablet.boardPx - 2 * (halfMaxPx + CELEBRATION.balloonSwayPx + LAYOUT.balloonMarginPx)
    const usableHeightPx = tablet.boardPx - (halfMaxPx + CELEBRATION.balloonBobPx + LAYOUT.balloonMarginPx) - tablet.arrowBandPx
    const latticeCellPx = LAYOUT.balloonSpacingFactor * tablet.balloonPx * jitterMax
    expect(Math.floor(usableWidthPx / latticeCellPx) + 1).toBe(5)
    expect(Math.floor(usableHeightPx / latticeCellPx) + 1).toBe(5)

    // And the ladder's order is what the criterion reads: size holds first (the phone is at the floor),
    // spacing tightens before the count, and the count only drops when the floor rung cannot hold the set.
    expect(phone.balloonPx).toBe(Math.ceil(LAYOUT.balloonPxMin / (1 - LAYOUT.balloonSizeJitter)))
    expect(LAYOUT.balloonSpacingFactor).toBe(0.55)
    expect(LAYOUT.balloonMinExposure).toBeLessThan(LAYOUT.balloonSpacingFactor)
  })
})

describe('nothing is a fixed pixel layout, and a too-small device is flagged (SPEC §13, issue #10)', () => {
  const viewports = [
    { width: 1024, height: 600 }, // the target tablet
    { width: 1024, height: 726 }, // the Chrome UI hidden, which gives the board more height
    { width: 1024, height: 620 }, // the Chrome UI part-shown
    { width: 1024, height: 552 }, // the Chrome UI taking a band: below the target tap size
    { width: 480, height: 320 }, // a phone, smaller than the spec assumes
    { width: 600, height: 1024 }, // portrait
  ]

  it('gives the target cell or flags the device, never both a shrunken board and a silent flag', () => {
    for (const viewport of viewports) {
      const metrics = computeLayout(viewport, GRID)
      expect(metrics.tapTargetTooSmall).toBe(metrics.cell < LAYOUT.tapTargetCssPx)

      // The board only runs past its area where `cellMinPx` clamps a device the flag already reports.
      expect(metrics.boardFitsArea || metrics.tapTargetTooSmall).toBe(true)

      // Every size is derived from the viewport inside the bounds, so a bigger screen gets a bigger cell.
      const bigger = computeLayout({ width: viewport.width, height: viewport.height + 120 }, GRID)
      expect(bigger.cell).toBeGreaterThanOrEqual(metrics.cell)
    }
  })

  it('holds the rack inside the panel on every device that gets the target cell, in landscape', () => {
    for (const viewport of viewports) {
      const metrics = computeLayout(viewport, GRID)
      // The band is what makes portrait fit at the target size; a device below §13's assumed size is still
      // the case the flag reports rather than a layout that can be fixed here.
      if (metrics.cell >= LAYOUT.tapTargetCssPx) expect(metrics.rackFitsPanel).toBe(true)
    }

    // The phone is smaller than the places the panel has to hold, which is the same fact the flag reports:
    // the rack is clipped there rather than scrolled, and no layout can make 35 bubbles fit 294 CSS px.
    const phone = computeLayout({ width: 480, height: 320 }, GRID)
    expect(phone.rackFitsPanel).toBe(false)
    expect(phone.panelContentPx).toBeLessThan(phone.panelChromePx + phone.rackHeightPx)
  })
})

/** A goal card row, the ring being taller than the numeral inside it (SPEC §8.1). */
function goalCardRowPxFor(goalPx: number): number {
  return Math.max(LAYOUT.chrome.goalRingPx, goalPx) + 2 * LAYOUT.chrome.goalPaddingPx
}

