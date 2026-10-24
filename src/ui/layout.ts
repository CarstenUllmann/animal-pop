import { FONTS, LAYOUT } from '../game/constants'

export interface Viewport {
  width: number
  height: number
}

export interface GridSize {
  rows: number
  cols: number
}

export interface LayoutMetrics {
  /** Panel column share of the width in landscape (SPEC §13). */
  panelWidthFraction: number
  /** Panel row share of the height in portrait, where the panel stacks above the board. */
  panelHeightFraction: number
  /** Board share of the height. */
  boardFraction: number
  /** Cell size in CSS px. */
  cell: number
  /** Numerals scale with the cell, inside the bounds SPEC §13 gives. */
  levelPx: number
  goalPx: number
  /** Rack bubble size and how many fit a row (SPEC §8.2). */
  bubblePx: number
  rackColumns: number
  /** The play arrow, which is a tap target (SPEC §10.1, §13). */
  playPx: number
  /** The box reserved for every interactive element no larger than this (SPEC §13). */
  interactivePx: number
  /** Portrait layout: the panel stacks above the board. */
  portrait: boolean
  /** The smallest tappable element is too small for this viewport. */
  tapTargetTooSmall: boolean
}

/**
 * SPEC §13: the panel is the left column in landscape and stacks above the board in portrait, the
 * board stays square and centred in the space that is left, numerals scale with the cell, every tap
 * target is at least 48 device px (90 CSS px on the target tablet), and nothing interactive is
 * smaller than 64 CSS px. Everything is derived from the viewport rather than a fixed pixel layout,
 * so it survives the target device's 1.41 aspect ratio and Chrome UI resizing.
 *
 * The celebration is not a share of the page here: it is an overlay over the board (SPEC §10), which
 * is what makes the 90 CSS px cell reachable on the target device's 600 CSS px height - six rows of
 * 90 need 540, and a band for the party is what made those two clauses contradict each other.
 */
export function computeLayout(viewport: Viewport, grid: GridSize): LayoutMetrics {
  const portrait = viewport.height > viewport.width
  const boardFraction = portrait ? LAYOUT.portraitBoardFraction : LAYOUT.landscapeBoardFraction
  const panelWidthFraction = portrait ? 1 : LAYOUT.panelWidthFraction
  const panelHeightFraction = portrait ? 1 - LAYOUT.portraitBoardFraction : 1

  // The board is sized from the space the panel leaves it, and stays square by taking the smaller side.
  // In portrait the panel is a row above the board, so the board has the page width but not the height.
  const boardHeight = Math.floor(viewport.height * boardFraction)
  const boardWidth = portrait ? viewport.width : viewport.width - Math.round(viewport.width * LAYOUT.panelWidthFraction)
  const cell = between(Math.floor(Math.min(boardHeight / grid.rows, boardWidth / grid.cols)), LAYOUT.cellMinPx, LAYOUT.cellMaxPx)

  const bubblePx = between(Math.round(cell * 0.26), LAYOUT.bubblePxMin, LAYOUT.bubblePxMax)

  return {
    panelWidthFraction,
    panelHeightFraction,
    boardFraction,
    cell,
    levelPx: between(Math.round(cell * 0.46), FONTS.levelPx, 56),
    goalPx: between(Math.round(cell * 0.33), 28, FONTS.goalPx),
    bubblePx,
    rackColumns: rackColumnsFor(rackWidthFor(viewport, panelWidthFraction), bubblePx),
    playPx: between(Math.round(cell * 0.90), LAYOUT.tapTargetCssPx, LAYOUT.cellMaxPx),
    interactivePx: LAYOUT.interactiveMinPx,
    portrait,
    tapTargetTooSmall: cell < LAYOUT.tapTargetCssPx,
  }
}

/** Push the metrics into CSS custom properties on the root element. */
export function applyLayout(root: HTMLElement, viewport: Viewport, grid: GridSize): LayoutMetrics {
  const metrics = computeLayout(viewport, grid)

  root.classList.toggle('is-portrait', metrics.portrait)
  root.dataset.tapTarget = metrics.tapTargetTooSmall ? 'too-small' : 'ok'
  root.dataset.dpr = String(Math.min(window.devicePixelRatio || 1, LAYOUT.dprMax))

  root.style.setProperty('--panel-width-fraction', String(metrics.panelWidthFraction))
  root.style.setProperty('--panel-height-fraction', String(metrics.panelHeightFraction))
  root.style.setProperty('--board-fraction', String(metrics.boardFraction))
  root.style.setProperty('--cell', `${metrics.cell}px`)
  root.style.setProperty('--cols', String(grid.cols))
  root.style.setProperty('--rows', String(grid.rows))
  root.style.setProperty('--level-px', `${metrics.levelPx}px`)
  root.style.setProperty('--goal-px', `${metrics.goalPx}px`)
  root.style.setProperty('--bubble-px', `${metrics.bubblePx}px`)
  root.style.setProperty('--rack-columns', String(metrics.rackColumns))
  root.style.setProperty('--play-px', `${metrics.playPx}px`)
  root.style.setProperty('--tap-min-px', `${metrics.interactivePx}px`)

  return metrics
}

/** SPEC §8.2: 3-4 bubbles per row, chosen so the rack fits the panel without scrolling. */
function rackColumnsFor(rackWidth: number, bubblePx: number): number {
  const gap = Math.round(bubblePx * 0.25)
  const fits = Math.floor((rackWidth + gap) / (bubblePx + gap))
  return between(fits, LAYOUT.rackColumnsMin, LAYOUT.rackColumnsMax)
}

/** The width the rack has: the panel column in landscape, the page width in portrait, less its padding. */
function rackWidthFor(viewport: Viewport, panelWidthFraction: number): number {
  // The padding is the stylesheet's own rem value, so this is an estimate; the row count is capped at
  // SPEC §8.2's 3-4 anyway, and on the target device the panel column always has room for 4.
  return Math.max(0, Math.round(viewport.width * panelWidthFraction) - 24)
}

/** CSS `clamp()` is newer than the engine (SPEC §2), so the bounds are computed here instead. */
function between(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}
