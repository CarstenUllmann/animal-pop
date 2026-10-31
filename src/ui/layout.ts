import { CHROME, FONTS, LAYOUT, MAX_BALLOONS } from '../game/constants'
import { bunchCapacity, spacingRungs, type BunchMetrics } from './bunch'

export interface Viewport {
  width: number
  height: number
}

export interface GridSize {
  rows: number
  cols: number
}

export interface LayoutMetrics {
  viewportWidth: number
  viewportHeight: number
  /** Panel share of the width in landscape. */
  panelWidthFraction: number
  /** Panel share of the height in portrait, where the panel sits above the board. */
  panelHeightFraction: number
  boardFraction: number
  /** Cell size in CSS px. */
  cell: number
  levelPx: number
  goalPx: number
  /** Rack bubble size and how many fit a row. */
  bubblePx: number
  rackColumns: number
  /** The play arrow, which is a tap target. */
  playPx: number
  /** Party balloon size, floored so every jittered balloon clears the tap target. */
  balloonPx: number
  /** The painted board's offset inside the overlay, not the overlay's size. */
  boardOffsetXPx: number
  boardOffsetYPx: number
  /** Top of the play arrow's no-go band, measured up from the board's bottom edge. */
  arrowBandPx: number
  /** Whether twelve balloons fit at the target spacing inside the keep-out. */
  bunchFitsBoard: boolean
  /** The floor for every interactive element. */
  interactivePx: number
  portrait: boolean
  tapTargetTooSmall: boolean
  /** The panel column, its row, and the row inside its padding. */
  panelColumnPx: number
  panelRowPx: number
  panelContentPx: number
  /** What the level label and goal cards take before the rack is allowed any. */
  panelChromePx: number
  /** The rack the fit is sized for, the rows it wraps to, and how many rows fit. */
  rackBubbles: number
  rackRows: number
  rackRowsFit: number
  rackHeightPx: number
  rackFitsPanel: boolean
  /** The square board against the area the fractions give it. */
  boardPx: number
  boardFitsArea: boolean
  boardAreaFraction: number
  panelAreaFraction: number
}

/**
 * Everything is derived from the viewport: the panel is a column in landscape and a row in portrait,
 * the board stays square in what is left, and every tap target keeps its floor.
 */
export function computeLayout(viewport: Viewport, grid: GridSize): LayoutMetrics {
  const portrait = viewport.height > viewport.width
  const boardFraction = portrait ? LAYOUT.portraitBoardFraction : LAYOUT.landscapeBoardFraction
  const panelWidthFraction = portrait ? 1 : LAYOUT.panelWidthFraction
  const panelHeightFraction = portrait ? 1 - LAYOUT.portraitBoardFraction : 1

  const panelColumnPx = Math.round(viewport.width * panelWidthFraction)
  const panelRowPx = Math.round(viewport.height * panelHeightFraction)

  // The board takes the smaller side of the space left after the panel and `.board-area`'s padding.
  const boardPaddingPx = 2 * CHROME.boardAreaPaddingPx
  const boardAreaWidthPx = portrait ? viewport.width : viewport.width - panelColumnPx
  const boardAreaHeightPx = portrait ? viewport.height - panelRowPx : viewport.height
  // Landscape's fraction already leaves the padding its room; portrait's fraction is the whole area.
  const boardHeight = portrait
    ? Math.floor(viewport.height * boardFraction) - boardPaddingPx
    : Math.floor(viewport.height * boardFraction)
  const boardWidth = boardAreaWidthPx - boardPaddingPx
  const cell = clamp(Math.floor(Math.min(boardHeight / grid.rows, boardWidth / grid.cols)), LAYOUT.cellMinPx, LAYOUT.cellMaxPx)

  const bubblePx = clamp(Math.round(cell * 0.26), LAYOUT.bubblePxMin, LAYOUT.bubblePxMax)
  const goalPx = clamp(Math.round(cell * 0.33), 28, FONTS.goalPx)
  const levelPx = clamp(Math.round(cell * 0.46), FONTS.levelPx, 56)
  const playPx = clamp(Math.round(cell * 0.90), LAYOUT.tapTargetCssPx, LAYOUT.cellMaxPx)

  const panelContentPx = panelRowPx - 2 * CHROME.panelPaddingPx
  // The goal cards are charged as two stacked rows, the worst case; side by side only frees room.
  const panelChromePx = LAYOUT.interactiveMinPx + 2 * goalCardRowPx(goalPx)
  const rackRowPx = bubblePx + CHROME.rackRowPx
  const rackBubbles = LAYOUT.rackSizingBubbles
  // Landscape keeps 3-4 per row; portrait's band takes whatever the panel width gives it.
  const rackWidth = rackWidthFor(panelColumnPx)
  const rackColumns = portrait
    ? bandColumnsFor(rackWidth, bubblePx, rackBubbles)
    : rackColumnsFor(rackWidth, bubblePx)
  const rackRows = Math.ceil(rackBubbles / rackColumns)
  const rackRowsFit = Math.max(0, Math.floor((panelContentPx - panelChromePx - 2 * CHROME.rackPaddingPx) / rackRowPx))
  const boardPx = cell * Math.max(grid.rows, grid.cols)

  // The floor is the smallest balloon after the −6% jitter, so a jittered balloon still clears it.
  const balloonFloorPx = Math.ceil(LAYOUT.balloonPxMin / (1 - LAYOUT.balloonSizeJitter))
  const balloonPx = Math.max(
    balloonFloorPx,
    Math.round(Math.min(boardAreaWidthPx * LAYOUT.balloonWidthFactor, boardAreaHeightPx * LAYOUT.balloonHeightFactor)),
  )

  // The overlay is `.board-area`'s padding box and the board is centred inside it. Where the cell is
  // clamped past the area, the board overhangs and the offset is read from the side, never negative.
  const contentWidthPx = boardAreaWidthPx - boardPaddingPx
  const contentHeightPx = boardAreaHeightPx - boardPaddingPx
  const boardOffsetXPx = Math.max(0, Math.round(CHROME.boardAreaPaddingPx + (contentWidthPx - boardPx) / 2))
  const boardOffsetYPx = Math.max(0, Math.round(CHROME.boardAreaPaddingPx + (contentHeightPx - boardPx) / 2))

  const arrowBandPx = arrowBandTopPx(
    Math.ceil((LAYOUT.celebrationBottomPaddingPct / 100) * boardAreaWidthPx),
    boardOffsetYPx,
    playPx,
    LAYOUT.balloonMarginPx,
  )

  const bunchBoard = bunchMetricsFor(boardPx, balloonPx, arrowBandPx)

  return {
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    panelWidthFraction,
    panelHeightFraction,
    boardFraction,
    cell,
    levelPx,
    goalPx,
    bubblePx,
    rackColumns,
    playPx,
    balloonPx,
    boardOffsetXPx,
    boardOffsetYPx,
    arrowBandPx,
    // The widest rung, counted with the worst spacing and the largest jittered balloon, is the
    // conservative check that the board can hold twelve balloons.
    bunchFitsBoard: bunchCapacity(bunchBoard, spacingRungs()[0] as number) >= MAX_BALLOONS,
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
    rackHeightPx: rackRows * rackRowPx + 2 * CHROME.rackPaddingPx,
    rackFitsPanel: rackRowsFit >= rackRows,
    boardPx,
    // Only a device clamped below the tap target runs past its area, which `tapTargetTooSmall` reports.
    boardFitsArea: boardPx + boardPaddingPx <= boardAreaHeightPx && boardPx + boardPaddingPx <= boardAreaWidthPx,
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
  root.style.setProperty('--balloon-px', `${metrics.balloonPx}px`)
  root.style.setProperty('--tap-min-px', `${metrics.interactivePx}px`)

  return metrics
}

/** 3-4 bubbles per row, charged conservatively with no horizontal spacing. */
function rackColumnsFor(rackWidth: number, bubblePx: number): number {
  const rowWidth = bubblePx + CHROME.rackRowPx
  const fits = Math.floor((rackWidth + CHROME.rackRowPx) / rowWidth)
  return clamp(fits, LAYOUT.rackColumnsMin, LAYOUT.rackColumnsMax)
}

/** Portrait's band takes as many columns as the panel width gives, never more than the rack holds. */
function bandColumnsFor(rackWidth: number, bubblePx: number, rackBubbles: number): number {
  const fits = Math.floor((rackWidth + CHROME.rackRowPx) / (bubblePx + CHROME.rackRowPx))
  return clamp(fits, LAYOUT.rackColumnsMin, rackBubbles)
}

/** The rack's width: the panel's content box less the chrome the stylesheet reserves around it. */
function rackWidthFor(panelColumnPx: number): number {
  return Math.max(
    0,
    panelColumnPx -
      2 * CHROME.panelPaddingXPx -
      CHROME.rackMarginPx -
      2 * CHROME.rackPaddingXPx,
  )
}

/** A goal card row: the ring is taller than its numeral, so the ring sets the height. */
function goalCardRowPx(goalPx: number): number {
  return Math.max(CHROME.goalRingPx, goalPx) + 2 * CHROME.goalPaddingPx
}

/** The board as the placement rule sees it: a square, the nominal balloon, and the arrow's band. */
export function bunchMetricsFor(boardPx: number, balloonPx: number, arrowBandPx: number): BunchMetrics {
  return { boardWidthPx: boardPx, boardHeightPx: boardPx, balloonPx, arrowBandPx }
}

/** The top of the play arrow's band, measured up from the board's bottom edge. */
function arrowBandTopPx(bandPx: number, boardOffsetYPx: number, playPx: number, marginPx: number): number {
  return Math.max(0, bandPx - boardOffsetYPx) + playPx + marginPx
}

/** CSS `clamp()` is newer than the engine, so the bounds are applied here. */
function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}
