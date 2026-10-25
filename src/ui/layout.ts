import { FONTS, LAYOUT, MAX_BALLOONS } from '../game/constants'
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
  /**
   * Columns the rack lays out: 3-4 in landscape (SPEC §13), and as many as the panel width allows in
   * portrait, where §13 makes the rack a horizontal band across the panel.
   */
  rackColumns: number
  /** The play arrow, which is a tap target (SPEC §10.1, §13). */
  playPx: number
  /** The party balloon size, from the measured board area, floored so every jittered balloon clears the floor (SPEC §10.1, issue #25). */
  balloonPx: number
  /**
   * Issue #32: the painted board's offset inside the overlay, not the overlay's size. The celebration is
   * `.board-area`'s padding box and the board is centred inside it, so "a position inside the board" cannot
   * be read as a percentage of the overlay - on the target tablet the board starts 89 CSS px across and
   * 30 CSS px up from the overlay's origin. `ui/bunch.ts` places centres against these, and the celebration
   * turns a place into inline px by adding them back.
   */
  boardOffsetXPx: number
  boardOffsetYPx: number
  /**
   * The top of the play arrow's no-go band, measured up from the board's bottom edge: the padding band the
   * arrow sits in, the arrow's own box, and `balloonMarginPx` clear of it (SPEC §10.1, *The arrow*). It is
   * the number the placement rule refuses, so a balloon can never land on the button she uses to move on.
   */
  arrowBandPx: number
  /** Whether `MAX_BALLOONS` fit at the target spacing inside the keep-out. Reported the way `boardFitsArea` is. */
  bunchFitsBoard: boolean
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
  /** The rack the fit is sized for (ADR 0001: the measured 35), the wrapped rows it needs, and whether they fit at once. */
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

  const panelColumnPx = Math.round(viewport.width * panelWidthFraction)
  const panelRowPx = Math.round(viewport.height * panelHeightFraction)

  // The board is sized from the space the panel leaves it, less the padding `.board-area` centres it
  // inside, and stays square by taking the smaller side. In portrait the panel is a row above the board,
  // so the board has the page width but not the height. Charging the padding is what keeps the bottom row
  // of a portrait board inside the viewport instead of painting under the page's `overflow: hidden`.
  const boardPaddingPx = 2 * LAYOUT.chrome.boardAreaPaddingPx
  const boardAreaWidthPx = portrait ? viewport.width : viewport.width - panelColumnPx
  const boardAreaHeightPx = portrait ? viewport.height - panelRowPx : viewport.height
  // Landscape's fraction is a cap that already leaves the padding its room (540 of 600 leaves 60);
  // portrait's fraction is the board's whole area, so the padding comes out of it.
  const boardHeight = portrait
    ? Math.floor(viewport.height * boardFraction) - boardPaddingPx
    : Math.floor(viewport.height * boardFraction)
  const boardWidth = boardAreaWidthPx - boardPaddingPx
  const cell = between(Math.floor(Math.min(boardHeight / grid.rows, boardWidth / grid.cols)), LAYOUT.cellMinPx, LAYOUT.cellMaxPx)

  const bubblePx = between(Math.round(cell * 0.26), LAYOUT.bubblePxMin, LAYOUT.bubblePxMax)
  const goalPx = between(Math.round(cell * 0.33), 28, FONTS.goalPx)
  const levelPx = between(Math.round(cell * 0.46), FONTS.levelPx, 56)
  const playPx = between(Math.round(cell * 0.90), LAYOUT.tapTargetCssPx, LAYOUT.cellMaxPx)

  // Issue #10: the fit is measured against the panel and board areas the fractions give, using the chrome
  // the stylesheet actually reserves (LAYOUT.chrome mirrors it), so a rack that fits here fits on screen.
  const panelContentPx = panelRowPx - 2 * LAYOUT.chrome.panelPaddingPx
  // The two goal cards are charged as two stacked rows, which is the worst case: they sit side by side when
  // the panel is wide enough (issue #19), so the fit holds either way. The level label's box is the reserved
  // place, and the mute is positioned rather than flowed, so it takes no row of its own.
  const panelChromePx = LAYOUT.interactiveMinPx + 2 * goalCardRowPx(goalPx)
  const rackRowPx = bubblePx + LAYOUT.chrome.rackRowPx
  const rackBubbles = LAYOUT.rackSizingBubbles
  // In landscape the rack keeps §8.2's 3-4 per row. In portrait §13 makes it a horizontal band across the
  // panel, so the columns are whatever the panel width gives it, capped by the rack itself - a band cannot
  // have more columns than bubbles.
  const rackWidth = rackWidthFor(panelColumnPx)
  const rackColumns = portrait
    ? bandColumnsFor(rackWidth, bubblePx, rackBubbles)
    : rackColumnsFor(rackWidth, bubblePx)
  const rackRows = Math.ceil(rackBubbles / rackColumns)
  const rackRowsFit = Math.max(0, Math.floor((panelContentPx - panelChromePx - 2 * LAYOUT.chrome.rackPaddingPx) / rackRowPx))
  const boardPx = cell * Math.max(grid.rows, grid.cols)
  // Issue #25: the balloon is the payoff, so it is sized from the board area it hangs over rather than
  // from a fixed 44px. Issue #32 raises the factors to 1.5x and the floor to 120 CSS px, which is the tap
  // target *after* the per-balloon -6% jitter has been applied: a jittered balloon can never fall under
  // 113 px, so a small board still shows a bunch rather than fingertip balloons. On the target tablet the
  // factors give 135 px (min(717 x 0.195, 600 x 0.225)).
  const balloonFloorPx = Math.ceil(LAYOUT.balloonPxMin / (1 - LAYOUT.balloonSizeJitter))
  const balloonPx = Math.max(
    balloonFloorPx,
    Math.round(Math.min(boardAreaWidthPx * LAYOUT.balloonWidthFactor, boardAreaHeightPx * LAYOUT.balloonHeightFactor)),
  )

  // Issue #32 (SPEC §10.1, *The bunch*): the overlay the celebration builds is `.board-area`'s padding box,
  // and the board is centred inside that box, so the board is not at the overlay's origin. The offset is the
  // padding plus half the slack the cell does not use; where the cell is clamped past the area (`cellMinPx`
  // on a phone) the board overhangs and the offset is the side it is read from, never a negative one.
  const contentWidthPx = boardAreaWidthPx - boardPaddingPx
  const contentHeightPx = boardAreaHeightPx - boardPaddingPx
  const boardOffsetXPx = Math.max(0, Math.round(LAYOUT.chrome.boardAreaPaddingPx + (contentWidthPx - boardPx) / 2))
  const boardOffsetYPx = Math.max(0, Math.round(LAYOUT.chrome.boardAreaPaddingPx + (contentHeightPx - boardPx) / 2))

  // The arrow's band: `.celebration`'s `padding-bottom` resolves against the overlay's width, the arrow box
  // is `playPx` tall inside it, and the same `balloonMarginPx` keeps the blob off the button. Read from the
  // board's bottom edge, which is where `ui/bunch.ts` refuses a centre. When the band is shallower than the
  // board's offset the arrow is below the board's edge, so the band contributes nothing there.
  const arrowBandPx = arrowBandTopPx(
    Math.ceil((LAYOUT.celebrationBottomPaddingPct / 100) * boardAreaWidthPx),
    boardOffsetYPx,
    playPx,
    LAYOUT.balloonMarginPx,
  )

  // Issue #33: the placement rule lives in `ui/bunch.ts`, so the fit is read off that rule rather than a
  // lattice this module keeps a second copy of. The board the rule is asked about is the painted board, the
  // nominal balloon on this device, and the band the arrow refuses.
  const bunchBoard = bunchMetricsFor(boardPx, balloonPx, arrowBandPx)

  return {
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
    // The fit is the worst case the placement rule can be held to (issue #33): the ladder's widest rung,
    // counted with the worst spacing and the largest jittered balloon the rung allows, so a board that
    // cannot hold that many centres cannot hold twelve balloons at that spacing. `ui/bunch.ts` owns the rule
    // this number is read from, and this is the assertion that keeps it honest: true on the target tablet
    // and on a portrait turn, false on a phone, where the count has to drop instead.
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
    rackHeightPx: rackRows * rackRowPx + 2 * LAYOUT.chrome.rackPaddingPx,
    rackFitsPanel: rackRowsFit >= rackRows,
    boardPx,
    // The board is only pushed past its area when `cellMinPx` clamps a device smaller than SPEC §13 assumes,
    // which is the case `tapTargetTooSmall` already reports rather than a layout that can be fixed here. The
    // test is against the area itself and includes the padding, because a board that fits a budget but not
    // the box it is centred in is exactly the portrait clipping this guards.
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

/** SPEC §8.2: 3-4 bubbles per row, chosen so the rack fits the panel without scrolling. */
function rackColumnsFor(rackWidth: number, bubblePx: number): number {
  // The row spacing is `LAYOUT.chrome.rackRowPx`, the stylesheet's own value, rather than a fraction of the
  // bubble: it is the same 6 px whatever the bubble size, and reading it as a fraction made the estimate
  // disagree with the rule. Charging no horizontal spacing keeps this the conservative side.
  const rowWidth = bubblePx + LAYOUT.chrome.rackRowPx
  const fits = Math.floor((rackWidth + LAYOUT.chrome.rackRowPx) / rowWidth)
  return between(fits, LAYOUT.rackColumnsMin, LAYOUT.rackColumnsMax)
}

/**
 * SPEC §13: in portrait the rack is a horizontal band across the panel width, so it takes as many columns as
 * the width gives it, capped by the bubbles the rack holds - a band cannot have more columns than bubbles, and
 * the fit has to describe the rack it is sizing for (ADR 0001). `rackColumnsMin` stays the floor, so a narrow
 * panel still keeps §8.2's 3 per row.
 */
function bandColumnsFor(rackWidth: number, bubblePx: number, rackBubbles: number): number {
  const fits = Math.floor((rackWidth + LAYOUT.chrome.rackRowPx) / (bubblePx + LAYOUT.chrome.rackRowPx))
  return between(fits, LAYOUT.rackColumnsMin, rackBubbles)
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

/**
 * Issue #33: the board as `ui/bunch.ts` sees it. The board is square (SPEC §13), so the two edges are the
 * same number, and this is all the placement rule needs to know about a device: the painted board, the
 * nominal balloon on it, and the band the play arrow refuses. Celebration asks for the same three numbers,
 * which is why the rule cannot disagree with the fit reported here.
 */
export function bunchMetricsFor(boardPx: number, balloonPx: number, arrowBandPx: number): BunchMetrics {
  return { boardWidthPx: boardPx, boardHeightPx: boardPx, balloonPx, arrowBandPx }
}

/** The top of the play arrow's band, measured up from the board's bottom edge (SPEC §10.1, *The arrow*). */
function arrowBandTopPx(bandPx: number, boardOffsetYPx: number, playPx: number, marginPx: number): number {
  return Math.max(0, bandPx - boardOffsetYPx) + playPx + marginPx
}

/** CSS `clamp()` is newer than the engine (SPEC §2), so the bounds are computed here instead. */
function between(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}
