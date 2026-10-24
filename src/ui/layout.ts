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
  /** Board panel as a fraction of the viewport height. */
  boardFraction: number
  /** Celebration layer as a fraction of the viewport height. */
  celebrationFraction: number
  /** Cell size in CSS px. */
  cell: number
  /** Numerals scale with the cell, inside the bounds SPEC §13 gives. */
  levelPx: number
  goalPx: number
  /** Portrait layout: the panel goes below the board. */
  portrait: boolean
  /** The smallest tappable element is too small for this viewport. */
  tapTargetTooSmall: boolean
}

/**
 * SPEC §13: board <= 60% height, celebration <= 40%, numerals scale with the cell, every tap
 * target >= 48 device px (90 CSS px on the target tablet), portrait gets the fallback layout with
 * the panel below the board. Everything is derived from the viewport, so it survives the target
 * device's 1.41 aspect ratio and Chrome's UI resizing.
 */
export function computeLayout(viewport: Viewport, grid: GridSize): LayoutMetrics {
  const portrait = viewport.height > viewport.width
  const boardFraction = portrait ? LAYOUT.portraitBoardFraction : LAYOUT.boardFraction
  const celebrationFraction = portrait ? LAYOUT.portraitCelebrationFraction : LAYOUT.celebrationFraction

  // The board never uses more than 75% of the width, so cells are sized from
  // the board area and the whole grid always fits.
  const boardHeight = viewport.height * boardFraction
  const boardWidth = viewport.width * 0.75
  const cell = Math.max(
    LAYOUT.cellMinPx,
    Math.min(LAYOUT.cellMaxPx, Math.floor(Math.min(boardHeight / grid.rows, boardWidth / grid.cols))),
  )

  return {
    boardFraction,
    celebrationFraction,
    cell,
    levelPx: between(Math.round(cell * 0.46), FONTS.levelPx, 56),
    goalPx: between(Math.round(cell * 0.33), 28, FONTS.goalPx),
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

  root.style.setProperty('--board-fraction', String(metrics.boardFraction))
  root.style.setProperty('--celebration-fraction', String(metrics.celebrationFraction))
  root.style.setProperty('--cell', `${metrics.cell}px`)
  root.style.setProperty('--cols', String(grid.cols))
  root.style.setProperty('--rows', String(grid.rows))
  root.style.setProperty('--level-px', `${metrics.levelPx}px`)
  root.style.setProperty('--goal-px', `${metrics.goalPx}px`)

  return metrics
}

/** CSS `clamp()` is newer than the engine (SPEC §2), so the bounds are computed here instead. */
function between(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}
