import { describe, expect, it } from 'vitest'
import { LAYOUT } from '../game/constants'
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
  it('holds the level label, both goal cards and a full rack of 39 in the panel column', () => {
    const metrics = computeLayout(TABLET, GRID)

    // SPEC §8.2 sizes the rack for up to 39 bubbles, above the measured plateau of 35, so the whole rack is
    // visible at once rather than scrolled. At 4 per row that is 10 wrapped rows.
    expect(metrics.rackBubbles).toBe(LAYOUT.rackSizingBubbles)
    expect(metrics.rackRows).toBe(Math.ceil(LAYOUT.rackSizingBubbles / metrics.rackColumns))
    // 574 - 180 - 16 for the rack's own padding, in rows of 29: thirteen rows fit where ten are needed.
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

  it('the rack also fits at the measured plateau of 35, the size the earlier test asserted (issue #8)', () => {
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

  it('in portrait the panel row cannot hold the whole measured rack, so the rack is clipped rather than scrolled', () => {
    const portrait = computeLayout({ width: 600, height: 1024 }, GRID)
    // SPEC §13's portrait clause ("wrap to 2 rows if needed") was written before the rack was measured: a
    // 600x1024 panel row is 461 CSS px, and the level label plus two cards leaves 239 for the rack, which is
    // 7 rows of the 10 the plateau needs. The panel does not scroll, so the rack stops there - this is the
    // one criterion that can only be closed on the device, and it is reported rather than asserted away.
    expect(portrait.rackRowsFit).toBe(7)
    expect(portrait.rackFitsPanel).toBe(false)
    // An early level's rack still fits at once, which is what §13's two lines meant: level 1 starts at 12
    // bubbles (SPEC §9.1), three rows of four.
    expect(Math.ceil(12 / portrait.rackColumns)).toBeLessThanOrEqual(portrait.rackRowsFit)
    // And the row that is shown is inside the panel: the panel keeps its reserved place and its cards.
    expect(portrait.rackRowsFit * (portrait.bubblePx + LAYOUT.chrome.rackRowPx) + 2 * LAYOUT.chrome.rackPaddingPx + portrait.panelChromePx).toBeLessThanOrEqual(portrait.panelContentPx)
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
      // Portrait is the exception, and it is asserted as its own case above (issue #10).
      if (metrics.cell >= LAYOUT.tapTargetCssPx && !metrics.portrait) expect(metrics.rackFitsPanel).toBe(true)
    }

    // The phone is smaller than the places the panel has to hold, which is the same fact the flag reports:
    // the rack is clipped there rather than scrolled, and no layout can make 39 bubbles fit 294 CSS px.
    const phone = computeLayout({ width: 480, height: 320 }, GRID)
    expect(phone.rackFitsPanel).toBe(false)
    expect(phone.panelContentPx).toBeLessThan(phone.panelChromePx + phone.rackHeightPx)
  })
})

/** A goal card row, the ring being taller than the numeral inside it (SPEC §8.1). */
function goalCardRowPxFor(goalPx: number): number {
  return Math.max(LAYOUT.chrome.goalRingPx, goalPx) + 2 * LAYOUT.chrome.goalPaddingPx
}

