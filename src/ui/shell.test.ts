import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * SPEC §15's kid-proofing (issue #20).
 *
 * The gestures themselves can only be checked on the tablet, so this is the half that can be asserted
 * without it: the rules and the listeners that make those gestures do nothing, and the one thing they
 * must never touch - a single-finger tap, which is the whole game. `styles.test.ts` already pins that the
 * shell cannot scroll; this pins the rest of §15's list, so the device check is testing whether the
 * implementation works rather than whether it exists.
 */

const SRC = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(join(SRC, '..', 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const html = readFileSync(join(SRC, '..', '..', 'index.html'), 'utf8')
const source = readFileSync(join(SRC, 'shell.ts'), 'utf8')

/**
 * The declarations of the block a selector owns. Matching the whole selector rather than searching for
 * `body {` is what keeps the `html, body` rule from answering for `body`, which is the difference between
 * "the shell cannot scroll" and "the shell cannot be long-pressed into a callout".
 */
function declarations(selector: string): string {
  const pattern = /([^{}]+)\{([^{}]*)\}/g
  let block: RegExpExecArray | null
  while ((block = pattern.exec(css)) !== null) {
    const ownSelector = block[1] as string
    if (ownSelector.trim().replace(/\s+/g, ' ') === selector) return block[2] as string
  }
  return ''
}

describe('kid-proofing (SPEC §15, issue #20)', () => {
  it('the viewport cannot be zoomed by the child', () => {
    const meta = /<meta\s+name="viewport"\s+content="([^"]*)"/.exec(html)
    expect(meta === null ? '' : meta[1]).toContain('maximum-scale=1')
    expect(meta === null ? '' : meta[1]).toContain('user-scalable=no')
  })

  it('the shell takes away pinch zoom, panning and double-tap zoom', () => {
    expect(declarations('html')).toContain('touch-action: none')
    // §15 also asks for `overscroll-behavior: none`, which Chrome 61 does not know and `baseline.test.ts`
    // keeps out of the stylesheet. `overflow: hidden` on the same shell is what actually stops a scroll,
    // and `styles.test.ts` asserts that, so the intent is met without the newer property.
    expect(declarations('html, body')).toContain('overflow: hidden')
  })

  it('nothing can be selected, long-pressed into a callout, or tap-highlighted', () => {
    const body = declarations('body')
    expect(body).toContain('user-select: none')
    expect(body).toContain('-webkit-user-select: none')
    expect(body).toContain('-webkit-touch-callout: none')
    expect(body).toContain('-webkit-tap-highlight-color: transparent')
  })

  it('covers the gestures CSS cannot cover', () => {
    // The context menu, text selection, drag, the gesture events and double-tap zoom are all things the
    // stylesheet cannot disable on Chrome/Android, so they are prevented here instead.
    for (const event of ['contextmenu', 'selectstart', 'dragstart', 'gesturestart', 'gesturechange', 'gestureend', 'dblclick']) {
      expect(source, event).toContain(`addEventListener('${event}'`)
    }
  })

  it('never blocks a single-finger tap, which is the game', () => {
    // The multi-touch guard fires only on more than one finger, so the tap the child makes is untouched,
    // and the module listens for no game input at all.
    expect(source).toContain('if (event.touches.length > 1) event.preventDefault()')
    expect(source).not.toMatch(/addEventListener\('(click|pointerdown|touchend)'/)

    // `preventDefault` on a touch or gesture listener only works when the listener is not passive, and the
    // default for these is passive, so the option is what makes the guard real rather than decorative.
    expect(source).toContain('{ passive: false }')
  })
})
