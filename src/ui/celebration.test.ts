import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CELEBRATION, LAYOUT, PARTICLES, playButtonDelayMsFor } from '../game/constants'

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

describe('celebration module (issues #12, #13, #25-#28)', () => {
  it('reveals the play arrow pulsing, not just visible', () => {
    // The stylesheet cannot add the pulse by itself: `next--pulsing` is the class the module has to
    // put on the arrow. It used to remove the class on stop but never add it.
    const reveal = section('const reveal = (): void =>', 'if (reducedMotion)')
    expect(reveal).toContain('next--ready')
    expect(reveal).toContain('next--pulsing')
    expect(source).toContain("play.classList.remove('next--pulsing')")
  })

  it('opens the party with a three-burst volley instead of waiting for a balloon or the ambient timer', () => {
    // SPEC §10.1 phase 1 (issue #27): three bursts at 0/180/460ms. The ambient burst is every 60
    // frames, so a party that only drew on a balloon pop opened on a dimmed, still board.
    const start = section('function start(): void {', 'function stop(): void {')
    expect(start).toContain('spawnBurst(')
    expect(start).toContain('draw()')
    expect(start).toContain('later(180,')
    expect(start).toContain('later(460,')
  })

  it('owns and clears every timer it schedules, so a left party cannot tick into the next one', () => {
    expect(source).toContain('const timers: number[] = []')
    expect(section('function stop(): void {', 'return {')).toContain('clearTimers()')
    // The stagger and the reveal go through the tracked helper rather than bare `setTimeout`; the one
    // direct call is inside `later` itself.
    expect(source.match(/window\.setTimeout/g)).toHaveLength(1)
  })

  it('derives the play-arrow delay from the party the set actually has (issue #28)', () => {
    // The party read at start is the one the delay is built from, because a respawn can change the
    // count. The same number is written inline and used for the reveal timer, so the CSS fade-in and
    // the class that makes the arrow tappable cannot drift apart.
    const start = section('function start(): void {', 'function stop(): void {')
    expect(start).toContain('const size = partySize()')
    expect(start).toContain('const playDelay = playButtonDelayMsFor(size)')
    expect(start).toContain("play.style.setProperty('--play-button-delay'")
    expect(start).toContain('later(playDelay, reveal)')
    // Twelve balloons land at 2.52s and three at 1.44s, not at the old fixed 1500ms.
    expect(playButtonDelayMsFor(12)).toBe(2520)
    expect(playButtonDelayMsFor(3)).toBe(1440)
    expect(CELEBRATION.playButtonDelayMs).toBe(1500)
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

  it('builds the three-element balloon, one transform owner each (issues #25, #26)', () => {
    // `.balloon` owns the rise (the hit box travels with the balloon), `.balloon__float` owns the
    // endless sway/bob, `.balloon__shape` owns the pop. Reintroducing the single-element structure is
    // exactly the mid-rise silent pop this test exists to catch.
    const spawn = section('function spawnBalloon(', 'function start(): void {')
    expect(spawn).toContain("float.className = 'balloon__float'")
    expect(spawn).toContain("shape.className = 'balloon__shape'")
    expect(spawn).toContain('float.append(shape)')
    expect(spawn).toContain('el.append(float)')
    expect(spawn).toContain("el.classList.add('balloon--popped')")
    expect(spawn).not.toContain("el.style.transform")
  })

  it('sizes and hangs the balloons from the party size, with Rng jitter (issue #25)', () => {
    const spawn = section('function spawnBalloon(', 'function start(): void {')
    // Size jitter comes through a custom property the stylesheet multiplies, so a rotation re-sizes
    // the bunch without the module touching it again.
    expect(spawn).toContain("setProperty('--balloon-jitter'")
    expect(spawn).toContain('LAYOUT.balloonSizeJitter')
    // The spread is wider than the board, and the band is the upper half.
    expect(source).toContain('LAYOUT.balloonSpreadStart')
    expect(source).toContain('LAYOUT.balloonSpreadEnd')
    expect(source).toContain('LAYOUT.balloonBandBottomMin')
    expect(source).toContain('LAYOUT.balloonBandBottomMax')
    // The float period, phase and direction all come from the injected Rng (SPEC §2).
    expect(spawn).toContain('balloonFloatMsMin')
    expect(spawn).toContain('animationDirection')
    expect(spawn).toContain('-rng.next() * period')
  })

  it('assigns firework colour at spawn, from a 2-3 hue subset (issue #27)', () => {
    const burst = section('function spawnBurst(', 'function draw(): void {')
    expect(burst).toContain('burstHues()')
    expect(burst).toContain('particle.color =')
    expect(burst).toContain('PARTICLES.whiteShare')
    // The draw loop reads the stored colour; it never picks one per frame.
    const draw = section('function draw(): void {', '/** The number of balloons')
    expect(draw).toContain('ctx.fillStyle = particle.color')
    expect(draw).not.toContain('FIREWORK_COLORS[')
    expect(draw).toContain('PARTICLES.hotCoreLifeFraction')
    expect(draw).toContain('particle.radius *')
    // The caps are unchanged: 120/burst, 60 on the 30fps tier, pool 500.
    expect(PARTICLES.perBurst).toBe(120)
    expect(PARTICLES.degradePerBurst).toBe(60)
    expect(PARTICLES.capacity).toBe(500)
    expect(PARTICLES.ambientFrames).toBe(60)
    expect(LAYOUT.dprMax).toBe(2)
  })
})
