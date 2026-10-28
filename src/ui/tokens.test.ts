import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ADULT_RESET, CELEBRATION, CHROME, FONTS, GRID, LAYOUT } from '../game/constants'
import { CSS_TOKENS, cssTokens, tokenCss, withTokens } from '../../scripts/tokens'

/**
 * The build-time CSS contract (ADR 0004).
 *
 * `style.css` used to carry a second copy of the numbers `game/constants.ts` owns, and `styles.test.ts`
 * parsed the declarations to prove the copies had not drifted. The build now generates those numbers
 * into the sheet, so this suite holds the other end: every token is one the constants own, the
 * stylesheet reads it, and nothing defines it twice.
 */

const SRC = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(join(SRC, '..', 'style.css'), 'utf8')
const ROOT = join(SRC, '..', '..')
const block = tokenCss()

function declaredTokens(): string[] {
  return (block.match(/^\s*(--[a-z0-9-]+):/gm) || []).map((line) => line.trim().slice(0, -1))
}

describe('the token block', () => {
  it('is one `:root` rule, and every token is declared exactly once', () => {
    expect(block.match(/:root\s*\{/g)).toHaveLength(1)
    expect(block.trimEnd().endsWith('}')).toBe(true)
    const names = declaredTokens()
    expect(new Set(names).size).toBe(names.length)
    expect(names).toHaveLength(Object.keys(CSS_TOKENS).length)
  })

  it('has a concrete value for every token, with no accidental arithmetic', () => {
    for (const [name, value] of Object.entries(CSS_TOKENS)) {
      expect(name.startsWith('--')).toBe(true)
      expect(value).not.toBe('')
      expect(value).not.toContain('undefined')
      expect(value).not.toContain('NaN')
      expect(block).toContain(`${name}: ${value};`)
    }
  })

  it('carries the constants the modules work from, not a second set of numbers', () => {
    const expected: Array<[string, string]> = [
      ['--chrome-panel-padding', `${CHROME.panelPaddingPx}px`],
      ['--chrome-panel-padding-x', `${CHROME.panelPaddingXPx}px`],
      ['--chrome-board-padding', `${CHROME.boardAreaPaddingPx}px`],
      ['--chrome-goal-padding', `${CHROME.goalPaddingPx}px`],
      ['--chrome-goal-ring', `${CHROME.goalRingPx}px`],
      ['--chrome-rack-padding', `${CHROME.rackPaddingPx}px`],
      ['--chrome-rack-padding-x', `${CHROME.rackPaddingXPx}px`],
      ['--chrome-rack-margin', `${CHROME.rackMarginPx}px`],
      ['--chrome-rack-row', `${CHROME.rackRowPx}px`],
      ['--panel-width-fraction', String(LAYOUT.panelWidthFraction)],
      ['--tap-min-px', `${LAYOUT.interactiveMinPx}px`],
      ['--play-px', `${LAYOUT.tapTargetCssPx}px`],
      ['--bubble-px', `${LAYOUT.bubblePxMin}px`],
      ['--rack-columns', String(LAYOUT.rackColumnsMax)],
      ['--level-px', `${FONTS.levelPx}px`],
      ['--goal-px', `${FONTS.goalPx}px`],
      ['--cols', String(GRID)],
      ['--rows', String(GRID)],
      ['--balloon-px', `${LAYOUT.balloonPxMin}px`],
      ['--balloon-ratio', String(LAYOUT.balloonHeightRatio)],
      ['--balloon-band', `${LAYOUT.balloonBandBottomMin}%`],
      ['--balloon-rise-ms', `${CELEBRATION.balloonRiseMs}ms`],
      ['--balloon-rise-ease', CELEBRATION.balloonRiseEase],
      ['--balloon-collapse-ms', `${CELEBRATION.balloonCollapseMs}ms`],
      ['--balloon-float-ms', `${(CELEBRATION.balloonFloatMsMin + CELEBRATION.balloonFloatMsMax) / 2}ms`],
      ['--balloon-sway', `${CELEBRATION.balloonSwayPx}px`],
      ['--balloon-bob', `${CELEBRATION.balloonBobPx}px`],
      ['--balloon-sway-diag', `${Math.round(CELEBRATION.balloonSwayPx * Math.SQRT1_2 * 100) / 100}px`],
      ['--arrow-band', `${LAYOUT.celebrationBottomPaddingPct}%`],
      ['--play-button-delay', `${CELEBRATION.playButtonDelayMs}ms`],
      ['--shake-ms', `${ADULT_RESET.shakeMs}ms`],
    ]
    expect(expected.map(([name]) => name).sort()).toEqual(Object.keys(CSS_TOKENS).sort())
    for (const [name, value] of expected) expect(CSS_TOKENS[name]).toBe(value)
  })

  it('does not restate a token by hand in the stylesheet, so there is one definition of each', () => {
    for (const name of Object.keys(CSS_TOKENS)) {
      expect(css).not.toContain(`${name}:`)
      // ... and the stylesheet reads it from the block instead.
      expect(css).toContain(`var(${name})`)
    }
  })

  it('is prepended to the entry stylesheet only, on either kind of path', () => {
    const sheet = ':root { --bg: #101426; }'
    expect(withTokens('D:/src/animal-pop/src/style.css', sheet)).toBe(block + sheet)
    expect(withTokens('D:\\src\\animal-pop\\src\\style.css', sheet)).toBe(block + sheet)
    expect(withTokens('D:/src/animal-pop/src/ui/panel.css', sheet)).toBe(sheet)
    expect(withTokens('D:/src/animal-pop/src/main.ts', 'code')).toBe('code')
  })

  it('reaches the sheet through a `pre` transform, so Vite parses the tokens', () => {
    const plugin = cssTokens()
    expect(plugin.name).toBe('animal-pop:css-tokens')
    expect(plugin.enforce).toBe('pre')
    const transform = plugin.transform as unknown as (code: string, id: string) => { code: string } | null
    expect(transform('a {}', 'D:/src/animal-pop/src/other.css')).toBeNull()
    const result = transform('a {}', 'D:/src/animal-pop/src/style.css')
    expect(result?.code.startsWith(block)).toBe(true)
  })

  it('is wired into the build, which is the only place the stylesheet is processed', () => {
    const config = readFileSync(join(ROOT, 'vite.config.ts'), 'utf8')
    expect(config).toContain('cssTokens()')
  })

  it('ships inside the emitted stylesheet, so the CSP needs no inline style for it', () => {
    // Only after `npm run build`: the point is that the tokens are in a same-origin file, not in a
    // `<style>` tag that `style-src 'self'` would refuse (issue #38).
    const assets = join(ROOT, 'dist', 'assets')
    if (!existsSync(assets)) return
    const sheets = readdirSync(assets).filter((file) => file.endsWith('.css'))
    expect(sheets.length).toBeGreaterThan(0)
    const shipped = sheets.map((file) => readFileSync(join(assets, file), 'utf8')).join('\n')
    for (const name of Object.keys(CSS_TOKENS)) expect(shipped).toContain(name)
  })
})
