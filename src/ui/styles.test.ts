import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CELEBRATION, FONTS, LAYOUT } from '../game/constants'
import { CONFIRM_GLYPH, SHAKE_MS } from './adultReset'

/**
 * The stylesheet is part of the shipped code, so it is checked against the same numbers the
 * modules work from. CSS cannot read `game/constants.ts`, which is why `baseline.test.ts` already
 * reads it for engine-newer tokens; this is the same idea for the numbers that have to agree.
 */

const SRC = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(join(SRC, '..', 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

function rule(selector: string): string {
  const start = css.indexOf(`${selector} {`)
  if (start === -1) return ''
  return css.slice(start, css.indexOf('}', start))
}

function mediaBlock(): string {
  const start = css.indexOf('@media (prefers-reduced-motion: reduce)')
  if (start === -1) return ''
  let depth = 0
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}') {
      depth -= 1
      if (depth === 0) return css.slice(start, i + 1)
    }
  }
  return ''
}

/**
 * Issue #10: `html,` and `body` are written on two lines, so that rule has to be matched with its selector
 * normalised. Every other selector here is on one line, which is why `rule()` above can look for it as it is.
 */
function ruleFor(selector: string): string {
  const needle = selector.replace(/\s+/g, '')
  let i = 0
  while (i < css.length) {
    const open = css.indexOf('{', i)
    if (open === -1) return ''
    const close = css.indexOf('}', open)
    if (close === -1) return ''
    // A `}` can sit in front of the selector when the previous rule was a block inside a block, as in
    // `@keyframes`, so it is not part of the selector.
    if (css.slice(i, open).replace(/\s+/g, '').replace('}', '') === needle) return css.slice(open, close + 1)
    i = close + 1
  }
  return ''
}

/**
 * The CSS px a declaration reserves, read at 1rem = 16 px. `LAYOUT.chrome` mirrors these numbers because
 * `computeLayout` charges them against the panel and board areas, so the fit it reports has to be measured
 * against the chrome this file actually reserves.
 */
function dimensionFor(selector: string, property: string, index: number): number | null {
  const block = ruleFor(selector)
  const match = block.match(new RegExp(`(?:^|[;{])\\s*${property}:([^;}]+)`))
  if (!match) return null
  const value = (match[1] || '').trim().split(/\s+/)[index]
  if (!value) return null
  const number = parseFloat(value)
  if (Number.isNaN(number)) return null
  return value.endsWith('rem') ? Math.ceil(number * 16) : number
}

/** The custom properties the shell reads, and the ones `applyLayout` writes. vitest runs in node (see
 *  `vitest.config.ts`), so there is no element to write them onto and the two lists are compared as text. */
function customPropertiesRead(): string[] {
  return (css.match(/var\(\s*(--[a-z0-9-]+)/g) || []).map((text) => text.slice(4).trim())
}

function layoutWrites(name: string): boolean {
  return readFileSync(join(SRC, 'layout.ts'), 'utf8').includes(`setProperty('${name}'`)
}

describe('celebration stylesheet', () => {
  it('rises the balloons with an animation, so the stagger the module sets can apply', () => {
    const balloon = rule('.balloon')
    expect(balloon).toContain('animation: balloon-rise')
    // The pop is a transition, so the inline `animation-delay` from CELEBRATION.balloonStaggerMs
    // staggers the entry without delaying a tap.
    expect(rule('.balloon--popped')).toContain('transition')
    expect(rule('.balloon--popped')).not.toContain('animation')
  })

  it('lets the rise stop filling forward, or a tapped balloon cannot pop (SPEC §10.1)', () => {
    // `both`/`forwards` keeps the final keyframe - `transform: translateY(0) scale(1)` - applying after
    // the rise ends, and animation values beat the `.balloon--popped` declaration, so the transition had
    // nothing to animate. `backwards` still hides a balloon until its stagger arrives.
    expect(rule('.balloon')).toContain('animation: balloon-rise 600ms ease-out backwards')
    expect(rule('.balloon')).not.toContain('animation: balloon-rise 600ms ease-out both')
    expect(rule('.balloon--popped')).toContain('transform: scale(')
  })

  it('holds the play button until the fanfare has run, at the constant it mirrors', () => {
    expect(css).toContain(`--play-button-delay: ${CELEBRATION.playButtonDelayMs}ms`)
    expect(rule('.next')).toContain('animation-delay')
  })

  it('places the play arrow bottom-centre and rises the balloons from below it (SPEC §10.1)', () => {
    // The party is an overlay over the board, so its composition has to leave the balloons reachable and
    // the way out of the level unmistakable: the arrow owns the bottom-centre, the balloons rest above it.
    expect(rule('.celebration')).toContain('justify-content: flex-end')
    expect(rule('.celebration')).toContain('padding-bottom: 4%')
    expect(rule('.balloon')).toContain('bottom: 26%')
    expect(rule('.balloon')).not.toContain('top: 30%')
    // The rise has to travel from below the resting row, not just fade in where it lands.
    expect(css).toContain('transform: translateY(280%) scale(0.7)')
  })

  it('dim reads as a scrim on the overlay itself, not as a class on the board', () => {
    expect(rule('.celebration')).toContain('background: rgba(9, 12, 24, 0.35)')
    expect(css).not.toContain(':has(')
  })

  it('the layer hides itself, so a hidden layer cannot cover the board and swallow every tap', () => {
    // `[hidden]` and `.celebration` have the same specificity, so whichever rule comes later wins. The
    // layer sets `display: flex`, which beats the global `[hidden]` rule at the top of the file: the empty
    // overlay then covers the whole board area as an invisible full-size hit target and nothing is
    // tappable. The layer therefore has to carry its own hidden rule, after the rule that displays it.
    expect(ruleFor('.celebration[hidden]')).toContain('display: none')
    expect(css.indexOf('.celebration[hidden]')).toBeGreaterThan(css.indexOf('.celebration {'))
    expect(ruleFor('[hidden]')).toContain('display: none')
  })

  it('reduced motion keeps a single frame and shows no confetti (SPEC §13, §14)', () => {
    const media = mediaBlock()
    expect(media).toContain('.balloon')
    expect(media).toContain('animation: none')
    expect(media).toContain('.particle-layer')
    expect(media).toContain('visibility: hidden')
    // Issue #19: pops, bubbles, rings and completion still read. The ring selector has to be the one
    // the panel actually builds, and the rack keeps its gap even without the sparkle ring.
    expect(media).toContain('.goal__ring-fill')
    expect(media).toContain('.rack__bubble--just-spent')
    expect(media).toContain('.next--ready')
  })
})

describe('shell (SPEC §13, issue #10)', () => {
  it('puts the party as an overlay over the board rather than a band below it (issue #12)', () => {
    // The board area is the rect ui/celebration.ts measures, so the layer has to cover exactly it.
    expect(rule('.board-area')).toContain('position: relative')
    const overlay = rule('.celebration')
    expect(overlay).toContain('position: absolute')
    // `inset` is Chrome 87, so the overlay spells its four sides out (SPEC §6).
    expect(overlay).toContain('top: 0')
    expect(overlay).toContain('bottom: 0')
  })

  it('the shell is the grid the layout module drives, with a plain fallback for Chrome 61 (SPEC §6)', () => {
    const shell = rule('.game')
    expect(shell).toContain('grid-template-columns: 30% 70%')
    expect(shell).toContain('--panel-width-fraction')
    expect(shell).toContain('--panel-height-fraction')
    // `#app` is more specific than `.game`, so it must not carry a display that would beat the grid.
    expect(rule('#app')).not.toContain('display')
    // `gap` is Chrome 84, and the forbidden token list in baseline.test.ts says so.
    expect(css).not.toMatch(/(^|[\s{;])gap:/)
  })

  it('the play arrow is shown and hit-tested in the same step (issue #13)', () => {
    const ready = rule('.next--ready')
    expect(ready).toContain('opacity: 1')
    expect(ready).toContain('pointer-events: auto')
    expect(rule('.next')).toContain('pointer-events: none')
  })

  it('the level label and the mute have reserved places at least as big as the smallest target', () => {
    expect(rule('.panel__level')).toContain('min-height: var(--tap-min-px, 64px)')
    expect(rule('.mute')).toContain('var(--tap-min-px, 64px)')
    // Issue #10 extends the same rule across the shell: the play arrow on the board and the rack block. A
    // rack bubble stays inside SPEC §8.2's 22-26 px, so the 64 px is the place the block reserves rather
    // than a bubble's size, and the block is what shrinks when the panel has less than the row it needs.
    expect(rule('.next')).toContain('min-width: var(--tap-min-px, 64px)')
    expect(rule('.next')).toContain('min-height: var(--tap-min-px, 64px)')
    expect(rule('.rack')).toContain('min-height: var(--tap-min-px, 64px)')
    expect(rule('.rack__bubble')).not.toMatch(/min-(width|height)/)
    // Every place reads the number the layout module writes, so the reserved 64 px cannot drift from it.
    expect(rule('.panel__level')).toContain(`min-height: var(--tap-min-px, ${LAYOUT.interactiveMinPx}px)`)
    expect(rule('.next')).toContain(`var(--tap-min-px, ${LAYOUT.interactiveMinPx}px)`)
    expect(rule('.rack')).toContain(`var(--tap-min-px, ${LAYOUT.interactiveMinPx}px)`)
  })
})

describe('rack stylesheet (SPEC §8.2, issue #8)', () => {
  it('is a wrapping grid, because a plateau rack of 35 bubbles cannot fit one row', () => {
    const rack = rule('.rack')
    expect(rack).toContain('display: grid')
    expect(rack).toContain('repeat(var(--rack-columns, 4), var(--bubble-px, 22px))')
    expect(rule('.rack__bubble')).toContain('position: relative')
    // SPEC §8.2's 3-4 per row is what the layout module chooses within, and the rows are the wrap.
    expect(rack).toContain('grid-template-columns: repeat(4, 22px)')
  })

  it('the bubble that just paid for a tap sparkles in the same frame as the pop (issue #8)', () => {
    expect(rule('.rack__bubble--just-spent::after')).toContain('animation: bubble-sparkle')
    expect(css).toContain('@keyframes bubble-sparkle')
  })

  it('a spent bubble stays a gap, with no empty or warning state (SPEC §8.4)', () => {
    expect(css).toMatch(/\.rack__bubble--spent \{/)
    expect(css).not.toContain('#f00')
    expect(css).not.toMatch(/\.rack[^{]*\{[^}]*color: red/)
  })
})

describe('adult reset stylesheet', () => {
  it('shakes the numeral for half a second, matching the constant the module works from', () => {
    expect(rule('.panel__level-value.panel__level--shaking')).toContain(`animation: level-shake ${SHAKE_MS}ms`)
    expect(SHAKE_MS).toBe(500)
  })

  it('the confirm step is a glyph, and there is no text hint anywhere (SPEC §1)', () => {
    expect(CONFIRM_GLYPH).toHaveLength(1)
    expect(/[A-Za-z]/.test(CONFIRM_GLYPH)).toBe(false)
    // No hint text, no invitation to discovery: nothing in the level rules says "hold" or "press".
    expect(css).not.toMatch(/content: '[^']*hold[^']*'/)
    expect(css).not.toMatch(/content: '[^']*press[^']*'/)
  })

  it('the icon is hidden by the module, so the stylesheet may not set `display` on it', () => {
    expect(rule('.adult-confirm')).not.toContain('display')
  })

  it('reduced motion drops the shake but keeps the icon (SPEC §13)', () => {
    const media = mediaBlock()
    expect(media).toContain('.panel__level--shaking')
    expect(media).toContain('animation: none')
    expect(media).not.toContain('.adult-confirm')
  })
})

describe('mute stylesheet', () => {
  it('the mute is a 64 CSS px target (SPEC §11, §13)', () => {
    const mute = rule('.mute')
    expect(mute).toContain('width: 64px')
    expect(mute).toContain('height: 64px')
  })

  it('it sits in the panel corner, which is the one place it can never overlap the board (issue #17)', () => {
    const mute = rule('.mute')
    expect(mute).toContain('position: absolute')
    expect(mute).toContain('top:')
    expect(mute).toContain('right:')
    // The mute is mounted inside the panel, so the panel has to be its containing block. In landscape the
    // panel is the left column and in portrait the row above the board, so its corner is always its own.
    expect(rule('.panel')).toContain('position: relative')
    expect(rule('.panel')).not.toContain('flex-direction: row')
  })

  it('both states have a shape, taken from the same fact `aria-pressed` carries', () => {
    expect(css).toContain('.mute__waves')
    expect(css).toContain('.mute__cross')
    expect(css).toContain(".mute[aria-pressed='true']")
  })
})

/**
 * Issue #10's acceptance criteria, held to the stylesheet as the file that actually paints them. These
 * tests run in node, so they can only check what the rules say; what the rules do on the tablet is the part
 * that has to be looked at on the device.
 */
describe('the shell cannot scroll (SPEC §13, issue #10)', () => {
  it('the page itself is pinned', () => {
    const page = ruleFor('html, body')
    expect(page).toContain('height: 100%')
    expect(page).toContain('overflow: hidden')
    // Fixed rather than flowed, so the Chrome UI taking or giving back a band cannot make a scrollable page.
    expect(ruleFor('body')).toContain('position: fixed')
  })

  it('nothing in the shell, grid, panel, board or rack can create a scroll', () => {
    for (const selector of ['.game', '.board-area', '.panel', '.board', '.rack']) {
      const block = ruleFor(selector)
      // A rule that is not there would pass `not.toMatch` for everything, so it has to be present to read.
      expect(block).not.toBe('')
      expect(block).not.toMatch(/overflow: (auto|scroll)/)
    }
    // Clipping is the mechanism SPEC §13 asks for: the rack wraps inside the panel and what does not fit is
    // clipped there rather than pushed onto the board. `min-height: 0` is the other half of that, because a
    // flex item's minimum size is its content, and a rack that grows its row moves the board.
    expect(ruleFor('.panel')).toContain('overflow: hidden')
    expect(ruleFor('.rack')).toContain('overflow: hidden')
    expect(ruleFor('.panel')).toContain('min-height: 0')
    expect(ruleFor('.game')).toContain('min-height: 0')
  })
})

describe('the shell sizes itself from the custom properties the layout writes (SPEC §13, issue #10)', () => {
  it('every custom property the shell reads is one `applyLayout` writes, or is defined at `:root`', () => {
    for (const name of customPropertiesRead()) {
      expect(layoutWrites(name) || css.includes(`${name}:`)).toBe(true)
    }
    for (const name of ['--panel-width-fraction', '--panel-height-fraction']) {
      expect(ruleFor('.game')).toContain(`var(${name}`)
      expect(layoutWrites(name)).toBe(true)
    }
    for (const name of ['--cell', '--cols', '--rows']) {
      expect(ruleFor('.board')).toContain(`var(${name})`)
      expect(layoutWrites(name)).toBe(true)
    }
    for (const name of ['--rack-columns', '--bubble-px']) {
      expect(ruleFor('.rack')).toContain(`var(${name}`)
      expect(layoutWrites(name)).toBe(true)
    }
  })

  it('the plain value beside each custom property is the fallback, not the layout (SPEC §6)', () => {
    // Nothing here is a fixed pixel layout: each rule states its value twice, the plain one for an engine
    // that cannot read custom properties and the derived one for the engine the game runs on. Where the
    // layout module has a constant for the number, the fallback is held to it.
    expect(ruleFor('.next')).toContain(`var(--play-px, ${LAYOUT.tapTargetCssPx}px)`)
    expect(ruleFor('.rack')).toContain(`var(--bubble-px, ${LAYOUT.bubblePxMin}px)`)
    expect(ruleFor('.rack')).toContain(`var(--rack-columns, ${LAYOUT.rackColumnsMax})`)
    expect(ruleFor('.game')).toContain(`var(--panel-width-fraction, ${LAYOUT.panelWidthFraction})`)
    expect(ruleFor('.panel__level-value')).toContain(`var(--level-px, ${FONTS.levelPx}px)`)
    expect(ruleFor('.goal__numeral')).toContain(`var(--goal-px, ${FONTS.goalPx}px)`)
  })

  it('the chrome the layout model charges against the panel is the chrome this file reserves', () => {
    // `computeLayout` measures the rack against the panel row inside its padding, using these numbers. If a
    // rule here changes without the mirror in `LAYOUT.chrome` changing with it, `rackFitsPanel` is measuring
    // a panel the stylesheet does not paint.
    expect(dimensionFor('.panel', 'padding', 0)).toBe(LAYOUT.chrome.panelPaddingPx)
    expect(dimensionFor('.panel', 'padding', 1)).toBe(LAYOUT.chrome.panelPaddingXPx)
    expect(dimensionFor('.board-area', 'padding', 0)).toBe(LAYOUT.chrome.boardAreaPaddingPx)
    expect(dimensionFor('.goal', 'padding', 0)).toBe(LAYOUT.chrome.goalPaddingPx)
    expect(dimensionFor('.goal__ring', 'width', 0)).toBe(LAYOUT.chrome.goalRingPx)
    expect(dimensionFor('.rack', 'padding', 0)).toBe(LAYOUT.chrome.rackPaddingPx)
    expect(dimensionFor('.rack', 'padding', 1)).toBe(LAYOUT.chrome.rackPaddingXPx)
    expect(dimensionFor('.rack', 'margin-left', 0)).toBe(LAYOUT.chrome.rackMarginPx)
    expect(dimensionFor('.rack__bubble', 'margin-bottom', 0)).toBe(LAYOUT.chrome.rackRowPx)
  })
})

describe('the board is the dominant half of the shell (SPEC §13, issue #10)', () => {
  it('the grid gives the panel the smaller track and the board the rest, in both orientations', () => {
    const shell = ruleFor('.game')
    expect(shell).toContain('grid-template-columns: 30% 70%')
    expect(shell).toContain('1fr')

    // SPEC §13's 28-32% panel column, and the board taking whatever the panel does not.
    expect(LAYOUT.panelWidthFraction).toBeGreaterThanOrEqual(0.28)
    expect(LAYOUT.panelWidthFraction).toBeLessThanOrEqual(0.32)
    expect(LAYOUT.landscapeBoardFraction).toBeGreaterThan(LAYOUT.panelWidthFraction)

    // Portrait: the panel is the row above the board, so the board keeps the `1fr` row. The board area is
    // moved into that second track by the portrait rules, which is what makes the board the bigger half.
    expect(LAYOUT.portraitBoardFraction).toBeGreaterThan(1 - LAYOUT.portraitBoardFraction)
    expect(ruleFor('.board-area')).toContain('grid-column: 2')
    expect(ruleFor('.game.is-portrait .board-area')).toContain('grid-row: 2')
  })

  it('the board is sized from the cell the layout derives, and the party is an overlay over it', () => {
    // The board's own box is the derived cell times the grid, not a pixel size; the celebration claims no
    // track of its own (issue #12), which is what leaves the room for the 90 CSS px cell.
    expect(ruleFor('.board')).toContain('calc(var(--cell) * var(--cols))')
    expect(ruleFor('.board')).toContain('calc(var(--cell) * var(--rows))')
    expect(ruleFor('.board')).toContain('overflow: hidden')
  })
})
