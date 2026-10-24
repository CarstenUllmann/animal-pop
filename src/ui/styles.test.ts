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

  it('it sits in the party band, where it cannot overlap the board (issue #17)', () => {
    const mute = rule('.mute')
    expect(mute).toContain('position: absolute')
    expect(mute).toContain('top:')
    expect(mute).toContain('right:')
  })

  it('both states have a shape, taken from the same fact `aria-pressed` carries', () => {
    expect(css).toContain('.mute__waves')
    expect(css).toContain('.mute__cross')
    expect(css).toContain(".mute[aria-pressed='true']")
  })
})
