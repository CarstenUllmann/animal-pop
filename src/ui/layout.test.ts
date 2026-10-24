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
