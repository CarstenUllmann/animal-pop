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
  /**
   * Issue #10: the panel has to show everything at once, so the fit is a number the module can be held to
   * rather than a claim in a comment. The panel row inside its padding is what the level label's reserved
   * place, the two goal cards and the wrapped rack have to share, and nothing there scrolls.
   */
  /** The panel column and row, and the panel row inside its own padding. */
  panelColumnPx: number
  panelRowPx: number
  panelContentPx: number
  /** What the level label and the two goal cards take before the rack is allowed any. */
  panelChromePx: number
  /** SPEC §8.2's full rack of up to 39 bubbles, the wrapped rows it needs, and the rows fit at once. */
  rackBubbles: number
  rackRows: number
  rackRowsFit: number
  /** The rack box at `rackBubbles`, row spacing charged on every row as the stylesheet charges it. */
  rackHeightPx: number
  /** The whole rack is visible at once. A rack that does not fit is clipped, never scrolled. */
  rackFitsPanel: boolean
  /** The board box (square, SPEC §13) against the area the fractions give it. */
  boardPx: number
  boardFitsArea: boolean
  /** Shares of the page area: the board is the half she plays on, so it has to be the bigger one. */
  boardAreaFraction: number
  panelAreaFraction: number
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
  const goalPx = between(Math.round(cell * 0.33), 28, FONTS.goalPx)
  const levelPx = between(Math.round(cell * 0.46), FONTS.levelPx, 56)

  // Issue #10: the fit is measured against the panel and board areas the fractions give, using the chrome
  // the stylesheet actually reserves (LAYOUT.chrome mirrors it), so a rack that fits here fits on screen.
  const panelColumnPx = Math.round(viewport.width * panelWidthFraction)
  const panelRowPx = Math.round(viewport.height * panelHeightFraction)
  const panelContentPx = panelRowPx - 2 * LAYOUT.chrome.panelPaddingPx
  // The two goal cards are charged as two stacked rows, which is the worst case: they sit side by side when
  // the panel is wide enough (issue #19), so the fit holds either way. The level label's box is the reserved
  // place, and the mute is positioned rather than flowed, so it takes no row of its own.
  const panelChromePx = LAYOUT.interactiveMinPx + 2 * goalCardRowPx(goalPx)
  const rackRowPx = bubblePx + LAYOUT.chrome.rackRowPx
  const rackColumns = rackColumnsFor(rackWidthFor(panelColumnPx), bubblePx)
  const rackBubbles = LAYOUT.rackSizingBubbles
  const rackRows = Math.ceil(rackBubbles / rackColumns)
  const rackRowsFit = Math.max(0, Math.floor((panelContentPx - panelChromePx - 2 * LAYOUT.chrome.rackPaddingPx) / rackRowPx))
  const boardPx = cell * Math.max(grid.rows, grid.cols)

  return {
    panelWidthFraction,
    panelHeightFraction,
    boardFraction,
    cell,
    levelPx,
    goalPx,
    bubblePx,
    rackColumns,
    playPx: between(Math.round(cell * 0.90), LAYOUT.tapTargetCssPx, LAYOUT.cellMaxPx),
    interactivePx: LAYOUT.interactiveMinPx,
    portrait,
    tapTargetTooSmall: cell < LAYOUT.tapTargetCssPx,
    panelColumnPx,
    panelRowPx,
    panelContentPx,
    panelChromePx,
    rackBubbles,
    rackRows,
    rackRowsFit,
    rackHeightPx: rackRows * rackRowPx + 2 * LAYOUT.chrome.rackPaddingPx,
    rackFitsPanel: rackRowsFit >= rackRows,
    boardPx,
    // The board is only pushed past its area when `cellMinPx` clamps a device smaller than SPEC §13 assumes,
    // which is the case `tapTargetTooSmall` already reports rather than a layout that can be fixed here.
    boardFitsArea: boardPx <= boardHeight && boardPx <= boardWidth,
    boardAreaFraction: 1 - panelWidthFraction * panelHeightFraction,
    panelAreaFraction: panelWidthFraction * panelHeightFraction,
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
  // The row spacing is `LAYOUT.chrome.rackRowPx`, the stylesheet's own value, rather than a fraction of the
  // bubble: it is the same 6 px whatever the bubble size, and reading it as a fraction made the estimate
  // disagree with the rule. Charging no horizontal spacing keeps this the conservative side.
  const rowWidth = bubblePx + LAYOUT.chrome.rackRowPx
  const fits = Math.floor((rackWidth + LAYOUT.chrome.rackRowPx) / rowWidth)
  return between(fits, LAYOUT.rackColumnsMin, LAYOUT.rackColumnsMax)
}

/** The width the rack has: the panel's content box, less the chrome the stylesheet reserves around it. */
function rackWidthFor(panelColumnPx: number): number {
  // Every value here mirrors `style.css`, so the rack is measured against the panel it is painted inside
  // rather than against a round number that happened to work on the target device (issue #10).
  return Math.max(
    0,
    panelColumnPx -
      2 * LAYOUT.chrome.panelPaddingXPx -
      LAYOUT.chrome.rackMarginPx -
      2 * LAYOUT.chrome.rackPaddingXPx,
  )
}

/** A goal card row. The ring is taller than the numeral it holds (SPEC §8.1), so the ring sets the height. */
function goalCardRowPx(goalPx: number): number {
  return Math.max(LAYOUT.chrome.goalRingPx, goalPx) + 2 * LAYOUT.chrome.goalPaddingPx
}

/** CSS `clamp()` is newer than the engine (SPEC §2), so the bounds are computed here instead. */
function between(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}
