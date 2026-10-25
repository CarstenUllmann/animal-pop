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
})
