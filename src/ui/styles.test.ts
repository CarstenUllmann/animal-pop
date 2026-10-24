import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CELEBRATION } from '../game/constants'
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

describe('celebration stylesheet', () => {
  it('rises the balloons with an animation, so the stagger the module sets can apply', () => {
    const balloon = rule('.balloon')
    expect(balloon).toContain('animation: balloon-rise')
    // The pop is a transition, so the inline `animation-delay` from CELEBRATION.balloonStaggerMs
    // staggers the entry without delaying a tap.
    expect(rule('.balloon--popped')).toContain('transition')
    expect(rule('.balloon--popped')).not.toContain('animation')
  })

  it('holds the play button until the fanfare has run, at the constant it mirrors', () => {
    expect(css).toContain(`--play-button-delay: ${CELEBRATION.playButtonDelayMs}ms`)
    expect(rule('.next')).toContain('animation-delay')
  })

  it('dim reads as a scrim on the overlay itself, not as a class on the board', () => {
    expect(rule('.celebration')).toContain('background: rgba(9, 12, 24, 0.35)')
    expect(css).not.toContain(':has(')
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
