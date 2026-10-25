import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * `ui/celebration.ts` is a DOM module and vitest runs in node (`vitest.config.ts`), so the parts that
 * need a canvas cannot be mounted here. What can be held to is the source itself, the same way
 * `styles.test.ts` and `mute.test.ts` check the couplings that only exist in a browser.
 */

const SRC = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(SRC, 'celebration.ts'), 'utf8')

function section(start: string, end: string): string {
  const from = source.indexOf(start)
  if (from === -1) return ''
  const to = source.indexOf(end, from + start.length)
  return to === -1 ? source.slice(from) : source.slice(from, to)
}

describe('celebration module (issues #12 and #13)', () => {
  it('reveals the play arrow pulsing, not just visible', () => {
    // The stylesheet cannot add the pulse by itself: `next--pulsing` is the class the module has to
    // put on the arrow. It used to remove the class on stop but never add it.
    const reveal = section('const reveal = (): void =>', 'if (reducedMotion)')
    expect(reveal).toContain('next--ready')
    expect(reveal).toContain('next--pulsing')
    expect(source).toContain("play.classList.remove('next--pulsing')")
  })

  it('opens the party with fireworks instead of waiting for a balloon or the ambient timer', () => {
    // SPEC §10.1 phase 1 puts the fireworks in the first 500ms. The ambient burst is every 90 frames,
    // so a party that only drew on a balloon pop opened on a dimmed, still board.
    const start = section('function start(): void {', 'function stop(): void {')
    expect(start).toContain('spawnBurst(')
    expect(start).toContain('draw()')
  })

  it('owns and clears every timer it schedules, so a left party cannot tick into the next one', () => {
    expect(source).toContain('const timers: number[] = []')
    expect(section('function stop(): void {', 'return {')).toContain('clearTimers()')
    // The stagger and the reveal go through the tracked helper rather than bare `setTimeout`; the one
    // direct call is inside `later` itself.
    expect(source.match(/window\.setTimeout/g)).toHaveLength(1)
    expect(source).toContain('later(CELEBRATION.playButtonDelayMs, reveal)')
  })

  it('keeps only timers that can still fire, so a long party cannot grow the list', () => {
    // Every respawn of the balloon set schedules another handful. A list that also kept fired ids would
    // grow for as long as she plays, which is what "idles indefinitely" rules out (SPEC §10.1 phase 4).
    const later = section('function later(', 'function clearTimers')
    expect(later).toContain('timers.splice(at, 1)')
    expect(later).toContain('timers.push(id)')
  })

  it('times the browser\'s frames, not its own draw work, so the 30fps tier can actually fire', () => {
    // SPEC §10.2's budget is frame time. Timing this layer's own `draw()` (a few hundred arcs) always
    // reads healthy even while the screen runs at 25fps, so the degrade could never happen on the
    // tablet and #12's "observable and reversible" was only half true.
    const draw = section('function draw(): void {', '/** The number of balloons')
    expect(draw).toContain('meter.tick(now)')
    expect(draw).toContain('setTier(tick.tier)')
    expect(draw).not.toContain('workStart')
    expect(source).toContain('createFrameTierMeter()')
  })

  it('exposes the tier from the first party frame, not only after a change (issue #12)', () => {
    // `setTier` writes on change, so a healthy party carried no `data-tier` at all: the one observable
    // the device check has said nothing until the tablet was already in trouble.
    expect(source).toContain('root.dataset.tier = shownTier')
    const assignments = source.match(/root\.dataset\.tier = shownTier/g) ?? []
    expect(assignments.length).toBeGreaterThanOrEqual(2)
  })

  it('gives every balloon a colour, because the stylesheet fills it with currentColor', () => {
    // The SVG body is `fill: currentColor`; nothing set the inherited colour, so the party was a row of
    // white ovals rather than balloons (SPEC §10.1).
    expect(source).toContain('el.style.color')
    expect(source).toContain('BALLOON_COLORS')
  })
})
