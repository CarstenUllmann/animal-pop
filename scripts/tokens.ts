import type { Plugin } from 'vite'
import { ADULT_RESET, CELEBRATION, CHROME, FONTS, GRID, LAYOUT } from '../src/game/constants.ts'

/**
 * CSS tokens, emitted at build time from `src/game/constants.ts` (ADR 0004).
 *
 * The stylesheet used to carry a second copy of every number a module also worked from - the chrome the
 * panel reserves, the balloon's height ratio, the shake, the arrow's band - and `styles.test.ts` parsed
 * the declarations to prove the two copies had not drifted. A mirror is a test-shaped promise; this is
 * the number itself. `style.css` reads `var(--token)` and the token is generated here, so there is one
 * copy and nothing to keep in step.
 *
 * The block is injected through a CSS `transform`, not a `<style>` tag in the document: `style-src
 * 'self'` in the shipped policy admits a same-origin stylesheet and nothing inline (issue #38), so the
 * tokens ride inside the stylesheet the build already emits. That also means the no-JS path gets them:
 * the defaults are in the same file as the rules that read them, and `ui/layout.ts` only overrides the
 * ones it measures.
 *
 * Only what `style.css` reads belongs here. A constant that no rule paints is not a token; a value the
 * layout module measures at runtime is a token's *default*, and the module writes the measured value
 * over it.
 */
export const CSS_TOKENS: Record<string, string> = {
  // The chrome ui/layout.ts charges against the panel and board areas (SPEC §13, issue #10).
  '--chrome-panel-padding': `${CHROME.panelPaddingPx}px`,
  '--chrome-panel-padding-x': `${CHROME.panelPaddingXPx}px`,
  '--chrome-board-padding': `${CHROME.boardAreaPaddingPx}px`,
  '--chrome-goal-padding': `${CHROME.goalPaddingPx}px`,
  '--chrome-goal-ring': `${CHROME.goalRingPx}px`,
  '--chrome-rack-padding': `${CHROME.rackPaddingPx}px`,
  '--chrome-rack-padding-x': `${CHROME.rackPaddingXPx}px`,
  '--chrome-rack-margin': `${CHROME.rackMarginPx}px`,
  '--chrome-rack-row': `${CHROME.rackRowPx}px`,

  // The shell's fallbacks (SPEC §13). Each is also written by `applyLayout` from the measurement; until
  // it runs - and for a reader without script - the constant is what the page paints.
  '--panel-width-fraction': String(LAYOUT.panelWidthFraction),
  '--tap-min-px': `${LAYOUT.interactiveMinPx}px`,
  '--play-px': `${LAYOUT.tapTargetCssPx}px`,
  '--bubble-px': `${LAYOUT.bubblePxMin}px`,
  '--rack-columns': String(LAYOUT.rackColumnsMax),
  '--level-px': `${FONTS.levelPx}px`,
  '--goal-px': `${FONTS.goalPx}px`,
  '--cols': String(GRID),
  '--rows': String(GRID),

  // The party (SPEC §10.1, issues #25, #26, #32, #35).
  '--balloon-px': `${LAYOUT.balloonPxMin}px`,
  '--balloon-ratio': String(LAYOUT.balloonHeightRatio),
  '--balloon-band': `${LAYOUT.balloonBandBottomMin}%`,
  '--balloon-rise-ms': `${CELEBRATION.balloonRiseMs}ms`,
  '--balloon-rise-ease': CELEBRATION.balloonRiseEase,
  '--balloon-collapse-ms': `${CELEBRATION.balloonCollapseMs}ms`,
  // The one sway cycle is 6-7s; the stylesheet's unscripted balloon sits in the middle of that.
  '--balloon-float-ms': `${(CELEBRATION.balloonFloatMsMin + CELEBRATION.balloonFloatMsMax) / 2}ms`,
  '--balloon-sway': `${CELEBRATION.balloonSwayPx}px`,
  '--balloon-bob': `${CELEBRATION.balloonBobPx}px`,
  // The 12.5%, 37.5%, 62.5% and 87.5% keyframes sit at 45 degrees of the sway, which is `sin(45°)` of it.
  '--balloon-sway-diag': `${round2(CELEBRATION.balloonSwayPx * Math.SQRT1_2)}px`,
  // The band the play arrow sits in, and the fallback place for a balloon the module has not placed.
  '--arrow-band': `${LAYOUT.celebrationBottomPaddingPct}%`,
  '--play-button-delay': `${CELEBRATION.playButtonDelayMs}ms`,

  // Adult reset (SPEC §14.2, issue #16).
  '--shake-ms': `${ADULT_RESET.shakeMs}ms`,
}

/** The stylesheet the tokens are prepended to. Only the entry sheet reads them. */
const ENTRY_STYLESHEET = 'src/style.css'

/** Two decimals is all a CSS px needs here, and `4.9497px` is noise in the sheet. */
function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/** The `:root` block the build prepends to the entry stylesheet. */
export function tokenCss(): string {
  const declarations = Object.keys(CSS_TOKENS).map((name) => `  ${name}: ${CSS_TOKENS[name]};`)
  return [
    '/* Generated from src/game/constants.ts by scripts/tokens.ts (ADR 0004). Do not edit by hand. */',
    ':root {',
    ...declarations,
    '}',
    '',
    '',
  ].join('\n')
}

/** A stylesheet id is not stable across platforms (Vite uses forward slashes; Windows may not). */
function isEntryStylesheet(id: string): boolean {
  return id.replace(/\\/g, '/').endsWith(ENTRY_STYLESHEET)
}

/**
 * Prepend the token block to the entry stylesheet, whatever the dev server or the build do with the
 * rest of it. Exported separately from the plugin so the transform is testable without running Vite.
 */
export function withTokens(id: string, css: string): string {
  return isEntryStylesheet(id) ? tokenCss() + css : css
}

/**
 * The build seam. `enforce: 'pre'` puts the block in front of the sheet before Vite's own CSS plugin
 * parses it, so minification and the `cssTarget` downlevelling see the tokens as ordinary declarations.
 */
export function cssTokens(): Plugin {
  return {
    name: 'animal-pop:css-tokens',
    enforce: 'pre',
    transform(code, id) {
      if (!isEntryStylesheet(id)) return null
      return { code: withTokens(id, code), map: null }
    },
  }
}
